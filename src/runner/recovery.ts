import type { AgentAction } from '../llm/schemas.js';

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

  /** Records an action that was actually performed and succeeded. */
  record(action: AgentAction, description: string, result: string): void {
    this.performed.add(identity(action));
    this.history.push({ action: description, result });
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

  /** The step's history so far, oldest first, for the model's prompt. */
  stepHistory(): StepHistoryEntry[] {
    return this.history;
  }
}
