import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BudgetSpend } from '../runner/budget.js';
import type { StepResult, TestResult } from '../runner/executor.js';
import { formatSpendLine } from './score.js';
import type { SkippedCase } from './junit.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Single escaping choke point (design D4). Summaries, steps and failure reasons are
 * user- and model-authored; one missed interpolation turns the report into an
 * injection vector the moment someone opens it in a browser.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/**
 * Reads a screenshot as a base64 `data:` URI so the report stays self-contained
 * (design D3). Returns undefined when unreadable: a report exists to explain a
 * failure and must not fail while doing so.
 */
export async function embedScreenshot(file: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(file);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export interface HtmlMeta {
  score: number;
  durationMs: number;
  /** Threshold, when one was given, so the gate verdict can be shown. */
  minScore?: number;
  /** Repo root, so paths render relative rather than absolute. */
  cwd?: string;
  generatedAt?: Date;
  /** The reason the run's budget or deadline stopped it, when it did (spec run-budget). */
  incomplete?: string;
  /**
   * What the run spent, when this report's caller owns the budget (design
   * report-what-it-spent). Rendered from `formatSpendLine`, the same text the
   * console prints, rather than recomposed here.
   */
  spend?: BudgetSpend;
}

const STYLES = `
:root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e3e3e3;
  --pass:#137333; --fail:#c5221f; --card:#fafafa; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#15171a; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2c2f34;
    --pass:#5bb974; --fail:#f28b82; --card:#1c1f23; }
}
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1.25rem; background:var(--bg); color:var(--fg);
  font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 62rem; margin: 0 auto; }
h1 { font-size:1.35rem; margin:0 0 .25rem; }
.sub { color:var(--muted); font-size:.85rem; margin-bottom:1.5rem; }
.score { display:flex; align-items:baseline; gap:.75rem; flex-wrap:wrap;
  padding:1.25rem; border:1px solid var(--line); border-radius:10px;
  background:var(--card); margin-bottom:1.5rem; }
.score b { font-size:2.5rem; line-height:1; font-variant-numeric:tabular-nums; }
.verdict { font-weight:600; }
.verdict.pass { color:var(--pass); } .verdict.fail { color:var(--fail); }
.counts { color:var(--muted); font-size:.9rem; }
.incomplete { padding:1rem 1.25rem; border:1px solid var(--fail); border-radius:10px;
  background:color-mix(in srgb, var(--fail) 10%, transparent); margin-bottom:1.5rem; font-weight:600; }
table { width:100%; border-collapse:collapse; margin-bottom:1.5rem; }
th, td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line);
  font-size:.9rem; vertical-align:top; }
th { color:var(--muted); font-weight:600; }
td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.tag { font-weight:700; font-size:.78rem; letter-spacing:.03em; }
.tag.pass { color:var(--pass); } .tag.fail { color:var(--fail); }
.tag.skip { color:var(--muted); }
details { border:1px solid var(--line); border-radius:10px; padding:.75rem 1rem;
  margin-bottom:.75rem; background:var(--card); }
details > summary { cursor:pointer; font-weight:600; }
.reason { border-left:3px solid var(--fail); padding:.5rem .75rem; margin:.75rem 0;
  color:var(--fg); background:color-mix(in srgb, var(--fail) 8%, transparent);
  border-radius:0 6px 6px 0; }
ol.steps { margin:.5rem 0 0; padding-left:1.25rem; }
ol.steps li { margin:.15rem 0; }
ol.steps li.failed { color:var(--fail); font-weight:600; }
img.shot { max-width:100%; border:1px solid var(--line); border-radius:8px; margin-top:.75rem; }
.note { color:var(--muted); font-style:italic; font-size:.85rem; }
footer { color:var(--muted); font-size:.8rem; border-top:1px solid var(--line);
  padding-top:1rem; margin-top:2rem; }
`;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderSteps(steps: StepResult[]): string {
  if (steps.length === 0) return '';
  const items = steps
    .map(
      (step) =>
        `<li class="${step.status === 'failed' ? 'failed' : ''}">${escapeHtml(step.step)}` +
        `${step.setup ? ' <span class="note">(setup)</span>' : ''}</li>`,
    )
    .join('\n        ');
  return `<ol class="steps">\n        ${items}\n      </ol>`;
}

async function renderTest(result: TestResult, cwd?: string): Promise<string> {
  const failed = result.status === 'failed';
  const notRun = result.status === 'not-run';
  const tagClass = failed ? 'fail' : notRun ? 'skip' : 'pass';
  const label = failed ? 'FAIL' : notRun ? 'NOT RUN' : 'PASS';
  const file = cwd ? path.relative(cwd, result.file) : result.file;
  const parts = [
    `    <details${failed || notRun ? ' open' : ''}>`,
    `      <summary><span class="tag ${tagClass}">${label}</span> ` +
      `${escapeHtml(result.summary)} <span class="note">${escapeHtml(result.priority)} · ${escapeHtml(file)}</span></summary>`,
  ];

  if (failed) {
    if (result.failedStep) {
      parts.push(`      <p><strong>Failing step:</strong> ${escapeHtml(result.failedStep)}</p>`);
    }
    if (result.reason) {
      parts.push(`      <p class="reason">${escapeHtml(result.reason)}</p>`);
    }
  }

  if (notRun && result.reason) {
    parts.push(`      <p class="note">${escapeHtml(result.reason)}</p>`);
  }

  parts.push(`      ${renderSteps(result.steps)}`);

  if (failed && result.screenshot) {
    const embedded = await embedScreenshot(result.screenshot);
    parts.push(
      embedded
        ? `      <img class="shot" alt="Screenshot at failure" src="${embedded}">`
        : '      <p class="note">Screenshot unavailable.</p>',
    );
  }

  parts.push('    </details>');
  return parts.join('\n');
}

/**
 * Renders the run as one self-contained HTML document (design D3): inline CSS,
 * screenshots as data URIs, no external references and no scripts. Score and gate
 * verdict lead, failures sort above passes, passing tests collapse (design D5).
 */
export async function renderHtml(
  results: TestResult[],
  skipped: SkippedCase[],
  meta: HtmlMeta,
): Promise<string> {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failures = results.filter((r) => r.status === 'failed');
  const notRun = results.filter((r) => r.status === 'not-run');
  const generatedAt = (meta.generatedAt ?? new Date()).toISOString();

  // Failures first, then the tests the run never reached: the reader came for
  // those, and passing tests are the least interesting part of an incomplete run.
  const ordered = [...failures, ...notRun, ...results.filter((r) => r.status === 'passed')];
  const detail = (await Promise.all(ordered.map((r) => renderTest(r, meta.cwd)))).join('\n');

  const verdict =
    meta.minScore === undefined
      ? ''
      : meta.score >= meta.minScore
        ? `<span class="verdict pass">min-score ${meta.minScore}: pass</span>`
        : `<span class="verdict fail">min-score ${meta.minScore}: FAIL</span>`;

  const banner =
    meta.incomplete === undefined
      ? ''
      : `  <section class="incomplete">Run stopped: ${escapeHtml(meta.incomplete)}</section>\n\n`;

  const rows = results
    .map((r) => {
      const file = meta.cwd ? path.relative(meta.cwd, r.file) : r.file;
      const tagClass = r.status === 'failed' ? 'fail' : r.status === 'not-run' ? 'skip' : 'pass';
      const label = r.status === 'failed' ? 'FAIL' : r.status === 'not-run' ? 'NOT RUN' : 'PASS';
      const time = r.status === 'not-run' ? '—' : seconds(r.durationMs);
      return (
        `      <tr><td><span class="tag ${tagClass}">${label}</span></td>` +
        `<td>${escapeHtml(r.priority)}</td><td>${escapeHtml(r.summary)}</td>` +
        `<td>${escapeHtml(file)}</td><td class="num">${time}</td></tr>`
      );
    })
    .join('\n');

  const skippedRows = skipped
    .map((s) => {
      const file = meta.cwd ? path.relative(meta.cwd, s.path) : s.path;
      return (
        '      <tr><td><span class="tag skip">SKIP</span></td><td>—</td>' +
        `<td>${escapeHtml(s.summary)}</td><td>${escapeHtml(file)}</td>` +
        '<td class="num">—</td></tr>'
      );
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blastproof report</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>blastproof report</h1>
  <p class="sub">${escapeHtml(generatedAt)} · ${seconds(meta.durationMs)}${
    meta.spend ? ` · ${escapeHtml(formatSpendLine(meta.spend))}` : ''
  }</p>

${banner}  <section class="score">
    <b>${meta.score}</b>
    ${verdict}
    <span class="counts">${passed} passed · ${failures.length} failed${
      notRun.length > 0 ? ` · ${notRun.length} not run` : ''
    }${skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}</span>
  </section>

  <table>
    <thead><tr><th>Status</th><th>Priority</th><th>Test</th><th>File</th><th class="num">Time</th></tr></thead>
    <tbody>
${rows}${rows && skippedRows ? '\n' : ''}${skippedRows}
    </tbody>
  </table>

${detail}

  <footer>Generated by blastproof. Screenshots are embedded, so this file works offline.</footer>
</main>
</body>
</html>
`;
}

/** Writes the report, creating missing parent directories. Returns the path written. */
export async function writeHtml(file: string, html: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, 'utf8');
  return file;
}
