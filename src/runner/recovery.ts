import type { AgentAction } from '../llm/schemas.js';
import { referencedEnvVars } from './env.js';

/**
 * The actions that commit — the point at which a side effect lands in the
 * application (design contained-recovery, D1).
 *
 * `fill` and `select` populate controls and only become an effect when
 * something commits them; refusing a repeated `fill` would block the
 * legitimate re-typing that a form reset by a redirect genuinely requires.
 * `navigate` is a GET whose entire effect is visible in the very next
 * snapshot, and refusing it would remove the model's only way to restore
 * preconditions while protecting nothing. `assert` never mutates by
 * definition.
 */
const COMMIT_ACTIONS: ReadonlySet<string> = new Set(['click', 'press']);

/**
 * The keys that activate a control. A `press` only commits when it is one of
 * these: `Enter` submits a form, and space activates a focused button.
 *
 * Guarding every `press` was tried and was wrong — it broke a step that walks
 * the page with repeated `Tab`, which is exactly the kind of legitimate
 * repetition this guarantee must not touch. Arrow keys, `Escape` and `Tab`
 * move focus or dismiss; they do not write.
 */
const COMMIT_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', ' ', 'Space', 'Spacebar']);

/**
 * The actions whose value is free text the model chose, and so the ones a
 * fabricated value can enter through (design refuse-an-invented-value, D6).
 *
 * `press` is absent because its value is a key name — `Enter`, `Tab` — which is
 * neither in the step nor on the page, so requiring a source would refuse every
 * press. `navigate` is absent because its value is a URL, already constrained by
 * `allowed_origins`: a stricter rule than this one, aimed at the same risk.
 */
const SOURCED_VALUE_ACTIONS: ReadonlySet<string> = new Set(['fill', 'select']);

/**
 * Whether every `{{env.*}}` variable `value` references is one `step` references
 * (design env-placeholder-must-be-named, D1).
 *
 * `referencedEnvVars` is deliberately the same function that decides what gets
 * substituted and what gets registered for masking (D2). This file used to carry
 * its own regex, and the two had already drifted: `{{ env.TOKEN }}` and
 * `Bearer {{env.TOKEN}}` are substituted by one and were not recognised by the
 * other. A value must not be able to expand under one definition of a
 * placeholder and be admitted under a different one.
 *
 * Names are compared exactly. Case is presentation for a typed value and is
 * normalised away everywhere else here, but `TOKEN` and `token` are two
 * variables holding two different secrets, so folding them together in the one
 * place that decides which secret gets typed would be a bug wearing a
 * convenience.
 */
function referencesOnlyNamedVars(value: string, step: string): boolean {
  const named = new Set(referencedEnvVars(step));
  return referencedEnvVars(value).every((name) => named.has(name));
}

/**
 * Case and spacing are presentation, so they are normalised away before any
 * comparison. Nothing beyond that (design D5): stripping punctuation or
 * reformatting numbers starts guessing at intent, and every such loosening
 * weakens the guarantee while looking like a kindness.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface StepHistoryEntry {
  /** Human-readable action, already masked. */
  action: string;
  /** The result it produced, already masked. */
  result: string;
}

/** Renders an action the way the CLI shows it: `click button "Add note" [value]`. */
export function describeAction(action: AgentAction): string {
  const target = action.target
    ? ` ${action.target.role ?? ''} "${action.target.name ?? action.target.text ?? ''}"`
    : '';
  const value = action.value ? ` [${action.value}]` : '';
  return `${action.action}${target}${value}`;
}

/**
 * Identity of an action for repeat detection: what it does, to what, with what.
 *
 * The value is taken **unresolved** — `{{env.TEST_PASSWORD}}` compares as
 * written, never as the secret it expands to — so the record can never retain
 * a substituted credential (design D1).
 */
function identity(action: AgentAction): string {
  return JSON.stringify([
    action.action,
    action.target?.role ?? '',
    action.target?.name ?? '',
    action.target?.text ?? '',
    action.value ?? '',
  ]);
}

