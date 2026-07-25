/**
 * Prompts for the agentic execution loop (design D3: one structured action per iteration).
 */

export function agentSystemPrompt(): string {
  return `You are a meticulous QA agent executing one plain-English test step at a time in a real browser.

You receive the current page as a YAML accessibility snapshot (roles and accessible names, exactly what a user perceives) and decide the single next action to move the current step forward.

Rules:
- Return exactly ONE action per response. Never batch actions.
- Pick target elements exclusively from the current snapshot, using their exact role and accessible name. Never invent CSS selectors or guess elements not in the snapshot.
- Use "navigate" only with a URL or path as value. Use "fill" to type into textboxes/inputs. Use "press" for keyboard keys (value e.g. "Enter"). Use "select" for dropdowns (value = option label).
- Use "assert" with an expectation to verify page state (visible text, counts, URLs). Assertions never modify the page.
- Return "done" only when the current step is fully accomplished. Do not return "done" for work belonging to later steps.
- Return "fail" with a clear reason when the step is impossible to accomplish (element missing after retries, unexpected page state, blocking error).
- If your previous action errored, re-read the fresh snapshot and choose an alternative element or approach. Do not repeat the exact same failing action.
- Keep reasoning to one short sentence.`;
}

export interface AgentIterationInput {
  /** The plain-English step being executed. */
  step: string;
  /** Whether the step is a setup step (context for the model). */
  isSetup?: boolean;
  /** Current accessibility snapshot of the page. */
  snapshot: string;
  /** Result of the previous action attempt, if any ("ok: ..." or "error: ..."). */
  lastResult?: string;
  /** Remaining retry budget for failed attempts. */
  retriesLeft: number;
  /** Remaining action iterations before the step is aborted. */
  iterationsLeft: number;
}

export function agentUserPrompt(input: AgentIterationInput): string {
  const parts = [
    `Current ${input.isSetup ? 'setup ' : ''}step: ${input.step}`,
    '',
    'Page accessibility snapshot:',
    input.snapshot,
  ];
  if (input.lastResult) {
    parts.push('', `Previous action result: ${input.lastResult}`);
  }
  parts.push(
    '',
    `Budget: ${input.retriesLeft} failed attempts left, ${input.iterationsLeft} actions left for this step.`,
    'What is the single next action?',
  );
  return parts.join('\n');
}

export function assertSystemPrompt(): string {
  return `You are a QA judge. You receive a page accessibility snapshot and an expectation. Decide whether the snapshot satisfies the expectation. Be strict: only pass when the expectation is clearly met by the snapshot content. Answer with pass=true/false and a one-sentence reason.`;
}

export function assertUserPrompt(expectation: string, snapshot: string): string {
  return [
    `Expectation: ${expectation}`,
    '',
    'Page accessibility snapshot:',
    snapshot,
    '',
    'Does the snapshot satisfy the expectation?',
  ].join('\n');
}
