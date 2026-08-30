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
  /**
   * Waits for the page to reach the given load state, bounded by `timeout`
   * (design D1/D2, trustworthy-verdicts). Signature matches Playwright's own
   * `page.waitForLoadState`, so a real `Page` satisfies this with no adapter.
   *
   * Required, not optional (design D2): `PageLike` is *implemented* by every
   * test double rather than passed as options, so an optional method here is
   * exactly the shape that let `timeoutMs` and `budget` go silently unset at
   * one call site while every other one set them — a no-op fake is at least
   * visible in that fake; an absent method is invisible everywhere. A page
   * double that cannot say when it settled cannot support a trustworthy
   * verdict.
   *
   * Rejects on timeout, exactly like Playwright — this primitive stays
   * honest about what happened. `executor.ts`'s settling helper is what
   * decides that exceeding the budget is normal and silent, not this method.
   */
  waitForLoadState(state: 'networkidle', options?: { timeout?: number }): Promise<void>;
}

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export interface ActionContext {
  baseUrl: string;
  /**
   * The configured `browser.timeout_ms` (design D1: one knob, not two): bounds how
   * long resolution waits for each candidate element to become visible, and how
   * long `navigate` waits to load. Must be populated by the caller — a Playwright
   * locator's explicit per-call timeout always overrides `page.setDefaultTimeout()`,
   * so leaving this `undefined` silently reinstates a fixed two-second wait for
   * resolution (and thirty seconds for navigation) regardless of what
   * `browser.timeout_ms` says, which is exactly the defect this field once was.
   */
  resolveTimeoutMs?: number;
  /** Extra origins the agent may reach; `baseUrl`'s own is always allowed. */
  allowedOrigins?: string[];
  /** Resolves `{{env.*}}` in action payloads at the moment of acting (design D2). */
  resolveValue?: (value: string) => string;
}

/** The URL a fresh browser context shows before anything is loaded (design contained-navigation, D2). */
const BLANK_PAGE = 'about:blank';

/**
 * The origins the agent may be on: the application's own, plus whatever the
 * configuration declares. One construction, used by both checks (design
 * contained-navigation, D3) — this defect existed because the rule lived at one
 * call site while claiming to cover everything, and two copies of it that can
 * drift apart would be a poor way to fix that.
 */
export function allowedOriginsFor(baseUrl: string, allowedOrigins: string[] | undefined): Set<string> {
  const allowed = new Set<string>([new URL(baseUrl).origin]);
  for (const origin of allowedOrigins ?? []) {
    allowed.add(new URL(origin).origin);
  }
  return allowed;
}

/**
 * Whether `url` is inside the boundary.
 *
 * `about:blank` is inside it: the browser's own empty page carries no content
 * and is what a fresh context shows before the first `goto`. Everything else is
 * compared by origin, and a URL with no comparable origin — `file:`, `data:` —
 * is **not** allowed. Treating "no origin" as "fine" would be the same
 * permissiveness that produced this defect (design D2).
 */
export function isOriginAllowed(url: string, allowed: ReadonlySet<string>): boolean {
  if (url === BLANK_PAGE) return true;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  if (origin === 'null') return false;
  return allowed.has(origin);
}

/** Describes the boundary the way both failure messages name it. */
export function describeBoundary(allowed: ReadonlySet<string>): string {
  return [...allowed].join(' or ');
}

/**
 * The one containment that does not depend on the model cooperating: an absolute
 * URL ignores the base entirely (`new URL('https://x/y', base)` is `https://x/y`),
 * so a page that can influence the agent could otherwise send it anywhere while it
 * holds a live session. Compared, not argued with (design D1).
 *
 * Refusing to make the request is strictly better than making it and objecting
 * afterwards, so this stays even though the executor now also checks where the
 * page ended up: the model is told its target is out of bounds and can choose
 * differently, rather than the step simply ending.
 */
