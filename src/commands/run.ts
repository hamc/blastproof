import path from 'node:path';
import { authenticate, AuthError, contextOptions, type AuthSession, type BrowserLike } from '../auth.js';
import { ConfigError, loadConfig, type BlastproofConfig } from '../config.js';
import { DiffError, getChangedFiles } from '../diff.js';
import { mapImpact, type ImpactResult } from '../impact.js';
import { createBrain } from '../llm/brain.js';
import { createModel, MissingApiKeyError } from '../llm/provider.js';
import { printPreflightFailures, runPreflight } from '../preflight.js';
import { renderHtml, writeHtml } from '../report/html.js';
import { renderJUnit, writeJUnit, type SkippedCase } from '../report/junit.js';
import { computeScore, formatIncompleteLine, formatScoreLine } from '../report/score.js';
import type { PageLike } from '../runner/actions.js';
import { BudgetExhaustedError, estimateMaxModelCalls, RunBudget, type RunBudgetOptions } from '../runner/budget.js';
import { MissingEnvError, SecretsMask, substituteEnv } from '../runner/env.js';
import {
  DEFAULT_MAX_ITERATIONS_PER_STEP,
  executeTest,
  type ExecutorEvent,
  type TestResult,
} from '../runner/executor.js';
import {
  matchesFilters,
  selectImpactedTests,
  type ImpactedSelection,
  type TestFilters,
} from '../runner/selection.js';
import {
  discoverTestFiles,
  parseTestFile,
  TESTS_RELATIVE_DIR,
  TestFileError,
  type TestFile,
} from '../runner/testfile.js';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/**
 * The budget flags shared by every command that can make a model call. Spec
 * run-budget counts "agent action, assert judgment, or test planning" against one
 * budget, so the flags that configure it cannot belong to `run` alone — `plan` and
 * `test` (which composes both) accept the same three.
 */
export interface BudgetFlags {
  /** Overrides config `budget.max_llm_calls` for this invocation (`--max-llm-calls`). */
  maxLlmCalls?: number;
  /** Overrides config `budget.max_tokens` for this invocation (`--max-tokens`). */
  maxTokens?: number;
  /** Overrides config `budget.max_duration_s`, in seconds, for this invocation (`--max-duration`). */
  maxDuration?: number;
}

export interface RunOptions extends TestFilters, BudgetFlags {
  cwd: string;
  /** Run only tests impacted by the diff vs `base` (uses routes: mappings). */
  impacted?: boolean;
  /** Base git ref for --impacted (default "main"). */
  base?: string;
  /** Overrides config base_url for this run only; the config file is never mutated. */
  url?: string;
  /** Print the selection plan and exit without launching a browser or calling the LLM. */
  dryRun?: boolean;
  /**
   * Minimum weighted score (0–100). When set it replaces the all-must-pass rule:
   * the run succeeds when the score reaches it, tolerating lower-priority failures
   * within the margin (design D4).
   */
  minScore?: number;
  /** Write a JUnit report: `true` for the session-directory default, or an explicit path. */
  junit?: string | boolean;
  /** Write an HTML report: `true` for the session-directory default, or an explicit path. */
  html?: string | boolean;
  /**
   * Fail the run when the diff contains a file matching neither a `routes:` glob
   * nor an `ignore:` glob. Additive to `--min-score`: a run can verify what it
   * selected and still be blocked by a change nobody has classified (design D4).
   */
  failOnUnmapped?: boolean;
  /**
   * A budget already constructed by a composing caller (`test`), so both of its
   * phases draw against one allowance instead of each resolving and starting its
   * own (a budget that resets between phases is two allowances, not one bound).
   * When absent, resolved here from `flag > env > file` as usual.
   */
  budget?: RunBudget;
}

/**
 * Resolves the run's budget: flag beats config (spec cli-run-command). Env already
 * beat the file by the time `config.budget` reaches here, since `loadConfig` merges
 * `BLASTPROOF_MAX_*` before validating (design run-budget, precedence flag > env >
 * file). Absent everywhere, every limit is undefined and `RunBudget` never binds.
 */
