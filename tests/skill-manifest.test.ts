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

const COMMANDS = ['init', 'run', 'plan', 'test'] as const;
type Command = (typeof COMMANDS)[number];

/** Markers in authoring.md fencing the block copied from the planner prompt. */
const CANONICAL_OPEN = '<!-- canonical:rules -->';
const CANONICAL_CLOSE = '<!-- /canonical:rules -->';

/**
 * The one prompt rule the skill deliberately omits: it only means something
 * when generating from a diff, which the skill's reader is not doing. Named
 * here rather than inferred, so a second rule cannot go missing quietly.
 */
const PLANNER_ONLY = 'Prefer the journey the changed files touch';

interface CommandLine {
  file: string;
  command: string;
  flags: string[];
}

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
 * Everything the document presents as code: fenced blocks first, then inline
 * spans from what is left. Prose is excluded by construction, which is the
 * whole point — an earlier version keyed on a backtick immediately preceding
 * the word and therefore read `blastproof runs end-to-end tests` as a command
 * while seeing none of the fenced lines an agent actually executes.
 */
function codeSpans(markdown: string): string[] {
  // Every CommonMark spelling of a code block, because each one that is missed
  // is invisible rather than merely unparsed — and an invisible line does not
  // reach the by-name failure below either. Backticks and tildes fence; any
  // info string; an unterminated fence runs to the end of the file; and
  // indentation is four spaces or a tab.
  //
  // Raw <pre> is deliberately not handled: no document in this repository uses
  // an HTML block, and adding a parser for one would be speculative surface.
  // Paired the way CommonMark pairs them, which is not "the next marker of any
  // kind": a fence closes only on its own character, at least as long, indented
  // by at most three spaces and followed by nothing else. Treating the two as
  // interchangeable split one real block into two spans and dropped the lines
  // between them into prose — so a ``` block containing ~~~ lines, a ````
  // block wrapping a ``` example, and a closing fence indented four spaces all
  // hid a command in plain sight while fence-marker parity stayed even.
  //
  // The closer is matched on equal length rather than "at least as long"
  // deliberately: a longer marker then fails to close, the block runs to end of
  // file, and everything after it is scanned. That errs toward reading too
  // much, which is the only safe direction for this check.
  //
  // Anchoring matters on its own account. Unanchored, a fence written inline —
  // `Shorthand: ```cmd``` ` — opens a block mid-sentence and shifts pairing for
  // the rest of the file. The info string is scanned too, since an invocation
  // left up there renders as nothing at all.
  const fence =
    /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm;
  const fenced = [...markdown.matchAll(fence)].flatMap(([, , info, body]) => [
    info ?? '',
    body ?? '',
  ]);
  const prose = markdown.replace(fence, '\n');
  const indented = prose.split('\n').filter((line) => /^(?: {4,}|\t)\s*\S/.test(line));
  const inline = [...prose.matchAll(/`([^`\n]+)`/g)].map(([, body]) => body ?? '');
  return [...fenced, ...indented, ...inline];
}

/**
 * A shell line continued with a trailing backslash is one command. Left
 * unfolded, its later lines carry flags that belong to the command on the
 * first line while looking like nothing at all.
 */
function foldContinuations(span: string): string {
  return span.replace(/\\\n\s*/g, ' ');
}

/**
 * A line that invokes the CLI, however it is spelled. `cli.md` tells the reader
 * to run it as `npx blastproof`, and an earlier version anchored on `blastproof`
 * at the start of the line — so the documented form escaped the check entirely,
 * taking its flags with it.
 */
const INVOCATION =
  /^\s*(?:\$\s*)?(?:(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)(?:\s+-{1,2}[a-z-]+)*\s+)?blastproof(?:@[\w.^~-]+)?\s+([a-z][a-z-]*)(.*)$/;

/**
 * Any line that means to invoke the CLI, parsed or not — deliberately looser
 * than INVOCATION and anchored on nothing, so a path-qualified binary or a
 * prefix nobody has thought of yet still has to be accounted for. Paths like
 * `.blastproof/tests` do not match: what follows the name there is a slash,
 * not the whitespace a command argument needs.
 */
const LOOKS_LIKE_INVOCATION = /blastproof(?:@\S+)?\s+\S/;

/** Invocations: a command and the flags used on that same line. */
function commandLines(markdown: string, file: string): CommandLine[] {
  const lines: CommandLine[] = [];
  for (const span of codeSpans(markdown)) {
    for (const line of foldContinuations(span).split('\n')) {
      const match = INVOCATION.exec(line);
      if (match === null) continue;
      lines.push({
        file,
        command: match[1] ?? '',
        // Case-insensitive on purpose: the CLI declares only lowercase flags,
        // so `--Bogus-Flag` must be captured in order to be rejected. Matching
        // lowercase only meant it was never seen at all.
        flags: [...(match[2] ?? '').matchAll(/(--[A-Za-z0-9-]+)/g)].map(([, flag]) => flag ?? ''),
      });
    }
  }
  return lines;
}

/** Lines whose first non-blank characters open or close a fence. */
function fenceMarkers(markdown: string): string[] {
  return markdown.split('\n').filter((line) => /^[ \t]*(?:```|~~~)/.test(line));
}

