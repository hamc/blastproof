import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const TESTS_RELATIVE_DIR = path.join('.blastproof', 'tests');

const prioritySchema = z.enum(['P0', 'P1', 'P2']);
export type Priority = z.infer<typeof prioritySchema>;

const testFileSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  priority: prioritySchema.default('P1'),
  tags: z.array(z.string()).default([]),
  setup: z.array(z.string().min(1)).optional(),
});

export interface TestFile {
  /** Path relative to the project root, e.g. `.blastproof/tests/app-load.yaml`. */
  path: string;
  summary: string;
  steps: string[];
  priority: Priority;
  tags: string[];
  setup?: string[];
}

export class TestFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestFileError';
  }
}

function formatIssues(file: string, error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Parses and validates a single YAML test file. Throws TestFileError naming file and field. */
export async function parseTestFile(filePath: string): Promise<TestFile> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new TestFileError(`Cannot read test file: ${filePath}`);
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    throw new TestFileError(
      `Invalid YAML in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = testFileSchema.safeParse(data ?? {});
  if (!result.success) {
    throw new TestFileError(`Invalid test file ${filePath}:\n${formatIssues(filePath, result.error)}`);
  }

  return { path: filePath, ...result.data };
}

/** Recursively discovers `.yaml`/`.yml` test files under `dir`, in sorted path order. */
export async function discoverTestFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.ya?ml$/i.test(entry.name)) {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found.sort();
}
