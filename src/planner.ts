import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { PlannerBrain } from './llm/brain.js';
import type { GeneratedTest } from './llm/schemas.js';
import type { PageLike } from './runner/actions.js';
import { defaultSnapshot } from './runner/executor.js';
import { TESTS_RELATIVE_DIR, type TestFile } from './runner/testfile.js';
import { fsReason } from './report/errors.js';

export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

/** A generated test plus the route coverage the planner assigns to it (design D6). */
export type TestDraft = GeneratedTest & { routes: string[] };

export interface GenerateOptions {
  route: string;
  baseUrl: string;
  /** Changed files that mapped to this route; empty for `--route` generation. */
  changedFiles: string[];
  brain: PlannerBrain;
  /**
   * Required, not optional: `plan` authenticates and then browses the session, so
   * a page can render the credential. This command shipped with no masking at all
   * because the boundary was closed at one call site instead of being defined over
   * every caller that prompts a model (design D2).
   */
  mask: (text: string) => string;
  /** Injectable snapshotter (defaults to live ariaSnapshot), mirroring the executor. */
  snapshot?: (page: PageLike) => Promise<string>;
  /**
   * Caps accessibility-tree lines sent to the model (mirrors the executor's
   * option of the same name). Only applies to the default snapshotter; an
   * injected `snapshot` fully replaces it.
   */
  maxSnapshotLines?: number;
  /**
   * The configured `browser.timeout_ms` (design D1, browser-patience): bounds how
   * long the route's initial load waits, mirroring the executor's `navigate`
   * action.
   *
   * Required, not optional — same reasoning as `ExecutorOptions.timeoutMs`
   * (runner/executor.ts): the one real caller (`plan`) always has the configured
   * value on hand, and an unset value has no legitimate "don't care" meaning here
   * — it would silently reinstate the fixed 30s this change exists to make
   * configurable.
   */
  timeoutMs: number;
}

/** Steps naming a credential alongside a quoted literal, with no `{{env.*}}` placeholder. */
const CREDENTIAL_WORD = /\b(password|passwd|api[ _-]?key|token|secret|credential)\b/i;
const QUOTED_LITERAL = /["'][^"']+["']/;

/**
 * Returns the steps that appear to carry a literal secret instead of a placeholder
 * (design D8). A credential word alone is not enough — "check the password field is
 * visible" is fine; it is the quoted literal without `{{env.*}}` that is a violation.
 */
export function findSecretLiterals(steps: string[]): string[] {
  return steps.filter(
    (step) => CREDENTIAL_WORD.test(step) && QUOTED_LITERAL.test(step) && !step.includes('{{env.'),
  );
}

/** A draft as `generateForRoute` returns it: the test, plus what `plan` should warn about. */
export type PlannedDraft = TestDraft & { unsourcedEmails: UnsourcedEmail[] };

/** An email address in a draft step that the page it was drafted from does not show. */
export interface UnsourcedEmail {
  /** 0-based index into the draft's steps. */
  step: number;
  address: string;
}

// Deliberately plain (design an-account-identifier-is-a-placeholder-too, D2): a
// local part, `@`, a domain with at least one dot. The question is "does this
// step carry an address", not "is this address valid".
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Returns every email address a step writes that the snapshot does not contain,
 * compared case-insensitively (design D2). It is the runner's rule for a filled
 * value — one in neither the step nor the page was supplied by the model —
 * applied one stage earlier, to the draft. An address read off the page, such as
 * a support contact, is a legitimate thing to verify and is not reported.
 *
 * Email is the one identifier with a shape precise enough to check. Usernames and
 * account numbers have none, and matching them by wording would be the grammar
 * heuristic #72 rejected; they stay guidance, and the docs say so.
 */
export function findUnsourcedEmails(steps: string[], snapshot: string): UnsourcedEmail[] {
  const page = snapshot.toLowerCase();
  const found: UnsourcedEmail[] = [];
  steps.forEach((text, step) => {
    for (const [address] of text.matchAll(EMAIL_ADDRESS)) {
      if (!page.includes(address.toLowerCase())) found.push({ step, address });
    }
  });
  return found;
}

