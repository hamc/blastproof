import { describe, expect, it, vi } from 'vitest';
import { renderHtml } from '../src/report/html.js';
import { renderJUnit } from '../src/report/junit.js';
import { emitWarning, type RunWarning } from '../src/report/warnings.js';

const DRIFT: RunWarning = {
  kind: 'route-drift',
  title: 'Route drift (test routes declared by no routes: mapping — contribute nothing to --impacted selection):',
  lines: ['  Apply a promo code (.blastproof/tests/promo.yaml): /cart/', 'Fix the route typo.'],
};

const AUTHORING: RunWarning = {
  kind: 'authoring',
  title: 'Authoring (a step enters a value but names none):',
  lines: ['  Leave a note (notes.yaml) step 2:', '      fill the <b>note</b> field', '    → fill the <b>note</b> field with <value>'],
  spaced: true,
};

const SECRET: RunWarning = {
  kind: 'reformatted-secret',
  title: 'warning: the application returned PASSWORD in a different form than the value supplied (case or spacing).',
  lines: [],
};

const junitMeta = { score: 100, durationMs: 1 };
const htmlMeta = { score: 100, durationMs: 1, screenshots: 'embed' as const };

describe('emitWarning (design the-reports-carry-the-warnings, D1)', () => {
  it('prints the title and each line, after a blank line when spaced, and keeps the warning', () => {
    const printed: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => printed.push(String(line)));
    const kept: RunWarning[] = [];

    emitWarning(AUTHORING, kept);
    emitWarning(undefined, kept);

    expect(printed).toEqual([`\n${AUTHORING.title}`, ...AUTHORING.lines]);
    expect(kept).toEqual([AUTHORING]);
    vi.restoreAllMocks();
  });
});

describe('the JUnit report carries the warnings (spec junit-report)', () => {
  it('counts none as 0 and writes no system-err', () => {
    const xml = renderJUnit([], [], { ...junitMeta, warnings: [] });
    expect(xml).toContain('<property name="warnings" value="0"/>');
    expect(xml).not.toContain('<system-err>');
  });

  it('counts a report given no list as 0 too', () => {
    expect(renderJUnit([], [], junitMeta)).toContain('<property name="warnings" value="0"/>');
  });

  it('counts every warning and writes their text, escaped, after the cases', () => {
    const xml = renderJUnit([], [], { ...junitMeta, warnings: [DRIFT, AUTHORING, SECRET] });

    expect(xml).toContain('<property name="warnings" value="3"/>');
    const body = xml.match(/<system-err>([\s\S]*)<\/system-err>/)?.[1];
    expect(body).toBe(
      [
        [DRIFT.title, ...DRIFT.lines].join('\n'),
        [AUTHORING.title, ...AUTHORING.lines].join('\n'),
        SECRET.title,
      ]
        .join('\n\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;'),
    );
    expect(xml.indexOf('<system-err>')).toBeGreaterThan(xml.indexOf('</properties>'));
    expect(xml.indexOf('<system-err>')).toBeLessThan(xml.indexOf('</testsuite>'));
  });

  it('leaves the counts and the score alone', () => {
    const xml = renderJUnit([], [], { ...junitMeta, warnings: [DRIFT] });
    expect(xml).toContain('tests="0" failures="0" skipped="0"');
    expect(xml).toContain('<property name="score" value="100"/>');
  });
});

describe('the HTML report carries the warnings (spec html-report)', () => {
  it('has no Warnings section when there are none', async () => {
    const html = await renderHtml([], [], { ...htmlMeta, warnings: [] });
    expect(html).not.toContain('class="warnings"');
    expect(await renderHtml([], [], htmlMeta)).not.toContain('class="warnings"');
  });

  it('shows each warning after the score and before the table', async () => {
    const html = await renderHtml([], [], { ...htmlMeta, warnings: [DRIFT, SECRET] });

    expect(html).toContain('<h2>Warnings (2)</h2>');
    expect(html).toContain('/cart/');
    expect(html).toContain('PASSWORD in a different form');
    const section = html.indexOf('<section class="warnings">');
    expect(section).toBeGreaterThan(html.indexOf('<section class="score">'));
    expect(section).toBeLessThan(html.indexOf('<table>'));
  });

  it('escapes the text, so a step quoting markup shows the characters', async () => {
    const html = await renderHtml([], [], { ...htmlMeta, warnings: [AUTHORING] });
    expect(html).toContain('fill the &lt;b&gt;note&lt;/b&gt; field with &lt;value&gt;');
    expect(html).not.toContain('<b>note</b>');
  });
});
