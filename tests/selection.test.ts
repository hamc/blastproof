import { describe, expect, it } from 'vitest';
import { detectRouteDrift, matchesFilters, selectImpactedTests } from '../src/runner/selection.js';
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

describe('detectRouteDrift', () => {
  it('detects trailing-slash drift against an exactly-matching mapping', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart/'] });
    const result = detectRouteDrift([cart], ['/cart']);
    expect(result.drifted).toEqual([{ test: cart, routes: ['/cart/'] }]);
  });

  it('detects a typo drift', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/crat'] });
    const result = detectRouteDrift([cart], ['/cart']);
    expect(result.drifted).toEqual([{ test: cart, routes: ['/crat'] }]);
  });

  it('reports no drift when every test route is declared by a mapping', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart', '/login'] });
    const result = detectRouteDrift([cart], ['/cart', '/login', '/checkout']);
    expect(result.drifted).toEqual([]);
  });

  it('does not run when no routes mappings are declared (metadata use)', () => {
    const cart = makeTest({ summary: 'cart', routes: ['/cart'] });
    expect(detectRouteDrift([cart], [])).toEqual({ drifted: [] });
  });

  it('does not flag a test that declares no routes', () => {
    const unrouted = makeTest({ summary: 'legacy' });
    expect(detectRouteDrift([unrouted], ['/cart']).drifted).toEqual([]);
  });

  it('de-duplicates and sorts the drifted routes per test', () => {
    const test = makeTest({ summary: 'mixed', routes: ['/x', '/x', '/a'] });
    const result = detectRouteDrift([test], ['/y']);
    expect(result.drifted).toEqual([{ test, routes: ['/a', '/x'] }]);
  });

  it('returns only the drifted tests, in input order', () => {
    const ok = makeTest({ summary: 'ok', routes: ['/cart'] });
    const drifted = makeTest({ summary: 'drifted', routes: ['/missing'] });
    const result = detectRouteDrift([ok, drifted], ['/cart']);
    expect(result.drifted).toEqual([{ test: drifted, routes: ['/missing'] }]);
  });

  it('does not flag a route declared by config but absent from this diff (D3)', () => {
    // Drift compares against the full declared universe, not affectedRoutes, so a
    // route valid but untouched by the diff is not drift.
    const cart = makeTest({ summary: 'cart', routes: ['/cart'] });
    expect(detectRouteDrift([cart], ['/cart']).drifted).toEqual([]);
  });
});
