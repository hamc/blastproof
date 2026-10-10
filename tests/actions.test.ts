import { describe, expect, it } from 'vitest';
import {
  ActionError,
  bindTarget,
  performAction,
  resolveTarget,
  type LocatorLike,
  type PageLike,
} from '../src/runner/actions.js';
import type { AgentAction } from '../src/llm/schemas.js';
import { indexRefs } from '../src/runner/snapshot.js';

const BASE = 'http://localhost:3000';

/**
 * A real Playwright failure, call log included (design name-what-blocks-the-click, D2).
 *
 * Copied from an actual run rather than paraphrased: the translation is coupled
 * to this wording, and a hand-written approximation would keep passing after
 * Playwright changed the line the code actually depends on.
 */
const INTERCEPTED_CLICK = [
  'locator.click: Timeout 30000ms exceeded.',
  'Call log:',
  "  - waiting for getByRole('button', { name: 'Me want it!' }).first()",
  '  -   locator resolved to <button mat-button="" aria-label="Close Welcome Banner">…</button>',
  '  - attempting click action',
  '  -   waiting for element to be visible, enabled and stable',
  '  -   element is visible, enabled and stable',
  '  -   scrolling into view if needed',
  '  -   done scrolling',
  '  -   <div class="cdk-overlay-backdrop cdk-overlay-dark-backdrop cdk-overlay-backdrop-showing"></div> intercepts pointer events',
  '  - retrying click action, attempt #1',
].join('\n');

function pageThatFailsWith(error: Error): PageLike {
  const locator: LocatorLike = {
    click: async () => {
      throw error;
    },
    fill: async () => {
      throw error;
    },
    press: async () => {
      throw error;
    },
    selectOption: async () => {
      throw error;
    },
    waitFor: async () => {},
    count: async () => 1,
  };
  return {
    goto: async () => undefined,
    locator: () => locator,
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => BASE,
    waitForLoadState: async () => undefined,
  } as unknown as PageLike;
}

const CLICK: AgentAction = {
  action: 'click',
  target: { ref: 'e1', role: 'button', name: 'Me want it!' },
  reasoning: '',
};

