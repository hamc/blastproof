import picomatch from 'picomatch';

export interface ImpactResult {
  /** Sorted, de-duplicated routes affected by the changed files. */
  affectedRoutes: string[];
  /**
   * Sorted changed files matching neither a `routes:` glob nor an `ignore:` glob —
   * files whose blast radius nobody has declared (design D1).
   */
  unmappedFiles: string[];
  /** Sorted changed files declared irrelevant via `ignore:`. */
  ignoredFiles: string[];
}

/**
 * Maps changed files to affected routes using the config `routes:` glob→URL-list
 * entries (pure, no I/O). Paths are normalized to forward slashes before matching.
 *
 * Each file lands in exactly one of three buckets (design D1): mapped to routes,
 * ignored, or unclassified. Only the third is reported as unmapped, which is what
 * makes that report — and the gate built on it — worth acting on.
 */
export function mapImpact(
  changedFiles: string[],
  routes: Record<string, string[]>,
  ignore: string[] = [],
): ImpactResult {
  const matchers = Object.entries(routes).map(([glob, urls]) => ({
    isMatch: picomatch(glob, { dot: true }),
    urls,
  }));
  const isIgnored = ignore.map((glob) => picomatch(glob, { dot: true }));

  const affected = new Set<string>();
  const unmapped: string[] = [];
  const ignored: string[] = [];

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    // Ignore wins: a file declared irrelevant contributes nothing, even if some
    // glob would also match it. Otherwise "irrelevant" would not mean irrelevant.
    if (isIgnored.some((matches) => matches(normalized))) {
      ignored.push(normalized);
      continue;
    }

    let matched = false;
    for (const { isMatch, urls } of matchers) {
      if (isMatch(normalized)) {
        matched = true;
        for (const url of urls) {
          affected.add(url);
        }
      }
    }
    if (!matched) {
      unmapped.push(normalized);
    }
  }

  return {
    affectedRoutes: [...affected].sort(),
    unmappedFiles: unmapped.sort(),
    ignoredFiles: ignored.sort(),
  };
}
