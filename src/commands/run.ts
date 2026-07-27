import path from 'node:path';
import { chromium } from 'playwright';
import { ConfigError, loadConfig, type BlastproofConfig } from '../config.js';
import { DiffError, getChangedFiles } from '../diff.js';
import { mapImpact, type ImpactResult } from '../impact.js';
import { createBrain } from '../llm/brain.js';
import { createModel, MissingApiKeyError } from '../llm/provider.js';
import { renderHtml, writeHtml } from '../report/html.js';
import { renderJUnit, writeJUnit, type SkippedCase } from '../report/junit.js';
import { computeScore, formatScoreLine } from '../report/score.js';
import type { PageLike } from '../runner/actions.js';
import { MissingEnvError, SecretsMask, substituteEnv } from '../runner/env.js';
import { executeTest, type ExecutorEvent, type TestResult } from '../runner/executor.js';
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

export interface RunOptions extends TestFilters {
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

/** Substitutes env placeholders across setup+steps, registering every secret for masking. */
function resolveSecretsAndSteps(test: TestFile): { test: TestFile; mask: SecretsMask } {
  const mask = new SecretsMask();
  for (const step of [...(test.setup ?? []), ...test.steps]) {
    mask.registerFrom(step);
  }
  return {
    test: {
      ...test,
      setup: test.setup?.map((step) => substituteEnv(step)),
      steps: test.steps.map((step) => substituteEnv(step)),
    },
    mask,
  };
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

function printSummary(results: TestResult[]): void {
  const passed = results.filter((r) => r.status === 'passed');
  const failed = results.filter((r) => r.status === 'failed');

  console.log('\n--- Summary ---------------------------------------------------');
  const rows = results.map((r) => ({
    status: r.status === 'passed' ? 'PASS' : 'FAIL',
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
  console.log(`${passed.length} passed, ${failed.length} failed, ${results.length} total`);

  for (const r of failed) {
    console.log(`\nX ${r.summary} (${r.file})`);
    if (r.failedStep) console.log(`  failing step: ${r.failedStep}`);
    if (r.reason) console.log(`  reason: ${r.reason}`);
    if (r.screenshot) console.log(`  screenshot: ${r.screenshot}`);
  }
}

async function runOne(
  browser: import('playwright').Browser,
  test: TestFile,
  config: BlastproofConfig,
  sessionDir: string,
): Promise<TestResult> {
  const brain = createBrain(createModel(config.llm).model);

  let resolved: TestFile;
  let mask: SecretsMask;
  try {
    ({ test: resolved, mask } = resolveSecretsAndSteps(test));
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

  // Fresh context per test: no cookies, storage or history leakage (design D6).
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(config.browser.timeout_ms);
    return await executeTest(page as unknown as PageLike, resolved, {
      brain,
      sessionDir,
      baseUrl: config.base_url,
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
    console.log('Unmapped files (matched by no routes: glob):');
    for (const file of impact.unmappedFiles) console.log(`  ${file}`);
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
 * outcome instead of the all-must-pass rule (design D4).
 */
async function finalize(
  results: TestResult[],
  skipped: SkippedCase[],
  options: RunOptions,
  sessionDir: string,
  durationMs: number,
): Promise<number> {
  if (results.length > 0) printSummary(results);

  const score = computeScore(results);
  console.log(formatScoreLine(score, results, options.minScore));

  if (options.junit) {
    const target =
      typeof options.junit === 'string'
        ? path.resolve(options.cwd, options.junit)
        : path.join(sessionDir, 'junit.xml');
    const xml = renderJUnit(results, skipped, { score, durationMs, cwd: options.cwd });
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
    });
    await writeHtml(target, html);
    console.log(`HTML report: ${path.relative(options.cwd, target)}`);
  }

  if (options.minScore !== undefined) {
    return score >= options.minScore ? EXIT_OK : EXIT_FAILED;
  }
  return results.some((result) => result.status === 'failed') ? EXIT_FAILED : EXIT_OK;
}

/** Prints the --dry-run selection plan; no browser is launched and no LLM is called. */
function printDryRun(selected: TestFile[], baseUrl: string, cwd: string): void {
  console.log(`\nDry run: ${selected.length} test(s) selected, base_url=${baseUrl}`);
  for (const test of selected) {
    console.log(`  ${test.summary} [${test.priority}] (${path.relative(cwd, test.path)})`);
  }
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
    impact = mapImpact(changedFiles, config.routes ?? {});
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
    printDryRun(selected, config.base_url, options.cwd);
    return EXIT_OK;
  }

  const sessionDir = path.join(options.cwd, '.blastproof', 'reports', sessionId());
  const startedAt = Date.now();

  // Empty selection short-circuits before the LLM key check and browser launch (D5).
  if (selected.length === 0) {
    console.log(
      impact ? 'No impacted tests to run.' : 'No tests matched the given filters.',
    );
    return finalize(results, selection.unroutedSkipped, options, sessionDir, Date.now() - startedAt);
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

  const browser = await chromium.launch({ headless: config.browser.headless });
  try {
    for (const test of selected) {
      console.log(`\n> ${test.summary} [${test.priority}] (${path.relative(options.cwd, test.path)})`);
      results.push(await runOne(browser, test, config, sessionDir));
    }
  } finally {
    await browser.close();
  }

  return finalize(results, selection.unroutedSkipped, options, sessionDir, Date.now() - startedAt);
}