function assertAllowedOrigin(url: URL, ctx: ActionContext): void {
  const allowed = allowedOriginsFor(ctx.baseUrl, ctx.allowedOrigins);
  if (!isOriginAllowed(url.toString(), allowed)) {
    throw new ActionError(
      `Refusing to navigate outside the application: ${url.origin} is not ${describeBoundary(allowed)}. ` +
        'Add it to allowed_origins in .blastproof/config.yaml if the app legitimately spans hosts.',
    );
  }
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
 * getByRole → getByLabel → getByText, each with a visibility wait bounded by
 * `resolveTimeoutMs` — the configured `browser.timeout_ms`, threaded here via
 * {@link ActionContext.resolveTimeoutMs} by every real caller. The `2_000` default
 * only applies to a caller that resolves a target without going through
 * `performAction`'s context (e.g. a direct unit test).
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

/** Expands `{{env.*}}` only now, so the value was never in a prompt (design D2). */
function resolve(value: string, ctx: ActionContext): string {
  return ctx.resolveValue ? ctx.resolveValue(value) : value;
}

function requireValue(action: AgentAction): string {
  if (action.value === undefined || action.value === '') {
    throw new ActionError(`Action "${action.action}" requires a value`);
  }
  return action.value;
}

/**
 * Playwright's own words for "the target was fine and something else took the
 * click", written into the call log of an action that then times out
 * (design name-what-blocks-the-click, D2).
 *
 * Quoted rather than re-derived: asking the page which element sits at the
 * target's coordinates costs a second round trip, at the moment an action has
 * just spent the whole browser timeout failing, to recompute what the error
 * already carries.
 *
 * Playwright renders the blocker as a whole element — `<div class="…"></div>`
 * — so the capture takes the **opening** tag and the rest of the rendering is
 * skipped up to the phrase. Bounded to one line, because the call log holds a
 * second element a few lines above (`locator resolved to <button …>`, the
 * target itself) and a pattern allowed to cross newlines names that one
 * instead: the wrong element, and the one this message exists to exonerate.
 *
 * This pattern is the coupling this translation rests on. If Playwright ever
 * rewords the line, the translation stops firing and behaviour reverts to the
 * raw timeout — which is why `tests/actions.test.ts` pins a real call log
 * verbatim rather than a hand-written approximation.
 */
const INTERCEPTS_POINTER = /(<[^>\n]{1,400}>)[^\n]{0,400}?intercepts pointer events/;

/** A framework's overlay class list is long, decorative, and about to be paid for by the token. */
const MAX_BLOCKER_LENGTH = 80;

function truncateBlocker(tag: string): string {
  return tag.length <= MAX_BLOCKER_LENGTH ? tag : `${tag.slice(0, MAX_BLOCKER_LENGTH)}…>`;
}

/**
 * Translates an interception into an obstruction the model can act on, or
 * returns `undefined` for any other failure (design D1/D3).
 *
 * The message leads with the fact that inverts the model's default reading. A
 * bare `locator.click: Timeout 30000ms exceeded` says the target is the
 * problem, so a model given one does the only thing that message supports: it
 * re-resolves the same element under a different accessible name. That was
 * measured against a real application — three attempts, three names, all
 * resolving to the correct element, the whole retry budget spent while the
 * dialog on top of it was never touched. So the first thing this says is that
 * the target was found and is fine, and the last thing it says is that trying
 * another name cannot help.
 *
 * The captured tag is markup, and the model is forbidden from targeting by CSS
 * everywhere else. It is named here as *what took the click* and never as a
 * handle: the route to the overlay is the accessibility snapshot, where the
 * dialog and its close control appear as roles and names.
 */
function obstructionFor(error: unknown, action: AgentAction): ActionError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = INTERCEPTS_POINTER.exec(message);
  if (!match) return undefined;
  const where = action.target ? ` on ${describeTarget(action.target)}` : '';
  return new ActionError(
    `blocked: the ${action.action}${where} was NOT performed. The target was found and is visible, ` +
      `enabled and stable — nothing about it is wrong. ${truncateBlocker(match[1]!)} is on top of it and ` +
      `received the pointer event instead. Something is covering the page: find it in the snapshot — a ` +
      `dialog, a cookie banner, an onboarding overlay — and dismiss it first, using its own close or ` +
      `accept control, or by pressing Escape with no target. Then act on this target again. Choosing a ` +
      `different name for the same target cannot help.`,
  );
}

/**
 * Performs one agent action on the page. `assert`/`done`/`fail` are control
 * actions handled by the executor and rejected here.
 * Returns a short human-readable result string fed back into the next prompt.
 *
 * The obstruction translation is guarded here, over the whole action path,
 * rather than at the four call sites that touch a locator (design D1).
 * `click`, `fill`, `select` and a targeted `press` all wait for the same
 * actionability and can all be intercepted; wrapping each of them is four
 * places to forget the fifth, which is this codebase's named recurring defect
 * — a guarantee implemented at a call site instead of over its scope.
 */
export async function performAction(
  page: PageLike,
  action: AgentAction,
  ctx: ActionContext,
): Promise<string> {
  try {
    return await performResolvedAction(page, action, ctx);
  } catch (error) {
    // Conditional on the error text, so anything that is not an interception
    // reaches the model byte-identical to before.
    throw obstructionFor(error, action) ?? error;
  }
}

async function performResolvedAction(
  page: PageLike,
  action: AgentAction,
  ctx: ActionContext,
): Promise<string> {
  switch (action.action) {
    case 'navigate': {
      const value = resolve(requireValue(action), ctx);
      const url = new URL(value, ctx.baseUrl);
      assertAllowedOrigin(url, ctx);
      // Same knob as resolution (design D1): a slow app is waited for, not just
      // the elements on the page it eventually renders.
      await page.goto(url.toString(), { timeout: ctx.resolveTimeoutMs ?? 30_000 });
      // Where it landed, when that is not where it was asked to go (design
      // judge-sees-the-record, D1). The executor has both facts and used to
      // discard one, which left every later reader — the model, the step
      // record, the judge, and whoever reads the log afterwards — believing a
      // redirected navigation had arrived at the requested URL.
      const landed = page.url();
      return landed === url.toString()
        ? `ok: navigated to ${url.toString()}`
        : `ok: navigated to ${url.toString()}, which redirected to ${landed}`;
    }
    case 'click': {
      const target = requireTarget(action);
      const locator = await resolveTarget(page, target, ctx.resolveTimeoutMs);
      await locator.click();
      return `ok: clicked ${describeTarget(target)}`;
    }
    case 'fill': {
      const target = requireTarget(action);
      const value = resolve(requireValue(action), ctx);
      const locator = await resolveTarget(page, target, ctx.resolveTimeoutMs);
      await locator.fill(value);
      return `ok: filled ${describeTarget(target)}`;
    }
    case 'press': {
      const key = action.value ? resolve(action.value, ctx) : 'Enter';
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
      const value = resolve(requireValue(action), ctx);
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