async function failureFor(action: AgentAction, error: Error): Promise<Error> {
  const page = pageThatFailsWith(error);
  try {
    await performAction(page, action, { baseUrl: BASE });
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('expected the action to fail');
}

describe('an obstructed action', () => {
  it('is reported as an obstruction, not as a bad target', async () => {
    const error = await failureFor(CLICK, new Error(INTERCEPTED_CLICK));
    expect(error).toBeInstanceOf(ActionError);
    // The fact that inverts the model's default reading has to come first: a
    // bare timeout is what produced three retries against the correct element.
    expect(error.message).toMatch(/^blocked: the click on role=button name="Me want it!" was NOT performed\./);
    expect(error.message).toContain('nothing about it is wrong');
  });

  it('names the element that took the pointer event, not the one that was resolved', async () => {
    const error = await failureFor(CLICK, new Error(INTERCEPTED_CLICK));
    expect(error.message).toContain('cdk-overlay-backdrop');
    expect(error.message).toContain('received the pointer event instead');
    // The call log holds a second element a few lines above — the target itself,
    // rendered by `locator resolved to`. Naming that one would blame exactly the
    // element this message exists to exonerate, so the pattern is line-bounded.
    expect(error.message).not.toContain('Close Welcome Banner');
    expect(error.message).not.toContain('mat-button');
  });

  it('offers both exits, and rules out the move that cannot help', async () => {
    const error = await failureFor(CLICK, new Error(INTERCEPTED_CLICK));
    expect(error.message).toContain('pressing Escape with no target');
    expect(error.message).toContain('close or accept control');
    // The measured failure was re-targeting. Saying so is the point of the message.
    expect(error.message).toContain('Choosing a different name for the same target cannot help');
  });

  it('does not paste a framework class list into the prompt whole', async () => {
    const error = await failureFor(CLICK, new Error(INTERCEPTED_CLICK));
    // The identity survives; the decorative tail does not.
    expect(error.message).toContain('<div class="cdk-overlay-backdrop');
    expect(error.message).toContain('…>');
    expect(error.message).not.toContain('cdk-overlay-backdrop-showing');
  });

  it('translates a fill and a select identically, because the guard is over the action path', async () => {
    const fill = await failureFor(
      { action: 'fill', target: { ref: 'e2', role: 'textbox', name: 'Email' }, value: 'a@b.c', reasoning: '' },
      new Error(INTERCEPTED_CLICK.replace('locator.click', 'locator.fill')),
    );
    expect(fill).toBeInstanceOf(ActionError);
    expect(fill.message).toMatch(/^blocked: the fill on role=textbox name="Email" was NOT performed\./);

    const select = await failureFor(
      { action: 'select', target: { ref: 'e3', role: 'combobox', name: 'Country' }, value: 'Brazil', reasoning: '' },
      new Error(INTERCEPTED_CLICK.replace('locator.click', 'locator.selectOption')),
    );
    expect(select).toBeInstanceOf(ActionError);
    expect(select.message).toMatch(/^blocked: the select on role=combobox name="Country" was NOT performed\./);
  });

  it('costs nothing when the failure is anything else', async () => {
    const timeout = new Error('locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole');
    const error = await failureFor(CLICK, timeout);
    // Byte-identical, and the same object: an unrelated failure must reach the
    // model exactly as it did before this translation existed.
    expect(error).toBe(timeout);
    expect(error.message).toBe(timeout.message);
  });

  it('leaves an unresolvable target reading as an unresolvable target', async () => {
    const page = {
      goto: async () => undefined,
      locator: () => ({ count: async () => 0 }),
      keyboard: { press: async () => {} },
      screenshot: async () => undefined,
      url: () => BASE,
      waitForLoadState: async () => undefined,
    } as unknown as PageLike;
    await expect(performAction(page, CLICK, { baseUrl: BASE })).rejects.toThrow(/^Element not found:/);
  });
});

/**
 * A page that answers `aria-ref=` locators from a table, as Playwright does: the
 * element the ref was printed for, or none. `stale` refs throw the way Playwright
 * does after a navigation.
 */
function pageOfRefs(
  elements: Record<string, { name: string; visible?: boolean }>,
  stale: string[] = [],
): { page: PageLike; selectors: string[]; clicked: string[] } {
  const selectors: string[] = [];
  const clicked: string[] = [];
  const page = {
    goto: async () => undefined,
    locator: (selector: string) => {
      selectors.push(selector);
      const ref = selector.slice('aria-ref='.length);
      const element = elements[ref];
      return {
        count: async () => {
          if (stale.includes(ref)) throw new Error(`Invalid frame in aria-ref selector "${selector}"`);
          return element ? 1 : 0;
        },
        waitFor: async () => {
          if (element?.visible === false) throw new Error('timeout');
        },
        click: async () => {
          clicked.push(element!.name);
        },
      };
    },
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => BASE,
    waitForLoadState: async () => undefined,
  } as unknown as PageLike;
  return { page, selectors, clicked };
}

describe('resolveTarget: the element the ref names, or none (spec agentic-execution: live element resolution)', () => {
  it('acts on the ref, never on a search for the name', async () => {
    const { page, selectors, clicked } = pageOfRefs({ e1: { name: 'Add New' }, e2: { name: 'Add' } });
    await performAction(page, { action: 'click', target: { ref: 'e2', role: 'button', name: 'Add' }, reasoning: '' }, { baseUrl: BASE });
    expect(selectors).toEqual(['aria-ref=e2']);
    expect(clicked).toEqual(['Add']);
  });

  it('fails at once, saying the page changed, when the element is gone', async () => {
    const { page, clicked } = pageOfRefs({});
    await expect(resolveTarget(page, { ref: 'e9', role: 'button', name: 'Checkout' })).rejects.toThrow(
      /no longer on the page; it changed since the snapshot/,
    );
    expect(clicked).toEqual([]);
  });

  it('reads an invalid frame, after a navigation, as the page having changed', async () => {
    const { page } = pageOfRefs({ e3: { name: 'Checkout' } }, ['e3']);
    await expect(resolveTarget(page, { ref: 'e3', role: 'button', name: 'Checkout' })).rejects.toThrow(
      /changed since the snapshot/,
    );
  });

  it('still waits for a resolved element to be visible', async () => {
    const { page } = pageOfRefs({ e4: { name: 'Hidden', visible: false } });
    await expect(resolveTarget(page, { ref: 'e4', role: 'button', name: 'Hidden' }, 1_500)).rejects.toThrow(
      'is on the page but did not become visible within 1500ms',
    );
  });
});

describe('bindTarget: the model names a ref, and the ref decides the element', () => {
  // The demo app's cart (#132) and two controls sharing a name (#60), as AI mode prints them.
  const refs = indexRefs(
    [
      '- region "Promo code" [ref=f1e11]:',
      '  - textbox "Promo code" [ref=f1e15]',
      '  - button "Apply promo code" [ref=f1e16]',
      '- button "Checkout" [ref=f1e25]',
      '- row "Invoice 1" [ref=f1e30]:',
      '  - button "Delete" [ref=f1e31]',
      '- row "Invoice 2" [ref=f1e32]:',
      '  - button "Delete" [ref=f1e33]',
      '- generic [ref=f1e40]: Save   draft',
      '- generic [ref=f1e41]',
      "- 'heading \"Notes on file: 1\" [level=2] [ref=f1e16b]'",
      "- paragraph [ref=f1e50]: 'It''s: done'",
    ].join('\n'),
  );
  const click = (target: AgentAction['target']): AgentAction => ({ action: 'click', target, reasoning: '' });

  it("binds #132's shape to the element read, not the first of its role", () => {
    const bound = bindTarget(click({ ref: 'f1e25', role: 'button', name: 'Checkout' }), refs);
    expect(bound.target).toEqual({ ref: 'f1e25', role: 'button', name: 'Checkout' });
  });

  it('refuses a role with no name when the element has one', () => {
    expect(() => bindTarget(click({ ref: 'f1e25', role: 'button' }), refs)).toThrow(
      'refused: ref f1e25 is button "Checkout", not button, so nothing was done.',
    );
  });

  it("binds #60's shape to the second of two same-named controls when that is the ref given", () => {
    expect(bindTarget(click({ ref: 'f1e33', role: 'button', name: 'Delete' }), refs).target?.ref).toBe('f1e33');
  });

  it("refuses a neighbour's ref, naming what the model said and what the ref is", () => {
    expect(() => bindTarget(click({ ref: 'f1e16', role: 'button', name: 'Checkout' }), refs)).toThrow(
      'refused: ref f1e16 is button "Apply promo code", not button "Checkout", so nothing was done.',
    );
  });

  it('refuses a ref the snapshot does not have, and a target with no ref', () => {
    expect(() => bindTarget(click({ ref: 'f9e1', role: 'button', name: 'Checkout' }), refs)).toThrow(
      'no element in the current snapshot has ref "f9e1"',
    );
    expect(() => bindTarget(click({ role: 'button', name: 'Checkout' }), refs)).toThrow('the target names no ref');
  });

  it("records the snapshot's words, compared without case or runs of whitespace", () => {
    const bound = bindTarget(click({ ref: '[ref=f1e16]', role: 'Button', name: 'apply  PROMO code' }), refs);
    expect(bound.target).toEqual({ ref: 'f1e16', role: 'button', name: 'Apply promo code' });
  });

  it('uses the inline text of an element with no name, and nothing for one with neither', () => {
    expect(bindTarget(click({ ref: 'f1e40', role: 'generic', name: 'Save draft' }), refs).target?.name).toBe(
      'Save   draft',
    );
    expect(bindTarget(click({ ref: 'f1e41', role: 'generic' }), refs).target).toEqual({
      ref: 'f1e41',
      role: 'generic',
      name: undefined,
    });
    expect(() => bindTarget(click({ ref: 'f1e41', role: 'generic', name: 'Save' }), refs)).toThrow(/is generic, not/);
  });

  it('reads the lines YAML wraps in single quotes', () => {
    expect(bindTarget(click({ ref: 'f1e16b', role: 'heading', name: 'Notes on file: 1' }), refs).target?.name).toBe(
      'Notes on file: 1',
    );
    expect(bindTarget(click({ ref: 'f1e50', role: 'paragraph', name: "It's: done" }), refs).target?.name).toBe(
      "It's: done",
    );
  });

  it('leaves an action without a target alone, and treats an empty target as none', () => {
    const press: AgentAction = { action: 'press', value: 'Escape', reasoning: '' };
    expect(bindTarget(press, refs)).toEqual({ ...press, target: undefined });
    expect(bindTarget({ ...press, target: {} }, refs).target).toBeUndefined();
  });
});
