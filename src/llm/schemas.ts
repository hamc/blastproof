import { z } from 'zod';

/**
 * A field the model may leave out, spelled the way every provider accepts.
 *
 * `.optional()` omits the key, and a strict validator refuses the whole request
 * for it — every key of an object must appear in `required`, and absence is
 * expressed as null. Anthropic reads the schema as a description and does not
 * care; OpenAI validates it before running the model, so the documented
 * `provider: openai` default made zero calls and reported `Provider returned
 * error` (#85, design portable-structured-output D1).
 *
 * The transform is what keeps this a wire-format change: `z.infer` still yields
 * `string | undefined`, so all twenty-two readers of an action see exactly what
 * they saw before. Verified against gpt-4o-mini, claude-haiku-4.5 and
 * gemini-2.5-flash-lite before it was written.
 */
function absentAsNull<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().transform((value) => value ?? undefined);
}

/** Every action the loop can take. Shared, so the two schemas below cannot disagree. */
const ACTION_NAMES = ['navigate', 'click', 'fill', 'press', 'select', 'assert', 'done', 'fail'] as const;

/**
 * The single structured decision the LLM returns on every loop iteration (design D3).
 */
export const agentActionSchema = z.object({
  action: z.enum(ACTION_NAMES).describe('The next browser action to perform for the current step.'),
  target: absentAsNull(
    z.object({
      role: absentAsNull(
        z.string().describe('ARIA role of the target element, e.g. "button", "link", "textbox".'),
      ),
      name: absentAsNull(
        z.string().describe('Accessible name of the target element, exactly as shown in the snapshot.'),
      ),
      text: absentAsNull(
        z.string().describe('Visible text of the target element, used as a fallback when no role matches.'),
      ),
    }),
  ).describe('Element to act on, resolved from the accessibility snapshot. Null for navigate/done/fail.'),
  value: absentAsNull(
    z
      .string()
      .describe(
        'Action payload: URL/path for navigate, text for fill, key for press (e.g. "Enter"), option label for select.',
      ),
  ),
  reasoning: z.string().describe('One sentence explaining why this action moves the step forward.'),
  expectation: absentAsNull(
    z.string().describe('For assert: the condition the current page snapshot must satisfy.'),
  ),
});

/**
 * The same action, validated *after* the wire schema has already transformed it.
 *
 * `generateObject` parses the model's answer with {@link agentActionSchema} and
 * hands back the transformed object, where an absent field is `undefined`. The
 * spec requires a malformed response to count as a failed attempt, so `brain.ts`
 * validates again to turn `unknown` into a typed action — and validating a
 * transformed object with the transforming schema rejects the model's own valid
 * answer, because `undefined` does not satisfy `nullable`. Measured: it reported
 * `Model returned an invalid action: Required` against a provider that had just
 * answered correctly.
 *
 * Wrapping the wire schema in `preprocess` to make it idempotent was tried and
 * refused by the provider: it emits an `anyOf`, and the strict validator wants
 * `required` inside every branch of one.
 *
 * So this shape is optional where that one is nullable. It never leaves the
 * process, so no validator ever sees it, and the assertion below fails the build
 * if the two ever describe different actions.
 */
const parsedAgentActionSchema = z.object({
  action: z.enum(ACTION_NAMES),
  target: z
    .object({
      role: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  value: z.string().optional(),
  reasoning: z.string(),
  expectation: z.string().optional(),
});

/**
 * Compile-time guard against the two schemas drifting apart. Assignability both
 * ways is type equality; a field added to one and not the other stops the build.
 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _schemasAgree: Mutual<
  z.infer<typeof parsedAgentActionSchema>,
  z.infer<typeof agentActionSchema>
> = true;
void _schemasAgree;

/** Validates an action the wire schema has already transformed. */
export function parseAgentAction(value: unknown): z.SafeParseReturnType<unknown, AgentAction> {
  return parsedAgentActionSchema.safeParse(value);
}

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
