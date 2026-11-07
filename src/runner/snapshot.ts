import type { Page } from 'playwright';
import { isOriginAllowed } from './actions.js';

/**
 * Which frames' content a snapshot may carry (design
 * show-frames-from-declared-origins, D1): the boundary navigation is compared
 * against, and who to tell when a frame was left out.
 */
export interface FrameBoundary {
  /** `base_url`'s origin plus `allowed_origins:`, as `allowedOriginsFor` builds it. */
  allowed: ReadonlySet<string>;
  /** Called with the origin of every frame whose content was not shown. */
  onHidden?: (origin: string) => void;
}

export interface SnapshotOptions {
  /** Maximum number of snapshot lines sent to the LLM. Default 200. */
  maxLines?: number;
  /** Required: a snapshot without it would carry every frame's content. */
  frames: FrameBoundary;
}

/**
 * The URLs of the frame an `iframe` element shows, then of each frame containing
 * it, up to the page — but only when the element `contentRef` names is in that
 * same frame. `undefined` otherwise, or when either element cannot be found.
 */
export type FrameChainLookup = (frameRef: string, contentRef: string) => Promise<string[] | undefined>;

const IFRAME_WITH_CONTENT = /^(\s*)- iframe\b.*:$/;

/** The origin a frame's content is judged by: its own URL's, or for `about:` its container's (design D2). */
function contentUrl(chain: string[]): string | undefined {
  return chain.find((url) => !url.startsWith('about:'));
}

/** The origin of a web URL, or `undefined` for one that has none (`data:`, `file:`). */
function webOrigin(url: string): string | undefined {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * Replaces the content of every frame outside the boundary with one line saying
 * so (design show-frames-from-declared-origins, D1/D2). Its refs go with it, so
 * an action naming one is refused by `bindTarget` as a ref the snapshot does not
 * have. A frame inside a cut frame goes with its lines. A page with no frame
 * costs no lookup.
 */
export async function cutUndeclaredFrames(
  snapshot: string,
  lookup: FrameChainLookup,
  frames: FrameBoundary,
): Promise<string> {
  if (!/- iframe\b/.test(snapshot)) return snapshot;
  const lines = snapshot.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    const frame = IFRAME_WITH_CONTENT.exec(line);
    if (!frame) continue;
    const indent = frame[1]!.length;
    let end = i + 1;
    while (end < lines.length && indentOf(lines[end]!) > indent) end++;
    // Both refs are read from the lines' attribute groups, never from their
    // text: a frame controls the names in its own lines, and a heading named
    // "[ref=e1]" must not pass for the page's e1 (design D1).
    const frameRef = lineRef(line);
    const contentRef = lines.slice(i + 1, end).map(lineRef).find((r) => r !== undefined);
    const chain = frameRef === undefined || contentRef === undefined ? undefined : await lookup(frameRef, contentRef);
    const url = chain === undefined ? undefined : contentUrl(chain);
    if (url !== undefined && isOriginAllowed(url, frames.allowed)) continue;
    const origin = url === undefined ? undefined : webOrigin(url);
    const reason =
      url === undefined
        ? "the frame's origin could not be read"
        : origin === undefined
          ? `a ${url.split(':')[0]}: frame is never shown`
          : `${origin} is not in allowed_origins`;
    // Only an origin `allowed_origins:` can name gets a warning offering it.
    if (origin !== undefined) frames.onHidden?.(origin);
    out.push(`${' '.repeat(indent + 2)}- text: "content not shown: ${reason}"`);
    i = end - 1;
  }
  return out.join('\n');
}

/**
 * The live lookup (design D1): the frame the `iframe` element shows, bound to
 * the frame its first content element is in. The `iframe` line's ref is written
 * by Playwright, not by the page; the content ref is tied to the document the
 * snapshot read, so a frame that navigated since does not resolve and is cut.
 */
function frameChainOn(page: Page): FrameChainLookup {
  const handleOf = (ref: string) => page.locator(`aria-ref=${ref}`).elementHandle({ timeout: 1_000 });
  return async (frameRef, contentRef) => {
    const handles: { dispose(): Promise<void> }[] = [];
    try {
      const frameElement = await handleOf(frameRef);
      if (frameElement) handles.push(frameElement);
      const content = await handleOf(contentRef);
      if (content) handles.push(content);
      const shown = await frameElement?.contentFrame();
      const owner = await content?.ownerFrame();
      if (!shown || shown !== owner) return undefined;
      const chain: string[] = [];
      for (let f: typeof shown | null = shown; f; f = f.parentFrame()) chain.push(f.url());
      return chain;
    } catch {
      // Detached between the snapshot and the lookup: unknown, so not shown.
      return undefined;
    } finally {
      await Promise.all(handles.map((h) => h.dispose().catch(() => {})));
    }
  };
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
export async function captureSnapshot(page: Page, options: SnapshotOptions): Promise<string> {
  const raw = await page.locator('body').ariaSnapshot({ mode: 'ai' });
  // Before the trim, so a hidden frame uses none of the line budget (design D1).
  const shown = await cutUndeclaredFrames(raw, frameChainOn(page), options.frames);
  return `url: ${page.url()}\n${trimSnapshot(shown.replace(/ \[cursor=pointer\]/g, ''), options.maxLines)}`;
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

/** A snapshot line as an element: its role, quoted name, attribute group and text. */
function parseElementLine(raw: string): RegExpExecArray | null {
  // YAML single-quotes a whole entry whose text holds `: `, as in
  // `- 'heading "Notes on file: 1" [level=2] [ref=e16]'`.
  const quoted = /^(\s*- )'((?:[^']|'')*)'(:.*)?$/.exec(raw);
  const line = quoted ? `${quoted[1]}${quoted[2]!.replace(/''/g, "'")}${quoted[3] ?? ''}` : raw;
  return ELEMENT_LINE.exec(line);
}

/** The ref in a line's attribute group, never one its name or text spells out. */
function lineRef(raw: string): string | undefined {
  const match = parseElementLine(raw);
  return match ? /\[ref=([A-Za-z0-9_-]+)\]/.exec(match[3] ?? '')?.[1] : undefined;
}

/**
 * Each ref in a snapshot, with the role and name its line shows (design
 * act-on-the-element-the-model-read, D2). Read from the snapshot text the model
 * was given, masked as it was, so what is checked and recorded is what the
 * model read and no secret enters the record.
 */
export function indexRefs(snapshot: string): Map<string, SnapshotElement> {
  const index = new Map<string, SnapshotElement>();
  for (const raw of snapshot.split('\n')) {
    const match = parseElementLine(raw);
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