/**
 * Holds what one step has already performed successfully, and decides whether
 * an incoming action would repeat it.
 *
 * Deliberately one object owning that decision rather than a check written at
 * the point an action is performed. The guarantee is over the step as a whole,
 * and this project's recurring defect is exactly a guarantee implemented at a
 * call site instead of over its scope — it has produced a secret leak, a
 * budget that missed `plan`, and a timeout that missed `auth`.
 *
 * A new instance per step is the whole of the "does not cross steps" rule:
 * there is no reset method to forget to call.
 *
 * The guarantee covers the whole step and not only recovery after a failed
 * judgment. That narrower scoping was implemented first and **the reproduction
 * disproved it**: against the demo app's notes page the model went
 * `click "Add note"` -> `fill "Test note"` -> `click "Add note"` with no
 * assertion anywhere in between, so no judgment had failed, the guard did not
 * apply, and the duplicate note was written exactly as before. The trigger is
 * not a failed judgment — it is a page that has lost the evidence of what was
 * done to it, which the model re-reads as an untouched page whether or not
 * anyone judged it.
 */
export class StepRecovery {
  private readonly performed = new Set<string>();
  private readonly history: StepHistoryEntry[] = [];
  /**
   * Everything the model has been allowed to read this step, normalised: the
   * step's own text, plus every snapshot it has been shown, plus every value it
   * has already typed successfully.
   *
   * One accumulating haystack rather than the snapshot in hand (design D2). The
   * model may read an order number on one page, navigate away, and type it into
   * a box on another — at that moment the current snapshot does not contain it,
   * and a check against only that snapshot would refuse a legitimate action.
   *
   * Bounded by construction: `max_snapshot_lines` caps each snapshot,
   * `maxIterationsPerStep` caps how many arrive, and the instance dies with the
   * step — which is also the whole of the "does not cross steps" rule.
   */
  private readonly readable: string[];
  /**
   * The step exactly as written, for deciding which `{{env.*}}` variables it
   * names (design env-placeholder-must-be-named, D3). Kept alongside the
   * normalised copy rather than derived from it: `readable` is lowercased, and
   * environment variable names are case-sensitive, so `TOKEN` and `token` must
   * stay distinguishable in the one place that decides which secret gets typed.
   */
  private readonly step: string;

  constructor(step: string) {
    this.step = step;
    this.readable = [normalise(step)];
  }

  /**
   * Records a snapshot the model was shown, as a source it may quote from.
   *
   * Takes the **masked** text (design D4). `executor.ts` shows the model
   * `mask(snap)` and never the raw tree, so a secret rendered on the page is
   * `***` to the model and cannot have been copied by it. Accepting the raw
   * snapshot here would credit the model with access it never had, and would
   * leave the executor and the model disagreeing about what the page said.
   */
  observe(maskedSnapshot: string): void {
    this.readable.push(normalise(maskedSnapshot));
  }

  /** Records an action that was actually performed and succeeded. */
  record(action: AgentAction, description: string, result: string): void {
    this.performed.add(identity(action));
    this.history.push({ action: description, result });
    // A value that passed the source check when it was typed stays quotable for
    // the rest of the step: a transitive closure over already-validated values,
    // not a hole. It covers the case `contained-recovery` was built for — a
    // submit answered by a redirect that empties the form, where the page has
    // just lost the value the model legitimately used a moment ago.
    if (action.value) this.readable.push(normalise(action.value));
  }

  /**
   * The reason to refuse `action`, or `undefined` when it may be performed.
   *
   * Refusing rather than failing keeps the model in the loop with an
   * explanation instead of ending the step outright, which would trade
   * duplicate writes for false failures.
   *
   * A genuine retry — a commit that landed but had no effect, which the model
   * repeats for good reason — is refused too, and that is the deliberate cost.
   * The two cases are indistinguishable from the accessibility tree: "the
   * click did nothing" and "the click worked and the redirect erased the
   * proof" produce the same snapshot. The asymmetry decides it. A refused
   * legitimate retry costs a visible failed step that someone investigates; an
   * allowed duplicate commit costs a silent extra row in someone's database,
   * and #28 has now produced one on three applications.
   */
  refusalFor(action: AgentAction): string | undefined {
    return this.repeatedCommitRefusal(action) ?? this.unsourcedValueRefusal(action);
  }