export function resolveBudgetOptions(config: BlastproofConfig, options: BudgetFlags): RunBudgetOptions {
  const maxDurationSeconds = options.maxDuration ?? config.budget?.max_duration_s;
  return {
    maxCalls: options.maxLlmCalls ?? config.budget?.max_llm_calls,
    maxTokens: options.maxTokens ?? config.budget?.max_tokens,
    maxDurationMs: maxDurationSeconds === undefined ? undefined : maxDurationSeconds * 1000,
  };
}

function sessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Returns a copy of `config` with `base_url` overridden by the --url flag
 * (CLI flag > config file, design D6). Throws ConfigError on an invalid URL.
 */
export function applyUrlOverride(
  config: BlastproofConfig,
  url: string | undefined,
): BlastproofConfig {
  if (url === undefined) return config;
  try {
    new URL(url);
  } catch {
    throw new ConfigError(
      `Invalid --url '${url}': expected an absolute URL like http://localhost:4173.`,
    );
  }
  return { ...config, base_url: url };
}

/**
 * Seeds one mask for the whole run (design D1): the auth credential plus every
 * placeholder any test references. A secret is dangerous for as long as it lives
 * in the session, not for the duration of the test that happened to declare it.
 */
function buildRunMask(config: BlastproofConfig, tests: TestFile[]): SecretsMask {
  const mask = new SecretsMask();
  for (const step of config.auth?.steps ?? []) mask.registerFrom(step);
  for (const value of Object.values(config.auth?.headers ?? {})) mask.registerFrom(value);
  for (const cookie of config.auth?.cookies ?? []) mask.registerFrom(cookie.value);
  for (const test of tests) {
    for (const step of [...(test.setup ?? []), ...test.steps]) mask.registerFrom(step);
  }
  return mask;
}

/**
 * Registers every referenced secret for masking, and leaves the steps untouched:
 * placeholders must survive into the prompt so the value never reaches the model
 * (design D2). `registerFrom` still throws on an unset variable, so the fail-fast
 * before any browser opens is unchanged — only the moment of expansion moved.
 */
function resolveSecretsAndSteps(test: TestFile): { test: TestFile } {
  for (const step of [...(test.setup ?? []), ...test.steps]) {
    // Validation only: an unset variable must still fail before a browser opens.
    new SecretsMask().registerFrom(step);
  }
  return { test };
}

/**
 * Records tests the run's budget or deadline stopped before they executed (design
 * D3, spec run-budget): a distinct `not-run` status, never `failed` — exhaustion
 * says nothing about the application under test.
 */
function notRunResults(tests: TestFile[], reason: string): TestResult[] {
  return tests.map((test) => ({
    file: test.path,
    summary: test.summary,
    priority: test.priority,
    tags: test.tags,
    status: 'not-run',
    steps: [],
    reason,
    durationMs: 0,
  }));
}

function printEvent(event: ExecutorEvent): void {
  switch (event.type) {
    case 'step-start':
      console.log(`  ${event.setup ? '(setup) ' : ''}step ${event.index + 1}/${event.total}: ${event.step}`);
      break;
    case 'action': {
      const { action, result } = event;
      const target = action.target ? ` ${action.target.role ?? ''} "${action.target.name ?? action.target.text ?? ''}"` : '';
      const value = action.value ? ` [${action.value}]` : '';
      console.log(`    -> ${action.action}${target}${value} :: ${result}`);
      break;
    }
    case 'step-end':
      if (event.status === 'failed') {
        console.log(`    X step failed: ${event.reason ?? 'unknown reason'}`);
      }
      break;
  }
}

function statusLabel(status: TestResult['status']): string {
  if (status === 'passed') return 'PASS';
  if (status === 'failed') return 'FAIL';
  return 'NOT RUN';
}

