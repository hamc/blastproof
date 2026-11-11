import { describe, expect, it } from 'vitest';
import { StepRecovery } from '../src/runner/recovery.js';
import { submitControlOf, type PageLike } from '../src/runner/actions.js';
import { indexRefs, snapshotFields } from '../src/runner/snapshot.js';
import type { AgentAction } from '../src/llm/schemas.js';

// Design refuse-the-same-submit-twice (#205): a press is the click it stands
// for, and a form that came back empty is not a next page.

const click = (name: string): AgentAction => ({ action: 'click', target: { role: 'button', name }, reasoning: 'r' });
const fill = (value: string): AgentAction => ({
  action: 'fill',
  target: { role: 'textbox', name: 'Note' },
  value,
  reasoning: 'r',
});
const enter: AgentAction = { action: 'press', value: 'Enter', reasoning: 'r' };
const pressOn = (role: string, name: string, key = 'Enter'): AgentAction => ({
  action: 'press',
  target: { role, name },
  value: key,
  reasoning: 'r',
});
const addNote = { role: 'button', name: 'Add note' };

/** Observe a page, then perform `action` on it if it is not refused. */
function attempt(
  recovery: StepRecovery,
  page: string,
  action: AgentAction,
  activates?: { role: string; name: string },
): string | undefined {
  recovery.observe(page);
  const refusal = recovery.refusalFor(action, activates);
  if (refusal === undefined) recovery.record(action, action.action, 'ok', activates);
  return refusal;
}

const filled = '- textbox "Note": Check the invoice\n- button "Add note"\n- list';
const empty = '- textbox "Note"\n- button "Add note"\n- list:\n  - listitem: Check the invoice';
const refilled = '- textbox "Note": Check the invoice\n- button "Add note"\n- list:\n  - listitem: Check the invoice';

describe('a press is the click it stands for (#205)', () => {
  it('refuses Enter in the form after its button was clicked, naming the button', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    attempt(recovery, empty, fill('Check the invoice'));
    const refusal = attempt(recovery, refilled, pressOn('textbox', 'Note'), addNote);
    expect(refusal).toContain('refused: pressing Enter here activates button "Add note"');
    expect(refusal).toContain('NOT pressed');
  });

  it('refuses a press with no target the same way', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    attempt(recovery, empty, fill('Check the invoice'));
    expect(attempt(recovery, refilled, enter, addNote)).toContain('activates button "Add note"');
  });

  it('refuses the button after Enter submitted the form', () => {
    const recovery = new StepRecovery('submit the add-note form');
    expect(attempt(recovery, filled, enter, addNote)).toBeUndefined();
    attempt(recovery, empty, fill('Check the invoice'));
    expect(attempt(recovery, refilled, click('Add note'))).toContain('refused: this click on button "Add note"');
  });

  it('refuses Enter and Space on the button itself, with no lookup', () => {
    for (const key of ['Enter', ' ']) {
      const recovery = new StepRecovery('submit the add-note form');
      attempt(recovery, filled, click('Add note'));
      attempt(recovery, empty, fill('Check the invoice'));
      expect(attempt(recovery, refilled, pressOn('button', 'Add note', key))).toContain('activates button "Add note"');
    }
  });

  it('performs Enter in a field of another form', () => {
    const recovery = new StepRecovery('add the note and search for it');
    attempt(recovery, filled, click('Add note'));
    expect(attempt(recovery, empty, pressOn('searchbox', 'Search'), { role: 'button', name: 'Search' })).toBeUndefined();
  });

  it('performs Enter where the page named no button, as before', () => {
    const recovery = new StepRecovery('add the note and search for it');
    attempt(recovery, filled, click('Add note'));
    expect(attempt(recovery, empty, pressOn('searchbox', 'Search'))).toBeUndefined();
  });

  it('does not take a key that moves focus for a click', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    expect(attempt(recovery, empty, pressOn('button', 'Add note', 'Tab'), addNote)).toBeUndefined();
  });

  it('treats a control clicked and then entered as one control for the tour exception', () => {
    const recovery = new StepRecovery('page through the tour');
    const next = { role: 'button', name: 'Next' };
    attempt(recovery, '- text: 1 of 8\n- button "Next"', click('Next'));
    expect(attempt(recovery, '- text: 2 of 8\n- button "Next"', pressOn('button', 'Next'))).toBeUndefined();
    expect(attempt(recovery, '- text: 3 of 8\n- button "Next"', enter, next)).toBeUndefined();
    expect(attempt(recovery, '- text: 3 of 8\n- button "Next"', click('Next'))).toContain('refused:');
  });
});

