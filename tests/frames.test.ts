import { describe, expect, it } from 'vitest';
import { allowedOriginsFor, bindTarget } from '../src/runner/actions.js';
import type { Page } from 'playwright';
import { captureSnapshot, cutUndeclaredFrames, indexRefs, type FrameChainLookup } from '../src/runner/snapshot.js';
import { hiddenFrameWarning } from '../src/report/warnings.js';

// Design show-frames-from-declared-origins (#21): a frame's content reaches a
// prompt only from the application's origin or one allowed_origins declares.

const APP = 'http://127.0.0.1:4390';
const PAY = 'https://pay.example.com';

/** The page the probe in the design read: frame prefixes mapped to frame chains. */
const chains: Record<string, string[]> = {
  f1: [`${PAY}/outer.html`, `${APP}/nested.html`],
  f4: [`${APP}/form.html`, `${PAY}/outer.html`, `${APP}/nested.html`],
  f2: ['about:srcdoc', `${APP}/nested.html`],
  f3: [`${APP}/form.html`, `${APP}/nested.html`],
};

/** Answers by the content ref's frame prefix; the frame ref is recorded, as the live lookup binds both. */
function lookupOf(table: Record<string, string[] | undefined>): FrameChainLookup & { asked: [string, string][] } {
  const asked: [string, string][] = [];
  const lookup = async (frameRef: string, contentRef: string) => {
    asked.push([frameRef, contentRef]);
    return table[contentRef.replace(/e\d+$/, '')];
  };
  return Object.assign(lookup, { asked });
}

const NESTED = [
  '- generic [ref=e1]:',
  '  - heading "Nested" [level=1] [ref=e2]',
  '  - iframe [ref=e3]:',
  '    - generic [ref=f1e1]:',
  '      - paragraph [ref=f1e2]: outer',
  '      - iframe [ref=f1e3]:',
  '        - generic [ref=f4e1]:',
  '          - textbox "Card number" [ref=f4e4]',
  '  - iframe [ref=e4]:',
  '    - button "Inline" [ref=f2e2]',
  '  - iframe [ref=e5]:',
  '    - generic [ref=f3e1]:',
  '      - textbox "Card number" [ref=f3e4]',
  '      - button "Pay" [ref=f3e5]',
  '  - paragraph [ref=e6]: after the frames',
].join('\n');

describe('cutUndeclaredFrames (show-frames-from-declared-origins, D1/D2)', () => {
  it("keeps a frame on the application's origin and a srcdoc frame it contains", async () => {
    const hidden: string[] = [];
    const out = await cutUndeclaredFrames(NESTED, lookupOf(chains), {
      allowed: allowedOriginsFor(APP, undefined),
      onHidden: (origin) => hidden.push(origin),
    });

    expect(out).toContain('button "Inline" [ref=f2e2]');
    expect(out).toContain('button "Pay" [ref=f3e5]');
    expect(out).toContain('paragraph [ref=e6]: after the frames');
    expect(hidden).toEqual([PAY]);
  });

  it('replaces an undeclared frame, and every frame inside it, with one line naming the origin', async () => {
    const out = await cutUndeclaredFrames(NESTED, lookupOf(chains), { allowed: allowedOriginsFor(APP, undefined) });

    expect(out).not.toContain('f1e');
    // Declared itself, but inside the undeclared frame: cut with it.
    expect(out).not.toContain('f4e');
    expect(out).toContain(
      `  - iframe [ref=e3]:\n    - text: "content not shown: ${PAY} is not in allowed_origins"\n  - iframe [ref=e4]:`,
    );
  });

  it('shows a frame whose origin allowed_origins declares', async () => {
    const out = await cutUndeclaredFrames(NESTED, lookupOf(chains), { allowed: allowedOriginsFor(APP, [PAY]) });
    expect(out).toBe(NESTED);
  });

  it('cuts a frame whose origin cannot be read, without naming one', async () => {
    const hidden: string[] = [];
    const out = await cutUndeclaredFrames(NESTED, lookupOf({ ...chains, f3: undefined }), {
      allowed: allowedOriginsFor(APP, [PAY]),
      onHidden: (origin) => hidden.push(origin),
    });

    expect(out).not.toContain('f3e');
    expect(out).toContain(`  - iframe [ref=e5]:\n    - text: "content not shown: the frame's origin could not be read"`);
    expect(hidden).toEqual([]);
  });

  it('cuts a srcdoc frame inside an undeclared frame', async () => {
    const snapshot = ['- iframe [ref=e1]:', '  - button "Inline" [ref=f1e2]'].join('\n');
    const out = await cutUndeclaredFrames(snapshot, lookupOf({ f1: ['about:srcdoc', `${PAY}/x`, `${APP}/`] }), {
      allowed: allowedOriginsFor(APP, undefined),
    });
    expect(out).toBe(`- iframe [ref=e1]:\n  - text: "content not shown: ${PAY} is not in allowed_origins"`);
  });

  it("binds each frame by the iframe line's ref and its first content ref", async () => {
    const lookup = lookupOf(chains);
    await cutUndeclaredFrames(NESTED, lookup, { allowed: allowedOriginsFor(APP, [PAY]) });
    expect(lookup.asked).toEqual([
      ['e3', 'f1e1'],
      ['f1e3', 'f4e1'],
      ['e4', 'f2e2'],
      ['e5', 'f3e1'],
    ]);
  });

  it("never takes a ref a frame's own text spells out", async () => {
    // A heading named "[ref=e1]" inside the undeclared frame: the main page's e1
    // is on the application's origin, and reading it would show the frame.
    const snapshot = ['- iframe [ref=e3]:', '  - heading "[ref=e1]" [level=1] [ref=f1e1]', '  - button "Pay" [ref=f1e2]'].join('\n');
    const lookup = lookupOf({ '': [`${APP}/`], f1: [`${PAY}/form.html`, `${APP}/`] });
    const out = await cutUndeclaredFrames(snapshot, lookup, { allowed: allowedOriginsFor(APP, undefined) });
    expect(lookup.asked).toEqual([['e3', 'f1e1']]);
    expect(out).toBe(`- iframe [ref=e3]:\n  - text: "content not shown: ${PAY} is not in allowed_origins"`);
  });

  it('cuts a data: frame without offering allowed_origins for it', async () => {
    const hidden: string[] = [];
    const snapshot = ['- iframe [ref=e3]:', '  - button "Pay" [ref=f1e2]'].join('\n');
    const out = await cutUndeclaredFrames(snapshot, lookupOf({ f1: ['data:text/html,x', `${APP}/`] }), {
      allowed: allowedOriginsFor(APP, undefined),
      onHidden: (origin) => hidden.push(origin),
    });
    expect(out).toContain('content not shown: a data: frame is never shown');
    expect(hidden).toEqual([]);
  });

  it('looks nothing up on a page without frames', async () => {
    const lookup = lookupOf(chains);
    const snapshot = '- main [ref=e1]:\n  - button "Pay" [ref=e2]';
    expect(await cutUndeclaredFrames(snapshot, lookup, { allowed: allowedOriginsFor(APP, undefined) })).toBe(snapshot);
    expect(lookup.asked).toEqual([]);
  });

  it('leaves the refs of a cut frame unbindable, so an action on one is refused', async () => {
    const out = await cutUndeclaredFrames(NESTED, lookupOf(chains), { allowed: allowedOriginsFor(APP, undefined) });
    const pay = { action: 'fill' as const, target: { ref: 'f4e4', role: 'textbox', name: 'Card number' }, value: '4242', reasoning: '' };
    expect(() => bindTarget(pay, indexRefs(out))).toThrow();
  });
});

