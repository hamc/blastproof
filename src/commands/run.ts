import path from 'node:path';
import { chromium } from 'playwright';
import { ConfigError, loadConfig, type BlastproofConfig } from '../config.js';
import { createBrain } from '../llm/brain.js';
import { createModel, MissingApiKeyError } from '../llm/provider.js';
import type { PageLike } from '../runner/actions.js';
import { MissingEnvError, SecretsMask, substituteEnv } from '../runner/env.js';
import { executeTest, type ExecutorEvent, type TestResult } from '../runner/executor.js';
import {
  discoverTestFiles,
  parseTestFile,
  TESTS_RELATIVE_DIR,
  TestFileError,
  type Priority,
  type TestFile,
} from '../runner/testfile.js';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export interface RunOptions {
  cwd: string;
  tags: string[];
  priority?: Priority;
  query?: string;
}

function sessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function matchesFilters(test: TestFile, options: RunOptions): boolean {
  if (options.tags.length > 0 && !options.tags.some((tag) => test.tags.includes(tag))) {
    return false;
  }
  if (options.priority && test.priority !== options.priority) {
    return false;
  }
  if (options.query && !test.summary.toLowerCase().includes(options.query.toLowerCase())) {
    return false;
  }
  return true;
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

/**
 * `blastproof run`: discovery → filters → sequential agentic execution → summary.
 * Returns the process exit code: 0 all pass, 1 any failure, 2 usage/config error.
 */
export async function runCommand(options: RunOptions): Promise<number> {
  let config: BlastproofConfig;
  try {
    config = await loadConfig(options.cwd);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
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
  const selected: TestFile[] = [];
  for (const file of files) {
    try {
      const test = await parseTestFile(file);
      if (matchesFilters(test, options)) selected.push(test);
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

  if (selected.length === 0) {
    console.log('No tests matched the given filters.');
    if (results.length === 0) return EXIT_OK;
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

  const sessionDir = path.join(options.cwd, '.blastproof', 'reports', sessionId());
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

  printSummary(results);
  return results.some((r) => r.status === 'failed') ? EXIT_FAILED : EXIT_OK;
}