describe('a form that came back empty is not a next page (#205)', () => {
  it('refuses the same button again, with nothing in between', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    expect(attempt(recovery, empty, click('Add note'))).toContain('refused: this click on button "Add note"');
  });

  it('reads a value printed under a placeholder', () => {
    const before = '- textbox "Note" [active]:\n  - /placeholder: Describe the note\n  - text: Check the invoice\n- button "Add note"';
    const after = '- textbox "Note":\n  - /placeholder: Describe the note\n- button "Add note"\n- listitem: Check the invoice';
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, before, click('Add note'));
    expect(attempt(recovery, after, click('Add note'))).toContain('refused:');
  });

  it.each([
    ['a tour', '- text: 1 of 8\n- button "Go"', '- text: 2 of 8\n- button "Go"'],
    ['a wizard whose next page lacks the field', '- textbox "Name": Ana\n- button "Go"', '- textbox "City"\n- button "Go"'],
    ['a list that keeps its search box filled', '- searchbox "Search": invoice\n- button "Go"\n- listitem: a', '- searchbox "Search": invoice\n- button "Go"\n- listitem: a\n- listitem: b'],
    ['a quantity that changed', '- spinbutton "Quantity": "1"\n- button "Go"', '- spinbutton "Quantity": "2"\n- button "Go"'],
    ['a field that was empty before too', '- textbox "Answer"\n- text: 1\n- button "Go"', '- textbox "Answer"\n- text: 2\n- button "Go"'],
    ['two fields of one name, one still filled', '- textbox "Tag": a\n- button "Go"', '- textbox "Tag": a\n- textbox "Tag"\n- button "Go"'],
  ])('still performs the repeat for %s', (_shape, before, after) => {
    const recovery = new StepRecovery('press Go until done');
    attempt(recovery, before, click('Go'));
    expect(attempt(recovery, after, click('Go'))).toBeUndefined();
  });
});

