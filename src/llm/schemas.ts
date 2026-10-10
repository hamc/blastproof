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
      ref: absentAsNull(
        z.string().describe('The ref of the target element, copied from its [ref=...] in the snapshot, e.g. "f1e25".'),
      ),
      role: absentAsNull(
        z.string().describe('ARIA role of that element, as its snapshot line shows it, e.g. "button", "link", "textbox".'),
      ),
      name: absentAsNull(
        z
          .string()
          .describe(
            'Accessible name of that element, exactly as its snapshot line shows it; its text after the colon when it has no quoted name.',
          ),
      ),
    }),
  ).describe('Element to act on, named by its ref in the accessibility snapshot. Null for navigate/done/fail, and for press on the focused element.'),
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
      ref: z.string().optional(),
      role: z.string().optional(),
      name: z.string().optional(),
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
/**
 * The judgment asks about the STEP (design ask-the-judge-about-the-step, D2).
 * `pass` used to be described as "Whether the snapshot satisfies the
 * expectation" — the question `judge-the-step` retired from the prompt and left
 * here, where the model reads it too. On inputs captured from a live run the
 * judge passed an executor's weakened claim ("redirected away from login, *or*
 * the Account menu is accessible") on its easy half, every time.
 *
 * `reason` comes first because structured output is generated in schema order:
 * the judge states what the step requires before deciding, instead of deciding
 * and then justifying. Order and descriptions were measured together; neither
 * half closed the measured wrong PASSes alone.
 *
 * `outcome` comes before both (design judge-the-outcome-not-the-means, D1): the
 * step rewritten with its action taken out. Asked about "dismiss the dialog and
 * verify it is gone" on a page where it was already gone, the judge failed it
 * for want of a dismissal (#121) — the verb, not the means or the claim, was
 * what it read as required. The sentence it decides now has no verb to satisfy.
 * That field, `pass`'s last two sentences and the prompt's paragraph on an
 * outcome that already held were each needed: leaving out any one left a
 * captured input wrong.
 */
export const assertJudgmentSchema = z.object({
  outcome: z
    .string()
    .describe(
      'The state the STEP asks for, rewritten as a sentence about the page with its action removed: ' +
        '"click Save and verify the note is listed" becomes "the note is listed"; "open the Account menu and ' +
        'verify it shows the email" becomes "the Account menu shows the email".',
    ),
  reason: z
    .string()
    .describe('One sentence: whether the snapshot shows that outcome.'),
  pass: z
    .boolean()
    .describe(
      'Whether the snapshot shows that outcome. The expectation is only a claim offered in support; ' +
        'it never replaces the step. False if any part of the outcome the step asks for is not shown, or cannot ' +
        'be assessed from this snapshot. An action the step names (click, dismiss, submit) is how its outcome is ' +
        'reached, not part of it: an outcome that holds passes whether or not that action was needed. An outcome ' +
        'that is an absence (gone, closed, dismissed, removed) is shown by the thing being absent. Where the step says ' +
        'the outcome appears (in the confirmation, in the list, for this order) is part of it: a value found only ' +
        'somewhere else on the page is false.',
    ),
});

/**
 * `outcome` is required of the model and optional here: it exists so the model
 * states the step's outcome before deciding it (design
 * judge-the-outcome-not-the-means, D1), and nothing downstream reads it, so a
 * judgment made without one is still a judgment.
 */
export type AssertJudgment = Omit<z.infer<typeof assertJudgmentSchema>, 'outcome'> & { outcome?: string };

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