/** Lines that mean to invoke the CLI and that the parser could not read. */
function unparsedInvocations(markdown: string): string[] {
  return codeSpans(markdown)
    .flatMap((span) => foldContinuations(span).split('\n'))
    .filter((line) => LOOKS_LIKE_INVOCATION.test(line) && INVOCATION.exec(line) === null);
}

/** Every flag the document names anywhere it presents as code. */
function namedFlags(markdown: string): string[] {
  return codeSpans(markdown).flatMap((span) =>
    [...span.matchAll(/(--[A-Za-z0-9-]+)/g)].map(([, flag]) => flag ?? ''),
  );
}

/** The prompt's rules, one per line, as the model receives them. */
function promptRules(): string[] {
  return plannerSystemPrompt()
    .split('\n')
    .filter((line) => line.startsWith('- '));
}

describe('the blastproof skill', () => {
  let files: string[];
  let sources: Map<string, string>;
  let canonical: string[];
  let flagsOf: Map<string, Set<string>>;
  let allFlags: Set<string>;

  const rel = (file: string): string => path.relative(root, file);

  beforeAll(async () => {
    await expect(
      access(cli),
      `${cli} is missing — run \`npm run build\` before the tests; this one reads the built CLI's --help`,
    ).resolves.toBeUndefined();
    files = await markdownFiles(skillDir);
    sources = new Map(
      await Promise.all(
        files.map(async (file) => [file, await readFile(file, 'utf8')] as [string, string]),
      ),
    );
    const authoring = sources.get(path.join(skillDir, 'references', 'authoring.md')) ?? '';
    const start = authoring.indexOf(CANONICAL_OPEN);
    const end = authoring.indexOf(CANONICAL_CLOSE);
    expect(
      start >= 0 && end > start,
      `${CANONICAL_OPEN} … ${CANONICAL_CLOSE} must fence the quoted rules in authoring.md`,
    ).toBe(true);
    canonical = authoring
      .slice(start + CANONICAL_OPEN.length, end)
      .split('\n')
      .filter((line) => line.startsWith('- '));
    flagsOf = new Map(
      await Promise.all(
        COMMANDS.map(
          async (command) => [command, new Set(await optionsOf(command))] as [string, Set<string>],
        ),
      ),
    );
    allFlags = new Set([...flagsOf.values()].flatMap((set) => [...set]));
  });

  it('ships a SKILL.md the installer can find', () => {
    // `skills add <owner>/<repo>` walks skills/<name>/SKILL.md. A rename here
    // does not fail anything at build time — it just stops being installable.
    const skill = sources.get(path.join(skillDir, 'SKILL.md')) ?? '';
    expect(skill.startsWith('---\n')).toBe(true);
    const frontMatter = skill.slice(4, skill.indexOf('\n---', 4));
    expect(frontMatter).toMatch(/^name: blastproof$/m);
    expect(frontMatter).toMatch(/^description: .{40,}/m);
  });

  it('quotes the canonical rules in exactly one place', () => {
    // The rules are compared only where the markers are, so a second block
    // anywhere in the skill is unguarded — free to say the opposite of the
    // first, in the register of something the runner enforces. That is the
    // duplication risk this whole block exists to bound, reappearing inside it.
    const opens = files.map(
      (file) => (sources.get(file) ?? '').split(CANONICAL_OPEN).length - 1,
    );
    const closes = files.map(
      (file) => (sources.get(file) ?? '').split(CANONICAL_CLOSE).length - 1,
    );
    const total = (counts: number[]): number => counts.reduce((sum, n) => sum + n, 0);
    expect({ opens: total(opens), closes: total(closes) }).toEqual({ opens: 1, closes: 1 });
  });

  it('stays out of the npm tarball', async () => {
    // The skill is installed from the repository, never from the package, and
    // proposal.md and AGENTS.md both say so. `files` is what makes that true.
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(manifest.files).toEqual(['dist']);
  });

  describe('every invocation it prints', () => {
    let invocations: CommandLine[];

    beforeAll(() => {
      invocations = files.flatMap((file) => commandLines(sources.get(file) ?? '', file));
    });

    it('is found at all — the extractor covers fenced blocks, not only inline spans', () => {
      // Without this the suite goes quietly empty and every assertion below
      // passes on nothing. It is the failure the first version shipped with.
      const perFile = files.filter(
        (file) => commandLines(sources.get(file) ?? '', file).length > 0,
      );
      expect(invocations.length).toBeGreaterThan(5);
      expect(perFile.map(rel)).toContain('skills/blastproof/SKILL.md');
    });

    it('sits in a document whose fences pair, so no block silently stops being scanned', () => {
      // Anchoring fixes a fence opened mid-line; it does not fix one never
      // closed, which swallows the rest of the file just as quietly. Both
      // shapes remove coverage that already existed, which is the failure this
      // guard has shipped with three times.
      const odd = files
        .filter((file) => fenceMarkers(sources.get(file) ?? '').length % 2 !== 0)
        .map((file) => `unpaired fence marker in ${rel(file)}`);
      expect(odd).toEqual([]);
    });

    it('is parsed, or the test says so — an unreadable line must not read as absent', () => {
      // The class, not the instance. Twice now a line the extractor could not
      // read was indistinguishable from a line that was not a command, and both
      // times the guard stayed green over a file that was wrong. Anything
      // spelled like an invocation must either parse or fail here.
      const unparsed = files.flatMap((file) =>
        unparsedInvocations(sources.get(file) ?? '').map(
          (line) => `${line.trim()} in ${rel(file)}`,
        ),
      );
      expect(unparsed).toEqual([]);
    });

    it('names a command the CLI has', () => {
      const unknown = invocations
        .filter(({ command }) => !COMMANDS.includes(command as Command))
        .map(({ command, file }) => `${command} in ${rel(file)}`);
      expect(unknown).toEqual([]);
    });

    it('uses only flags the command it invokes declares', () => {
      // Per command, not against the union: `--tag` is a real flag and is still
      // wrong on `plan`, and a union check waves that through.
      const wrong: string[] = [];
      for (const { command, flags, file } of invocations) {
        const declared = flagsOf.get(command) ?? new Set<string>();
        for (const flag of flags) {
          if (!declared.has(flag)) wrong.push(`${flag} on \`blastproof ${command}\` in ${rel(file)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  it('names no flag the CLI does not declare, anywhere it presents as code', () => {
    const named = files.flatMap((file) =>
      namedFlags(sources.get(file) ?? '').map((flag) => ({ flag, file })),
    );
    expect(named.length, 'no `--flag` found — the pattern stopped matching').toBeGreaterThan(0);
    const unknown = named
      .filter(({ flag }) => !allFlags.has(flag))
      .map(({ flag, file }) => `${flag} in ${rel(file)}`);
    expect(unknown).toEqual([]);
  });

  it('documents each flag under a command that actually declares it', () => {
    // cli.md documents flags in per-command sections, where they appear in
    // tables rather than on an invocation line the check above would see.
    const cliReference = sources.get(path.join(skillDir, 'references', 'cli.md')) ?? '';
    const sections = cliReference.split(/^## /m).filter((section) => section.startsWith('`blast'));
    expect(sections.length).toBe(COMMANDS.length);
    const misplaced: string[] = [];
    for (const section of sections) {
      const command = /^`blastproof ([a-z]+)`/.exec(section)?.[1];
      if (command === undefined) continue;
      const declared = flagsOf.get(command) ?? new Set<string>();
      for (const flag of namedFlags(section)) {
        if (!declared.has(flag)) misplaced.push(`${flag} under \`${command}\` in references/cli.md`);
      }
    }
    expect(misplaced).toEqual([]);
  });

  describe('the authoring rules it quotes', () => {
    it('are exactly the prompt rules, minus the one planner-only rule', () => {
      // Set equality both ways, on whole rules. A substring check in either
      // direction lets a rule be truncated to a prefix and still pass, and a
      // check keyed on bold lets a rule be un-bolded out of coverage.
      const expected = promptRules().filter((rule) => !rule.includes(PLANNER_ONLY));
      expect(expected.length, 'no rule found in the prompt — the pattern stopped matching').toBeGreaterThan(0);
      expect(canonical.length, 'the canonical block is empty').toBeGreaterThan(0);
      expect([...canonical].sort()).toEqual([...expected].sort());
    });

    it('omits the planner-only rule, and says which one it is', () => {
      // The exclusion is allowed because it is named. If the prompt stops
      // carrying that rule, this allowlist is stale and must be revisited.
      expect(promptRules().filter((rule) => rule.includes(PLANNER_ONLY))).toHaveLength(1);
      expect(canonical.filter((rule) => rule.includes(PLANNER_ONLY))).toEqual([]);
    });
  });
});
