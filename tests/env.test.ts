import { describe, expect, it } from 'vitest';
import {
  maskSecrets,
  MissingEnvError,
  labelledVariables,
  placeholdersAsLabels,
  referencedEnvVars,
  SecretsMask,
  substituteEnv,
} from '../src/runner/env.js';

describe('substituteEnv', () => {
  it('substitutes placeholders from the environment', () => {
    const env = { TEST_PASSWORD: 's3cret' };
    expect(substituteEnv('fill password with {{env.TEST_PASSWORD}}', env)).toBe(
      'fill password with s3cret',
    );
  });

  it('substitutes multiple and whitespace-tolerant placeholders', () => {
    const env = { A: '1', B: '2' };
    expect(substituteEnv('{{ env.A }} and {{env.B}}', env)).toBe('1 and 2');
  });

  it('throws MissingEnvError naming the variable when unset', () => {
    const err = (() => {
      try {
        substituteEnv('login with {{env.MISSING_VAR}}', {});
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(MissingEnvError);
    expect((err as Error).message).toContain('MISSING_VAR');
  });

  it('leaves non-env placeholders untouched', () => {
    expect(substituteEnv('hello {{name}}', {})).toBe('hello {{name}}');
  });
});

describe('referencedEnvVars', () => {
  it('collects unique variable names', () => {
    expect(referencedEnvVars('{{env.A}} {{env.B}} {{env.A}} {{other}}')).toEqual(['A', 'B']);
  });
});

describe('maskSecrets', () => {
  it('replaces every occurrence of each secret with an unnamed label, having no names', () => {
    expect(maskSecrets('pw=s3cret, again s3cret', ['s3cret'])).toBe('pw=[redacted], again [redacted]');
  });

  it('ignores empty secrets and escapes regex characters', () => {
    expect(maskSecrets('nothing here', [''])).toBe('nothing here');
    expect(maskSecrets('value a.b+c here', ['a.b+c'])).toBe('value [redacted] here');
  });
});

describe('placeholdersAsLabels (ask-the-judge-about-the-step)', () => {
  it('rewrites each placeholder as the label its value is masked to', () => {
    expect(placeholdersAsLabels('verify it shows {{env.TEST_OTHER}}')).toBe('verify it shows [redacted TEST_OTHER]');
    expect(placeholdersAsLabels('{{env.A}} and {{ env.B }}')).toBe('[redacted A] and [redacted B]');
  });

  it('leaves text without a placeholder untouched, including values', () => {
    const text = 'Unknown promo code "HUNTER2". [redacted PROBE_SECRET] {env.NOT} {{ENV.X}}';
    expect(placeholdersAsLabels(text)).toBe(text);
  });

  it('produces exactly the label the mask writes for that variable', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.TEST_EMAIL}}', { TEST_EMAIL: 'qa@acme.test' });
    expect(placeholdersAsLabels('{{env.TEST_EMAIL}}')).toBe(mask.mask('qa@acme.test'));
  });
});

describe('labelledVariables', () => {
  it('returns each named label once, and ignores unnamed ones', () => {
    expect(labelledVariables('[redacted A] [redacted B] [redacted A] [redacted]')).toEqual(['A', 'B']);
    expect(labelledVariables('no labels, {{env.A}}')).toEqual([]);
  });
});

