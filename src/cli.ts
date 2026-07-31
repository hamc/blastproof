import { Command, InvalidArgumentError } from 'commander';
import { formatInitGuidance, initProject } from './commands/init.js';
import { planCommand } from './commands/plan.js';
import { EXIT_OK, EXIT_USAGE, runCommand } from './commands/run.js';
import { testCommand } from './commands/test.js';
import type { Priority } from './runner/testfile.js';

/** Injected from package.json at build time (see tsup.config.ts). */
declare const __BLASTPROOF_VERSION__: string;

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePriority(value: string): Priority {
  if (value !== 'P0' && value !== 'P1' && value !== 'P2') {
    throw new InvalidArgumentError('priority must be one of P0, P1, P2');
  }
  return value;
}

function parseMinScore(value: string): number {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new InvalidArgumentError('min-score must be an integer between 0 and 100');
  }
  return score;
}

/** `--max-llm-calls`/`--max-tokens`: counts, so non-positive or non-numeric is a usage error. */
function parsePositiveInt(flag: string): (value: string) => number {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidArgumentError(`${flag} must be a positive integer`);
    }
    return n;
  };
}

/** `--max-duration`: seconds, so a fractional value is fine, but not zero or negative. */
function parsePositiveNumber(flag: string): (value: string) => number {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new InvalidArgumentError(`${flag} must be a positive number`);
    }
    return n;
  };
}

const program = new Command();

program
  .name('blastproof')
  .description('Open-source AI testing agent: plain-English YAML tests executed agentically on a real browser.')
  .version(__BLASTPROOF_VERSION__);

program
  .command('init')
  .description('Scaffold .blastproof/ (config, tests, sample tests) in the current directory')
  .action(async () => {
    try {
      const result = await initProject(process.cwd());
      console.log(formatInitGuidance(result));
      process.exitCode = EXIT_OK;
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = EXIT_USAGE;
    }
  });

program
  .command('run')
  .description('Discover and run all tests under .blastproof/tests/ agentically')
  .option('--tag <tag>', 'only run tests with this tag (repeatable)', collect, [])
  .option('--priority <priority>', 'only run tests with this priority (P0|P1|P2)', parsePriority)
  .option('--query <text>', 'only run tests whose summary contains <text> (case-insensitive)')
  .option('--impacted', 'run only tests impacted by the diff vs --base (uses routes: mappings)')
  .option('--base <ref>', 'base git ref for --impacted', 'main')
  .option('--url <url>', 'override config base_url for this run only (config file untouched)')
  .option('--dry-run', 'print the selection plan and exit without launching a browser or calling the LLM')
  .option(
    '--min-score <n>',
    'require a weighted score of at least n (0-100); replaces the all-must-pass rule',
    parseMinScore,
  )
  .option('--junit [path]', 'write a JUnit XML report (default: .blastproof/reports/<session>/junit.xml)')
  .option('--html [path]', 'write a self-contained HTML report (default: .blastproof/reports/<session>/report.html)')
  .option('--fail-on-unmapped', 'fail when a changed file matches no routes: or ignore: glob')
  .option(
    '--concurrency <n>',
    'run this many tests at once (overrides config; default 1 — see the README on when this is safe)',
    parsePositiveInt('--concurrency'),
  )
  .option(
    '--max-llm-calls <n>',
    'stop the run after this many model calls, reported as incomplete (overrides config)',
    parsePositiveInt('--max-llm-calls'),
  )
  .option(
    '--max-tokens <n>',
    'stop the run after this many tokens spent across all model calls (overrides config)',
    parsePositiveInt('--max-tokens'),
  )
  .option(
    '--max-duration <seconds>',
    'stop the run after this many seconds of wall-clock time (overrides config)',
    parsePositiveNumber('--max-duration'),
  )
  .action(
    async (options: {
      tag: string[];
      priority?: Priority;
      query?: string;
      impacted?: boolean;
      base: string;
      url?: string;
      dryRun?: boolean;
      minScore?: number;
      junit?: string | boolean;
      html?: string | boolean;
      failOnUnmapped?: boolean;
      concurrency?: number;
      maxLlmCalls?: number;
      maxTokens?: number;
      maxDuration?: number;
    }) => {
      try {
        process.exitCode = await runCommand({
          cwd: process.cwd(),
          tags: options.tag,
          priority: options.priority,
          query: options.query,
          impacted: options.impacted,
          base: options.base,
          url: options.url,
          dryRun: options.dryRun,
          minScore: options.minScore,
          junit: options.junit,
          html: options.html,
          failOnUnmapped: options.failOnUnmapped,
          concurrency: options.concurrency,
          maxLlmCalls: options.maxLlmCalls,
          maxTokens: options.maxTokens,
          maxDuration: options.maxDuration,
        });
      } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_USAGE;
      }
    },
  );

