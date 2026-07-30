import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannerBrain } from '../src/llm/brain.js';
import type { GeneratedTest } from '../src/llm/schemas.js';
import {
  coveredRoutes,
  findSecretLiterals,
  generateForRoute,
  PlannerError,
  renderTestYaml,
  routeToSlug,
  writeDraft,
  type GenerateOptions,
  type TestDraft,
} from '../src/planner.js';
import type { PageLike } from '../src/runner/actions.js';
import { parseTestFile, type TestFile } from '../src/runner/testfile.js';

const DRAFT: GeneratedTest = {
  summary: 'Applying a discount updates the cart total',
  steps: ['open the cart', 'apply discount code SAVE20', 'check the total drops'],
  priority: 'P0',
  tags: ['cart', 'checkout'],
};

function stubBrain(draft: GeneratedTest = DRAFT, captured?: { input?: unknown }): PlannerBrain {
  return {
    async planTest(input) {
      if (captured) captured.input = input;
      return draft;
    },
  };
}

function fakePage(
  overrides: Partial<PageLike> = {},
): { page: PageLike; visited: string[]; gotoTimeouts: (number | undefined)[] } {
  const visited: string[] = [];
  const gotoTimeouts: (number | undefined)[] = [];
  const page = {
    goto: async (url: string, options?: { timeout?: number }) => {
      visited.push(url);
      gotoTimeouts.push(options?.timeout);
      return undefined;
    },
    url: () => visited[visited.length - 1] ?? '',
    ...overrides,
  } as unknown as PageLike;
  return { page, visited, gotoTimeouts };
}

describe('routeToSlug', () => {
  it('maps the root route to home', () => {
    expect(routeToSlug('/')).toBe('home');
    expect(routeToSlug('')).toBe('home');
  });

  it('slugifies nested and messy routes', () => {
    expect(routeToSlug('/cart/discount')).toBe('cart-discount');
    expect(routeToSlug('/Products/Item_42')).toBe('products-item-42');
    expect(routeToSlug('/checkout?step=2')).toBe('checkout-step-2');
  });
});

describe('findSecretLiterals', () => {
  it('flags a credential step carrying a quoted literal', () => {
    expect(findSecretLiterals(['fill the password field with "hunter2"'])).toHaveLength(1);
  });

  it('accepts placeholders and credential mentions without literals', () => {
    expect(
      findSecretLiterals([
        'fill the password field with {{env.TEST_PASSWORD}}',
        'check the password field is visible',
        'click the "Sign in" button',
      ]),
    ).toEqual([]);
  });
});

describe('renderTestYaml', () => {
  it('emits a provenance header and a body that parses as a test file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-render-'));
    try {
      const yaml = renderTestYaml(
        { ...DRAFT, routes: ['/cart'] },
        { route: '/cart', base: 'main', date: '2026-07-26' },
      );
      expect(yaml).toContain('# route: /cart');
      expect(yaml).toContain('# base: main');
      expect(yaml).toContain('# generated: 2026-07-26');

      const file = path.join(dir, 'cart.yaml');
      await writeFile(file, yaml);
      const parsed = await parseTestFile(file);
      expect(parsed.summary).toBe(DRAFT.summary);
      expect(parsed.steps).toEqual(DRAFT.steps);
      expect(parsed.priority).toBe('P0');
      expect(parsed.routes).toEqual(['/cart']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks explicit --route generation in the header', () => {
    const yaml = renderTestYaml({ ...DRAFT, routes: ['/cart'] }, { route: '/cart', date: '2026-07-26' });
    expect(yaml).toContain('(explicit --route)');
  });
});

/** Mirrors config `browser.timeout_ms`'s own schema default (src/config.ts). */
const DEFAULT_TEST_TIMEOUT_MS = 30_000;

/**
 * Base `GenerateOptions` for tests that don't care about the specific timeout
 * value. `timeoutMs` is required on the real type (browser-patience, same
 * reasoning as `ExecutorOptions.timeoutMs`: the one real caller, `plan`, always
 * has the configured value on hand, and an unset value has no legitimate
 * "don't care" meaning — it would silently reinstate a fixed 30s). Centralising
 * the default here, rather than at each of this file's `generateForRoute`
 * calls, is what keeps that requirement cheap (mirrors `auth.test.ts`'s
 * `options()` and `executor.test.ts`'s `baseOptions`).
 */
function baseGenerateOptions(
  overrides: Partial<GenerateOptions> & Pick<GenerateOptions, 'route' | 'brain'>,
): GenerateOptions {
  return {
    baseUrl: 'http://localhost:4173',
    changedFiles: [],
    mask: (t: string) => t,
    snapshot: async () => '- main',
    timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    ...overrides,
  };
}