function printSummary(results: TestResult[]): void {
  const passed = results.filter((r) => r.status === 'passed');
  const failed = results.filter((r) => r.status === 'failed');
  const notRun = results.filter((r) => r.status === 'not-run');

  console.log('\n--- Summary ---------------------------------------------------');
  const rows = results.map((r) => ({
    status: statusLabel(r.status),
    priority: r.priority,
    summary: r.summary,
    duration: `${(r.durationMs / 1000).toFixed(1)}s`,
  }));
  const width = (key: keyof (typeof rows)[number]) =>
    Math.max(key.length, ...rows.map((r) => String(r[key]).length));
  const [ws, wp, wsum, wd] = [width('status'), width('priority'), width('summary'), width('duration')];
  for (const row of rows) {
    console.log(
      `${row.status.padEnd(ws)}  ${row.priority.padEnd(wp)}  ${row.summary.padEnd(wsum)}  ${row.duration.padStart(wd)}`,
    );
  }
  console.log('---------------------------------------------------------------');
  // The "not run" clause only appears when a budget/deadline actually stopped the
  // run, so an ordinary run's line is unchanged (design: inert by default).
  console.log(
    notRun.length > 0
      ? `${passed.length} passed, ${failed.length} failed, ${notRun.length} not run, ${results.length} total`
      : `${passed.length} passed, ${failed.length} failed, ${results.length} total`,
  );

  for (const r of failed) {
    console.log(`\nX ${r.summary} (${r.file})`);
    if (r.failedStep) console.log(`  failing step: ${r.failedStep}`);
    if (r.reason) console.log(`  reason: ${r.reason}`);
    if (r.screenshot) console.log(`  screenshot: ${r.screenshot}`);
  }

  if (notRun.length > 0) {
    console.log(`\n${notRun.length} test(s) not run (run stopped by its budget or deadline):`);
    for (const r of notRun) console.log(`  - ${r.summary} (${r.file})`);
  }
}

async function runOne(
  browser: import('playwright').Browser,
  test: TestFile,
  config: BlastproofConfig,
  sessionDir: string,
  session: AuthSession | undefined,
  runMask: SecretsMask,
  budget: RunBudget,
): Promise<TestResult> {
  const brain = createBrain(createModel(config.llm).model, undefined, budget);

  let resolved: TestFile;
  const mask = runMask;
  try {
    ({ test: resolved } = resolveSecretsAndSteps(test));
  } catch (error) {
    if (error instanceof MissingEnvError) {
      // Spec: missing env var fails the test before any page is opened.
      return {
        file: test.path,
        summary: test.summary,
        priority: test.priority,
        tags: test.tags,
        status: 'failed',
        steps: [],
        reason: error.message,
        durationMs: 0,
      };
    }
    throw error;
  }

  // Fresh context per test: no cookies, storage or history leakage (m1 design D6).
  // With auth configured the context merely starts from the shared session instead
  // of empty, so isolation is preserved (auth design D3); `auth: false` opts out.
  const context = await browser.newContext(test.auth ? contextOptions(session) : {});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(config.browser.timeout_ms);
    return await executeTest(page as unknown as PageLike, resolved, {
      brain,
      sessionDir,
      baseUrl: config.base_url,
      allowedOrigins: config.allowed_origins,
      resolveValue: (value) => substituteEnv(value),
      maxRetries: config.max_retries_per_step,
      mask: (text) => mask.mask(text),
      onEvent: printEvent,
    });
  } finally {
    await context.close();
  }
}

/** Prints the --impacted report sections (affected/unmapped/unrouted-skipped/uncovered). */
function printImpactReport(
  impact: ImpactResult,
  selection: ImpactedSelection,
  cwd: string,
): void {
  console.log('\n--- Impact -----------------------------------------------------');
  console.log(
    impact.affectedRoutes.length > 0 ? 'Affected routes:' : 'Affected routes: none',
  );
  for (const route of impact.affectedRoutes) console.log(`  ${route}`);
  if (impact.unmappedFiles.length > 0) {
    console.log('Unclassified files (matched by no routes: or ignore: glob):');
    for (const file of impact.unmappedFiles) console.log(`  ${file}`);
  }
  if (impact.ignoredFiles.length > 0) {
    console.log(`Ignored files: ${impact.ignoredFiles.length}`);
  }
  if (selection.unroutedSkipped.length > 0) {
    console.log('Unrouted tests (skipped):');
    for (const test of selection.unroutedSkipped) {
      console.log(`  ${test.summary} (${path.relative(cwd, test.path)})`);
    }
  }
  if (selection.uncoveredRoutes.length > 0) {
    console.log('Affected but uncovered routes:');
    for (const route of selection.uncoveredRoutes) console.log(`  ${route}`);
  }
  console.log('---------------------------------------------------------------');
}

