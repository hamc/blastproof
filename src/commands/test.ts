import { planCommand } from './plan.js';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runCommand } from './run.js';

export interface TestOptions {
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
  });
  if (runCode === EXIT_USAGE) return EXIT_USAGE;

  section('Draft: affected routes no test covers');
  const planCode = await planCommand({
    cwd: options.cwd,
    base: options.base,
    url: options.url,
    write: options.write,
  });
  if (planCode === EXIT_USAGE) return EXIT_USAGE;

  console.log(
    '\nDrafts are not executed and do not affect the score — review them before ' +
      'they join the suite.',
  );

  return runCode === EXIT_OK && planCode === EXIT_OK ? EXIT_OK : EXIT_FAILED;
}