program
  .command('plan')
  .description('Generate plain-English YAML tests for affected routes no test covers yet')
  .option('--base <ref>', 'base git ref for the diff', 'main')
  .option('--url <url>', 'override config base_url for this run only (config file untouched)')
  .option('--route <route>', 'generate for this route, bypassing the diff (repeatable)', collect, [])
  .option('--write', 'persist drafts under .blastproof/tests/ instead of previewing them')
  .option(
    '--dry-run',
    'print the routes that would generate drafts and exit without launching a browser or calling the LLM',
  )
  .option(
    '--max-llm-calls <n>',
    'stop after this many model calls, reported as incomplete (overrides config)',
    parsePositiveInt('--max-llm-calls'),
  )
  .option(
    '--max-tokens <n>',
    'stop after this many tokens spent across all model calls (overrides config)',
    parsePositiveInt('--max-tokens'),
  )
  .option(
    '--max-duration <seconds>',
    'stop after this many seconds of wall-clock time (overrides config)',
    parsePositiveNumber('--max-duration'),
  )
  .action(
    async (options: {
      base: string;
      url?: string;
      route: string[];
      write?: boolean;
      dryRun?: boolean;
      maxLlmCalls?: number;
      maxTokens?: number;
      maxDuration?: number;
    }) => {
      try {
        process.exitCode = await planCommand({
          cwd: process.cwd(),
          base: options.base,
          url: options.url,
          routes: options.route,
          write: options.write,
          dryRun: options.dryRun,
          maxLlmCalls: options.maxLlmCalls,
          maxTokens: options.maxTokens,
          maxDuration: options.maxDuration,
        });
      } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_USAGE;
      }
    },
  );

program
  .command('test')
  .description('Full PR pipeline: run the tests covering the diff, then draft tests for the gaps')
  .option('--base <ref>', 'base git ref for the diff', 'main')
  .option('--url <url>', 'override config base_url for this run only (config file untouched)')
  .option(
    '--min-score <n>',
    'require a weighted score of at least n (0-100); replaces the all-must-pass rule',
    parseMinScore,
  )
  .option('--junit [path]', 'write a JUnit XML report (default: .blastproof/reports/<session>/junit.xml)')
  .option('--html [path]', 'write a self-contained HTML report (default: .blastproof/reports/<session>/report.html)')
  .option('--write', 'persist generated drafts under .blastproof/tests/ instead of previewing them')
  .option('--fail-on-unmapped', 'fail when a changed file matches no routes: or ignore: glob')
  .option(
    '--max-llm-calls <n>',
    'stop the pipeline after this many model calls, shared by both phases (overrides config)',
    parsePositiveInt('--max-llm-calls'),
  )
  .option(
    '--max-tokens <n>',
    'stop the pipeline after this many tokens, shared by both phases (overrides config)',
    parsePositiveInt('--max-tokens'),
  )
  .option(
    '--max-duration <seconds>',
    'stop the pipeline after this many seconds of wall-clock time (overrides config)',
    parsePositiveNumber('--max-duration'),
  )
  .action(
    async (options: {
      base: string;
      url?: string;
      minScore?: number;
      junit?: string | boolean;
      html?: string | boolean;
      write?: boolean;
      failOnUnmapped?: boolean;
      maxLlmCalls?: number;
      maxTokens?: number;
      maxDuration?: number;
    }) => {
      try {
        process.exitCode = await testCommand({
          cwd: process.cwd(),
          base: options.base,
          url: options.url,
          minScore: options.minScore,
          junit: options.junit,
          html: options.html,
          write: options.write,
          failOnUnmapped: options.failOnUnmapped,
          maxLlmCalls: options.maxLlmCalls,
          maxTokens: options.maxTokens,
          maxDuration: options.maxDuration,
        });
      } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_USAGE;
      }
    },
  );

// Commander exits 1 on a bad flag by default; usage errors are exit 2 here (spec:
// cli-run-command). It writes the message itself, so we only map the outcome.
// exitOverride is per-Command and is not inherited, so subcommands need it too.
program.exitOverride();
for (const command of program.commands) command.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const exitCode = (error as { exitCode?: number }).exitCode ?? EXIT_USAGE;
  process.exitCode = exitCode === 0 ? EXIT_OK : EXIT_USAGE;
}
