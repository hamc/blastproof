import type { AgentAction } from '../llm/schemas.js';
import { hasVerificationClause, isVerificationStep } from './authoring.js';
import { REDACTION_PREFIX, referencedEnvVars } from './env.js';
import { FIELD_ROLES, snapshotFields } from './snapshot.js';

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

/** Enter, the key that submits a form from a field. */
const ENTER_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter']);

/** The key a press sends: `performAction` presses Enter when the model names none. */
function pressedKey(action: AgentAction): string {
  return action.value || 'Enter';
}

/** A click, or a press of a key that activates a control. */
function isCommit(action: AgentAction): boolean {
  if (!COMMIT_ACTIONS.has(action.action)) return false;
  return action.action !== 'press' || COMMIT_KEYS.has(pressedKey(action));
}

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
    ? ` ${action.target.role ?? ''} "${action.target.name ?? ''}"`
    : '';
  const value = action.value ? ` [${action.value}]` : '';
  return `${action.action}${target}${value}`;
}

/**
 * Identity of an action for repeat detection: what it does, to what, with what.
 *
 * The value is taken **unresolved** — `{{env.TEST_PASSWORD}}` compares as
 * written, never as the secret it expands to — so the record can never retain
 * a substituted credential (design D1). Its case is content, not presentation:
 * "Check the invoice" and "check the invoice" are two different notes.
 *
 * The target is identified by the element acted on, as the snapshot showed
 * it: the executor binds every target to its ref's line before this is asked
 * (design act-on-the-element-the-model-read, D5), so `role` and `name` are the
 * page's, and `name` is the line's inline text where it has no accessible name.
 * The ref itself is left out, because a control the application re-renders
 * gets a new one, and the #124 duplicate commit would pass. The name is
 * normalised, as the binding compares it.
 */
function identity(action: AgentAction): string {
  const role = action.target?.role ?? '';
  const name = action.target?.name ?? '';
  // A press with no key is the Enter it sends, not a third thing (#205).
  const value = action.action === 'press' ? pressedKey(action) : (action.value ?? '');
  return JSON.stringify([action.action, role, normalise(name), value]);
}

/** A control as the snapshot shows it: what a click on it is recorded under. */
export interface ActivatedControl {
  role?: string;
  name?: string;
}

/** The control a press activates: the button it is on, or the one the page named. */
function activatedControl(action: AgentAction, activates?: ActivatedControl): ActivatedControl | undefined {
  if (action.action !== 'press' || !isCommit(action)) return undefined;
  return normalise(action.target?.role ?? '') === 'button' ? action.target : activates;
}

/**
 * Identity of a commit: the control it activates, not the gesture (design
 * refuse-the-same-submit-twice, D1). Enter or Space on a button is that
 * button's click, and Enter in a field of a form is the click of the form's
 * default submit button, which the executor asked the page for and passes as
 * `activates`. `click "Add note"`, then Enter in the same form, wrote a second
 * note on `gpt-6-luna` (#205): two identities for one submit. A press with no
 * such control keeps its own identity.
 */
function commitIdentity(action: AgentAction, activates?: ActivatedControl): string {
  const control = activatedControl(action, activates);
  if (control === undefined) return identity(action);
  return identity({ action: 'click', target: { role: control.role, name: control.name }, reasoning: '' });
}

function fieldKey(field: { role?: string; name?: string }): string {
  return JSON.stringify([field.role ?? '', normalise(field.name ?? '')]);
}

/**
 * Whether `after` is `before` come back reset (design
 * refuse-the-same-submit-twice, D3): a field that held a value is on the page
 * again, same role and name, with no value in any occurrence. A wizard's next
 * page does not have the field, a "load more" list keeps its search box
 * filled, and a form answered by a redirect to itself has the field, emptied.
 */
