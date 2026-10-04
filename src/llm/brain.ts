import { APICallError, generateObject, RetryError, type LanguageModel } from 'ai';
import type { z } from 'zod';
import {
  agentSystemPrompt,
  agentUserPrompt,
  assertSystemPrompt,
  assertUserPrompt,
  plannerSystemPrompt,
  plannerUserPrompt,
  type AgentIterationInput,
  type PlannerInput,
} from './prompts.js';
import { ProviderRefusedError, type RunBudget } from '../runner/budget.js';
import { labelledVariables, placeholdersAsLabels, redactionLabel } from '../runner/env.js';
import type { StepHistoryEntry } from '../runner/recovery.js';
import {
  agentActionSchema,
  parseAgentAction,
  assertJudgmentSchema,
  generatedTestSchema,
  type AgentAction,
  type AssertJudgment,
  type GeneratedTest,
} from './schemas.js';

/**
 * The LLM decision-maker used by the executor. Mocked in unit tests.
 */
export interface AgentBrain {
  /** Decides the single next action for the current step. Throws on malformed model output. */
  nextAction(input: AgentIterationInput): Promise<AgentAction>;
  /**
   * Judges whether the snapshot establishes the STEP's own outcome (design
   * judge-the-step, D1). `expectation` is the model's claim offered in
   * support of the step, not a substitute question — a claim that is true of
   * the snapshot but does not establish what the step describes must not
   * pass. Kept alongside the step because it is still useful: it says which
   * reading of the step the model is checking, and it belongs in reports.
   */
  judge(
    step: string,
    expectation: string,
    snapshot: string,
    stepHistory?: StepHistoryEntry[],
  ): Promise<AssertJudgment>;
}

/**
 * Narrowed signature of `generateObject` so tests can inject a stub.
 *
 * `temperature` is per call rather than per model on purpose (design D3,
 * deterministic-verdicts): one model instance has to serve a judgment that must
 * not move and an action choice that must be free to, and that is a property of
 * the question, not of the model.
 */
export type GenerateObjectFn = (options: {
  model: LanguageModel;
  schema: z.ZodTypeAny;
  system?: string;
  prompt?: string;
  temperature?: number;
}) => Promise<{ object: unknown; usage?: { totalTokens?: number } }>;

export class MalformedModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedModelOutputError';
  }
}

/**
 * The budget (design D2) wraps this single function, not the callers: every model
 * call in the product — agent action, assert judgment, planner (below) — is a
 * `generate` call made here. `check()` before means an over-budget call is never
 * issued; `record()` after means the AI SDK's `usage` (previously discarded) is
 * what the budget counts against, so an unconfigured budget costs nothing extra
 * and a configured one is total by construction, not by every caller remembering.
 */
/** A raw provider body is unbounded; a step's failure line is read in a terminal. */
const MAX_PROVIDER_DETAIL = 300;

/**
 * Quotes the provider instead of summarising it (design portable-structured-output D2).
 *
 * A refusal arrives as an `AI_APICallError` whose `message` is often whatever
 * short phrase the gateway chose — `Provider returned error` — while the
 * explanation sits in `responseBody`, unread. That is how a schema our
 * documented OpenAI default could never satisfy read as a broken tool for as
 * long as it did (#85): the provider named the field, the constraint and the
 * rule, and none of it reached anyone.
 *
 * Deliberately not per-case: nothing here knows what a schema rejection is, so
 * a credit limit, a rate limit and an unknown model are all improved by the
 * same three lines.
 */
function withProviderDetail(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const body = (error as { responseBody?: unknown }).responseBody;
  if (typeof body !== 'string' || body.length === 0) return error;
  // Collapsed: a body arrives pretty-printed and a failure line is one line.
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, MAX_PROVIDER_DETAIL);
  if (error.message.includes(detail)) return error;
  error.message = `${error.message} — provider said: ${detail}`;
  return error;
}

/**
 * Turns a call that got no response into a stop of the run (design
 * stop-the-run-when-the-provider-refuses, D1): an `APICallError` with an error
 * status or none (a network failure), alone or as the last error of the SDK's
 * exhausted retries. Decided on the type and the status, never on the message,
 * which is each provider's own prose. Anything else is left alone, including a
 * 2xx whose body did not parse: a response came back, and the next attempt may
 * well parse, so it stays a failed attempt as a malformed answer always has.
 */
function asProviderRefusal(error: unknown): unknown {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause)) return error;
  if (cause.statusCode !== undefined && cause.statusCode < 400) return error;
  // The body sits on the last attempt's error, not on the RetryError around it.
  withProviderDetail(cause);
  return new ProviderRefusedError(cause.statusCode, cause.message);
}

async function countedGenerate(
  generate: GenerateObjectFn,
  budget: RunBudget,
  options: Parameters<GenerateObjectFn>[0],
): ReturnType<GenerateObjectFn> {
  budget.check();
  let result: Awaited<ReturnType<GenerateObjectFn>>;
  try {
    result = await generate(options);
  } catch (error) {
    throw asProviderRefusal(withProviderDetail(error));
  }
  // Recorded even when the output later fails schema validation: the call was
  // made and spent tokens regardless of whether the model's answer parses.
  budget.record(result.usage);
  return result;
}

