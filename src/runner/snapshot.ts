import type { Page } from 'playwright';

export interface SnapshotOptions {
  /** Maximum number of snapshot lines sent to the LLM. Default 200. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 200;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// A line whose role is a dialog, YAML single-quoted or not.
const DIALOG_LINE = /^\s*- '?(?:dialog|alertdialog)(?=[\s:"']|$)/;
const OMITTED_LINE = /^\s*- \.\.\. \(\d+ lines? omitted: max_snapshot_lines is (\d+)\)$/m;

/**
 * The cap a snapshot was cut at, read from its markers, or `undefined` when
 * nothing was omitted (design keep-the-open-dialog-in-the-snapshot, D3). Read
 * from the text so a step's reason cannot disagree with what the model saw.
 */
export function snapshotCutAt(snapshot: string): number | undefined {
  const match = OMITTED_LINE.exec(snapshot);
  return match ? Number(match[1]) : undefined;
}

/**
 * Which lines of an over-cap snapshot to keep (design
 * keep-the-open-dialog-in-the-snapshot, D1). Frameworks render dialogs, menus
 * and palettes in a portal at the end of `<body>`, so a cut from the top
 * dropped first the element the last action opened (#162). The open dialogs
 * (the last one, on top, first) and the focused element are kept with their
 * subtree and the lines they sit under; the rest of the cap is filled from the
 * top, as before. Never more than `maxLines`.
 */
function linesToKeep(lines: string[], maxLines: number): Set<number> {
  const keep = new Set<number>();
  const subtreeEnd = (i: number): number => {
    let j = i + 1;
    while (j < lines.length && indentOf(lines[j]!) > indentOf(lines[i]!)) j++;
    return j;
  };
  const ancestors = (i: number): number[] => {
    const found: number[] = [];
    let indent = indentOf(lines[i]!);
    for (let j = i - 1; j >= 0 && indent > 0; j--) {
      if (indentOf(lines[j]!) < indent) {
        found.unshift(j);
        indent = indentOf(lines[j]!);
      }
    }
    return found;
  };

  const dialogs = lines.flatMap((line, i) => (DIALOG_LINE.test(line) ? [i] : [])).reverse();
  const focused = lines.flatMap((line, i) => (line.includes('[active]') ? [i] : []));
  for (const anchor of [...dialogs.slice(0, 1), ...focused, ...dialogs.slice(1)]) {
    for (const line of ancestors(anchor)) if (keep.size < maxLines) keep.add(line);
    for (let line = anchor; line < subtreeEnd(anchor) && keep.size < maxLines; line++) keep.add(line);
  }
  for (let line = 0; line < lines.length && keep.size < maxLines; line++) keep.add(line);
  return keep;
}

/**
 * Trims an aria snapshot: drops empty containers (e.g. `- group:` with no children)
 * and caps the line count. Over the cap, each run of omitted lines is replaced in
 * place by a marker naming the setting that cut it (design
 * keep-the-open-dialog-in-the-snapshot, D2). Pure function, exported for tests.
 */
export function trimSnapshot(snapshotYaml: string, maxLines: number = DEFAULT_MAX_LINES): string {
  let lines = snapshotYaml.split('\n').filter((line) => line.trim().length > 0);

  // Removing empty containers can empty their parents; iterate until stable (bounded).
  for (let pass = 0; pass < 5; pass++) {
    const kept: string[] = [];
    let removed = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isContainer = line.trimEnd().endsWith(':');
      if (isContainer) {
        const next = lines[i + 1];
        const hasChildren = next !== undefined && indentOf(next) > indentOf(line);
        if (!hasChildren) {
          removed++;
          continue;
        }
      }
      kept.push(line);
    }
    lines = kept;
    if (removed === 0) break;
  }

  if (lines.length <= maxLines) return lines.join('\n');

  const keep = linesToKeep(lines, maxLines);
  const out: string[] = [];
  let omitted = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && !keep.has(i)) {
      omitted++;
      continue;
    }
    if (omitted > 0) {
      const indent = ' '.repeat(indentOf(lines[i - omitted]!));
      out.push(`${indent}- ... (${omitted} ${omitted === 1 ? 'line' : 'lines'} omitted: max_snapshot_lines is ${maxLines})`);
      omitted = 0;
    }
    if (i < lines.length) out.push(lines[i]!);
  }
  return out.join('\n');
}

/**
 * Captures the current page as a compact accessibility snapshot (design D1),
 * prefixed with the page URL so the model can reason about navigation.
 *
 * Always in AI mode (design act-on-the-element-the-model-read, D3): every
 * element carries the `[ref=…]` an action names it by, and a plain
 * `ariaSnapshot()` invalidates the refs of the last AI-mode one, measured. The
 * `[cursor=pointer]` marker it adds is dropped: it is about the mouse, not the
 * element, and it was most of the growth that was not a ref.
 */
export async function captureSnapshot(page: Page, options: SnapshotOptions = {}): Promise<string> {
  const raw = await page.locator('body').ariaSnapshot({ mode: 'ai' });
  return `url: ${page.url()}\n${trimSnapshot(raw.replace(/ \[cursor=pointer\]/g, ''), options.maxLines)}`;
}

const REF_MARKER = / \[ref=[A-Za-z0-9_-]+\]/g;

/**
 * The snapshot as a reader that chooses no element sees it: the judge and the
 * planner (design act-on-the-element-the-model-read, D3). Refs are ids, not
 * page content, and the judge corpus's stored snapshots have none.
 */
export function withoutRefs(snapshot: string): string {
  return snapshot.replace(REF_MARKER, '');
}

/** What the snapshot line holding a ref shows about its element. */
export interface SnapshotElement {
  role: string;
  /** The accessible name, unquoted; absent when the line has none. */
  name?: string;
  /** Inline text after the colon (`- generic [ref=e4]: Promo code`), unquoted. */
  text?: string;
}

/** Undoes YAML double-quote escaping, the form a name containing `"` is printed in. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

// `- role "name" [attr] [ref=x] [attr]: inline text`, every part after the role optional.
const ELEMENT_LINE =
  /^\s*- ([a-z][a-zA-Z]*)(?: ("(?:[^"\\]|\\.)*"))?((?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;

/**
 * Each ref in a snapshot, with the role and name its line shows (design
 * act-on-the-element-the-model-read, D2). Read from the snapshot text the model
 * was given, masked as it was, so what is checked and recorded is what the
 * model read and no secret enters the record.
 */
export function indexRefs(snapshot: string): Map<string, SnapshotElement> {
  const index = new Map<string, SnapshotElement>();
  for (const raw of snapshot.split('\n')) {
    // YAML single-quotes a whole entry whose text holds `: `, as in
    // `- 'heading "Notes on file: 1" [level=2] [ref=e16]'`.
    const quoted = /^(\s*- )'((?:[^']|'')*)'(:.*)?$/.exec(raw);
    const line = quoted ? `${quoted[1]}${quoted[2]!.replace(/''/g, "'")}${quoted[3] ?? ''}` : raw;
    const match = ELEMENT_LINE.exec(line);
    if (!match) continue;
    const ref = /\[ref=([A-Za-z0-9_-]+)\]/.exec(match[3] ?? '')?.[1];
    if (!ref) continue;
    const element: SnapshotElement = { role: match[1]! };
    if (match[2] !== undefined) element.name = unquote(match[2]);
    if (match[4] !== undefined && match[4].trim() !== '') element.text = unquote(match[4]);
    index.set(ref, element);
  }
  return index;
}
