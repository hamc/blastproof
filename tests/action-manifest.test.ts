import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('action.yml', () => {
  it('parses as YAML', async () => {
    // Twice now an example containing an unquoted colon inside a description made
    // GitHub reject the whole manifest — and the only thing that caught it was a
    // workflow run after the push. This catches it before the commit.
    const raw = await readFile(path.join(root, 'action.yml'), 'utf8');
    expect(() => parse(raw)).not.toThrow();
  });

  it('exposes the inputs and output the docs promise', async () => {
    const manifest = parse(await readFile(path.join(root, 'action.yml'), 'utf8')) as {
      runs: { using: string };
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
    };
    expect(manifest.runs.using).toBe('composite');
    expect(Object.keys(manifest.outputs)).toContain('score');
    for (const input of ['api-key', 'command', 'base', 'min-score', 'fail-on-unmapped', 'version']) {
      expect(manifest.inputs).toHaveProperty(input);
    }
  });

  it('never interpolates an expression inside a description', async () => {
    // GitHub evaluates ${{ }} in descriptions, where contexts like `secrets`
    // do not exist — an illustrative example there breaks the action entirely.
    const raw = await readFile(path.join(root, 'action.yml'), 'utf8');
    const offending = raw
      .split('\n')
      .filter((line) => /description:/.test(line) && /\$\{\{/.test(line));
    expect(offending).toEqual([]);
  });
});