/**
 * Derives the test filename stem from a route: `/` → `home`, everything else
 * lowercased with non-alphanumerics collapsed to `-` (design D7).
 */
export function routeToSlug(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'home';
}

export interface ProvenanceMeta {
  route: string;
  /** Base ref the diff came from; omitted when the route was named with `--route`. */
  base?: string;
  /** ISO date (YYYY-MM-DD); injectable so tests are not clock-dependent. */
  date?: string;
}

/** Renders a draft as YAML with the provenance comment header (design D7). */
export function renderTestYaml(draft: TestDraft, meta: ProvenanceMeta): string {
  const header = [
    '# Generated by `blastproof plan` — review before committing.',
    `# route: ${meta.route}`,
    `# base: ${meta.base ?? '(explicit --route)'}`,
    `# generated: ${meta.date ?? new Date().toISOString().slice(0, 10)}`,
    '',
  ].join('\n');
  return (
    header +
    stringify({
      summary: draft.summary,
      priority: draft.priority,
      tags: draft.tags,
      routes: draft.routes,
      steps: draft.steps,
    })
  );
}

/**
 * Generates one test draft for a route: load it, snapshot it, one LLM call (design D2/D4).
 * `routes` is set here, never taken from the model, so the draft provably closes the
 * coverage gap that triggered it (design D6).
 */
export async function generateForRoute(
  page: PageLike,
  options: GenerateOptions,
): Promise<PlannedDraft> {
  const { route, baseUrl, changedFiles, brain, mask, snapshot, maxSnapshotLines, timeoutMs } = options;
  const takeSnapshot = snapshot ?? ((p: PageLike) => defaultSnapshot(p, maxSnapshotLines));

  const url = new URL(route, baseUrl).toString();
  try {
    // Same knob as the executor's `navigate` action (design D1): a slow app is
    // waited for at the configured timeout, not a value fixed in the code.
    await page.goto(url, { timeout: timeoutMs });
  } catch (error) {
    throw new PlannerError(
      `Cannot load ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Kept, not inlined: the draft is checked against the very page the model saw
  // (design D4), not a second snapshot of a page that may have changed since.
  const pageSnapshot = mask(await takeSnapshot(page));
  const generated = await brain.planTest({
    route,
    snapshot: pageSnapshot,
    changedFiles,
  });

  const leaked = findSecretLiterals(generated.steps);
  if (leaked.length > 0) {
    throw new PlannerError(
      `Generated steps contain literal secrets instead of {{env.VAR}} placeholders: ${leaked.join(' | ')}`,
    );
  }

  // Travels with the draft rather than failing it (design D3): a literal email is
  // a wrong test, not a leak, and the draft is otherwise worth reviewing.
  // `renderTestYaml` selects its fields, so this never reaches the file.
  return {
    ...generated,
    routes: [route],
    unsourcedEmails: findUnsourcedEmails(generated.steps, pageSnapshot),
  };
}

/**
 * Writes a draft under `.blastproof/tests/`, never overwriting: an existing target
 * fails this route with the conflicting path (design D7). Returns the path written.
 */
export async function writeDraft(
  cwd: string,
  draft: TestDraft,
  meta: ProvenanceMeta,
): Promise<string> {
  const dir = path.join(cwd, TESTS_RELATIVE_DIR);
  const file = path.join(dir, `${routeToSlug(meta.route)}.yaml`);
  try {
    await mkdir(dir, { recursive: true });
    // 'wx' fails if the file exists — atomic, so a concurrent write cannot slip through.
    await writeFile(file, renderTestYaml(draft, meta), { flag: 'wx' });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EEXIST' && err.syscall !== 'mkdir') {
      throw new PlannerError(
        `Refusing to overwrite ${path.relative(cwd, file)} (route ${meta.route}). ` +
          'Delete or rename it to regenerate.',
      );
    }
    throw new PlannerError(
      `Cannot write draft to ${file}: ${fsReason(error)}. Check that ${path.dirname(file)} is a directory you can write to, not a file.`
    );
  }
  return file;
}

/** Routes already covered by at least one test in the suite. */
export function coveredRoutes(tests: TestFile[]): Set<string> {
  return new Set(tests.flatMap((test) => test.routes));
}
