import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTestFiles, parseTestFile, TestFileError } from '../src/runner/testfile.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-testfile-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTest(name: string, content: string): Promise<string> {
  const file = path.join(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

describe('parseTestFile', () => {
  it('parses a minimal test with defaults', async () => {
    const file = await writeTest('t.yaml', 'summary: App loads\nsteps:\n  - open the app\n');
    const test = await parseTestFile(file);
    expect(test.summary).toBe('App loads');
    expect(test.steps).toEqual(['open the app']);
    expect(test.priority).toBe('P1');
    expect(test.tags).toEqual([]);
    expect(test.setup).toBeUndefined();
    expect(test.routes).toEqual([]);
  });

  it('parses a full test', async () => {
    const file = await writeTest(
      't.yml',
      [
        'summary: Checkout with discount',
        'priority: P0',
        'tags: [checkout, discount]',
        'setup:',
        '  - log in as demo user',
        'steps:',
        '  - add item to cart',
        '  - apply promo code SAVE20',
        '',
      ].join('\n'),
    );
    const test = await parseTestFile(file);
    expect(test.priority).toBe('P0');
    expect(test.tags).toEqual(['checkout', 'discount']);
    expect(test.setup).toEqual(['log in as demo user']);
  });

  it('rejects a file missing summary, naming the file and field', async () => {
    const file = await writeTest('broken.yaml', 'steps:\n  - do something\n');
    const err = await parseTestFile(file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TestFileError);
    expect((err as Error).message).toContain('broken.yaml');
    expect((err as Error).message).toContain('summary');
  });

  it('rejects empty steps', async () => {
    const file = await writeTest('broken.yaml', 'summary: X\nsteps: []\n');
    await expect(parseTestFile(file)).rejects.toThrow(/steps/);
  });

  it('rejects invalid YAML', async () => {
    const file = await writeTest('broken.yaml', 'summary: [unclosed\n');
    await expect(parseTestFile(file)).rejects.toThrow(/Invalid YAML/);
  });

  it('rejects an invalid priority', async () => {
    const file = await writeTest('broken.yaml', 'summary: X\npriority: P9\nsteps:\n  - a\n');
    await expect(parseTestFile(file)).rejects.toThrow(/priority/);
  });

  it('parses a routes list', async () => {
    const file = await writeTest(
      't.yaml',
      'summary: Checkout\nsteps:\n  - pay\nroutes:\n  - /cart\n  - /checkout\n',
    );
    const test = await parseTestFile(file);
    expect(test.routes).toEqual(['/cart', '/checkout']);
  });

  it('rejects non-string routes entries', async () => {
    const file = await writeTest('broken.yaml', 'summary: X\nsteps:\n  - a\nroutes: [/cart, 42]\n');
    await expect(parseTestFile(file)).rejects.toThrow(/routes/);
  });
});

describe('discoverTestFiles', () => {
  it('finds nested yaml files in sorted path order', async () => {
    await writeTest('b/two.yaml', '');
    await writeTest('a/one.yml', '');
    await writeTest('three.yaml', '');
    await writeTest('ignored.txt', '');
    const found = await discoverTestFiles(dir);
    expect(found.map((f) => path.relative(dir, f))).toEqual([
      path.join('a', 'one.yml'),
      path.join('b', 'two.yaml'),
      'three.yaml',
    ]);
  });
});

describe('auth opt-out', () => {
  it('defaults to true', async () => {
    const file = await writeTest('a.yaml', 'summary: A test\nsteps:\n  - do it\n');
    const parsed = await parseTestFile(file);
    expect(parsed.auth).toBe(true);
  });

  it('parses auth: false', async () => {
    const file = await writeTest('b.yaml', 'summary: Login test\nauth: false\nsteps:\n  - log in\n');
    const parsed = await parseTestFile(file);
    expect(parsed.auth).toBe(false);
  });

  it('rejects a non-boolean', async () => {
    const file = await writeTest('c.yaml', 'summary: A test\nauth: yes-please\nsteps:\n  - do it\n');
    await expect(parseTestFile(file)).rejects.toThrow(/auth/);
  });
});
