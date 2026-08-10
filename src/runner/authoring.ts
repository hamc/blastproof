import type { TestFile } from './testfile.js';

/** Which of a test file's two step lists a finding came from. */
export type StepOrigin = 'setup' | 'steps';

export interface AuthoringFinding {
  /** The test declaring the step. */
  test: TestFile;
  /** Which list the step came from — `setup` runs first and fails the same way. */
  origin: StepOrigin;
  /** 1-based position within `origin`'s list, as a reader counts them. */
  index: number;
  /** The step, verbatim. */
  step: string;
}

export interface AuthoringResult {
  findings: AuthoringFinding[];
}

/**
 * Steps that put a value into the page. Closed and small on purpose (design D3):
 * an unlisted verb produces a false negative — the check stays silent and the run
 * fails honestly, as it does today — while an unlisted connector produces a false
 * positive, flagging a step that works. Only one of those is worth risking.
 */
const VALUE_VERBS = ['fill', 'enter', 'type', 'input', 'set'];

/**
 * Anchored at the start of the step, not merely contained in it. Test steps are
 * imperative ("fill the note field"), so the leading word is the action; a step
 * using one of these words as a noun — `verify the type is Premium` — is a check,
 * and matching it anywhere would flag it. `\b` after the verb keeps `setup the
 * account` from matching `set`.
 */
const LEADING_VALUE_VERB = new RegExp(`^\\s*(?:${VALUE_VERBS.join('|')})\\b`, 'i');

/**
 * A step that names a value always carries one of these. Enumerating the ways to
 * *name* a value cannot be closed — that set is open English, and trying it flagged
 * `set the priority to High` — so the question is inverted (design D3): a bare step
 * is a verb followed by a field and stops. Widening this list can only ever quiet
 * the check, which makes it the safe one to extend.
 */
const CONNECTOR_WORDS = ['with', 'to', 'as', 'using', 'into', 'from', 'in'];

const CONNECTOR_WORD = new RegExp(`\\b(?:${CONNECTOR_WORDS.join('|')})\\b`, 'i');

/** A quote, an assignment or a placeholder is a value even with no connector word. */
const CONNECTOR_SYMBOL = /["'`:=]|\{\{env\./i;

/**
 * `fill in` and `type in` are phrasal verbs, so their `in` belongs to the verb and
 * says nothing about a value. Dropped before the connector test, so `fill in the
 * note field` stays a bare step while `enter Order not received in the subject
 * field` keeps the `in` that introduces where the value goes.
 */
const PHRASAL_IN = new RegExp(`^(\\s*(?:${VALUE_VERBS.join('|')}))\\s+in\\b`, 'i');

/** True when the step enters a value but supplies no source for it. */
function namesNoValue(step: string): boolean {
  if (!LEADING_VALUE_VERB.test(step)) return false;
  const withoutPhrasal = step.replace(PHRASAL_IN, '$1');
  return !CONNECTOR_WORD.test(withoutPhrasal) && !CONNECTOR_SYMBOL.test(withoutPhrasal);
}

/**
 * Pure detection of steps the executor cannot carry out (design steps-name-their-value
 * D1–D9). `src/llm/prompts.ts` forbids the executor from inventing a value — one it
 * types must come from the step, from the page, or from an `{{env.*}}` placeholder —
 * so a step supplying none of the three is required to fail, several model calls into
 * a run. This predicts that from the parsed test file, with no browser, model, network
 * or key.
 *
 * Covers `setup` as well as `steps` (D2): setup steps run through the same executor
 * and fail the same way, and a check that covered one list would be the call-site
 * shape AGENTS.md names as this repository's recurring defect.
 *
 * **English only** (D9). The verb set, the connectors and the phrasal-verb exception
 * are English grammar; a step in another language matches no verb and yields no
 * finding. An empty result therefore means "nothing found in English", never "this
 * suite was checked" — callers must not present it as coverage.
 *
 * Findings are grouped by test in input order, `setup` before `steps`, then step
 * order, so output is stable across runs.
 */
export function detectMissingValues(tests: TestFile[]): AuthoringResult {
  const findings: AuthoringFinding[] = [];
  for (const test of tests) {
    for (const origin of ['setup', 'steps'] as const) {
      const steps = origin === 'setup' ? (test.setup ?? []) : test.steps;
      steps.forEach((step, position) => {
        if (namesNoValue(step)) {
          findings.push({ test, origin, index: position + 1, step });
        }
      });
    }
  }
  return { findings };
}

/**
 * The offending step with a value clause appended — the shape to follow, not a value
 * (design D6). `<value>` stays literal: guessing one is exactly what `prompts.ts`
 * forbids the executor from doing, and a check that did it while enforcing the rule
 * against everyone else would not deserve to be believed.
 */
export function suggestValueClause(step: string): string {
  return `${step.trimEnd()} with <value>`;
}
