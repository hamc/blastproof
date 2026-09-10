import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlastproofConfig } from '../src/config.js';
import { printUncommitted } from '../src/report/uncommitted.js';

type Routes = Pick<BlastproofConfig, 'routes' | 'ignore'>;

const CONFIG: Routes = {
  routes: {
    'app/cart.html': ['/cart', '/checkout'],
    'app/login.html': ['/login'],
  },
  ignore: ['src/**', '**/*.md'],
};

let errors: string[];
const errOut = (): string => errors.join('\n');

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printUncommitted', () => {
  it("names an uncommitted file beside the routes it would have affected", async () => {
    // #99's reproduction, as a unit: the file is mapped, the diff never saw it.
    printUncommitted(['app/cart.html'], [], CONFIG, 'main');

    expect(errOut()).toContain("are not in the diff against 'main'");
    expect(errOut()).toContain('app/cart.html -> /cart, /checkout');
    expect(errOut()).toContain('Commit or stash them');
  });

  it('names a file no glob classified as unclassified', () => {
    printUncommitted(['.tool-versions'], [], CONFIG, 'main');

    expect(errOut()).toContain('.tool-versions  (matched by no routes: or ignore: glob)');
  });

  it('says nothing about a file ignore: already declared irrelevant', () => {
    // Design D3: the user has declared it cannot affect a page, and a warning
    // that fires on every run stops being read.
    printUncommitted(['src/diff.ts', 'README.md'], [], CONFIG, 'main');

    expect(errOut()).toBe('');
  });

  it('says nothing about a file already in the diff', () => {
    // Its routes are in the selection regardless of an extra uncommitted edit:
    // --impacted selects at route granularity, so nothing about coverage moved.
    printUncommitted(['app/cart.html'], ['app/cart.html'], CONFIG, 'main');

    expect(errOut()).toBe('');
  });

  it('reports the rest when only some of the files are silenced', () => {
    printUncommitted(
      ['app/cart.html', 'app/login.html', 'src/diff.ts'],
      ['app/cart.html'],
      CONFIG,
      'develop',
    );

    expect(errOut()).toContain('1 file(s)');
    expect(errOut()).toContain("against 'develop'");
    expect(errOut()).toContain('app/login.html -> /login');
    expect(errOut()).not.toContain('cart.html');
    expect(errOut()).not.toContain('src/diff.ts');
  });

  it('prints nothing on a clean tree, which is every CI checkout', () => {
    printUncommitted([], ['app/cart.html'], CONFIG, 'main');

    expect(errOut()).toBe('');
  });

  it('works with no routes: and no ignore: at all', () => {
    printUncommitted(['app/cart.html'], [], { routes: undefined, ignore: undefined }, 'main');

    expect(errOut()).toContain('app/cart.html  (matched by no routes: or ignore: glob)');
  });

  it('compares against the diff on forward slashes, whatever the platform gave it', () => {
    printUncommitted(['app/cart.html'], ['app\\cart.html'], CONFIG, 'main');

    expect(errOut()).toBe('');
  });
});
