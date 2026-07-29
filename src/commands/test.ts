import { ConfigError, loadConfig, type BlastproofConfig } from '../config.js';
import { RunBudget } from '../runner/budget.js';
import { planCommand } from './plan.js';
import {
  applyUrlOverride,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  resolveBudgetOptions,
  runCommand,
  type BudgetFlags,
} from './run.js';

export interface TestOptions extends BudgetFlags {
  cwd: string;
  /** Base git ref for the diff (default "main"). */
  base?: string;
  /** Overrides config base_url for this run only. */
  url?: string;
  /** Minimum weighted score; replaces the all-must-pass rule when given. */
  minScore?: number;
  junit?: string | boolean;
  html?: string | boolean;
  /** Persist generated drafts instead of previewing them. */
  write?: boolean;
  /** Fail when the diff contains a file matching neither routes: nor ignore:. */
  failOnUnmapped?: boolean;
}

function section(title: string): void {
  console.log(`\n=== ${title} ${'='.repeat(Math.max(0, 58 - title.length))}`);
}

/**
 * `blastproof test`: the diff-driven one-shot — execute the tests covering the
 * affected routes, then draft tests for the affected routes nothing covers.
 *
 * Drafts are reported, never executed (design D1). A model-written test that has
 * not been reviewed must not decide a merge: a hallucinated expectation would block
 * a correct change, and a credulous one would wave a broken change through while
 * looking like coverage. So `test` makes a gap visible; it does not close it.
 *
 * Exit codes: 2 usage/config/diff, 1 gate failure or draft generation failure,
 * 0 otherwise (design D2).
 */
export async function testCommand(options: TestOptions): Promise<number> {
  // One budget for the whole pipeline (spec run-budget: "every model call made
  // anywhere in the run... or test planning" counts against a single budget).
  // `test` composes `run` then `plan`; resolving a fresh budget inside each phase
  // would let a pipeline that must stay under N calls actually spend up to 2N —
  // two allowances, not one bound. Resolved once, here, and handed to both.
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
  const budget = new RunBudget(resolveBudgetOptions(config, options));

  section('Verify: tests covering the affected routes');
  const runCode = await runCommand({
    cwd: options.cwd,
    tags: [],
    impacted: true,
    base: options.base,
    url: options.url,
    minScore: options.minScore,
    junit: options.junit,
    html: options.html,
    failOnUnmapped: options.failOnUnmapped,
    budget,
  });
  if (runCode === EXIT_USAGE) return EXIT_USAGE;

  section('Draft: affected routes no test covers');
  const planCode = await planCommand({
    cwd: options.cwd,
    base: options.base,
    url: options.url,
    write: options.write,
    budget,
  });
  if (planCode === EXIT_USAGE) return EXIT_USAGE;

  console.log(
    '\nDrafts are not executed and do not affect the score — review them before ' +
      'they join the suite.',
  );

  return runCode === EXIT_OK && planCode === EXIT_OK ? EXIT_OK : EXIT_FAILED;
}
