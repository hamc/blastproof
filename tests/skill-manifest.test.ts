import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { plannerSystemPrompt } from '../src/llm/prompts.js';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const skillDir = path.join(root, 'skills', 'blastproof');
const authoringFile = path.join(skillDir, 'references', 'authoring.md');

const COMMANDS = ['init', 'run', 'plan', 'test'] as const;

/** Markers in authoring.md fencing the block quoted from the planner prompt. */
const CANONICAL_OPEN = '<!-- canonical:rules -->';
const CANONICAL_CLOSE = '<!-- /canonical:rules -->';

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return markdownFiles(full);
      return entry.name.endsWith('.md') ? [full] : [];
    }),
  );
  return found.flat();
}

async function optionsOf(command: string): Promise<string[]> {
  const { stdout } = await run(process.execPath, [cli, command, '--help']);
  // commander indents an option by exactly two spaces and wraps its description
  // deeper, so this reads the flags and never a `--flag` named in prose.
  return stdout
    .split('\n')
    .map((line) => /^ {2}(--[a-z0-9-]+)/.exec(line)?.[1])
    .filter((flag): flag is string => flag !== undefined);
}

/**
 * Only ever from inside backticks. A first pass over the written skill read
 * `blastproof runs`, `blastproof reaches` and `blastproof repository` as
 * commands — prose, every one of them. A test that passes for the wrong reason
 * is worse than no test (#30), so the code span is the boundary.
 */
function backtickedCommands(markdown: string): string[] {
  return [...markdown.matchAll(/`blastproof ([a-z][a-z-]*)/g)].map(([, command]) => command ?? '');
}

function backtickedFlags(markdown: string): string[] {
  return [...markdown.matchAll(/`(--[a-z0-9-]+)/g)].map(([, flag]) => flag ?? '');
}

/** The rules the prompt marks in bold: what it treats as load-bearing. */
function boldedRules(prompt: string): string[] {
  return [...prompt.matchAll(/\*\*(.+?)\*\*/g)].map(([, rule]) => rule ?? '');
}

describe('the blastproof skill', () => {
  let files: string[];
  let corpus: string;
  let authoring: string;
  let canonical: string;
  let flagsOf: Map<string, Set<string>>;
  let allFlags: Set<string>;

  beforeAll(async () => {
    await expect(
      access(cli),
      `${cli} is missing — run \`npm run build\` before the tests; this one reads the built CLI's --help`,
    ).resolves.toBeUndefined();
    files = await markdownFiles(skillDir);
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    corpus = contents.join('\n');
    authoring = await readFile(authoringFile, 'utf8');
    const start = authoring.indexOf(CANONICAL_OPEN);
    const end = authoring.indexOf(CANONICAL_CLOSE);
    expect(
      start >= 0 && end > start,
      `${CANONICAL_OPEN} … ${CANONICAL_CLOSE} must fence the quoted rules in authoring.md`,
    ).toBe(true);
    canonical = authoring.slice(start + CANONICAL_OPEN.length, end);
    flagsOf = new Map(
      await Promise.all(
        COMMANDS.map(
          async (command) => [command, new Set(await optionsOf(command))] as [string, Set<string>],
        ),
      ),
    );
    allFlags = new Set([...flagsOf.values()].flatMap((set) => [...set]));
  });

  it('ships a SKILL.md the installer can find', async () => {
    // `skills add <owner>/<repo>` walks skills/<name>/SKILL.md. A rename here
    // does not fail anything at build time — it just stops being installable.
    const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skill.startsWith('---\n')).toBe(true);
    const frontMatter = skill.slice(4, skill.indexOf('\n---', 4));
    expect(frontMatter).toMatch(/^name: blastproof$/m);
    expect(frontMatter).toMatch(/^description: .{40,}/m);
  });

  it('names no command the CLI does not have', async () => {
    const named = backtickedCommands(corpus);
    expect(
      named.length,
      'no `blastproof <command>` found — the pattern stopped matching',
    ).toBeGreaterThan(0);
    // Reported per file, so a failure names the file that says it rather than
    // leaving someone to grep four documents for the offending word.
    const unknown: string[] = [];
    for (const file of files) {
      const markdown = await readFile(file, 'utf8');
      for (const command of backtickedCommands(markdown)) {
        if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
          unknown.push(`${command} in ${path.relative(root, file)}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('names no flag the CLI does not declare', () => {
    const named = backtickedFlags(corpus);
    expect(named.length, 'no `--flag` found — the pattern stopped matching').toBeGreaterThan(0);
    // Word boundary is implicit: the pattern captures the whole flag, so
    // `--min-scores` is captured whole and cannot pass as `--min-score`.
    expect(named.filter((flag) => !allFlags.has(flag))).toEqual([]);
  });

  it('documents each flag under a command that actually declares it', async () => {
    // Stronger than the union check above: cli.md documents flags in per-command
    // sections, so a flag listed under the wrong command is a real error the
    // union would wave through.
    const cliReference = await readFile(path.join(skillDir, 'references', 'cli.md'), 'utf8');
    const sections = cliReference.split(/^## /m).filter((section) => section.startsWith('`blast'));
    expect(sections.length).toBe(COMMANDS.length);
    const misplaced: string[] = [];
    for (const section of sections) {
      const command = /^`blastproof ([a-z]+)`/.exec(section)?.[1];
      if (command === undefined) continue;
      const declared = flagsOf.get(command) ?? new Set<string>();
      for (const flag of backtickedFlags(section)) {
        if (!declared.has(flag)) misplaced.push(`${flag} under \`${command}\``);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it('carries every rule the planner prompt marks as load-bearing', () => {
    const rules = boldedRules(plannerSystemPrompt());
    expect(rules.length, 'no bolded rule found in the prompt — the pattern stopped matching').toBeGreaterThan(0);
    // Verbatim, not paraphrased: the quote is what makes the two copies
    // comparable at all (design D8). A reworded rule fails here.
    expect(rules.filter((rule) => !canonical.includes(rule))).toEqual([]);
  });

  it('quotes no rule the planner prompt does not state', () => {
    const prompt = plannerSystemPrompt();
    const quoted = canonical
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim().replaceAll('**', ''));
    expect(quoted.length, 'the canonical block is empty').toBeGreaterThan(0);
    // Otherwise the skill teaches a rule the tool does not enforce, which is
    // the failure mode this file exists to prevent, pointed the other way.
    expect(quoted.filter((rule) => !prompt.replaceAll('**', '').includes(rule))).toEqual([]);
  });
});