/**
 * Prints the summary tail shared by every terminating path: score line, optional
 * JUnit report, and the exit code. With `--min-score` the threshold decides the
 * outcome instead of the all-must-pass rule (design D4) — unless `incomplete` is
 * set, in which case nothing rescues the run: a budget or deadline stop always
 * exits non-zero (spec run-budget, design D4), whatever the executed tests scored.
 */
async function finalize(
  results: TestResult[],
  skipped: SkippedCase[],
  options: RunOptions,
  sessionDir: string,
  durationMs: number,
  impact?: ImpactResult,
  incomplete?: BudgetExhaustedError,
): Promise<number> {
  if (results.length > 0) printSummary(results);

  const score = computeScore(results);
  console.log(
    incomplete ? formatIncompleteLine(score, incomplete.message) : formatScoreLine(score, results, options.minScore),
  );

  if (options.junit) {
    const target =
      typeof options.junit === 'string'
        ? path.resolve(options.cwd, options.junit)
        : path.join(sessionDir, 'junit.xml');
    const xml = renderJUnit(results, skipped, {
      score,
      durationMs,
      cwd: options.cwd,
      incomplete: incomplete?.message,
    });
    await writeJUnit(target, xml);
    console.log(`JUnit report: ${path.relative(options.cwd, target)}`);
  }

  if (options.html) {
    const target =
      typeof options.html === 'string'
        ? path.resolve(options.cwd, options.html)
        : path.join(sessionDir, 'report.html');
    const html = await renderHtml(results, skipped, {
      score,
      durationMs,
      minScore: options.minScore,
      cwd: options.cwd,
      incomplete: incomplete?.message,
    });
    await writeHtml(target, html);
    console.log(`HTML report: ${path.relative(options.cwd, target)}`);
  }

  // Unconditional and first (spec run-budget, design D4): an incomplete run is
  // never a pass, whatever --min-score would have said about the tests that
  // happened to finish before the stop.
  if (incomplete) return EXIT_FAILED;

  if (reportUnclassified(options, impact)) return EXIT_FAILED;

  if (options.minScore !== undefined) {
    return score >= options.minScore ? EXIT_OK : EXIT_FAILED;
  }
  return results.some((result) => result.status === 'failed') ? EXIT_FAILED : EXIT_OK;
}

/** Prints the --dry-run selection plan; no browser is launched and no LLM is called. */
/**
 * Additive, unlike --min-score (design D4): "the tests I ran passed" and
 * "something changed that nobody has classified" are different claims. Returns
 * true when the run is blocked. Shared with --dry-run, which bypassed it — and a
 * keyless, browserless pre-flight is the worst place for a false green.
 */
function reportUnclassified(options: RunOptions, impact: ImpactResult | undefined): boolean {
  const unclassified = options.failOnUnmapped ? (impact?.unmappedFiles ?? []) : [];
  if (unclassified.length === 0) return false;
  console.error(
    `error: ${unclassified.length} changed file(s) match no routes: or ignore: glob, ` +
      'so their blast radius is unknown:',
  );
  for (const file of unclassified) console.error(`  ${file}`);
  console.error(
    'Map them in routes: if they can affect a page, or list them in ignore: if they cannot.',
  );
  return true;
}