describe('review cases (#205)', () => {
  it('takes a press with no key for the Enter it sends', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    attempt(recovery, empty, fill('Check the invoice'));
    const bare: AgentAction = { action: 'press', reasoning: 'r' };
    expect(attempt(recovery, refilled, bare, addNote)).toContain('pressing Enter here activates button "Add note"');
    const verifying = new StepRecovery('verify the note is listed');
    expect(attempt(verifying, filled, bare)).toContain('this step only verifies');
  });

  it('keeps a repeated Enter allowed when the button is found once and not the next time', () => {
    const next = { role: 'button', name: 'Next' };
    const found = new StepRecovery('press Enter until the list ends');
    expect(attempt(found, '- listitem: one', enter, next)).toBeUndefined();
    expect(attempt(found, '- listitem: two', enter)).toBeUndefined();
    const lost = new StepRecovery('press Enter until the list ends');
    expect(attempt(lost, '- listitem: one', enter)).toBeUndefined();
    expect(attempt(lost, '- listitem: two', enter, next)).toBeUndefined();
  });

  it('refuses Enter again on a form that came back empty', () => {
    const recovery = new StepRecovery('submit the add-note form');
    expect(attempt(recovery, filled, enter, addNote)).toBeUndefined();
    expect(attempt(recovery, empty, enter, addNote)).toContain('refused:');
  });

  const emailPage = '- textbox "Email": ana@example.com\n- button "Next"';
  const passwordPage = '- textbox "Password": "[redacted TEST_PASSWORD]"\n- button "Next"';
  const next = { role: 'button', name: 'Next' };
  const fillField = (name: string, value: string): AgentAction => ({ action: 'fill', target: { role: 'textbox', name }, value, reasoning: 'r' });

  it('performs Enter in the next page of a form, in a field the earlier page did not have', () => {
    const recovery = new StepRecovery('sign in as ana@example.com with {{env.TEST_PASSWORD}}');
    attempt(recovery, '- textbox "Email"\n- button "Next"', fillField('Email', 'ana@example.com'));
    expect(attempt(recovery, emailPage, pressOn('textbox', 'Email'), next)).toBeUndefined();
    attempt(recovery, '- textbox "Password"\n- button "Next"', fillField('Password', '{{env.TEST_PASSWORD}}'));
    expect(attempt(recovery, passwordPage, pressOn('textbox', 'Password'), next)).toBeUndefined();
  });

  it('does the same for a press with no target, by the field just filled', () => {
    const recovery = new StepRecovery('sign in as ana@example.com with {{env.TEST_PASSWORD}}');
    attempt(recovery, '- textbox "Email"\n- button "Next"', fillField('Email', 'ana@example.com'));
    expect(attempt(recovery, emailPage, enter, next)).toBeUndefined();
    attempt(recovery, '- textbox "Password"\n- button "Next"', fillField('Password', '{{env.TEST_PASSWORD}}'));
    expect(attempt(recovery, passwordPage, enter, next)).toBeUndefined();
  });

  it('still refuses the click on that next page, as before this change', () => {
    const recovery = new StepRecovery('sign in as ana@example.com with {{env.TEST_PASSWORD}}');
    attempt(recovery, emailPage, click('Next'));
    attempt(recovery, '- textbox "Password"\n- button "Next"', fillField('Password', '{{env.TEST_PASSWORD}}'));
    expect(attempt(recovery, passwordPage, click('Next'))).toContain('refused:');
  });

  it('does not take an unnamed field, or a press with no field, for a next page', () => {
    const unnamed = new StepRecovery('submit the form');
    attempt(unnamed, '- textbox: hello\n- button "Send"', click('Send'));
    attempt(unnamed, '- textbox\n- button "Send"', { action: 'fill', target: { role: 'textbox', name: '' }, value: 'hello', reasoning: 'r' });
    expect(attempt(unnamed, '- textbox: hello\n- button "Send"', pressOn('textbox', 'hello'), { role: 'button', name: 'Send' })).toContain('refused:');
    const noField = new StepRecovery('submit the add-note form');
    attempt(noField, filled, click('Add note'));
    attempt(noField, empty, click('Notes'));
    expect(attempt(noField, empty, enter, addNote)).toContain('refused:');
  });

  it('known wrong refusal: a wizard whose next page has the same field, left empty (design D3)', () => {
    const recovery = new StepRecovery('skip through the questions');
    attempt(recovery, '- textbox "Answer": yes\n- text: 1 of 3\n- button "Next"', click('Next'));
    expect(attempt(recovery, '- textbox "Answer"\n- text: 2 of 3\n- button "Next"', click('Next'))).toContain('refused:');
  });

  it('known wrong refusal: Enter in a field that was there when the button was clicked, whatever the key did (design D5)', () => {
    const recovery = new StepRecovery('save and add a tag');
    const page = '- textbox "Tag"\n- button "Save"';
    attempt(recovery, page, click('Save'));
    attempt(recovery, page + '\n- status: Saved', { action: 'fill', target: { role: 'textbox', name: 'Tag' }, value: 'save', reasoning: 'r' });
    expect(attempt(recovery, page + '\n- status: Saved', pressOn('textbox', 'Tag'), { role: 'button', name: 'Save' })).toContain('refused:');
  });

  it('does not let an unnamed field decide that a page came back reset', () => {
    const recovery = new StepRecovery('press Go until done');
    attempt(recovery, '- textbox: Ana\n- button "Go"', click('Go'));
    expect(attempt(recovery, '- textbox\n- text: 2\n- button "Go"', click('Go'))).toBeUndefined();
  });
});

