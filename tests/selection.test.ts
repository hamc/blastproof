import { describe, expect, it } from 'vitest';
import { matchesFilters, selectImpactedTests } from '../src/runner/selection.js';
import type { TestFile } from '../src/runner/testfile.js';

function makeTest(overrides: Partial<TestFile> & { summary: string }): TestFile {
  return {
    path: `/repo/.blastproof/tests/${overrides.summary}.yaml`,
    steps: ['do something'],
    priority: 'P1',
    tags: [],
    routes: [],
    auth: true, // the parser's default (#23)
    ...overrides,
  };
}

const noFilters = { tags: [] };

describe('matchesFilters', () => {
  it('matches everything without filters', () => {
    expect(matchesFilters(makeTest({ summary: 'anything' }), noFilters)).toBe(true);
  });

  it('filters by tag, priority and query', () => {
    const test = makeTest({ summary: 'Checkout flow', priority: 'P0', tags: ['smoke'] });
    expect(matchesFilters(test, { tags: ['smoke'] })).toBe(true);
    expect(matchesFilters(test, { tags: ['cart'] })).toBe(false);
    expect(matchesFilters(test, { tags: [], priority: 'P0' })).toBe(true);
    expect(matchesFilters(test, { tags: [], priority: 'P1' })).toBe(false);
    expect(matchesFilters(test, { tags: [], query: 'checkout' })).toBe(true);
    expect(matchesFilters(test, { tags: [], query: 'login' })).toBe(false);
  });
});

describe('selectImpactedTests', () => {
  it('selects only tests whose routes intersect the affected routes', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart', '/checkout'] });
    const login = makeTest({ summary: 'login', routes: ['/login'] });
    const result = selectImpactedTests([cart, login], ['/cart'], noFilters);
    expect(result.selected).toEqual([cart]);
    expect(result.unroutedSkipped).toEqual([]);
    expect(result.uncoveredRoutes).toEqual([]);
  });

  it('compares route strings by exact equality', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart/'] });
    const result = selectImpactedTests([cart], ['/cart'], noFilters);
    expect(result.selected).toEqual([]);
    expect(result.uncoveredRoutes).toEqual(['/cart']);
  });

  it('applies tag/priority/query filters after the impacted selection', () => {
    const cart = makeTest({ summary: 'Cart checkout', priority: 'P0', tags: ['cart'], routes: ['/cart'] });
    const cartSmoke = makeTest({ summary: 'Cart smoke', priority: 'P2', tags: ['smoke'], routes: ['/cart'] });
    const suite = [cart, cartSmoke];

    expect(selectImpactedTests(suite, ['/cart'], { tags: ['smoke'] }).selected).toEqual([cartSmoke]);
    expect(selectImpactedTests(suite, ['/cart'], { tags: [], priority: 'P0' }).selected).toEqual([cart]);
    expect(selectImpactedTests(suite, ['/cart'], { tags: [], query: 'checkout' }).selected).toEqual([cart]);
  });

  it('skips tests without routes and reports them as unrouted', () => {
    const routed = makeTest({ summary: 'cart', routes: ['/cart'] });
    const unrouted = makeTest({ summary: 'legacy' });
    const result = selectImpactedTests([routed, unrouted], ['/cart'], noFilters);
    expect(result.selected).toEqual([routed]);
    expect(result.unroutedSkipped).toEqual([unrouted]);
  });

  it('reports affected routes covered by no selected test', () => {
    const login = makeTest({ summary: 'login', routes: ['/login'] });
    const result = selectImpactedTests([login], ['/login', '/settings'], noFilters);
    expect(result.selected).toEqual([login]);
    expect(result.uncoveredRoutes).toEqual(['/settings']);
  });

  it('treats a route as uncovered when its only test is removed by filters', () => {
    const cart = makeTest({ summary: 'cart', priority: 'P2', routes: ['/cart'] });
    const result = selectImpactedTests([cart], ['/cart'], { tags: [], priority: 'P0' });
    expect(result.selected).toEqual([]);
    expect(result.uncoveredRoutes).toEqual(['/cart']);
  });

  it('selects nothing when no routes are affected, but still reports unrouted tests', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart'] });
    const unrouted = makeTest({ summary: 'legacy' });
    const result = selectImpactedTests([cart, unrouted], [], noFilters);
    expect(result.selected).toEqual([]);
    expect(result.unroutedSkipped).toEqual([unrouted]);
    expect(result.uncoveredRoutes).toEqual([]);
  });

  it('returns an empty selection for an empty suite', () => {
    expect(selectImpactedTests([], ['/cart'], noFilters)).toEqual({
      selected: [],
      unroutedSkipped: [],
      uncoveredRoutes: ['/cart'],
    });
  });
});
