import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiffError, getChangedFiles } from '../src/diff.js';

let dir: string;
let git: SimpleGit;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-diff-'));
  git = simpleGit(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeRepoFile(relative: string, content: string): Promise<void> {
  const file = path.join(dir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function commitAll(message: string): Promise<void> {
  await git.add('.');
  await git.commit(message);
}

/** Creates a repo with a base commit on the default branch; returns the base ref name. */
async function initRepo(): Promise<string> {
  await git.init();
  await git.addConfig('user.email', 'test@blastproof.dev');
  await git.addConfig('user.name', 'blastproof test');
  await writeRepoFile('src/cart/discount.ts', 'export const discount = 0;\n');
  await writeRepoFile('src/cart/old.ts', 'export const old = true;\n');
  await writeRepoFile('README.md', '# demo\n');
  await commitAll('base commit');
  const branches = await git.branchLocal();
  return branches.current;
}

describe('getChangedFiles', () => {
  it('returns repo-relative paths changed on the branch, including deletions', async () => {
    const base = await initRepo();
    await git.checkoutBranch('feature', base);
    await writeRepoFile('src/cart/discount.ts', 'export const discount = 20;\n');
    await rm(path.join(dir, 'src', 'cart', 'old.ts'));
    await writeRepoFile('src/cart/new.ts', 'export const fresh = true;\n');
    await commitAll('feature work');

    const files = await getChangedFiles(base, dir);
    expect(files).toEqual(['src/cart/discount.ts', 'src/cart/new.ts', 'src/cart/old.ts']);
  });

  it('reports renamed files by their new path', async () => {
    const base = await initRepo();
    await git.checkoutBranch('feature', base);
    await git.mv('src/cart/old.ts', 'src/cart/renamed.ts');
    await commitAll('rename old module');

    const files = await getChangedFiles(base, dir);
    expect(files).toEqual(['src/cart/renamed.ts']);
  });

  it('ignores files changed on the base ref after the branch point (three-dot)', async () => {
    const base = await initRepo();
    await git.checkoutBranch('feature', base);
    await writeRepoFile('src/cart/discount.ts', 'export const discount = 20;\n');
    await commitAll('feature work');

    await git.checkout(base);
    await writeRepoFile('docs/guide.md', '# unrelated base-side change\n');
    await commitAll('base moved on');
    await git.checkout('feature');

    const files = await getChangedFiles(base, dir);
    expect(files).toEqual(['src/cart/discount.ts']);
  });

  it('returns an empty list when the branch has no changes', async () => {
    const base = await initRepo();
    await git.checkoutBranch('feature', base);
    await expect(getChangedFiles(base, dir)).resolves.toEqual([]);
  });

  it('throws DiffError naming the ref for an invalid base ref', async () => {
    await initRepo();
    const err = await getChangedFiles('nonexistent-ref', dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiffError);
    expect((err as Error).message).toContain('nonexistent-ref');
  });

  it('throws DiffError when cwd is not a git repository', async () => {
    const err = await getChangedFiles('main', dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiffError);
    expect((err as Error).message).toMatch(/git repository/);
  });
});