describe('second review cases (#205)', () => {
  const addNoteControl = { role: 'button', name: 'Add note' };
  const fillField = (name: string, value: string): AgentAction => ({ action: 'fill', target: { role: 'textbox', name }, value, reasoning: 'r' });

  it('takes an empty key for Enter, and names Space in a refusal', () => {
    const recovery = new StepRecovery('submit the add-note form');
    attempt(recovery, filled, click('Add note'));
    attempt(recovery, empty, fill('Check the invoice'));
    const emptyKey: AgentAction = { action: 'press', value: '', reasoning: 'r' };
    expect(attempt(recovery, refilled, emptyKey, addNoteControl)).toContain('pressing Enter here activates');
    expect(attempt(recovery, refilled, pressOn('button', 'Add note', ' '))).toContain('pressing Space here activates');
  });

  it('refuses Enter in a field the same form gained after its submit', () => {
    const recovery = new StepRecovery('add the note Check the invoice tagged urgent');
    attempt(recovery, filled, click('Add note'));
    const back = '- textbox "Note"\n- textbox "Tags"\n- button "Add note"\n- listitem: Check the invoice';
    attempt(recovery, back, fill('Check the invoice'));
    expect(attempt(recovery, back, pressOn('textbox', 'Tags'), addNoteControl)).toContain('refused:');
  });

  it('known miss: a form that came back with its only field renamed (design D5)', () => {
    const recovery = new StepRecovery('post the comment hello');
    const post = { role: 'button', name: 'Post' };
    attempt(recovery, '- textbox "Add a comment": hello\n- button "Post"', click('Post'));
    attempt(recovery, '- textbox "Add another comment"\n- button "Post"', fillField('Add another comment', 'hello'));
    expect(attempt(recovery, '- textbox "Add another comment": hello\n- button "Post"', enter, post)).toBeUndefined();
  });

  it('does not let a shared key join two buttons the page named', () => {
    const recovery = new StepRecovery('add the note and search for invoice');
    attempt(recovery, filled, click('Add note'));
    attempt(recovery, empty, { action: 'fill', target: { role: 'searchbox', name: 'Search' }, value: 'invoice', reasoning: 'r' });
    expect(attempt(recovery, empty, enter, { role: 'button', name: 'Search' })).toBeUndefined();
    expect(attempt(recovery, empty + '\n- text: 1 result', enter, addNoteControl)).toContain('refused:');
  });

  it('performs Enter on a wizard whose last button has another name', () => {
    for (const press of [enter, pressOn('textbox', 'Answer')]) {
      const recovery = new StepRecovery('press Enter until the wizard ends');
      expect(attempt(recovery, '- textbox "Answer"\n- text: 1 of 2', press, { role: 'button', name: 'Continue' })).toBeUndefined();
      expect(attempt(recovery, '- textbox "Answer"\n- text: 2 of 2', press, { role: 'button', name: 'Finish' })).toBeUndefined();
    }
  });

  it('known miss: a form with no field that came back with one, then Enter in it (design D5)', () => {
    const recovery = new StepRecovery('save the preferences with the comment ok');
    const save = { role: 'button', name: 'Save' };
    attempt(recovery, '- checkbox "Newsletter" [checked]\n- button "Save"', click('Save'));
    attempt(recovery, '- checkbox "Newsletter"\n- textbox "Comment"\n- button "Save"', fillField('Comment', 'ok'));
    expect(attempt(recovery, '- checkbox "Newsletter"\n- textbox "Comment": ok\n- button "Save"', enter, save)).toBeUndefined();
  });

  it('does not take Space for the Enter that moves to a next page', () => {
    const recovery = new StepRecovery('sign in');
    const next = { role: 'button', name: 'Next' };
    attempt(recovery, '- textbox "Email": a@b.c\n- button "Next"', click('Next'));
    attempt(recovery, '- textbox "Password"\n- button "Next"', fillField('Password', 'sign in'));
    expect(attempt(recovery, '- textbox "Password": x\n- button "Next"', pressOn('textbox', 'Password', ' '), next)).toContain('refused:');
    expect(attempt(recovery, '- textbox "Password": x\n- button "Next"', pressOn('textbox', 'Password'), next)).toBeUndefined();
  });
});

