import { Command, InvalidArgumentError } from 'commander';
import { formatInitGuidance, initProject } from './commands/init.js';
import { planCommand } from './commands/plan.js';
import { EXIT_OK, EXIT_USAGE, runCommand } from './commands/run.js';
import type { Priority } from './runner/testfile.js';

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

const program = new Command();

program
  .name('blastproof')
  .description('Open-source AI testing agent: plain-English YAML tests executed agentically on a real browser.')
  .version('0.0.1');

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
  .action(async (options: { base: string; url?: string; route: string[]; write?: boolean }) => {
    try {
      process.exitCode = await planCommand({
        cwd: process.cwd(),
        base: options.base,
        url: options.url,
        routes: options.route,
        write: options.write,
      });
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = EXIT_USAGE;
    }
  });

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