describe('generateForRoute', () => {
  it('loads the route, snapshots it and sets routes to exactly that route', async () => {
    const captured: { input?: { route?: string; snapshot?: string; changedFiles?: string[] } } = {};
    const { page, visited } = fakePage();

    const draft = await generateForRoute(
      page,
      baseGenerateOptions({
        route: '/cart',
        changedFiles: ['src/cart/discount.ts'],
        brain: stubBrain(DRAFT, captured),
        snapshot: async () => '- button "Apply discount"',
      }),
    );

    expect(visited).toEqual(['http://localhost:4173/cart']);
    expect(captured.input?.route).toBe('/cart');
    expect(captured.input?.snapshot).toContain('Apply discount');
    expect(captured.input?.changedFiles).toEqual(['src/cart/discount.ts']);
    // Coverage is assigned by code, never by the model (design D6).
    expect(draft.routes).toEqual(['/cart']);
  });

  it('uses the configured browser.timeout_ms for the route load, not a fixed value (browser-patience)', async () => {
    const { page, gotoTimeouts } = fakePage();

    await generateForRoute(page, baseGenerateOptions({ route: '/cart', brain: stubBrain(), timeoutMs: 45_000 }));

    expect(gotoTimeouts).toEqual([45_000]);
  });

  it('ignores any routes the model tries to return', async () => {
    const { page } = fakePage();
    const rogue = { ...DRAFT, routes: ['/somewhere-else'] } as unknown as GeneratedTest;

    const draft = await generateForRoute(page, baseGenerateOptions({ route: '/settings', brain: stubBrain(rogue) }));

    expect(draft.routes).toEqual(['/settings']);
  });

  it('wraps a navigation failure in PlannerError naming the URL', async () => {
    const { page } = fakePage({
      goto: async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED');
      },
    });

    await expect(
      generateForRoute(page, baseGenerateOptions({ route: '/cart', brain: stubBrain(), snapshot: async () => '' })),
    ).rejects.toThrow(/Cannot load http:\/\/localhost:4173\/cart/);
  });

  it('rejects a draft whose steps carry literal secrets', async () => {
    const { page } = fakePage();
    const leaky: GeneratedTest = {
      ...DRAFT,
      steps: ['fill the password field with "hunter2"'],
    };

    await expect(
      generateForRoute(
        page,
        baseGenerateOptions({ route: '/login', brain: stubBrain(leaky), snapshot: async () => '- textbox "Password"' }),
      ),
    ).rejects.toThrow(PlannerError);
  });
});

describe('the planner masks too', () => {
  it('never sends a rendered secret to the model', async () => {
    // `plan` authenticates and then browses that session, and shipped with no
    // masking at all: the boundary had been closed at one call site instead of
    // being defined over every caller that prompts a model.
    const captured: { input?: { snapshot?: string } } = {};
    const { page } = fakePage();

    await generateForRoute(
      page,
      baseGenerateOptions({
        route: '/account',
        brain: stubBrain(DRAFT, captured),
        mask: (t) => t.replace(/LIVE-SECRET-abc123/g, '***'),
        snapshot: async () => '- text "Authenticated with token: LIVE-SECRET-abc123"',
      }),
    );

    expect(captured.input?.snapshot).not.toContain('LIVE-SECRET-abc123');
  });
});

describe('writeDraft', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'blastproof-write-'));
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the draft under .blastproof/tests using the route slug', async () => {
    const draft: TestDraft = { ...DRAFT, routes: ['/cart/discount'] };
    const file = await writeDraft(dir, draft, { route: '/cart/discount', base: 'main' });

    expect(path.relative(dir, file)).toBe(path.join('.blastproof', 'tests', 'cart-discount.yaml'));
    const parsed = await parseTestFile(file);
    expect(parsed.routes).toEqual(['/cart/discount']);
  });

  it('refuses to overwrite an existing file and leaves it untouched', async () => {
    const existing = path.join(dir, '.blastproof', 'tests', 'cart.yaml');
    await writeFile(existing, 'summary: hand written\nsteps:\n  - do not clobber me\n');

    const draft: TestDraft = { ...DRAFT, routes: ['/cart'] };
    await expect(writeDraft(dir, draft, { route: '/cart', base: 'main' })).rejects.toThrow(
      PlannerError,
    );
    await expect(readFile(existing, 'utf8')).resolves.toContain('do not clobber me');
  });
});

describe('coveredRoutes', () => {
  it('collects every declared route across the suite', () => {
    const tests = [
      { routes: ['/cart', '/checkout'] },
      { routes: ['/login'] },
      { routes: [] },
    ] as TestFile[];
    expect([...coveredRoutes(tests)].sort()).toEqual(['/cart', '/checkout', '/login']);
  });
});
