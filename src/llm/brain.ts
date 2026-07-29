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
  /** Judges whether the snapshot satisfies an assert expectation. */
  judge(expectation: string, snapshot: string): Promise<AssertJudgment>;
}

/** Narrowed signature of `generateObject` so tests can inject a stub. */
export type GenerateObjectFn = (options: {
  model: LanguageModel;
  schema: z.ZodTypeAny;
  system?: string;
  prompt?: string;
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

    async judge(expectation, snapshot) {
      const result = await countedGenerate(generate, budget, {
        model,
        schema: assertJudgmentSchema,
        system: assertSystemPrompt(),
        prompt: assertUserPrompt(expectation, snapshot),
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
