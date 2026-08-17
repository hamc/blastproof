import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectMissingValues, suggestValueClause } from '../src/runner/authoring.js';
import { discoverTestFiles, parseTestFile, type TestFile } from '../src/runner/testfile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeTest(overrides: Partial<TestFile> & { summary: string }): TestFile {
  return {
    path: `/repo/.blastproof/tests/${overrides.summary}.yaml`,
    steps: ['do something'],
    priority: 'P1',
    tags: [],
    routes: [],
    auth: true,
    ...overrides,
  };
}

/** The findings for a single-step test, as the step text — the unit under test. */
function flagged(step: string): boolean {
  const result = detectMissingValues([makeTest({ summary: 'one', steps: [step] })]);
  return result.findings.length === 1;
}

describe('detectMissingValues', () => {
  it('reports a value-entering step that names no value', () => {
    const test = makeTest({ summary: 'Add a note', steps: ['navigate to /notes', 'fill the note field'] });
    const { findings } = detectMissingValues([test]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ test, origin: 'steps', index: 2, step: 'fill the note field' });
  });

  it('does not report a step that names its value', () => {
    expect(flagged('fill the note field with Order not received')).toBe(false);
  });

  it('does not report a value taken from an env placeholder', () => {
    expect(flagged('fill password with {{env.TEST_PASSWORD}}')).toBe(false);
  });

  it('does not report a value taken from the page', () => {
    // prompts.ts permits a value that comes from the page, so this runs today.
    // Failing it would block a working test — the reason the check only warns (D1).
    expect(flagged('fill the recipient field with the address shown on the confirmation page')).toBe(false);
  });

  it('does not report a quoted value', () => {
    expect(flagged('enter "Order not received" in the note field')).toBe(false);
  });

  it('does not report a value introduced by a connector other than `with`', () => {
    // The shape that broke the first design: enumerating ways to name a value
    // cannot be closed, so the check asks for a connector instead (D3).
    expect(flagged('set the priority to High')).toBe(false);
  });

  it('does not report a value that precedes its field', () => {
    expect(flagged('enter Order not received in the subject field')).toBe(false);
  });

  it('reports a phrasal verb, whose `in` belongs to the verb', () => {
    expect(flagged('fill in the note field')).toBe(true);
    expect(flagged('type in the search box')).toBe(true);
  });

  it('does not report a step with no value-entering verb', () => {
    expect(flagged('click Save and verify the confirmation is shown')).toBe(false);
  });

  it('does not match a verb used as a noun', () => {
    // `type` and `set` are nouns as often as verbs. Matching them anywhere in the
    // step rather than at its head flagged these, which is why the verb is anchored.
    expect(flagged('verify the type is Premium')).toBe(false);
    expect(flagged('verify the set of results is empty')).toBe(false);
  });

  it('does not match a longer word starting with a verb', () => {
    expect(flagged('setup the account and verify the dashboard')).toBe(false);
    expect(flagged('entering the building is not a step')).toBe(false);
  });

  it('checks setup steps too, before steps', () => {
    // setup runs through the same executor and fails the same way (D2).
    const test = makeTest({
      summary: 'Search',
      setup: ['fill the search box'],
      steps: ['fill the note field'],
    });
    const { findings } = detectMissingValues([test]);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ origin: 'setup', index: 1, step: 'fill the search box' });
    expect(findings[1]).toMatchObject({ origin: 'steps', index: 1, step: 'fill the note field' });
  });

  it('returns nothing for a clean suite', () => {
    const clean = makeTest({ summary: 'Clean', steps: ['fill the note field with Check the invoice'] });
    expect(detectMissingValues([clean]).findings).toEqual([]);
  });

  it('returns nothing for no tests at all', () => {
    expect(detectMissingValues([]).findings).toEqual([]);
  });

  it('groups by test in input order, then by step order', () => {
    const first = makeTest({ summary: 'First', steps: ['fill a', 'click b', 'enter c'] });
    const second = makeTest({ summary: 'Second', steps: ['type d'] });
    const { findings } = detectMissingValues([first, second]);

    expect(findings.map((finding) => finding.step)).toEqual(['fill a', 'enter c', 'type d']);
  });

  it('produces no finding for a non-English step', () => {
    // Documents the gap as intended, not as an oversight: the check is English
    // grammar in code (D9), so a suite in another language is silently unchecked.
    // #53 is the language-independent answer. When it lands, this test should fail
    // and force the decision rather than let the gap survive unnoticed.
    expect(flagged('preencha o campo de observação')).toBe(false);
  });

  describe('every verb in the closed set is matched', () => {
    for (const verb of ['fill', 'enter', 'type', 'input', 'set']) {
      it(`matches \`${verb}\``, () => {
        expect(flagged(`${verb} the note field`)).toBe(true);
      });
    }
  });

  describe('every connector silences the check', () => {
    for (const connector of ['with', 'to', 'as', 'using', 'into', 'from']) {
      it(`accepts \`${connector}\``, () => {
        expect(flagged(`fill the note field ${connector} something`)).toBe(false);
      });
    }

    for (const [name, step] of [
      ['a quote', 'fill the note field "x"'],
      ['an equals sign', 'fill the note field = x'],
      ['a colon', 'fill the note field: x'],
      ['a placeholder', 'fill the note field {{env.NOTE}}'],
      ['a loose `in`', 'fill x in the note field'],
    ] as const) {
      it(`accepts ${name}`, () => {
        expect(flagged(step)).toBe(false);
      });
    }
  });

  it('finds nothing in the project’s own suite', async () => {
    // The only corpus of real steps this repository has. A check that fires on the
    // tests we ship is wrong, whatever the unit tests say.
    const files = await discoverTestFiles(path.join(root, '.blastproof', 'tests'));
    const tests = await Promise.all(files.map((file) => parseTestFile(file)));

    expect(detectMissingValues(tests).findings).toEqual([]);
  });
});

