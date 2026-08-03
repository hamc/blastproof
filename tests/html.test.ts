import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { embedScreenshot, escapeHtml, renderHtml, writeHtml } from '../src/report/html.js';
import { ReportError } from '../src/report/errors.js';
import { type SkippedCase } from '../src/report/junit.js';
import type { TestResult } from '../src/runner/executor.js';

function passed(summary: string): TestResult {
  return {
    file: '.blastproof/tests/ok.yaml',
    summary,
    priority: 'P1',
    tags: [],
    status: 'passed',
    steps: [
      { step: 'open the page', setup: false, status: 'passed', iterations: 1, failedAttempts: 0, durationMs: 500 },
    ],
    durationMs: 1500,
  };
}

function failed(summary: string, screenshot?: string): TestResult {
  return {
    file: '.blastproof/tests/bad.yaml',
    summary,
    priority: 'P0',
    tags: [],
    status: 'failed',
    steps: [
      { step: 'open the cart', setup: false, status: 'passed', iterations: 1, failedAttempts: 0, durationMs: 300 },
      { step: 'apply promo code SAVE20', setup: false, status: 'failed', iterations: 3, failedAttempts: 3, durationMs: 900 },
    ],
    failedStep: 'apply promo code SAVE20',
    reason: 'Element not found: role=button',
    screenshot,
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

const SKIPPED: SkippedCase[] = [{ path: '.blastproof/tests/legacy.yaml', summary: 'Legacy test' }];

describe('escapeHtml', () => {
  it('escapes every markup-significant character', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });
});

describe('embedScreenshot', () => {
  it('returns a data URI for a readable file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-shot-'));
    try {
      const file = path.join(dir, 'shot.png');
      await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await expect(embedScreenshot(file)).resolves.toMatch(/^data:image\/png;base64,/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves undefined when the file cannot be read', async () => {
    await expect(embedScreenshot('/nope/missing.png')).resolves.toBeUndefined();
  });
});