describe('SecretsMask', () => {
  it('registers values from placeholders and masks them', () => {
    const env = { USER: 'demo', PASSWORD: 'demo123' };
    const mask = new SecretsMask();
    mask.registerFrom('log in as {{env.USER}} with {{env.PASSWORD}}', env);
    expect(mask.mask('user demo typed demo123')).toBe('user [redacted USER] typed [redacted PASSWORD]');
  });

  // label-a-redaction-with-its-variable: with one shared `***`, a step verifying
  // one secret passed against a page showing another (3 of 3, measured).
  it('keeps two secrets distinguishable after masking, and neither value', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.PROBE_SECRET}} {{env.OTHER_SECRET}}', {
      PROBE_SECRET: 'HUNTER2',
      OTHER_SECRET: 'SAVE99',
    });
    const step = mask.mask('verify the status message reads Unknown promo code "SAVE99".');
    const page = mask.mask('- status: Unknown promo code "HUNTER2".');

    expect(step).toBe('verify the status message reads Unknown promo code "[redacted OTHER_SECRET]".');
    expect(page).toBe('- status: Unknown promo code "[redacted PROBE_SECRET]".');
    for (const text of [step, page]) {
      expect(text).not.toMatch(/hunter2|save99/i);
    }
  });

  it('gives one secret one label, whichever form of it was matched', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.P}}', { P: 'open sesame' });
    expect(mask.mask('open sesame | OPEN   SESAME | open%20sesame')).toBe(
      '[redacted P] | [redacted P] | [redacted P]',
    );
  });

  it('labels a value two variables share by the first name registered', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.FIRST}} {{env.SECOND}}', { FIRST: 'same', SECOND: 'same' });
    expect(mask.mask('same')).toBe('[redacted FIRST]');
  });

  it('throws when a referenced variable is unset', () => {
    const mask = new SecretsMask();
    expect(() => mask.registerFrom('{{env.NOPE}}', {})).toThrow(MissingEnvError);
  });

  // #109: the app reformats the value before rendering it.
  it('redacts a value the page returned in another case', () => {
    for (const supplied of ['hunter2', 'Hunter2', 'HUNTER2']) {
      const mask = new SecretsMask();
      mask.registerFrom('fill the promo code with {{env.PROBE_SECRET}}', { PROBE_SECRET: supplied });
      expect(mask.mask('- status: Unknown promo code "HUNTER2".')).toBe(
        '- status: Unknown promo code "[redacted PROBE_SECRET]".',
      );
    }
  });

  it('redacts a value the page re-spaced', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.PHRASE}}', { PHRASE: 'open sesame' });
    expect(mask.mask('said: open   sesame')).toBe('said: [redacted PHRASE]');
  });

  it('does not redact a form it cannot recognise, and claims nothing', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.PROBE_SECRET}}', { PROBE_SECRET: 'hunter2' });
    const encoded = Buffer.from('hunter2').toString('base64');

    expect(mask.mask(`token=${encoded}`)).toBe(`token=${encoded}`);
    expect(mask.nearMissedVariables()).toEqual([]);
  });

  it('keeps masking the literal and percent-encoded forms, longest first', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.SHORT}} and {{env.LONG}}', { SHORT: 'demo', LONG: 'demo123' });

    expect(mask.mask('demo123 then demo')).toBe('[redacted LONG] then [redacted SHORT]');
    // The widened comparison must not let the short one eat the long one's prefix.
    expect(mask.mask('DEMO123')).toBe('[redacted LONG]');

    const spaced = new SecretsMask();
    spaced.registerFrom('{{env.PHRASE}}', { PHRASE: 'open sesame' });
    // The percent-encoded form is the same secret, so it reads as the same one.
    expect(spaced.mask('q=open%20sesame')).toBe('q=[redacted PHRASE]');
  });

  it('records a near-miss by variable name, and only when the literal missed it', () => {
    const literal = new SecretsMask();
    literal.registerFrom('{{env.PROBE_SECRET}}', { PROBE_SECRET: 'HUNTER2' });
    literal.mask('Unknown promo code "HUNTER2".');
    expect(literal.nearMissedVariables()).toEqual([]);

    const reformatted = new SecretsMask();
    reformatted.registerFrom('{{env.PROBE_SECRET}}', { PROBE_SECRET: 'hunter2' });
    reformatted.mask('Unknown promo code "HUNTER2".');
    reformatted.mask('again: HUNTER2');
    // Names only, and once however many occurrences were redacted.
    expect(reformatted.nearMissedVariables()).toEqual(['PROBE_SECRET']);
    expect(reformatted.nearMissedVariables().join()).not.toContain('hunter2');
  });

  it('masks the same text identically when called repeatedly', () => {
    // The patterns are compiled once and reused, and a `g` regex carries
    // `lastIndex` between calls — a reused one that is not reset skips matches.
    const mask = new SecretsMask();
    mask.registerFrom('{{env.S}}', { S: 'hunter2' });
    const text = 'code HUNTER2 and again hunter2';

    const expected = 'code [redacted S] and again [redacted S]';
    expect(mask.mask(text)).toBe(expected);
    expect(mask.mask(text)).toBe(expected);
    expect(mask.mask(text)).toBe(expected);
  });

  it('masks a value registered after the first mask() call', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.A}}', { A: 'first' });
    expect(mask.mask('first second')).toBe('[redacted A] second');

    mask.registerFrom('{{env.B}}', { B: 'second' });
    expect(mask.mask('first second')).toBe('[redacted A] [redacted B]');
  });

  it('masks a value registered without a name, recording no near-miss for it', () => {
    const mask = new SecretsMask();
    mask.add('hunter2');
    expect(mask.mask('code HUNTER2')).toBe('code [redacted]');
    expect(mask.nearMissedVariables()).toEqual([]);
  });

  it('says whether it holds any value (withhold-a-screenshot-that-saw-a-secret)', () => {
    const mask = new SecretsMask();
    expect(mask.isEmpty()).toBe(true);

    // An empty value registers nothing, so it must not withhold anything either.
    mask.add('');
    mask.registerFrom('open the page', {});
    expect(mask.isEmpty()).toBe(true);

    mask.registerFrom('fill the promo code with {{env.PROBE_SECRET}}', { PROBE_SECRET: 'HUNTER2' });
    expect(mask.isEmpty()).toBe(false);
  });
});
