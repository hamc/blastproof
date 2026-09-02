import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Splitting the README into `docs/` bought scanability and paid for it in
 * surfaces that can disagree — the exact class behind #30 and behind three
 * documentation defects outside readers found in a single week. A moved
 * heading or a renamed file breaks a link silently: nothing fails, and the
 * reader simply lands nowhere. This is the cheap guard, in the shape of
 * `action-manifest.test.ts`: assert the links resolve, in CI, before a merge.
 */

/**
 * Markdown files that are part of the published documentation surface. The
 * skill is in here because AGENTS.md declares it user-facing content held to
 * the same bar as `action.yml`, and because its reader is a coding agent that
 * will follow a broken relative link without reporting anything. `RELEASING.md`
 * is in here because it is reached only from `CONTRIBUTING.md`: a file nobody
 * navigates to directly is the one whose link rots unnoticed.
 */
const DOC_ROOTS = [
  'README.md',
  'CONTRIBUTING.md',
  'RELEASING.md',
  'AGENTS.md',
  'skills/blastproof/SKILL.md',
  'skills/blastproof/references/authoring.md',
  'skills/blastproof/references/cli.md',
  'skills/blastproof/references/mapping.md',
];

/**
 * GitHub's heading-anchor algorithm, reduced to what our headings actually use:
 * strip inline code fences and any other HTML, lowercase, drop every character
 * that is not alphanumeric, space, hyphen or underscore, then hyphenate spaces.
 * An em dash therefore vanishes and leaves the doubled hyphen GitHub produces
 * (`## \`budget\` — bounding` → `budget--bounding`).
 */
function slug(heading: string): string {
  return heading
    .replace(/`/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

function headingsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match?.[1]) anchors.add(slug(match[1]));
  }
  return anchors;
}

/**
 * Relative references, ignoring absolute URLs and bare anchors.
 *
 * Both syntaxes, because the README uses both: markdown links for prose, and
 * raw HTML for what markdown cannot express — the themed logo in a `<picture>`
 * and the flow diagram, which needs a `width`. Reading only markdown left every
 * asset the page points at unverified, and those are the files most likely to
 * be renamed or re-exported.
 */
function linksOf(markdown: string): { target: string; anchor?: string }[] {
  const links: { target: string; anchor?: string }[] = [];
  const push = (href: string): void => {
    if (/^[a-z]+:/i.test(href)) return;
    const [target, anchor] = href.split('#');
    links.push({ target: target ?? '', anchor });
  };

  for (const match of markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) push(match[1]!);
  for (const match of markdown.matchAll(/<[a-z]+\b[^>]*?\b(?:src|srcset|href)="([^"]+)"/gi)) {
    push(match[1]!);
  }
  return links;
}

async function docFiles(): Promise<string[]> {
  const inDocs = (await readdir(path.join(root, 'docs')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join('docs', name));
  return [...DOC_ROOTS, ...inDocs];
}

describe('documentation links', () => {
  it('every docs/ page is reachable from the README', async () => {
    // A page nobody links to is a page nobody reads, and the reason to keep it
    // in the repository at all is that the README sends people there.
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const pages = (await readdir(path.join(root, 'docs'))).filter((n) => n.endsWith('.md'));

    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(readme, `docs/${page} is not linked from the README`).toContain(`./docs/${page}`);
    }
  });

  it('every relative link resolves to a file that exists', async () => {
    const broken: string[] = [];

    for (const file of await docFiles()) {
      const markdown = await readFile(path.join(root, file), 'utf8');
      for (const { target } of linksOf(markdown)) {
        if (target === '') continue; // same-page anchor, checked below
        const resolved = path.resolve(path.dirname(path.join(root, file)), target);
        if (!existsSync(resolved)) broken.push(`${file} → ${target}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('every link anchor resolves to a heading in the file it points at', async () => {
    // The half of link rot that a file-existence check misses entirely: the
    // file is still there, the heading it named is not.
    const headings = new Map<string, Set<string>>();
    const broken: string[] = [];

    for (const file of await docFiles()) {
      const markdown = await readFile(path.join(root, file), 'utf8');
      headings.set(file, headingsOf(markdown));
    }

    for (const file of await docFiles()) {
      const markdown = await readFile(path.join(root, file), 'utf8');
      for (const { target, anchor } of linksOf(markdown)) {
        if (!anchor) continue;

        const targetFile =
          target === ''
            ? file
            : path.relative(root, path.resolve(path.dirname(path.join(root, file)), target));

        const known = headings.get(targetFile);
        if (!known) continue; // not a markdown file we track (e.g. action.yml)
        if (!known.has(anchor)) broken.push(`${file} → ${targetFile}#${anchor}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