describe('renderHtml', () => {
  it('references nothing external', async () => {
    const html = await renderHtml([passed('one'), failed('two')], SKIPPED, {
      score: 40,
      durationMs: 4000,
    });
    // No src/href pointing anywhere but an inline data URI, no scripts.
    expect(html).not.toMatch(/(src|href)\s*=\s*["'](?!data:)/i);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('//cdn');
  });

  it('leads with the score and the gate verdict', async () => {
    const html = await renderHtml([failed('x')], [], { score: 60, durationMs: 1, minScore: 80 });
    expect(html).toContain('<b>60</b>');
    expect(html).toContain('min-score 80: FAIL');
  });

  it('omits the verdict when no threshold was given', async () => {
    const html = await renderHtml([passed('x')], [], { score: 100, durationMs: 1 });
    expect(html).toContain('<b>100</b>');
    expect(html).not.toContain('min-score');
  });

  it('shows the failing step and reason', async () => {
    const html = await renderHtml([failed('checkout')], [], { score: 0, durationMs: 1 });
    expect(html).toContain('apply promo code SAVE20');
    expect(html).toContain('Element not found: role=button');
  });

  it('renders markup in a summary as inert text', async () => {
    const html = await renderHtml([passed('<script>alert(1)</script>')], [], {
      score: 100,
      durationMs: 1,
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('embeds a screenshot inline', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-html-'));
    try {
      const shot = path.join(dir, 'shot.png');
      await writeFile(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const html = await renderHtml([failed('x', shot)], [], { score: 0, durationMs: 1 });
      expect(html).toContain('<img class="shot"');
      expect(html).toContain('src="data:image/png;base64,');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('degrades gracefully when the screenshot is missing', async () => {
    const html = await renderHtml([failed('x', '/nope/missing.png')], [], {
      score: 0,
      durationMs: 1,
    });
    expect(html).toContain('Screenshot unavailable');
    expect(html).not.toContain('<img');
  });

  it('lists skipped tests', async () => {
    const html = await renderHtml([], SKIPPED, { score: 100, durationMs: 0 });
    expect(html).toContain('Legacy test');
    expect(html).toContain('SKIP');
  });

  it('puts failures before passes', async () => {
    const html = await renderHtml([passed('a pass'), failed('a failure')], [], {
      score: 50,
      durationMs: 1,
    });
    const detail = html.slice(html.indexOf('<details'));
    expect(detail.indexOf('a failure')).toBeLessThan(detail.indexOf('a pass'));
  });
});

describe('renderHtml: incomplete runs (spec run-budget)', () => {
  it('shows a banner naming the stop when the run is incomplete', async () => {
    const html = await renderHtml([passed('a')], [], {
      score: 100,
      durationMs: 1,
      incomplete: 'model call budget exhausted: reached the configured maximum of 5 call(s)',
    });
    expect(html).toContain('Run stopped:');
    expect(html).toContain('model call budget exhausted');
  });

  it('omits the banner on a complete run', async () => {
    const html = await renderHtml([passed('a')], [], { score: 100, durationMs: 1 });
    expect(html).not.toContain('Run stopped');
  });

  it('distinguishes a not-run test from a failed one', async () => {
    const html = await renderHtml([failed('a failure'), notRun('never got here', 'stopped: budget exhausted')], [], {
      score: 100,
      durationMs: 1,
      incomplete: 'stopped: budget exhausted',
    });
    expect(html).toContain('NOT RUN');
    expect(html).toContain('never got here');
    // The not-run test's own table row is tagged "skip", never "fail".
    const rowStart = html.lastIndexOf('<tr>', html.indexOf('never got here'));
    const rowEnd = html.indexOf('</tr>', rowStart);
    const row = html.slice(rowStart, rowEnd);
    expect(row).toContain('tag skip');
    expect(row).not.toContain('tag fail');
  });

  it('puts not-run tests after failures but before passes, and counts them separately', async () => {
    const html = await renderHtml(
      [passed('a pass'), notRun('never got here', 'stopped'), failed('a failure')],
      [],
      { score: 100, durationMs: 1, incomplete: 'stopped' },
    );
    const detail = html.slice(html.indexOf('<details'));
    expect(detail.indexOf('a failure')).toBeLessThan(detail.indexOf('never got here'));
    expect(detail.indexOf('never got here')).toBeLessThan(detail.indexOf('a pass'));
    expect(html).toContain('1 not run');
  });
});

describe('writeHtml', () => {
  it('creates missing parent directories', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-htmlw-'));
    try {
      const target = path.join(dir, 'build', 'report.html');
      await expect(writeHtml(target, '<html></html>')).resolves.toBe(target);
      await expect(readFile(target, 'utf8')).resolves.toBe('<html></html>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws ReportError with a house-style message when the target is a directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-htmlw-'));
    try {
      // writeFile to a directory fails with EISDIR — the raw code the issue calls out.
      const target = path.join(dir, 'report.html');
      await mkdir(target);
      let thrown: unknown;
      try {
        await writeHtml(target, '<html></html>');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ReportError);
      const message = (thrown as Error).message;
      expect(message).toContain('Cannot write HTML report to');
      expect(message).toContain(target);
      expect(message).not.toMatch(/\b(EACCES|EISDIR|ENOTDIR|EEXIST|ENOENT|EPERM):/);
      expect(message).toMatch(/is not a directory/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws ReportError with a house-style message when a parent path is a file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-htmlw-'));
    try {
      // mkdir through a file fails (ENOTDIR/EEXIST): the raw code the issue calls out.
      const blocker = path.join(dir, 'blocker');
      await writeFile(blocker, '');
      const target = path.join(blocker, 'report.html');
      let thrown: unknown;
      try {
        await writeHtml(target, '<html></html>');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ReportError);
      const message = (thrown as Error).message;
      expect(message).toContain('Cannot write HTML report to');
      expect(message).toContain(target);
      expect(message).not.toMatch(/\b(EACCES|EISDIR|ENOTDIR|EEXIST|ENOENT|EPERM):/);
      expect(message).toMatch(/is not a directory/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
