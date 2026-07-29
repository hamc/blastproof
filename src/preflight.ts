import type { Browser } from 'playwright';
import type { BlastproofConfig } from './config.js';
import { DEFAULT_OLLAMA_BASE_URL } from './llm/provider.js';
import { BrowserLaunchError, launchBrowser } from './runner/browser.js';

/**
 * How long a reachability probe waits before concluding an endpoint is down.
 *
 * Deliberately generous, not tight, because the two ways this can fail are not
 * symmetric: a genuinely dead port is refused almost instantly (`ECONNREFUSED`
 * — no timer involved at all), so raising this limit costs nothing in the
 * common "nothing is listening" case. It only widens the window for a
 * slow-but-working endpoint: a dev server compiling a route on its first
 * request, a container still cold-starting, a loaded CI runner. Reporting that
 * case as down is a false negative that blocks a run that would have worked —
 * design D6 names exactly this as strictly worse than the raw dump this change
 * replaces, so the asymmetry is worth spending on: 15s is three times the
 * original 5s, comfortably above what an ordinary cold start needs, and still
 * far short of a real hang.
 *
 * Deliberately not a config/flag/env knob (design's Open Questions): an escape
 * hatch added pre-emptively becomes the thing people paste into CI to silence
 * a real problem instead of fixing it. A generous default that does not bind
 * in practice is the safer trade.
 */
const REACHABILITY_TIMEOUT_MS = 15_000;

/** Minimal shape preflight needs from `fetch`; matches the global so production
 * needs no injection, and tests can substitute a fake without a real `Response`. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>;

/**
 * Selects which checks apply, by what the command is actually about to spend
 * (design D3): a dry run needs none of these, so every field is false and
 * `runPreflight` performs no I/O at all.
 */
export interface PreflightNeeds {
  /** The command is about to launch a browser. */
  browser: boolean;
  /** The command is about to call the configured model provider. */
  model: boolean;
  /** The command is about to navigate a page to `base_url`. */
  baseUrl: boolean;
}

export interface PreflightSuccess {
  ok: true;
  /** The browser launched by the browser check, ready to reuse (design task
   *  2.4) — undefined when `needs.browser` was false, so nothing was launched. */
  browser?: Browser;
}

export interface PreflightFailure {
  ok: false;
  /** One entry per unmet prerequisite (design D2): every failure, not the first. */
  failures: string[];
}

export type PreflightResult = PreflightSuccess | PreflightFailure;

export type PreflightConfig = Pick<BlastproofConfig, 'base_url' | 'llm' | 'browser'>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `probe`'s own timer is the only thing ever aborting its fetch (there is no
 * caller-supplied signal to confuse this with), so an abort always means the
 * limit elapsed, never a connection failure — `fetch` raises a distinct error
 * for each (verified against Node's built-in `fetch`): a timeout surfaces as
 * `DOMException` named `AbortError`; a refused connection surfaces as a
 * `TypeError` with an `ECONNREFUSED` cause. Distinguishing them matters because
 * they call for different actions (task: give a timeout its own message) — one
 * says try again shortly, the other says start the app.
 */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Any HTTP response — even a 404 or a 401 — proves the connection was made
 * (design D6): this checks reachability, not credentials or content, so it never
 * inspects the response.
 */
async function probe(url: string, fetchImpl: FetchLike): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function providerBaseUrl(llm: PreflightConfig['llm']): string {
  if (llm.base_url) return llm.base_url;
  switch (llm.provider) {
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'openai':
      return 'https://api.openai.com';
    case 'ollama':
      return DEFAULT_OLLAMA_BASE_URL;
  }
}

async function checkModel(llm: PreflightConfig['llm'], fetchImpl: FetchLike): Promise<string | undefined> {
  const url = providerBaseUrl(llm);
  try {
    await probe(url, fetchImpl);
    return undefined;
  } catch (error) {
    if (isTimeout(error)) {
      return (
        `Cannot reach the ${llm.provider} provider at ${url}: it did not respond within ` +
        `${REACHABILITY_TIMEOUT_MS / 1000}s. It may be temporarily slow or overloaded rather than ` +
        'down — try again in a moment, or check llm.base_url in .blastproof/config.yaml.'
      );
    }
    return (
      `Cannot reach the ${llm.provider} provider at ${url} (${messageOf(error)}). ` +
      'Check your network connection' +
      (llm.provider === 'ollama' ? ', that Ollama is running (`ollama serve`),' : '') +
      ' or llm.base_url in .blastproof/config.yaml.'
    );
  }
}

async function checkBaseUrl(baseUrl: string, fetchImpl: FetchLike): Promise<string | undefined> {
  try {
    await probe(baseUrl, fetchImpl);
    return undefined;
  } catch (error) {
    if (isTimeout(error)) {
      return (
        `The application at ${baseUrl} did not respond within ${REACHABILITY_TIMEOUT_MS / 1000}s. ` +
        'It may still be starting (a dev server compiling a route on first request, a cold-starting ' +
        'container) rather than down — try again in a moment.'
      );
    }
    return (
      `The application at ${baseUrl} is not responding (${messageOf(error)}). ` +
      'Start it, or point --url / base_url in .blastproof/config.yaml at the right address.'
    );
  }
}

interface BrowserCheckResult {
  failure?: string;
  browser?: Browser;
}

async function checkBrowser(headless: boolean): Promise<BrowserCheckResult> {
  try {
    const browser = await launchBrowser({ headless });
    return { browser };
  } catch (error) {
    return { failure: error instanceof BrowserLaunchError ? error.message : messageOf(error) };
  }
}

/**
 * Verifies every prerequisite the command is about to spend on, all at once
 * (design D2, spec preflight) — not one crash per run. Each check is shallow
 * (design D6): a connection attempt, never a credential check or a model call.
 * When the browser check succeeds, the launched instance is returned for reuse
 * (task 2.4) instead of being closed here and relaunched by the caller; when any
 * check fails, a browser that did launch is closed rather than leaked.
 */
export async function runPreflight(
  needs: PreflightNeeds,
  config: PreflightConfig,
  fetchImpl: FetchLike = fetch,
): Promise<PreflightResult> {
  const [browserResult, modelFailure, baseUrlFailure] = await Promise.all([
    needs.browser
      ? checkBrowser(config.browser.headless)
      : Promise.resolve<BrowserCheckResult>({}),
    needs.model ? checkModel(config.llm, fetchImpl) : Promise.resolve(undefined),
    needs.baseUrl ? checkBaseUrl(config.base_url, fetchImpl) : Promise.resolve(undefined),
  ]);

  const failures = [browserResult.failure, modelFailure, baseUrlFailure].filter(
    (value): value is string => value !== undefined,
  );

  if (failures.length > 0) {
    if (browserResult.browser) await browserResult.browser.close();
    return { ok: false, failures };
  }

  return { ok: true, browser: browserResult.browser };
}

/** Prints every unmet prerequisite together (design D2) — never just the first. */
export function printPreflightFailures(failures: string[]): void {
  console.error(`error: ${failures.length} unmet prerequisite(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
}
