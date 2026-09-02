import { describe, expect, it } from 'vitest';
import {
  ActionError,
  performAction,
  resolveTarget,
  type LocatorLike,
  type PageLike,
} from '../src/runner/actions.js';
import type { AgentAction } from '../src/llm/schemas.js';

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
    first: () => locator,
  };
  return {
    goto: async () => undefined,
    getByRole: () => locator,
    getByLabel: () => locator,
    getByText: () => locator,
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => BASE,
    waitForLoadState: async () => undefined,
  } as unknown as PageLike;
}

const CLICK: AgentAction = {
  action: 'click',
  target: { role: 'button', name: 'Me want it!' },
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
      { action: 'fill', target: { role: 'textbox', name: 'Email' }, value: 'a@b.c', reasoning: '' },
      new Error(INTERCEPTED_CLICK.replace('locator.click', 'locator.fill')),
    );
    expect(fill).toBeInstanceOf(ActionError);
    expect(fill.message).toMatch(/^blocked: the fill on role=textbox name="Email" was NOT performed\./);

    const select = await failureFor(
      { action: 'select', target: { role: 'combobox', name: 'Country' }, value: 'Brazil', reasoning: '' },
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
      getByRole: () => ({
        waitFor: async () => {
          throw new Error('timeout');
        },
        first() {
          return this;
        },
      }),
      getByLabel: () => ({
        waitFor: async () => {
          throw new Error('timeout');
        },
        first() {
          return this;
        },
      }),
      getByText: () => ({
        waitFor: async () => {
          throw new Error('timeout');
        },
        first() {
          return this;
        },
      }),
      keyboard: { press: async () => {} },
      screenshot: async () => undefined,
      url: () => BASE,
      waitForLoadState: async () => undefined,
    } as unknown as PageLike;
    await expect(performAction(page, CLICK, { baseUrl: BASE })).rejects.toThrow(/^Element not found:/);
  });
});

/**
 * A page whose elements have accessible names, so exact and substring matching are
 * distinguishable — the doubles above return one locator whatever is asked for, which
 * is fine for the failure paths they cover and useless here.
 *
 * `visible` is per element, and document order is array order, so the fake reproduces
 * the two Playwright defaults this change is about: a name matches by substring, and
 * `.first()` breaks a tie by position.
 */
interface FakeElement {
  role: string;
  name: string;
  visible?: boolean;
}

function pageOf(elements: FakeElement[]): {
  page: PageLike;
  resolvedNames: () => string[];
  queries: string[];
} {
  const queries: string[] = [];
  const resolved: string[] = [];

  const locatorFor = (matches: FakeElement[]): LocatorLike => {
    const self: LocatorLike = {
      click: async () => {},
      fill: async () => {},
      press: async () => {},
      selectOption: async () => undefined,
      waitFor: async () => {
        const head = matches[0];
        if (!head || head.visible === false) throw new Error('timeout');
        resolved.push(head.name);
      },
      first: () => locatorFor(matches.slice(0, 1)),
    };
    return self;
  };

  const byName = (name: string, exact: boolean, role?: string): FakeElement[] =>
    elements.filter(
      (el) =>
        (role === undefined || el.role === role) &&
        (exact ? el.name === name : el.name.toLowerCase().includes(name.toLowerCase())),
    );

  const page = {
    goto: async () => undefined,
    getByRole: (role: string, options?: { name?: string; exact?: boolean }) => {
      queries.push(`role:${role}:${options?.name ?? ''}:${options?.exact ? 'exact' : 'loose'}`);
      return locatorFor(
        options?.name === undefined
          ? elements.filter((el) => el.role === role)
          : byName(options.name, options.exact === true, role),
      );
    },
    // No labels in this fake: the label strategy finds nothing, which is what a page
    // of plain buttons does, and keeps these tests about role and text.
    getByLabel: (text: string, options?: { exact?: boolean }) => {
      queries.push(`label:${text}:${options?.exact ? 'exact' : 'loose'}`);
      return locatorFor([]);
    },
    getByText: (text: string, options?: { exact?: boolean }) => {
      queries.push(`text:${text}:${options?.exact ? 'exact' : 'loose'}`);
      return locatorFor(byName(text, options?.exact === true));
    },
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => BASE,
    waitForLoadState: async () => undefined,
  } as unknown as PageLike;

  return { page, resolvedNames: () => resolved, queries };
}

describe('resolveTarget: exact accessible name before substring (spec agentic-execution: live element resolution)', () => {
  it('does not lose an exact name to a longer one that contains it', async () => {
    // "Add New" is first in document order, so today's substring match plus .first()
    // clicks it — successfully, on the wrong control, with nothing able to say so.
    const { page, resolvedNames } = pageOf([
      { role: 'button', name: 'Add New' },
      { role: 'button', name: 'Add' },
    ]);

    await resolveTarget(page, { role: 'button', name: 'Add' });

    expect(resolvedNames()).toEqual(['Add']);
  });

  it('still resolves a name that matches nothing exactly', async () => {
    // The forgiving behaviour the fallback exists for: a snapshot whose text differs
    // from the accessible name by truncation still drives the page.
    const { page, resolvedNames } = pageOf([{ role: 'button', name: 'Create a local account' }]);

    await resolveTarget(page, { role: 'button', name: 'Create' });

    expect(resolvedNames()).toEqual(['Create a local account']);
  });

  it('keeps strategy order above match precision', async () => {
    // The heading matches the text strategy exactly; the field matches the role
    // strategy only loosely. The field must win, or a step naming a field types into
    // the heading above it.
    const { page, resolvedNames, queries } = pageOf([
      { role: 'heading', name: 'E-mail' },
      { role: 'textbox', name: 'E-mail de contato' },
    ]);

    await resolveTarget(page, { role: 'textbox', name: 'E-mail' });

    expect(resolvedNames()).toEqual(['E-mail de contato']);
    // Locators are built up front and tried in order, so the text-exact query is
    // still constructed — it simply never wins, because role comes first.
    expect(queries.indexOf('role:textbox:E-mail:loose')).toBeLessThan(
      queries.indexOf('text:E-mail:exact'),
    );
  });

  it('asks for the exact match first on every strategy', async () => {
    const { page, queries } = pageOf([]);

    await expect(resolveTarget(page, { role: 'button', name: 'Ghost' })).rejects.toThrow(
      /^Element not found:/,
    );

    expect(queries).toEqual([
      'role:button:Ghost:exact',
      'role:button:Ghost:loose',
      'label:Ghost:exact',
      'label:Ghost:loose',
      'text:Ghost:exact',
      'text:Ghost:loose',
    ]);
  });

  it('resolves an ambiguous name by document order, as it did before', async () => {
    // Not an oversight. Refusing here was designed and then measured out: on real
    // accessible sites the .sr-only pattern gives ordinary links a visible twin, so
    // the refusal would refuse navigation. See the change's design D2/D7.
    const { page, resolvedNames } = pageOf([
      { role: 'button', name: 'Excluir' },
      { role: 'button', name: 'Excluir' },
    ]);

    await resolveTarget(page, { role: 'button', name: 'Excluir' });

    expect(resolvedNames()).toEqual(['Excluir']);
  });
});
