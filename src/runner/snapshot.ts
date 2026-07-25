import type { Page } from 'playwright';

export interface SnapshotOptions {
  /** Maximum number of snapshot lines sent to the LLM. Default 200. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 200;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Trims an aria snapshot: drops empty containers (e.g. `- group:` with no children)
 * and caps the line count. Pure function, exported for tests.
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

  if (lines.length > maxLines) {
    lines = [...lines.slice(0, maxLines), `- ... (snapshot truncated after ${maxLines} lines)`];
  }
  return lines.join('\n');
}

/**
 * Captures the current page as a compact accessibility snapshot (design D1),
 * prefixed with the page URL so the model can reason about navigation.
 */
export async function captureSnapshot(page: Page, options: SnapshotOptions = {}): Promise<string> {
  const raw = await page.locator('body').ariaSnapshot();
  return `url: ${page.url()}\n${trimSnapshot(raw, options.maxLines)}`;
}