describe('suggestValueClause', () => {
  it('appends a value clause without inventing a value', () => {
    expect(suggestValueClause('fill the note field')).toBe('fill the note field with <value>');
  });

  it('is itself a step the check accepts', () => {
    // The suggestion must not be something the tool would warn about again.
    expect(flagged(suggestValueClause('fill the note field'))).toBe(false);
  });
});

describe('the authoring rule reads the same everywhere it is stated', () => {
  // Third copy of a rule that already exists twice and has already drifted once
  // (#45). This does not make a single source; it makes divergence loud.
  const RULE = 'forbidden from inventing values';

  it('appears in the planner prompt, the README and the check’s own message', async () => {
    const places = {
      'src/llm/prompts.ts': await readFile(path.join(root, 'src/llm/prompts.ts'), 'utf8'),
      'README.md': await readFile(path.join(root, 'README.md'), 'utf8'),
      'src/commands/run.ts': await readFile(path.join(root, 'src/commands/run.ts'), 'utf8'),
    };
    const missing = Object.entries(places)
      .filter(([, contents]) => !contents.includes(RULE))
      .map(([name]) => name);

    expect(missing, `"${RULE}" is missing from: ${missing.join(', ')}`).toEqual([]);
  });

  it('never claims such a step cannot be carried out', async () => {
    // The reason has changed and the guard has not. 0.12.0 claimed the step was
    // impossible while nothing enforced the rule — measured, `fill the note
    // field` ran three times out of three with an invented value and passed
    // every time. `refuse-an-invented-value` now enforces it, so the claim is
    // much closer to true — and still an overclaim, which is why this stays.
    //
    // The refusal is a text comparison against the step, the pages seen and
    // `{{env.*}}`. A model that types something the page happens to contain, or
    // a value short enough to appear anywhere (`3`), is not refused. So such a
    // step usually fails, not always, and an absolute statement would be the
    // same kind of unmeasured promise as the one this test was written to kill.
    const surfaces = await Promise.all(
      ['README.md', 'CHANGELOG.md', 'src/commands/run.ts', 'src/llm/prompts.ts'].map(
        async (file) => [file, await readFile(path.join(root, file), 'utf8')] as const,
      ),
    );
    const offending = surfaces
      .filter(([, contents]) => /cannot be carried out|carried out at all/.test(contents))
      .map(([file]) => file);

    expect(offending, `these still claim the step is impossible: ${offending.join(', ')}`).toEqual([]);
  });

  it('says the rule is enforced, not merely stated, everywhere it appears', async () => {
    // The inverse guard, and the one that would have caught this defect years
    // earlier if it had existed: every surface describing the rule must say the
    // runner acts on it. A surface that only tells the model not to invent is a
    // surface describing the state #57 was filed about.
    const surfaces = await Promise.all(
      ['README.md', 'src/commands/run.ts', 'src/llm/prompts.ts'].map(
        async (file) => [file, await readFile(path.join(root, file), 'utf8')] as const,
      ),
    );
    const silent = surfaces
      .filter(([, contents]) => !/refuse[sd]?\b|enforces it/.test(contents))
      .map(([file]) => file);

    expect(silent, `these state the rule without saying it is enforced: ${silent.join(', ')}`).toEqual([]);
  });

  it('states the English-only limit in both the README and the message', async () => {
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const runner = await readFile(path.join(root, 'src/commands/run.ts'), 'utf8');

    expect(readme).toContain('English only');
    expect(runner).toContain('in English only');
  });
});
