import picomatch from 'picomatch';

export interface ImpactResult {
  /** Sorted, de-duplicated routes affected by the changed files. */
  affectedRoutes: string[];
  /** Sorted changed files that matched no `routes:` glob. */
  unmappedFiles: string[];
}

/**
 * Maps changed files to affected routes using the config `routes:` glob→URL-list
 * entries (pure, no I/O). Paths are normalized to forward slashes before matching;
 * files matching no glob are reported as unmapped and never fail the run.
 */
export function mapImpact(changedFiles: string[], routes: Record<string, string[]>): ImpactResult {
  const matchers = Object.entries(routes).map(([glob, urls]) => ({
    isMatch: picomatch(glob, { dot: true }),
    urls,
  }));

  const affected = new Set<string>();
  const unmapped: string[] = [];

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
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

  return { affectedRoutes: [...affected].sort(), unmappedFiles: unmapped.sort() };
}
