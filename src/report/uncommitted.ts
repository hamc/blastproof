import type { BlastproofConfig } from '../config.js';
import { mapImpact } from '../impact.js';
import { emitWarning, type RunWarning } from './warnings.js';

/**
 * Prints the working-tree changes the diff excluded, to stderr (design D2).
 *
 * `--impacted` selects from `git diff <base>...HEAD`, which sees only commits.
 * A run against a dirty tree therefore reports no affected routes, selects
 * nothing and exits 0 without ever saying what it did not look at (#99) — and
 * `--fail-on-unmapped` cannot catch it, because the guard inspects the changed
 * files the hole already excluded it from.
 *
 * The report names routes and decides nothing (design D2). `-> /login` tells a
 * reader that a journey they have tests for went untested; the file name alone
 * leaves them to work that out. Selecting from the working tree is a separate
 * decision (#99's second half) and this deliberately does not make it.
 *
 * Two classes stay silent (design D3), because a warning that fires on every
 * run stops being read:
 *
 * - a file `ignore:` matches — the user has already declared it cannot affect a
 *   page, and re-reporting it here would contradict our own vocabulary
 * - a file already in the diff — `--impacted` selects at route granularity, so
 *   its routes are in the selection regardless of an extra uncommitted edit
 *
 * Classification goes through `mapImpact` one file at a time, the same idiom
 * `plan` already uses to attribute files to routes. Reusing the one classifier
 * is what makes it impossible for this warning to disagree with the impact
 * report printed beside it.
 *
 * Non-fatal: no exit code, no selection and no gate changes. `run` passes its
 * list of warnings so the reports carry it too; `plan` writes no report.
 */
export function printUncommitted(
  uncommitted: string[],
  changedFiles: string[],
  config: Pick<BlastproofConfig, 'routes' | 'ignore'>,
  baseRef: string,
  into?: RunWarning[],
): void {
  emitWarning(uncommittedWarning(uncommitted, changedFiles, config, baseRef), into);
}

/** The warning `printUncommitted` prints, or none when nothing was left out. */
export function uncommittedWarning(
  uncommitted: string[],
  changedFiles: string[],
  config: Pick<BlastproofConfig, 'routes' | 'ignore'>,
  baseRef: string,
): RunWarning | undefined {
  const inDiff = new Set(changedFiles.map((file) => file.replace(/\\/g, '/')));
  const routes = config.routes ?? {};
  const ignore = config.ignore ?? [];

  const findings = uncommitted
    .filter((file) => !inDiff.has(file))
    .map((file) => ({ file, impact: mapImpact([file], routes, ignore) }))
    .filter(({ impact }) => impact.ignoredFiles.length === 0);

  if (findings.length === 0) return undefined;

  return {
    kind: 'uncommitted',
    title: `warning: ${findings.length} file(s) changed in the working tree are not in the diff against '${baseRef}':`,
    lines: [
      ...findings.map(({ file, impact }) =>
        impact.affectedRoutes.length > 0
          ? `  ${file} -> ${impact.affectedRoutes.join(', ')}`
          : `  ${file}  (matched by no routes: or ignore: glob)`,
      ),
      'Nothing above was considered. Commit or stash them to include them.',
    ],
    spaced: true,
  };
}