function printDryRun(selected: TestFile[], config: BlastproofConfig, cwd: string): void {
  console.log(`\nDry run: ${selected.length} test(s) selected, base_url=${config.base_url}`);
  for (const test of selected) {
    console.log(`  ${test.summary} [${test.priority}] (${path.relative(cwd, test.path)})`);
  }
  // A ceiling, not a forecast (design D5): the arithmetic is exact (see
  // estimateMaxModelCalls for the derivation), but a real run almost always
  // finishes in far fewer calls than this ever allows.
  //
  // `auth.steps` runs once before any selected test and spends model calls
  // through the same executeTest loop (design D8) — a login recipe with static
  // headers/cookies/storage_state does not call the model at all, but `steps`
  // does, and a ceiling that omitted it could be exceeded by the first run that
  // configures a login journey. Included here for that reason (DEF-001 follow-up:
  // the number must not be exceedable by anything it claims to bound).
  const authSteps = config.auth?.steps ?? [];
  const withAuth = authSteps.length > 0 ? [...selected, { steps: authSteps }] : selected;
  const ceiling = estimateMaxModelCalls(
    withAuth,
    DEFAULT_MAX_ITERATIONS_PER_STEP,
    config.max_retries_per_step,
  );
  const authNote = authSteps.length > 0 ? ', including the login journey' : '';
  console.log(
    `Worst case: up to ${ceiling} model call(s) for this selection${authNote} (a maximum, not a prediction).`,
  );
  console.log('Dry run: no browser launched, no LLM calls made.');
}

/**
 * `blastproof run`: discovery → filters → sequential agentic execution → summary.
 * With --impacted, the diff vs `base` selects only tests covering affected routes.
 * Returns the process exit code: 0 all pass, 1 any failure, 2 usage/config error.
 */
