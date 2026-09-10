import { simpleGit } from 'simple-git';

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffError';
  }
}

function toDiffError(error: unknown, baseRef: string): DiffError {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository/i.test(message)) {
    return new DiffError(
      'Cannot compute diff: not inside a git repository. Run blastproof from within your project repository.',
    );
  }
  if (/no merge base/i.test(message)) {
    return new DiffError(
      `Cannot compute diff against '${baseRef}': no common merge-base with HEAD (shallow clone?). Fetch more history, e.g. \`git fetch --deepen\` or set fetch-depth: 0 in actions/checkout.`,
    );
  }
  if (/unknown revision|ambiguous argument|bad revision|invalid object name/i.test(message)) {
    return new DiffError(
      `Cannot compute diff: base ref '${baseRef}' does not exist in this repository. Fetch it first (e.g. \`git fetch origin ${baseRef}\`) or pass a valid --base ref.`,
    );
  }
  return new DiffError(`Cannot compute diff against '${baseRef}': ${message}`);
}

/**
 * Returns the sorted repo-relative paths of files changed on the current branch
 * relative to `baseRef` (`git diff <baseRef>...HEAD`, three-dot merge-base
 * semantics): added, modified, deleted and renamed files, paths only.
 * Throws DiffError with an actionable message on invalid refs, non-repo cwd
 * or a missing merge-base (e.g. shallow CI clone).
 */
export async function getChangedFiles(
  baseRef: string,
  cwd: string = process.cwd(),
): Promise<string[]> {
  try {
    const summary = await simpleGit(cwd).diffSummary(['--name-only', `${baseRef}...HEAD`]);
    return summary.files.map((file) => file.file).sort();
  } catch (error) {
    throw toDiffError(error, baseRef);
  }
}

/**
 * Returns the sorted repo-relative paths changed in the working tree: staged,
 * unstaged, untracked and renamed, with `.gitignore` already applied by git.
 *
 * These are exactly the paths `getChangedFiles` cannot see. `<base>...HEAD`
 * compares two commits, so nothing that has not been committed is in it — which
 * is the right comparison in CI, where everything is, and the wrong one on the
 * machine the change is being written on (#99).
 *
 * A rename contributes both of its paths (`from` and `to`): a page that moved
 * changes what covers the route it left as much as the route it arrived at.
 *
 * Resolves to `[]` rather than throwing (design D7). Callers reach this after
 * `getChangedFiles` has already succeeded, so the repository exists and the ref
 * resolved; a failure past that point belongs to a warning, and a warning must
 * never be the thing that ends a run.
 */
export async function getUncommittedFiles(cwd: string = process.cwd()): Promise<string[]> {
  try {
    const status = await simpleGit(cwd).status();
    const paths = new Set<string>();
    for (const file of status.files) {
      paths.add(file.path.replace(/\\/g, '/'));
      // simple-git carries the pre-rename path here and nowhere else in `files`.
      const from = (file as { from?: string }).from;
      if (from) paths.add(from.replace(/\\/g, '/'));
    }
    return [...paths].sort();
  } catch {
    return [];
  }
}
