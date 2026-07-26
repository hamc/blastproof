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

function fakePage(overrides: Partial<PageLike> = {}): { page: PageLike; visited: string[] } {
  const visited: string[] = [];
  const page = {
    goto: async (url: string) => {
      visited.push(url);
      return undefined;
    },
    url: () => visited[visited.length - 1] ?? '',
    ...overrides,
  } as unknown as PageLike;
  return { page, visited };
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

describe('generateForRoute', () => {
  it('loads the route, snapshots it and sets routes to exactly that route', async () => {
    const captured: { input?: { route?: string; snapshot?: string; changedFiles?: string[] } } = {};
    const { page, visited } = fakePage();

    const draft = await generateForRoute(page, {
      route: '/cart',
      baseUrl: 'http://localhost:4173',
      changedFiles: ['src/cart/discount.ts'],
      brain: stubBrain(DRAFT, captured),
      snapshot: async () => '- button "Apply discount"',
    });

    expect(visited).toEqual(['http://localhost:4173/cart']);
    expect(captured.input?.route).toBe('/cart');
    expect(captured.input?.snapshot).toContain('Apply discount');
    expect(captured.input?.changedFiles).toEqual(['src/cart/discount.ts']);
    // Coverage is assigned by code, never by the model (design D6).
    expect(draft.routes).toEqual(['/cart']);
  });

  it('ignores any routes the model tries to return', async () => {
    const { page } = fakePage();
    const rogue = { ...DRAFT, routes: ['/somewhere-else'] } as unknown as GeneratedTest;

    const draft = await generateForRoute(page, {
      route: '/settings',
      baseUrl: 'http://localhost:4173',
      changedFiles: [],
      brain: stubBrain(rogue),
      snapshot: async () => '- main',
    });

    expect(draft.routes).toEqual(['/settings']);
  });

  it('wraps a navigation failure in PlannerError naming the URL', async () => {
    const { page } = fakePage({
      goto: async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED');
      },
    });

    await expect(
      generateForRoute(page, {
        route: '/cart',
        baseUrl: 'http://localhost:4173',
        changedFiles: [],
        brain: stubBrain(),
        snapshot: async () => '',
      }),
    ).rejects.toThrow(/Cannot load http:\/\/localhost:4173\/cart/);
  });

  it('rejects a draft whose steps carry literal secrets', async () => {
    const { page } = fakePage();
    const leaky: GeneratedTest = {
      ...DRAFT,
      steps: ['fill the password field with "hunter2"'],
    };

    await expect(
      generateForRoute(page, {
        route: '/login',
        baseUrl: 'http://localhost:4173',
        changedFiles: [],
        brain: stubBrain(leaky),
        snapshot: async () => '- textbox "Password"',
      }),
    ).rejects.toThrow(PlannerError);
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
