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
