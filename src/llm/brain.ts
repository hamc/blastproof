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
}) => Promise<{ object: unknown }>;

export class MalformedModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedModelOutputError';
  }
}

export function createBrain(
  model: LanguageModel,
  generate: GenerateObjectFn = generateObject as unknown as GenerateObjectFn,
): AgentBrain {
  return {
    async nextAction(input) {
      const result = await generate({
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
      const result = await generate({
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
): PlannerBrain {
  return {
    async planTest(input) {
      const result = await generate({
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