export async function runCommand(options: RunOptions): Promise<number> {
  let config: BlastproofConfig;
  try {
    config = applyUrlOverride(await loadConfig(options.cwd), options.url);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const impacted = options.impacted ?? false;
  const base = options.base ?? 'main';

  // Without --impacted there is no diff, so nothing is ever classified and the
  // flag would silently pass — the exact false-safe it exists to prevent.
  if (options.failOnUnmapped && !impacted) {
    console.error(
      'error: --fail-on-unmapped classifies the files in a diff, so it requires --impacted.',
    );
    return EXIT_USAGE;
  }

  // Impact analysis fails fast (usage error) before any browser launch.
  let impact: ImpactResult | undefined;
  if (impacted) {
    let changedFiles: string[];
    try {
      changedFiles = await getChangedFiles(base, options.cwd);
    } catch (error) {
      if (error instanceof DiffError) {
        console.error(`error: ${error.message}`);
        return EXIT_USAGE;
      }
      throw error;
    }
    impact = mapImpact(changedFiles, config.routes ?? {}, config.ignore ?? []);
  }

  const testsDir = path.join(options.cwd, TESTS_RELATIVE_DIR);
  let files: string[];
  try {
    files = await discoverTestFiles(testsDir);
  } catch {
    console.error(`error: no tests directory at ${TESTS_RELATIVE_DIR}. Run \`blastproof init\` first.`);
    return EXIT_USAGE;
  }

  const results: TestResult[] = [];
  const parsed: TestFile[] = [];
  for (const file of files) {
    try {
      parsed.push(await parseTestFile(file));
    } catch (error) {
      if (error instanceof TestFileError) {
        // A broken test file is a failure, not a crash: report it and keep going.
        results.push({
          file: path.relative(options.cwd, file),
          summary: path.basename(file),
          priority: 'P1',
          tags: [],
          status: 'failed',
          steps: [],
          reason: error.message,
          durationMs: 0,
        });
        continue;
      }
      throw error;
    }
  }

  // Impacted selection first, tag/priority/query filters applied within it (D3/D4).
  const selection: ImpactedSelection = impact
    ? selectImpactedTests(parsed, impact.affectedRoutes, options)
    : {
        selected: parsed.filter((test) => matchesFilters(test, options)),
        unroutedSkipped: [],
        uncoveredRoutes: [],
      };
  const selected = selection.selected;

  if (impact) {
    printImpactReport(impact, selection, options.cwd);
  }

  if (options.dryRun) {
    printDryRun(selected, config, options.cwd);
    // A dry run is a pre-flight; reporting a clean plan while a file in the suite
    // cannot be parsed would bless a run that is about to fail and drop the score.
    if (results.length > 0) {
      console.error(`\n${results.length} test file(s) could not be parsed:`);
      for (const broken of results) console.error(`  ${broken.file}: ${broken.reason ?? 'invalid'}`);
      return EXIT_FAILED;
    }
    return reportUnclassified(options, impact) ? EXIT_FAILED : EXIT_OK;
  }

  const sessionDir = path.join(options.cwd, '.blastproof', 'reports', sessionId());
  const startedAt = Date.now();

  // Empty selection short-circuits before the LLM key check and browser launch (D5).
  if (selected.length === 0) {
    console.log(
      impact ? 'No impacted tests to run.' : 'No tests matched the given filters.',
    );
    return finalize(results, selection.unroutedSkipped, options, sessionDir, Date.now() - startedAt, impact);
  }

  // Fail fast on a missing API key before launching any browser (spec: llm-providers).
  try {
    createModel(config.llm);
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const { provider, modelId } = createModel(config.llm);
  console.log(
    `blastproof run: ${selected.length} test(s), provider=${provider} model=${modelId}, base_url=${config.base_url}`,
  );

  const runMask = buildRunMask(config, parsed);

  // Unconfigured (the common case) never binds: every limit inside is undefined,
  // so check() never throws and this is a no-op wrapper (design: inert by default).
  // A composing caller (`test`) may hand in an already-started budget so both of
  // its phases share one allowance instead of `run` resolving a fresh one.
  const budget = options.budget ?? new RunBudget(resolveBudgetOptions(config, options));

  // Every unmet prerequisite reported together, before any of them is spent on
  // (design D2, spec preflight) — not the browser this run, the provider next
  // run, and the stopped app the one after. The browser it launches (when it
  // launches) is reused below rather than launched a second time (task 2.4).
  const preflight = await runPreflight({ browser: true, model: true, baseUrl: true }, config);
  if (!preflight.ok) {
    printPreflightFailures(preflight.failures);
    return EXIT_USAGE;
  }
  const browser = preflight.browser!;
  let incomplete: BudgetExhaustedError | undefined;
  try {
    // Authenticate once, before the first test (design D3). A failed login is a
    // configuration problem, not a product defect, so it aborts with exit 2 rather
    // than surfacing as N failing tests and a meaningless score (design D6). A
    // budget/deadline stop during login is a different thing again (spec
    // run-budget): the run is incomplete, not misconfigured, so none of the
    // selected tests get to run.
    let session: AuthSession | undefined;
    if (config.auth) {
      try {
        console.log('Authenticating...');
        session = await authenticate({
          auth: config.auth,
          cwd: options.cwd,
          baseUrl: config.base_url,
          allowedOrigins: config.allowed_origins,
          browser: browser as unknown as BrowserLike,
          brain: createBrain(createModel(config.llm).model, undefined, budget),
          maxRetries: config.max_retries_per_step,
          mask: runMask,
          onEvent: printEvent,
        });
      } catch (error) {
        if (error instanceof BudgetExhaustedError) {
          incomplete = error;
        } else if (error instanceof AuthError) {
          console.error(`error: ${error.message}`);
          return EXIT_USAGE;
        } else {
          throw error;
        }
      }
    }

    if (incomplete) {
      // The budget or deadline ran out during login: no selected test ever got
      // to start, so every one of them is not run (design D3).
      results.push(...notRunResults(selected, incomplete.message));
    } else {
      for (let i = 0; i < selected.length; i++) {
        const test = selected[i]!;
        console.log(`\n> ${test.summary} [${test.priority}] (${path.relative(options.cwd, test.path)})`);
        try {
          // Checked here too, not only inside the brain (design run-budget task
          // 4.2): a deadline that has already passed must stop the *next test*
          // rather than launching a fresh context only to fail on its first call.
          budget.check();
          results.push(await runOne(browser, test, config, sessionDir, session, runMask, budget));
        } catch (error) {
          if (error instanceof BudgetExhaustedError) {
            incomplete = error;
            // The test in progress, plus everything after it, never finished —
            // recorded as not run rather than failed, and excluded from the
            // score's denominator rather than counted against it (D3/D4).
            results.push(...notRunResults(selected.slice(i), error.message));
            break;
          }
          throw error;
        }
      }
    }
  } finally {
    await browser.close();
  }

  return finalize(
    results,
    selection.unroutedSkipped,
    options,
    sessionDir,
    Date.now() - startedAt,
    impact,
    incomplete,
  );
}
