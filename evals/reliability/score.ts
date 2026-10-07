/**
 * Scoring for the reliability benchmark (design measure-verdict-reliability, D3).
 * Pure: a run's JUnit report in, one outcome per sample out.
 *
 * The JUnit report is read rather than the console, because the console is for
 * people and is reworded whenever that helps one.
 */

export interface JUnitCase {
  /** The test file, relative to the repository root. */
  file: string;
  summary: string;
  status: 'passed' | 'failed' | 'skipped';
  failedStep?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '');
}

/** Reads the testcases of a report written by `renderJUnit`. */
export function parseJUnit(xml: string): JUnitCase[] {
  const cases: JUnitCase[] = [];
  const testcase = /<testcase classname="([^"]*)" name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcase)) {
    const [, file = '', summary = '', , body = ''] = match;
    const base = { file: unescapeXml(file), summary: unescapeXml(summary) };
    if (body.includes('<skipped')) {
      cases.push({ ...base, status: 'skipped' });
    } else if (body.includes('<failure')) {
      const step = /<failure[^>]*>failing step: ([^\n]*)\n/.exec(body)?.[1];
      cases.push({ ...base, status: 'failed', failedStep: step === undefined ? undefined : unescapeXml(step) });
    } else {
      cases.push({ ...base, status: 'passed' });
    }
  }
  return cases;
}

export type MutantOutcome = 'caught' | 'caught-elsewhere' | 'false-pass' | 'incomplete';
export type SuiteOutcome = 'pass' | 'false-fail' | 'incomplete';

/**
 * The step a run's sign-in failed at, from its console output, or undefined.
 * A failed sign-in ends the run with exit 2 and no report: no test reached a
 * verdict, yet the gate failed, which is a verdict a user receives.
 */
export function authFailure(log: string): string | undefined {
  return /Authentication failed at step "([^"]*)"/.exec(log)?.[1];
}

/**
 * One mutant sample. `testcase` is the target's case from the run's report, or
 * undefined when the run left none. A run whose sign-in failed blocked the merge
 * for a reason that is not the seeded bug: caught elsewhere. Any other run
 * without a verdict (a stop of the budget or the provider) is incomplete.
 */
export function scoreMutant(
  testcase: JUnitCase | undefined,
  expectedStep: string,
  authFailedAt?: string,
): MutantOutcome {
  if (!testcase && authFailedAt !== undefined) return 'caught-elsewhere';
  if (!testcase || testcase.status === 'skipped') return 'incomplete';
  if (testcase.status === 'passed') return 'false-pass';
  return testcase.failedStep === expectedStep ? 'caught' : 'caught-elsewhere';
}

/**
 * One test of the unmodified suite. A sign-in that failed against the correct
 * app blocked every test of the run: each is a false FAIL, not a run that did
 * not count.
 */
export function scoreSuite(testcase: JUnitCase | undefined, authFailedAt?: string): SuiteOutcome {
  if (!testcase && authFailedAt !== undefined) return 'false-fail';
  if (!testcase || testcase.status === 'skipped') return 'incomplete';
  return testcase.status === 'passed' ? 'pass' : 'false-fail';
}

/**
 * The 95% Wilson upper bound on a rate of `errors` in `n`. With no error seen,
 * the honest claim is a bound, not zero: 0 in 60 is "below about 6%".
 */
export function wilsonUpper(errors: number, n: number, z = 1.96): number {
  if (n === 0) return 1;
  const p = errors / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (centre + margin) / (1 + z2 / n));
}

export interface Tally<T extends string> {
  counts: Record<T, number>;
  /** Samples that reached a verdict: every outcome but incomplete. */
  decided: number;
}

export function tally<T extends string>(outcomes: T[], all: readonly T[]): Tally<T> {
  const counts = Object.fromEntries(all.map((o) => [o, 0])) as Record<T, number>;
  for (const o of outcomes) counts[o]++;
  return { counts, decided: outcomes.filter((o) => o !== 'incomplete').length };
}

/** "1/60 (1.7%, ≤ 8.9%)": the count, the rate, and its 95% upper bound. */
export function formatRate(errors: number, n: number): string {
  if (n === 0) return 'no decided sample';
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  return `${errors}/${n} (${pct(errors / n)}, ≤ ${pct(wilsonUpper(errors, n))} at 95%)`;
}
