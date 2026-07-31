import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BudgetSpend } from '../runner/budget.js';
import type { TestResult } from '../runner/executor.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Single escaping choke point (design D6). Summaries, steps and failure reasons
 * are model- and user-authored, so any of them can carry XML-significant characters.
 */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** Minimal shape of a test skipped as unrouted under `--impacted`. */
export interface SkippedCase {
  path: string;
  summary: string;
}

export interface JUnitMeta {
  score: number;
  durationMs: number;
  /** Repo root, so `classname` is repo-relative rather than absolute. */
  cwd?: string;
  /** The reason the run's budget or deadline stopped it, when it did (spec run-budget). */
  incomplete?: string;
  /**
   * What the run spent, when this report's caller owns the budget (design
   * report-what-it-spent). Taken from the same `RunBudget` the summary line
   * uses, so the report and the console cannot disagree about what a run cost.
   */
  spend?: BudgetSpend;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * Renders the run as a JUnit `testsuite` (design D7). Unrouted skipped tests are
 * emitted as `<skipped/>` cases so the coverage gap shows up in CI instead of
 * being absent from the report; tests the run's budget or deadline stopped before
 * they executed (`not-run`, spec run-budget) are emitted the same way, with the
 * limit named in the reason rather than the fixed unrouted-skip message. When the
 * run is incomplete, that is recorded as a run-level property, not folded into any
 * one testcase. Pure — returns the XML, writes nothing.
 */
export function renderJUnit(
  results: TestResult[],
  skipped: SkippedCase[],
  meta: JUnitMeta,
): string {
  const relative = (file: string): string =>
    meta.cwd ? path.relative(meta.cwd, file) : file;

  const failures = results.filter((result) => result.status === 'failed').length;
  const notRun = results.filter((result) => result.status === 'not-run');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="blastproof" tests="${results.length + skipped.length}" failures="${failures}" skipped="${skipped.length + notRun.length}" time="${seconds(meta.durationMs)}">`,
    '  <properties>',
    `    <property name="score" value="${meta.score}"/>`,
    ...(meta.spend ? [`    <property name="llm_calls" value="${meta.spend.calls}"/>`] : []),
    // Omitted rather than emitted as zero when no call reported usage: a
    // property carrying 0 would be read by a pipeline as "this run spent no
    // tokens", which is a different claim from "the provider did not say".
    ...(meta.spend && meta.spend.callsWithUsage > 0
      ? [`    <property name="llm_tokens" value="${meta.spend.tokens}"/>`]
      : []),
    ...(meta.incomplete !== undefined
      ? [
          '    <property name="incomplete" value="true"/>',
          `    <property name="incomplete_reason" value="${escapeXml(meta.incomplete)}"/>`,
        ]
      : []),
    '  </properties>',
  ];

  for (const result of results) {
    if (result.status === 'not-run') {
      lines.push(
        `  <testcase classname="${escapeXml(relative(result.file))}" name="${escapeXml(result.summary)}" time="0.000">`,
        `    <skipped message="${escapeXml(result.reason ?? 'not run: the run stopped before this test executed')}"/>`,
        '  </testcase>',
      );
      continue;
    }
    const open = `  <testcase classname="${escapeXml(relative(result.file))}" name="${escapeXml(result.summary)}" time="${seconds(result.durationMs)}"`;
    if (result.status === 'passed') {
      lines.push(`${open}/>`);
      continue;
    }
    const reason = result.reason ?? 'test failed';
    const body = result.failedStep
      ? `failing step: ${result.failedStep}\n${reason}`
      : reason;
    lines.push(`${open}>`);
    lines.push(`    <failure message="${escapeXml(reason)}">${escapeXml(body)}</failure>`);
    lines.push('  </testcase>');
  }

  for (const test of skipped) {
    lines.push(
      `  <testcase classname="${escapeXml(relative(test.path))}" name="${escapeXml(test.summary)}" time="0.000">`,
      '    <skipped message="no routes: declared, skipped by --impacted"/>',
      '  </testcase>',
    );
  }

  lines.push('</testsuite>', '');
  return lines.join('\n');
}

/** Writes the report, creating missing parent directories. Returns the path written. */
export async function writeJUnit(file: string, xml: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, xml, 'utf8');
  return file;
}