describe('snapshotFields', () => {
  it('reads inline values, values under a placeholder, and empty fields', () => {
    const snapshot = [
      '- textbox "Note" [active] [ref=e14]:',
      '  - /placeholder: Describe the note',
      '  - text: Check the invoice',
      '- textbox "Title": Hello',
      '- searchbox "Search"',
      '- combobox "Priority":',
      '  - option "High" [selected]',
      '- button "Add note"',
    ].join('\n');
    expect(snapshotFields(snapshot)).toEqual([
      { role: 'textbox', name: 'Note', filled: true },
      { role: 'textbox', name: 'Title', filled: true },
      { role: 'searchbox', name: 'Search', filled: false },
      { role: 'combobox', name: 'Priority', filled: false },
    ]);
  });

  it('does not take text deeper than its own lines for a value', () => {
    const snapshot = '- combobox "City":\n  - listbox:\n    - text: Lisbon';
    expect(snapshotFields(snapshot)).toEqual([{ role: 'combobox', name: 'City', filled: false }]);
  });

  it('does not take the next element for a value', () => {
    expect(snapshotFields('- textbox "Note"\n- text: Saved')).toEqual([{ role: 'textbox', name: 'Note', filled: false }]);
  });
});

/** A DOM control as the lookup reads it in the page. */
interface FakeControl {
  tagName: string;
  type?: string;
  disabled?: boolean;
  form?: FakeControl | null;
  getRootNode(): { querySelectorAll(selector: string): FakeControl[] };
  addEventListener(type: string, listener: () => void, options?: { capture: boolean; once: boolean }): void;
  /** What the page does when the test "presses": fires the listeners of that event. */
  fire(type: string): void;
  /** A control doubles as its own handle here. */
  dispose(): Promise<void>;
}

/** A document in tree order; `form` is the form owner of the controls given it. */
function documentOf(): { add(tagName: string, type?: string, form?: FakeControl): FakeControl; all: FakeControl[] } {
  const all: FakeControl[] = [];
  const root = { querySelectorAll: () => all.filter((c) => c.tagName === 'BUTTON' || c.tagName === 'INPUT') };
  return {
    all,
    add(tagName, type, form) {
      const listeners: Array<{ type: string; listener: () => void; once: boolean }> = [];
      const one: FakeControl = {
        tagName,
        type,
        form: form ?? null,
        getRootNode: () => root,
        addEventListener: (type, listener, options) => {
          // Capture, or a handler below that stops the event would hide it.
          if (options?.capture) listeners.push({ type, listener, once: options.once });
        },
        fire: (type) => {
          for (const one of listeners.filter((l) => l.type === type)) {
            one.listener();
            if (one.once) listeners.splice(listeners.indexOf(one), 1);
          }
        },
        dispose: async () => undefined,
      };
      all.push(one);
      return one;
    },
  };
}

const handle = <T,>(value: T) => ({ evaluate: async <R,>(fn: (v: T) => R) => fn(value), dispose: async () => undefined });

/** A page whose refs resolve to fake controls, and whose focus is `active`. */
function pageOf(elements: Record<string, FakeControl>, active?: FakeControl): { page: PageLike; asked: string[] } {
  const asked: string[] = [];
  const page = {
    evaluateHandle: async () => active ?? null,
    locator: (selector: string) => {
      const ref = selector.slice('aria-ref='.length);
      return {
        count: async () => (elements[ref] ? 1 : 0),
        elementHandle: async () => elements[ref],
        evaluate: async (
          fn: (el: FakeControl, arg: { field: FakeControl | null; enter: boolean }) => boolean,
          arg: { field: FakeControl | null; enter: boolean },
        ) => {
          asked.push(ref);
          return fn(elements[ref]!, arg);
        },
        evaluateHandle: async (fn: (el: FakeControl) => unknown) => handle(fn(elements[ref]!)),
      };
    },
  } as unknown as PageLike;
  return { page, asked };
}