  private repeatedCommitRefusal(action: AgentAction): string | undefined {
    if (!COMMIT_ACTIONS.has(action.action)) return undefined;
    if (action.action === 'press' && !COMMIT_KEYS.has(action.value ?? '')) return undefined;
    if (!this.performed.has(identity(action))) return undefined;
    return (
      `refused: this exact action already succeeded earlier in this step, so it was NOT performed again. ` +
      `Repeating something that commits repeats whatever it changed in the application. If the page no longer ` +
      `shows that it worked, that is normal for a submit answered by a redirect — check the record of what you ` +
      `have already done. Verify the step's outcome another way, or fail the step.`
    );
  }

  /**
   * Refuses a typed value that came from nowhere the model was entitled to read
   * (design refuse-an-invented-value).
   *
   * `prompts.ts` has forbidden inventing a value since 0.7.0, and measured
   * against a real model the rule simply does not hold: given `fill the note
   * field`, the model supplied "This is a test note." twice and "This is a new
   * note" once, and the step passed all three times. A prompt instructs; it does
   * not enforce. The result is the false negative this project exists to remove
   * — a green test over an input nobody wrote, differing run to run, with
   * nothing in the report to say so because nothing knew.
   *
   * The comparison is `includes`, not equality: a value is legitimately a
   * fragment of a step that also names the field, and of a snapshot that also
   * holds the rest of the page.
   *
   * Unlike the authoring warning that predicts this before a run, nothing here
   * parses English, so the guarantee holds for a suite written in any language.
   */
  private unsourcedValueRefusal(action: AgentAction): string | undefined {
    if (!SOURCED_VALUE_ACTIONS.has(action.action)) return undefined;
    const value = action.value;
    if (!value) return undefined;
    // A variable the step never names is one the test never pointed at this
    // field, whatever else the value contains (design
    // env-placeholder-must-be-named, D1). Checked first and separately from the
    // exemption below, because this is the half the original design missed: it
    // asked whether a value was a placeholder, when what makes one legitimate is
    // whether the test asked for that secret. A model that produces a variable
    // name nobody showed it guessed, and the guess is what gets refused.
    if (!referencesOnlyNamedVars(value, this.step)) {
      const named = referencedEnvVars(this.step);
      return (
        `refused: the value "${value}" was NOT typed, because this step does not reference that {{env.*}} ` +
        `variable. ${named.length > 0 ? `This step references ${named.map((n) => `{{env.${n}}}`).join(', ')}.` : 'This step references no environment variable.'} ` +
        `A placeholder is a source only when the step names it — otherwise the test never asked for that secret ` +
        `to be typed here. Use a value this step supplies, or fail the step and say it supplies none.`
      );
    }
    // Now the exemption, and only now: substitution happens inside
    // `performAction`, after this point, so the placeholder is all there is to
    // see — and a masked value could match neither the step nor the page, so
    // comparing it as text would refuse every authenticated test
    // (refuse-an-invented-value, D3).
    if (referencedEnvVars(value).length > 0) return undefined;
    const needle = normalise(value);
    if (needle === '') return undefined;
    if (this.readable.some((source) => source.includes(needle))) return undefined;
    return (
      `refused: the value "${value}" was NOT typed, because it appears neither in this step nor anywhere on the ` +
      `pages you have been shown. A value you type must come from the step, from the page, or from an {{env.*}} ` +
      `placeholder — one you make up would put the test's verdict on an input nobody wrote. Use a value the step ` +
      `or the page gives you, or fail the step and say it supplies none.`
    );
  }

  /** The step's history so far, oldest first, for the model's prompt. */
  stepHistory(): StepHistoryEntry[] {
    return this.history;
  }
}
