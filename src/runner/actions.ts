import type { AgentAction, AgentTarget } from '../llm/schemas.js';

/**
 * Narrow Playwright subset used by the runner. Real `Page`/`Locator` objects are
 * structurally compatible (cast once at the boundary) and tests use fakes.
 */
export interface LocatorLike {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  selectOption(option: { label: string }): Promise<unknown>;
  waitFor(options?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<void>;
  first(): LocatorLike;
}

export interface PageLike {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  getByRole(role: string, options?: { name?: string }): LocatorLike;
  getByLabel(text: string): LocatorLike;
  getByText(text: string): LocatorLike;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  url(): string;
}

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export interface ActionContext {
  baseUrl: string;
  /** Per-resolution wait budget in ms (each fallback candidate gets a short wait). */
  resolveTimeoutMs?: number;
}

function describeTarget(target: AgentTarget): string {
  const parts: string[] = [];
  if (target.role) parts.push(`role=${target.role}`);
  if (target.name) parts.push(`name="${target.name}"`);
  if (target.text) parts.push(`text="${target.text}"`);
  return parts.join(' ') || '(no target)';
}

/**
 * Resolves an element from the live accessibility tree only (self-healing, design D4):
 * getByRole → getByLabel → getByText, each with a short visibility wait.
 */
export async function resolveTarget(
  page: PageLike,
  target: AgentTarget,
  resolveTimeoutMs = 2_000,
): Promise<LocatorLike> {
  const candidates: LocatorLike[] = [];
  if (target.role) {
    candidates.push(page.getByRole(target.role, target.name ? { name: target.name } : {}));
  }
  if (target.name) {
    candidates.push(page.getByLabel(target.name));
  }
  const text = target.text ?? target.name;
  if (text) {
    candidates.push(page.getByText(text));
  }

  for (const candidate of candidates) {
    const locator = candidate.first();
    try {
      await locator.waitFor({ state: 'visible', timeout: resolveTimeoutMs });
      return locator;
    } catch {
      // try the next resolution strategy
    }
  }
  throw new ActionError(`Element not found: ${describeTarget(target)}`);
}

function requireTarget(action: AgentAction): AgentTarget {
  if (!action.target || (!action.target.role && !action.target.name && !action.target.text)) {
    throw new ActionError(`Action "${action.action}" requires a target (role/name/text)`);
  }
  return action.target;
}

function requireValue(action: AgentAction): string {
  if (action.value === undefined || action.value === '') {
    throw new ActionError(`Action "${action.action}" requires a value`);
  }
  return action.value;
}

/**
 * Performs one agent action on the page. `assert`/`done`/`fail` are control
 * actions handled by the executor and rejected here.
 * Returns a short human-readable result string fed back into the next prompt.
 */
export async function performAction(
  page: PageLike,
  action: AgentAction,
  ctx: ActionContext,
): Promise<string> {
  switch (action.action) {
    case 'navigate': {
      const value = requireValue(action);
      const url = new URL(value, ctx.baseUrl).toString();
      await page.goto(url, { timeout: 30_000 });
      return `ok: navigated to ${url}`;
    }
    case 'click': {
      const target = requireTarget(action);
      const locator = await resolveTarget(page, target, ctx.resolveTimeoutMs);
      await locator.click();
      return `ok: clicked ${describeTarget(target)}`;
    }
    case 'fill': {
      const target = requireTarget(action);
      const value = requireValue(action);
      const locator = await resolveTarget(page, target, ctx.resolveTimeoutMs);
      await locator.fill(value);
      return `ok: filled ${describeTarget(target)}`;
    }
    case 'press': {
      const key = action.value ?? 'Enter';
      if (action.target && (action.target.role || action.target.name || action.target.text)) {
        const locator = await resolveTarget(page, action.target, ctx.resolveTimeoutMs);
        await locator.press(key);
        return `ok: pressed ${key} on ${describeTarget(action.target)}`;
      }
      await page.keyboard.press(key);
      return `ok: pressed ${key}`;
    }
    case 'select': {
      const target = requireTarget(action);
      const value = requireValue(action);
      const locator = await resolveTarget(page, target, ctx.resolveTimeoutMs);
      await locator.selectOption({ label: value });
      return `ok: selected "${value}" in ${describeTarget(target)}`;
    }
    case 'assert':
    case 'done':
    case 'fail':
      throw new ActionError(`Action "${action.action}" is handled by the executor, not the page`);
  }
}