describe('submitControlOf', () => {
  const snapshot = [
    '- button "Search" [ref=e1]',
    '- textbox "Note" [ref=e2]',
    '- button "Cancel" [ref=e3]',
    '- button "Add note" [ref=e4]',
    '- textbox "Comment" [ref=e5]',
    '- textbox "Loose" [ref=e6]',
  ].join('\n');
  const refs = indexRefs(snapshot);

  function dom(): Record<string, FakeControl> & { doc: ReturnType<typeof documentOf>; form: FakeControl } {
    const doc = documentOf();
    const searchForm = doc.add('FORM');
    const search = doc.add('BUTTON', 'submit', searchForm);
    const form = doc.add('FORM');
    const note = doc.add('INPUT', 'text', form);
    const cancel = doc.add('BUTTON', 'button', form);
    const add = doc.add('BUTTON', 'submit', form);
    const comment = doc.add('TEXTAREA', 'textarea', form);
    const loose = doc.add('INPUT', 'text');
    return { e1: search, e2: note, e3: cancel, e4: add, e5: comment, e6: loose, doc, form } as never;
  }
  const press = (ref?: string, name = 'Note', key?: string): AgentAction => ({
    action: 'press',
    ...(ref ? { target: { ref, role: 'textbox', name } } : {}),
    ...(key ? { value: key } : {}),
    reasoning: 'r',
  });

  it("names the default submit button of the target field's form", async () => {
    const { page } = pageOf(dom());
    expect(await submitControlOf(page, press('e2', 'Note', 'Enter'), refs)).toMatchObject({ role: 'button', name: 'Add note' });
  });

  it('asks about the focused element for a press with no target', async () => {
    const elements = dom();
    const { page } = pageOf(elements, elements.e2);
    expect(await submitControlOf(page, press(), refs)).toMatchObject({ role: 'button', name: 'Add note' });
  });

  it('says whether the press clicked the button', async () => {
    const elements = dom();
    const { page } = pageOf(elements);
    const quiet = await submitControlOf(page, press('e2'), refs);
    expect(await quiet!.activated()).toBe(false);
    const clicked = await submitControlOf(page, press('e2'), refs);
    elements.e4!.fire('click');
    expect(await clicked!.activated()).toBe(true);
    // Another event on the button is not a click.
    const hovered = await submitControlOf(page, press('e2'), refs);
    elements.e4!.fire('mouseover');
    expect(await hovered!.activated()).toBe(false);
  });

  it('takes a form submitted by the key handler itself for a press that submitted', async () => {
    const elements = dom();
    const { page } = pageOf(elements);
    const control = await submitControlOf(page, press('e2'), refs);
    elements.form.fire('submit');
    expect(await control!.activated()).toBe(true);
  });

  it('reads an empty key as Enter, as the press itself does', async () => {
    const { page } = pageOf(dom());
    const empty: AgentAction = { action: 'press', target: { ref: 'e2', role: 'textbox', name: 'Note' }, value: '', reasoning: 'r' };
    expect(await submitControlOf(page, empty, refs)).toMatchObject({ role: 'button', name: 'Add note' });
  });

  it('takes a page that went away for a press that submitted', async () => {
    const elements = dom();
    const { page } = pageOf(elements);
    const real = page.locator.bind(page) as unknown as (s: string) => Record<string, unknown>;
    (page as unknown as { locator: unknown }).locator = (selector: string) => ({
      ...real(selector),
      evaluateHandle: async () => ({ evaluate: async () => { throw new Error('Execution context was destroyed'); }, dispose: async () => undefined }),
    });
    const control = await submitControlOf(page, press('e2'), refs);
    expect(await control!.activated()).toBe(true);
  });

  it('names nothing when the default button is disabled, since Enter then submits nothing', async () => {
    const elements = dom();
    elements.e4!.disabled = true;
    const { page } = pageOf(elements);
    expect(await submitControlOf(page, press('e2'), refs)).toBeUndefined();
  });

  it('takes a button of an unknown type, and an image button, for a submit button', async () => {
    for (const [tagName, type] of [['BUTTON', 'submit'], ['INPUT', 'image']] as const) {
      const elements = dom();
      // A browser reports type "submit" for <button type="bogus">.
      const first = elements.doc.add(tagName, type, elements.form);
      elements.doc.all.splice(elements.doc.all.indexOf(elements.e2!), 0, elements.doc.all.pop()!);
      const { page } = pageOf(elements);
      // The first submit button is not "Add note", and the snapshot here does not show it.
      expect(await submitControlOf(page, press('e2'), refs)).toBeUndefined();
      expect(first.form).toBe(elements.form);
    }
  });

  it('finds a button the form owns from outside it', async () => {
    const doc = documentOf();
    const form = doc.add('FORM');
    const title = doc.add('INPUT', 'text', form);
    doc.add('BUTTON', 'button', form);
    doc.add('DIV');
    const publish = doc.add('BUTTON', 'submit', form);
    const { page } = pageOf({ e1: title, e2: publish });
    const shown = indexRefs('- textbox "Title" [ref=e1]\n- button "Publish" [ref=e2]');
    expect(await submitControlOf(page, press('e1', 'Title'), shown)).toMatchObject({ name: 'Publish' });
  });

  it('names the focused button itself for a bare Enter or Space', async () => {
    const elements = dom();
    const { page } = pageOf(elements, elements.e3);
    expect(await submitControlOf(page, press(), refs)).toMatchObject({ role: 'button', name: 'Cancel' });
    expect(await submitControlOf(page, press(undefined, '', ' '), refs)).toMatchObject({ role: 'button', name: 'Cancel' });
  });

  it('names nothing for a bare Space in a field', async () => {
    const elements = dom();
    const { page } = pageOf(elements, elements.e2);
    expect(await submitControlOf(page, press(undefined, '', ' '), refs)).toBeUndefined();
  });

  it.each([
    ['a textarea', 'e5', 'Comment'],
    ['a field with no form', 'e6', 'Loose'],
  ])('names nothing for %s', async (_what, ref, name) => {
    const { page } = pageOf(dom());
    expect(await submitControlOf(page, press(ref, name), refs)).toBeUndefined();
  });

  it.each([
    ['an input Enter does not submit from', 'INPUT', 'file'],
    ['a form member that is no input and has no type', 'DIV', undefined],
  ])('names nothing for %s', async (_what, tagName, type) => {
    const elements = dom();
    elements.e2!.tagName = tagName;
    elements.e2!.type = type;
    const { page } = pageOf(elements);
    expect(await submitControlOf(page, press('e2'), refs)).toBeUndefined();
  });

  it('names the button for a checkbox, which Enter submits from too', async () => {
    const elements = dom();
    elements.e2!.type = 'checkbox';
    const { page } = pageOf(elements);
    expect(await submitControlOf(page, press('e2'), refs)).toMatchObject({ name: 'Add note' });
  });

  it('names nothing when the snapshot does not show the button', async () => {
    const { page } = pageOf(dom());
    const cut = indexRefs('- textbox "Note" [ref=e2]\n- button "Cancel" [ref=e3]');
    expect(await submitControlOf(page, press('e2'), cut)).toBeUndefined();
  });

  it('names nothing when nothing has the focus', async () => {
    const { page } = pageOf(dom());
    expect(await submitControlOf(page, press(), refs)).toBeUndefined();
  });

  it('does not ask the page for another key, another action, or a press on a button', async () => {
    const { page, asked } = pageOf(dom());
    expect(await submitControlOf(page, press('e2', 'Note', 'Tab'), refs)).toBeUndefined();
    expect(await submitControlOf(page, press('e2', 'Note', ' '), refs)).toBeUndefined();
    expect(await submitControlOf(page, press(undefined, '', 'Tab'), refs)).toBeUndefined();
    expect(await submitControlOf(page, { action: 'click', target: { ref: 'e4', role: 'button', name: 'Add note' }, reasoning: 'r' }, refs)).toBeUndefined();
    expect(await submitControlOf(page, { action: 'press', target: { ref: 'e4', role: 'button', name: 'Add note' }, value: 'Enter', reasoning: 'r' }, refs)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('names nothing, and does not throw, when the page cannot be asked', async () => {
    const broken = { locator: () => ({ count: async () => { throw new Error('gone'); } }) } as unknown as PageLike;
    expect(await submitControlOf(broken, press('e2'), refs)).toBeUndefined();
    expect(await submitControlOf({} as unknown as PageLike, press(), refs)).toBeUndefined();
  });

  it('names nothing when the page takes longer than the bound to answer', async () => {
    const hung = { evaluateHandle: () => new Promise(() => {}) } as unknown as PageLike;
    expect(await submitControlOf(hung, press(), refs, 20)).toBeUndefined();
  });

  it('passes over a button whose element cannot be asked', async () => {
    const elements = dom();
    const { page } = pageOf(elements);
    const real = page.locator.bind(page);
    (page as unknown as { locator: (s: string) => unknown }).locator = (selector: string) =>
      selector === 'aria-ref=e1' ? { count: async () => 1, evaluate: async () => { throw new Error('other frame'); } } : real(selector);
    expect(await submitControlOf(page, press('e2'), refs)).toMatchObject({ role: 'button', name: 'Add note' });
  });
});
