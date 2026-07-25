import { Command, InvalidArgumentError } from 'commander';
import { formatInitGuidance, initProject } from './commands/init.js';
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
  .action(async (options: { tag: string[]; priority?: Priority; query?: string }) => {
    try {
      process.exitCode = await runCommand({
        cwd: process.cwd(),
        tags: options.tag,
        priority: options.priority,
        query: options.query,
      });
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = EXIT_USAGE;
    }
  });

await program.parseAsync(process.argv);
