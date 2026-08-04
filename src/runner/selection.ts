import type { Priority, TestFile } from './testfile.js';

export interface TestFilters {
  tags: string[];
  priority?: Priority;
  query?: string;
}

/** Returns true when the test passes the tag/priority/query filters. */
export function matchesFilters(test: TestFile, filters: TestFilters): boolean {
  if (filters.tags.length > 0 && !filters.tags.some((tag) => test.tags.includes(tag))) {
    return false;
  }
  if (filters.priority && test.priority !== filters.priority) {
    return false;
  }
  if (filters.query && !test.summary.toLowerCase().includes(filters.query.toLowerCase())) {
    return false;
  }
  return true;
}

export interface ImpactedSelection {
  /** Tests covering at least one affected route, after tag/priority/query filters. */
  selected: TestFile[];
  /** Tests with no `routes:` declaration — never executed by `--impacted` (design D4). */
  unroutedSkipped: TestFile[];
  /** Affected routes covered by no selected test — reported, never failing (design D5). */
  uncoveredRoutes: string[];
}

/**
 * Pure impacted selection (design D3): tests whose `routes:` intersect the
 * affected route set, further reduced by the tag/priority/query filters.
 * Route strings compare by exact equality. Tests without `routes:` are skipped
 * and reported; affected routes no selected test covers are reported.
 */
export function selectImpactedTests(
  tests: TestFile[],
  affectedRoutes: string[],
  filters: TestFilters = { tags: [] },
): ImpactedSelection {
  const affected = new Set(affectedRoutes);
  const selected: TestFile[] = [];
  const unroutedSkipped: TestFile[] = [];

  for (const test of tests) {
    if (test.routes.length === 0) {
      unroutedSkipped.push(test);
      continue;
    }
    if (!test.routes.some((route) => affected.has(route))) continue;
    if (!matchesFilters(test, filters)) continue;
    selected.push(test);
  }

  const covered = new Set(selected.flatMap((test) => test.routes));
  return {
    selected,
    unroutedSkipped,
    uncoveredRoutes: affectedRoutes.filter((route) => !covered.has(route)),
  };
}

export interface RouteDriftEntry {
  /** The test declaring at least one route no mapping declares. */
  test: TestFile;
  /** Routes this test declares that no config mapping declares; sorted, de-duplicated. */
  routes: string[];
}

export interface RouteDriftResult {
  drifted: RouteDriftEntry[];
}

/**
 * Pure route-drift detection (design route-drift-warning D1–D7): returns tests
 * that declare at least one route present in no `routes:` mapping's value list.
 * Comparison is exact equality — no normalization (D1) — so `/cart` and `/cart/`
 * are distinct, and a test declaring the one no mapping declares is drift.
 *
 * Computed over the FULL parsed set, not `selectImpactedTests`'s `selected`:
 * a drifted test is precisely one that never gets selected, so checking
 * `selected` would never fire (D2). Compared against the full declared route
 * universe, not the diff's affected subset: drift is "no mapping declares this
 * route at all", independent of the current diff (D3). Empty `declaredRoutes`
 * means config has no `routes:` mappings, so a suite using `routes:` as metadata
 * is not flagged (D4).
 */
export function detectRouteDrift(
  tests: TestFile[],
  declaredRoutes: Iterable<string>,
): RouteDriftResult {
  const known = new Set(declaredRoutes);
  if (known.size === 0) return { drifted: [] };
  const drifted: RouteDriftEntry[] = [];
  for (const test of tests) {
    const unknown = [...new Set(test.routes)]
      .filter((route) => !known.has(route))
      .sort();
    if (unknown.length > 0) drifted.push({ test, routes: unknown });
  }
  return { drifted };
}