describe('hiddenFrameWarning (show-frames-from-declared-origins, D3)', () => {
  it('names the origin and the config line that shows it', () => {
    const warning = hiddenFrameWarning(PAY);
    expect(warning.kind).toBe('hidden-frame');
    expect(warning.title).toContain(PAY);
    expect(warning.lines.join('\n')).toContain('allowed_origins in .blastproof/config.yaml');
  });
});

describe('captureSnapshot cuts frames before the line cap (show-frames-from-declared-origins, D1)', () => {
  it('spends no line of the budget on a frame it does not show', async () => {
    const frameLines = Array.from({ length: 50 }, (_, i) => `    - button "Pay ${i}" [ref=f1e${i + 1}]`);
    const raw = ['- main [ref=e1]:', '  - iframe [ref=e2]:', ...frameLines, '  - button "Checkout" [ref=e3]'].join('\n');
    const pay = { url: () => `${PAY}/form.html`, parentFrame: () => null };
    const app = { url: () => `${APP}/`, parentFrame: () => null };
    const page = {
      url: () => `${APP}/`,
      locator: (selector: string) => ({
        ariaSnapshot: async () => raw,
        elementHandle: async () => ({
          contentFrame: async () => (selector === 'aria-ref=e2' ? pay : null),
          ownerFrame: async () => (selector.startsWith('aria-ref=f1') ? pay : app),
          dispose: async () => {},
        }),
      }),
    };
    const snap = await captureSnapshot(page as unknown as Page, { maxLines: 10, frames: { allowed: allowedOriginsFor(APP, undefined) } });
    expect(snap).not.toContain('omitted');
    expect(snap).toContain('button "Checkout" [ref=e3]');
    expect(snap).not.toContain('Pay 0');
  });

  it('cuts a frame whose content is not in the frame the iframe shows', async () => {
    const raw = ['- iframe [ref=e2]:', '  - button "Pay" [ref=f1e1]'].join('\n');
    const shown = { url: () => `${APP}/form.html`, parentFrame: () => null };
    const other = { url: () => `${APP}/other.html`, parentFrame: () => null };
    const page = {
      url: () => `${APP}/`,
      locator: (selector: string) => ({
        ariaSnapshot: async () => raw,
        elementHandle: async () => ({
          contentFrame: async () => (selector === 'aria-ref=e2' ? shown : null),
          ownerFrame: async () => other,
          dispose: async () => {},
        }),
      }),
    };
    const snap = await captureSnapshot(page as unknown as Page, { frames: { allowed: allowedOriginsFor(APP, undefined) } });
    expect(snap).toContain(`content not shown: the frame's origin could not be read`);
  });
});
