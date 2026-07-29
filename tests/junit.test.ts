import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeXml, renderJUnit, writeJUnit, type SkippedCase } from '../src/report/junit.js';
import type { TestResult } from '../src/runner/executor.js';

function passed(summary: string): TestResult {
  return {
    file: '.blastproof/tests/ok.yaml',
    summary,
    priority: 'P1',
    tags: [],
    status: 'passed',
    steps: [],
    durationMs: 1500,
  };
}

function failed(summary: string, failedStep: string, reason: string): TestResult {
  return {
    file: '.blastproof/tests/bad.yaml',
    summary,
    priority: 'P0',
    tags: [],
    status: 'failed',
    steps: [],
    failedStep,
    reason,
    durationMs: 2500,
  };
}

function notRun(summary: string, reason: string): TestResult {
  return {
    file: '.blastproof/tests/never.yaml',
    summary,
    priority: 'P0',
    tags: [],
    status: 'not-run',
    steps: [],
    reason,
    durationMs: 0,
  };
}

const SKIPPED: SkippedCase[] = [
  { path: '.blastproof/tests/legacy.yaml', summary: 'Legacy test' },
];

describe('escapeXml', () => {
  it('escapes every XML-significant character', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });
});

describe('renderJUnit', () => {
  it('reports suite counts matching its cases', () => {
    const xml = renderJUnit(
      [passed('one'), passed('two'), failed('three', 'step', 'boom')],
      SKIPPED,
      { score: 60, durationMs: 6000 },
    );
    expect(xml).toContain('tests="4"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('time="6.000"');
  });

  it('emits a passing test as a bare self-closing case', () => {
    const xml = renderJUnit([passed('all good')], [], { score: 100, durationMs: 1500 });
    expect(xml).toContain('name="all good" time="1.500"/>');
    expect(xml).not.toContain('<failure');
    expect(xml).not.toContain('<skipped');
  });

  it('carries the reason in the message and the failing step in the body', () => {
    const xml = renderJUnit(
      [failed('checkout', 'apply promo code SAVE20', 'Element not found: role=button')],
      [],
      { score: 0, durationMs: 2500 },
    );
    expect(xml).toContain('<failure message="Element not found: role=button">');
    expect(xml).toContain('failing step: apply promo code SAVE20');
  });

  it('emits unrouted tests as skipped cases', () => {
    const xml = renderJUnit([], SKIPPED, { score: 100, durationMs: 0 });
    expect(xml).toContain('name="Legacy test"');
    expect(xml).toContain('<skipped message="no routes: declared, skipped by --impacted"/>');
  });

  it('exposes the score as a property', () => {
    const xml = renderJUnit([passed('x')], [], { score: 75, durationMs: 100 });
    expect(xml).toContain('<property name="score" value="75"/>');
  });

  it('escapes summaries and reasons so the output stays well-formed', () => {
    const xml = renderJUnit(
      [failed('Cart & "checkout" <flow>', 'step with <angle>', 'reason & "quoted"')],
      [],
      { score: 0, durationMs: 10 },
    );
    expect(xml).toContain('name="Cart &amp; &quot;checkout&quot; &lt;flow&gt;"');
    expect(xml).not.toMatch(/name="[^"]*<flow>/);
    // Round-trips: unescaping recovers the original summary.
    const match = /<testcase [^>]*name="([^"]*)"/.exec(xml);
    const unescaped = match![1]!
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    expect(unescaped).toBe('Cart & "checkout" <flow>');
  });

  it('makes classname repo-relative when a cwd is given', () => {
    const result = { ...passed('x'), file: '/repo/.blastproof/tests/ok.yaml' };
    const xml = renderJUnit([result], [], { score: 100, durationMs: 1, cwd: '/repo' });
    expect(xml).toContain(`classname="${path.join('.blastproof', 'tests', 'ok.yaml')}"`);
  });
});

describe('renderJUnit: incomplete runs (spec run-budget)', () => {
  it('emits a not-run test as skipped, naming the limit in the message', () => {
    const xml = renderJUnit(
      [passed('one'), notRun('two', 'model call budget exhausted: reached the configured maximum of 5 call(s)')],
      [],
      { score: 100, durationMs: 10 },
    );
    expect(xml).toContain('name="two" time="0.000"');
    expect(xml).toContain('<skipped message="model call budget exhausted');
    expect(xml).not.toContain('<failure');
  });

  it('counts not-run tests in skipped, not in failures', () => {
    const xml = renderJUnit([passed('one'), notRun('two', 'stopped')], [], {
      score: 100,
      durationMs: 10,
    });
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('skipped="1"');
  });

  it('adds skipped and unrouted counts together', () => {
    const xml = renderJUnit([notRun('two', 'stopped')], SKIPPED, { score: 100, durationMs: 10 });
    expect(xml).toContain('skipped="2"');
  });

  it('records the run as incomplete, naming the reason, only when it is', () => {
    const complete = renderJUnit([passed('x')], [], { score: 100, durationMs: 10 });
    expect(complete).not.toContain('name="incomplete"');

    const incomplete = renderJUnit([passed('x'), notRun('y', 'stopped')], [], {
      score: 100,
      durationMs: 10,
      incomplete: 'model call budget exhausted: reached the configured maximum of 5 call(s)',
    });
    expect(incomplete).toContain('<property name="incomplete" value="true"/>');
    expect(incomplete).toContain('<property name="incomplete_reason" value="model call budget exhausted');
  });
});

describe('writeJUnit', () => {
  it('creates missing parent directories and writes the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-junit-'));
    try {
      const target = path.join(dir, 'build', 'reports', 'e2e.xml');
      const written = await writeJUnit(target, '<testsuite/>');
      expect(written).toBe(target);
      await expect(readFile(target, 'utf8')).resolves.toBe('<testsuite/>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
