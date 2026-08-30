import { generateObject, type LanguageModel } from 'ai';
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
import type { RunBudget } from '../runner/budget.js';
import type { StepHistoryEntry } from '../runner/recovery.js';
import {
  agentActionSchema,
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
async function countedGenerate(
  generate: GenerateObjectFn,
  budget: RunBudget,
  options: Parameters<GenerateObjectFn>[0],
): ReturnType<GenerateObjectFn> {
  budget.check();
  const result = await generate(options);
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
      const parsed = agentActionSchema.safeParse(result.object);
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
      const result = await countedGenerate(generate, budget, {
        model,
        schema: assertJudgmentSchema,
        system: assertSystemPrompt(),
        prompt: assertUserPrompt(step, expectation, snapshot, stepHistory),
        temperature: 0,
      });
      const parsed = assertJudgmentSchema.safeParse(result.object);
      if (!parsed.success) {
        throw new MalformedModelOutputError(
          `Model returned an invalid assert judgment: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      return parsed.data;
    },
  };
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