function cameBackReset(before: string, after: string): boolean {
  // A field with no name cannot be told from another one, so it decides nothing.
  const now = new Map<string, boolean>();
  for (const field of snapshotFields(after)) now.set(fieldKey(field), (now.get(fieldKey(field)) ?? false) || field.filled);
  return snapshotFields(before).some((field) => field.name !== '' && field.filled && now.get(fieldKey(field)) === false);
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
  /** The last page the model was shown, as given to `observe` (masked, without refs). */
  private lastObserved: string | undefined;
  /**
   * The last action that succeeded, with the page it was decided on (design
   * repeat-a-click-that-moves-the-page, D1/D2). A commit that follows itself
   * on a page that moved is a tour's "Next", not a duplicate.
   */
  private lastSuccess:
    | { commit: string; own: string; named: boolean; page: string | undefined; action: AgentAction }
    | undefined;
  /**
   * The page each commit was last decided on, by commit identity (design
   * refuse-the-same-submit-twice, D6): what tells Enter in the next page of a
   * form from Enter in the same form again.
   */
  private readonly commitPages = new Map<string, string | undefined>();
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
  /**
   * Whether the step asks only for a check (design a-verification-step-only-looks,
   * D1). Read by the executor too, which refuses `done` in such a step.
   */
  readonly verifies: boolean;
  /**
   * Whether the step acts first and asks for a check after (design
   * judge-a-done-that-closes-a-check, D2). The executor judges a `done` in such
   * a step instead of closing it.
   */
  readonly checksAfterActing: boolean;

  /**
   * `step` is the step as written: the first source a typed value may come
   * from, and the one that names which `{{env.*}}` variables may be typed.
   * `judged` is the sentence the judge reads, which decides how
   * the step closes. They differ only for an action step joined with the check
   * after it (design an-action-step-takes-the-next-check, D4): a value only
   * that check names is one the page should show, not one to type.
   */
  constructor(step: string, judged: string = step) {
    this.step = step;
    this.readable = [normalise(step)];
    this.verifies = isVerificationStep(judged);
    // Joined, it checks by construction, whatever an unbalanced quote in the
    // written step does to the clause test.
    this.checksAfterActing = judged !== step || hasVerificationClause(judged);
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
    this.lastObserved = maskedSnapshot;
  }

  /**
   * Whether anything succeeded during this step (design close-a-step D1).
   *
   * Reads the history `record` already keeps rather than a flag threaded
   * through the loop: `record` is reached at one place, after `performAction`
   * returns without throwing, so this is "what worked" and not "what was
   * attempted" — a click that raised is correctly absent. A separate counter
   * would be one more thing a future branch can forget to increment, which is
   * the shape that let `timeoutMs` and the budget go unset at a single call
   * site while every other one set them.
   *
   * `observe` deliberately does not move it. Being shown a page is not doing
   * something to it.
   */
  get acted(): boolean {
    return this.history.length > 0;
  }

  /** Records an action that was actually performed and succeeded. */
  record(action: AgentAction, description: string, result: string, activates?: ActivatedControl): void {
    // Under both: the control it activated, so the button is refused after
    // Enter, and its own, for a later press whose control cannot be found.
    // `lastSuccess` under both as well: a lookup that finds the button once
    // and not the next time must not turn an allowed repeat into a refusal.
    const commit = commitIdentity(action, activates);
    this.performed.add(identity(action));
    this.performed.add(commit);
    if (isCommit(action)) this.commitPages.set(commit, this.lastObserved);
    const named = activatedControl(action, activates) !== undefined;
    this.lastSuccess = { commit, own: identity(action), named, page: this.lastObserved, action };
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
  refusalFor(action: AgentAction, activates?: ActivatedControl): string | undefined {
    return (
      this.verificationRefusal(action) ??
      this.repeatedCommitRefusal(action, activates) ??
      this.redactionLabelRefusal(action) ??
      this.unsourcedValueRefusal(action)
    );
  }

  /**
   * Refuses a typed value containing a redaction label (design
   * label-a-redaction-with-its-variable, D3).
   *
   * Checked before the source check because the source check would admit it:
   * `observe` credits the model with the masked snapshot, and the label is in
   * the masked snapshot. It is the mask's own writing, not the application's, so
   * typing it would put the words "[redacted TEST_EMAIL]" into a real field.
   * A prefix match rather than the exact label, because a model that copies
   * part of one, or rebuilds one around another name, is equally wrong.
   *
   * Translating it back into its placeholder was the alternative, and it is the
   * exemption #66 closed: the model would be choosing a secret to type.
   */
  private redactionLabelRefusal(action: AgentAction): string | undefined {
    if (!SOURCED_VALUE_ACTIONS.has(action.action)) return undefined;
    if (!action.value?.includes(REDACTION_PREFIX)) return undefined;
    return (
      `refused: the value was NOT typed, because it contains a redaction label. ${REDACTION_PREFIX} NAME] stands ` +
      `for the value of {{env.NAME}}, withheld from you; it is never a value the application should receive. ` +
      `To enter an environment value, use the {{env.*}} placeholder this step names. If the step names none, ` +
      `use a value it supplies, or fail the step.`
    );
  }

  /**
   * Refuses a commit in a step that only checks (design
   * a-verification-step-only-looks, D2). Without it the agent could make a check
   * true by producing what it checks: a click on "Add to cart" put the message a
   * verification looked for on the page, and the step passed (#139). Navigation
   * stays allowed, since a check may need another page; a link click does not,
   * since a link and a logout item look alike from here and `navigate` covers it.
   * First among the refusals, because it holds whatever was done before.
   */
  private verificationRefusal(action: AgentAction): string | undefined {
    if (!this.verifies || !isCommit(action)) return undefined;
    return (
      'refused: this step only verifies — it does not ask you to change anything, so clicking or pressing here ' +
      'could make the check pass by producing what it checks. Assert what the page shows. If what the step names ' +
      'is on another page, navigate there. If it is not shown, fail the step.'
    );
  }

  private repeatedCommitRefusal(action: AgentAction, activates?: ActivatedControl): string | undefined {
    if (!isCommit(action)) return undefined;
    const commit = commitIdentity(action, activates);
    const own = this.performed.has(identity(action));
    if (!own && !this.performed.has(commit)) return undefined;
    const control = activatedControl(action, activates);
    if (this.followsItselfOnAMovedPage(commit, identity(action), control !== undefined)) return undefined;
    if (this.pressedInANewField(action, commit)) return undefined;
    const rest =
      `It is the same control even under a new ref: refs are renumbered when the page changes. Repeating something that commits repeats whatever it changed in the application. If the page no longer ` +
      `shows that it worked, that is normal for a submit answered by a redirect — check the record of what you ` +
      `have already done. Verify the step's outcome another way, or fail the step.`;
    // A press refused as a click says which click (design
    // refuse-the-same-submit-twice, D4): told only that "this press" already
    // succeeded, a model that never pressed reads the refusal as false.
    if (!own && control !== undefined) {
      const key = pressedKey(action).trim() === '' ? 'Space' : pressedKey(action);
      return (
        `refused: pressing ${key} here activates ${control.role ?? ''} "${control.name ?? ''}", ` +
        `and the click on it already succeeded earlier in this step, so the key was NOT pressed. ${rest}`
      );
    }
    // The element named, and the ref disowned (design act-on-the-element-the-model-read,
    // D5): after a reload the same control has a new ref, and a model told only that
    // "this exact action" succeeded read the new ref as a different action and
    // insisted, 4 runs in 5 on the demo app's notes test.
    const target = action.target ? ` on ${action.target.role ?? ''} "${action.target.name ?? ''}"` : '';
    return (
      `refused: this ${action.action}${target} already succeeded earlier in this step, so it was NOT performed ` +
      `again. ${rest}`
    );
  }

  /**
   * The one repeat performed (design repeat-a-click-that-moves-the-page): the
   * same commit as the last action that succeeded, with nothing in between, on
   * a page that differs from the one that success was decided on. A tour's
   * "Next" or a "load more" needs it (#164). Both measured duplicates did
   * something else in between to restore the form, a `fill` (#124) or a click
   * on "New Issue" (#28), and a press that moved nothing is still refused.
   * Compared exactly on the ref-less text `observe` receives, so a re-render
   * alone is no change. `commit` is the control activated, so "Next" clicked
   * and "Next" entered are one control here.
   */
  private followsItselfOnAMovedPage(commit: string, own: string, named: boolean): boolean {
    const last = this.lastSuccess;
    if (last === undefined) return false;
    // The same control. Or the same press: a lookup that fails once must not
    // refuse a repeat that was allowed, and a wizard paged with Enter ends on
    // a button of another name. What a shared key must not do is join this
    // press to a different button that was already activated in the step.
    const joinsAnother = last.named && named && this.performed.has(commit);
    const same = last.commit === commit || (last.own === own && !joinsAnother);
    if (!same) return false;
    if (last.page === undefined || this.lastObserved === undefined || last.page === this.lastObserved) return false;
    // A form that came back empty moved too, and is no next page (#205): the
    // second click sent an empty form and failed a correct application.
    return !cameBackReset(last.page, this.lastObserved);
  }

  /**
   * Enter in a field that was not on the page when the button it activates was
   * last pressed (design refuse-the-same-submit-twice, D6): the next page of a
   * form, not the same form again. A two-page sign-in is email, Enter,
   * password, Enter, and both presses activate "Next". The duplicate has the
   * opposite shape: the form came back, so its field was there. The field is
   * the press's target, or for a press with no target the field the last
   * action filled, which is where the focus is. Without a named field, on a
   * page with an unnamed one, or while a field of that earlier page is still
   * shown, nothing can be told and the press is refused.
   */
  private pressedInANewField(action: AgentAction, commit: string): boolean {
    if (action.action !== 'press' || !ENTER_KEYS.has(pressedKey(action))) return false;
    const last = this.lastSuccess?.action;
    const field = action.target ?? (last !== undefined && SOURCED_VALUE_ACTIONS.has(last.action) ? last.target : undefined);
    if (field === undefined || !field.name || !FIELD_ROLES.has(field.role ?? '')) return false;
    const page = this.commitPages.get(commit);
    if (page === undefined || this.lastObserved === undefined) return false;
    const then = snapshotFields(page);
    if (then.some((one) => one.name === '' || fieldKey(one) === fieldKey(field))) return false;
    // And that earlier page is gone: a form that came back with one more
    // field still has the fields it had.
    const now = new Set(snapshotFields(this.lastObserved).map(fieldKey));
    return !then.some((one) => now.has(fieldKey(one)));
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
