import { cp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseTestFile } from '../../src/runner/testfile.js';

/**
 * The mutants of the reliability benchmark (design measure-verdict-reliability,
 * D1, D4): a declared bug, seeded by exact text edits into a temporary copy of
 * the demo app, and the step of one dogfood test that must fail on it.
 *
 * An edit's `find` must occur exactly once. The demo app is edited for other
 * reasons, and a mutant whose text moved would otherwise run against the
 * correct app and be counted as a false PASS.
 */
const editSchema = z.object({
  file: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
});

const mutantSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    class: z.enum(['literal', 'subtle']),
    /** The wrong verdict whose shape a subtle mutant reproduces: an issue or an archived change. */
    incident: z.string().min(1).optional(),
    /** The targeted test, relative to the repository root. */
    test: z.string().min(1),
    /** The step, verbatim, that a correct verdict fails. */
    step: z.string().min(1),
    /** What the seeded bug is, for a reader of the report. */
    bug: z.string().min(1),
    edits: z.array(editSchema).min(1),
  })
  .refine((m) => m.class !== 'subtle' || m.incident !== undefined, {
    message: 'a subtle mutant names the incident whose shape it reproduces',
    path: ['incident'],
  });

export type Mutant = z.infer<typeof mutantSchema>;
export type Edit = z.infer<typeof editSchema>;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_APP_DIR = path.join(REPO_ROOT, 'examples', 'demo-app');
export const MUTANTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mutants.json');

export class MutantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutantError';
  }
}

/** Parses the mutant list. Throws a MutantError naming the first malformed mutant. */
export function parseMutants(json: unknown): Mutant[] {
  const parsed = z.array(mutantSchema).safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path ?? [];
    const raw = Array.isArray(json) && typeof at[0] === 'number' ? (json[at[0]] as { id?: unknown }) : undefined;
    const name = typeof raw?.id === 'string' ? raw.id : `#${String(at[0])}`;
    throw new MutantError(`mutant ${name}: ${at.slice(1).join('.') || '(root)'}: ${issue?.message}`);
  }
  const ids = new Set<string>();
  for (const m of parsed.data) {
    if (ids.has(m.id)) throw new MutantError(`mutant ${m.id}: id declared twice`);
    ids.add(m.id);
  }
  return parsed.data;
}

export function loadMutants(file: string = MUTANTS_FILE): Mutant[] {
  return parseMutants(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Checks each mutant against the repository as it is: its target test parses and
 * contains its step verbatim, and every edit's `find` occurs exactly once in the
 * demo app. Returns the problems found, empty when all hold.
 */
export async function checkMutants(
  mutants: Mutant[],
  repoRoot: string = REPO_ROOT,
  appDir: string = DEMO_APP_DIR,
): Promise<string[]> {
  const problems: string[] = [];
  for (const m of mutants) {
    try {
      const test = await parseTestFile(path.join(repoRoot, m.test));
      if (!test.steps.includes(m.step)) problems.push(`mutant ${m.id}: ${m.test} has no step "${m.step}"`);
    } catch (error) {
      problems.push(`mutant ${m.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const edit of m.edits) {
      let text: string;
      try {
        text = await readFile(path.join(appDir, edit.file), 'utf8');
      } catch {
        problems.push(`mutant ${m.id}: ${edit.file} does not exist in the demo app`);
        continue;
      }
      const problem = editProblem(text, edit);
      if (problem) problems.push(`mutant ${m.id}: ${problem}`);
    }
  }
  return problems;
}

function occurrences(text: string, find: string): number {
  let count = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) count++;
  return count;
}

function editProblem(text: string, edit: Edit): string | undefined {
  const count = occurrences(text, edit.find);
  return count === 1 ? undefined : `${edit.file}: the text to replace occurs ${count} times, not once`;
}

/** Applies one edit to a file's text. Throws a MutantError unless `find` occurs exactly once. */
export function applyEdit(text: string, edit: Edit): string {
  const problem = editProblem(text, edit);
  if (problem) throw new MutantError(problem);
  return text.replace(edit.find, () => edit.replace);
}

/** Copies the demo app to `dest` and applies the mutant's edits there; `undefined` copies it unmodified. */
export async function materialize(dest: string, mutant?: Mutant, appDir: string = DEMO_APP_DIR): Promise<void> {
  await cp(appDir, dest, { recursive: true });
  for (const edit of mutant?.edits ?? []) {
    const file = path.join(dest, edit.file);
    await writeFile(file, applyEdit(await readFile(file, 'utf8'), edit), 'utf8');
  }
}