export function createBrain(
  model: LanguageModel,
  generate: GenerateObjectFn = generateObject as unknown as GenerateObjectFn,
  /**
   * Required, not optional: `plan`'s planner brain shipped uncounted because this
   * was optional and positional-third — exactly the shape that let it be skipped
   * (design D2, spec run-budget). An unbounded run is still expressible; it is
   * `new RunBudget()` with no limits, not the absence of an argument.
   */
  budget: RunBudget,
): AgentBrain {
  return {
    async nextAction(input) {
      // Deliberately unpinned (design D1, deterministic-verdicts). This call is
      // searching, not deciding: it is handed a page that may have been
      // redesigned since the test was written and asked what to do about it, and
      // sampling is how it finds a route the author did not anticipate. That is
      // self-healing. Pinning it would trade a visible flakiness problem for an
      // invisible one — a suite that heals less does not fail, it starts
      // reporting defects that are not there.
      const result = await countedGenerate(generate, budget, {
        model,
        schema: agentActionSchema,
        system: agentSystemPrompt(),
        prompt: agentUserPrompt(input),
      });
      const parsed = parseAgentAction(result.object);
      if (!parsed.success) {
        throw new MalformedModelOutputError(
          `Model returned an invalid action: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      return parsed.data;
    },

    async judge(step, expectation, snapshot, stepHistory) {
      // Pinned (design D1, deterministic-verdicts). This call decides, and two
      // decisions about one page must agree: it is the verdict `--min-score`
      // gates a merge on. Left at the provider's default — 1.0 for all three —
      // the same test scored 0 and then 100 against a real application with
      // nothing changed between the runs (#81).
      //
      // This narrows the distribution; it does not make a run reproducible.
      // Provider batching, floating point, and a gateway routing two calls to
      // different providers or quantizations all survive it.
      // One vocabulary for both sides (design ask-the-judge-about-the-step, D1):
      // the page already carries `[redacted NAME]`, so the step, the claim and
      // the record are read that way too. Done here rather than at the call
      // sites, so the first judgment, the re-observation and the login check all
      // get it.
      const asJudged = stepHistory?.map((entry) => ({
        action: placeholdersAsLabels(entry.action),
        result: placeholdersAsLabels(entry.result),
      }));
      const result = await countedGenerate(generate, budget, {
        model,
        schema: assertJudgmentSchema,
        system: assertSystemPrompt(),
        prompt: assertUserPrompt(
          placeholdersAsLabels(step),
          placeholdersAsLabels(expectation),
          snapshot,
          asJudged,
        ),
        temperature: 0,
      });
      const parsed = assertJudgmentSchema.safeParse(result.object);
      if (!parsed.success) {
        throw new MalformedModelOutputError(
          `Model returned an invalid assert judgment: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      return secretMismatch(placeholdersAsLabels(step), snapshot, asJudged, parsed.data);
    },
  };
}

/**
 * Fails a PASS on a step naming a secret the page does not show, when the page
 * shows a different one (design ask-the-judge-about-the-step, D5).
 *
 * Measured live after the step and the page were put in one vocabulary, the
 * judge still called `[redacted TEST_EMAIL]` a match for `[redacted TEST_OTHER]`
 * in 2 of 4 runs. A prompt instructs and does not enforce; labels are tokens the
 * mask writes, so comparing them is a check on our own output, not a reading of
 * prose.
 *
 * The two conditions beyond "X is not on the page" keep it off correct steps:
 * the record, because a step that typed a secret into a form it then submitted
 * names one the page no longer shows; and another label being present, because a
 * step asserting a secret is absent is right on a page that shows none. Only
 * ever turns PASS into FAIL.
 */
function secretMismatch(
  judgedStep: string,
  snapshot: string,
  judgedRecord: StepHistoryEntry[] | undefined,
  judgment: AssertJudgment,
): AssertJudgment {
  if (!judgment.pass) return judgment;
  const onPage = labelledVariables(snapshot);
  const inRecord = labelledVariables((judgedRecord ?? []).map((e) => `${e.action}\n${e.result}`).join('\n'));
  for (const name of labelledVariables(judgedStep)) {
    const others = onPage.filter((other) => other !== name);
    if (onPage.includes(name) || inRecord.includes(name) || others.length === 0) continue;
    const shown = others.map((other) => redactionLabel(other)).join(', ');
    return {
      ...judgment,
      pass: false,
      reason:
        `The step names ${redactionLabel(name)}, which appears neither on the page nor in this step's actions, ` +
        `while the page shows ${shown}: a different secret cannot satisfy it. (The judge had said: ${judgment.reason})`,
    };
  }
  return judgment;
}

/**
 * The LLM test writer used by the planner (design D5). Mocked in unit tests.
 */
export interface PlannerBrain {
  /** Generates one test draft for a route. Throws on malformed model output. */
  planTest(input: PlannerInput): Promise<GeneratedTest>;
}

export function createPlanner(
  model: LanguageModel,
  generate: GenerateObjectFn = generateObject as unknown as GenerateObjectFn,
  /** Required for the same reason as {@link createBrain}'s: see its budget param. */
  budget: RunBudget,
): PlannerBrain {
  return {
    async planTest(input) {
      // Deliberately unpinned, like `nextAction` and for a related reason
      // (design D1, deterministic-verdicts): a draft is read by a person before
      // it ever runs, so variance here costs a review comment rather than a
      // wrong verdict.
      const result = await countedGenerate(generate, budget, {
        model,
        schema: generatedTestSchema,
        system: plannerSystemPrompt(),
        prompt: plannerUserPrompt(input),
      });
      const parsed = generatedTestSchema.safeParse(result.object);
      if (!parsed.success) {
        throw new MalformedModelOutputError(
          `Model returned an invalid test draft: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      return parsed.data;
    },
  };
}
