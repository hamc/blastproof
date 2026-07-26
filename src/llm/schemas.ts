import { z } from 'zod';

/**
 * The single structured decision the LLM returns on every loop iteration (design D3).
 */
export const agentActionSchema = z.object({
  action: z
    .enum(['navigate', 'click', 'fill', 'press', 'select', 'assert', 'done', 'fail'])
    .describe('The next browser action to perform for the current step.'),
  target: z
    .object({
      role: z
        .string()
        .optional()
        .describe('ARIA role of the target element, e.g. "button", "link", "textbox".'),
      name: z
        .string()
        .optional()
        .describe('Accessible name of the target element, exactly as shown in the snapshot.'),
      text: z
        .string()
        .optional()
        .describe('Visible text of the target element, used as a fallback when no role matches.'),
    })
    .optional()
    .describe('Element to act on, resolved from the accessibility snapshot. Omit for navigate/done/fail.'),
  value: z
    .string()
    .optional()
    .describe(
      'Action payload: URL/path for navigate, text for fill, key for press (e.g. "Enter"), option label for select.',
    ),
  reasoning: z.string().describe('One sentence explaining why this action moves the step forward.'),
  expectation: z
    .string()
    .optional()
    .describe('For assert: the condition the current page snapshot must satisfy.'),
});

export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionName = AgentAction['action'];
export type AgentTarget = NonNullable<AgentAction['target']>;

/** Judgment returned by the LLM when evaluating an `assert` expectation against a snapshot. */
export const assertJudgmentSchema = z.object({
  pass: z.boolean().describe('Whether the snapshot satisfies the expectation.'),
  reason: z.string().describe('One sentence explaining the judgment.'),
});

export type AssertJudgment = z.infer<typeof assertJudgmentSchema>;

/**
 * A test draft returned by the planner (design D5). `routes` is deliberately absent:
 * it is set by code to the route the draft was generated for, never by the model (D6).
 */
export const generatedTestSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe('One line naming the user journey this test covers, e.g. "Applying a discount updates the cart total".'),
  steps: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Plain-English steps a QA engineer would follow, each naming controls exactly as they appear in the snapshot.',
    ),
  priority: z
    .enum(['P0', 'P1', 'P2'])
    .describe('P0 for revenue- or auth-critical journeys, P1 for main flows, P2 for edge cases.'),
  tags: z
    .array(z.string())
    .describe('Short lowercase tags grouping this test, e.g. ["cart", "checkout"].'),
});

export type GeneratedTest = z.infer<typeof generatedTestSchema>;
