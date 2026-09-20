import { describe, expect, it } from 'vitest';
import {
  maskSecrets,
  MissingEnvError,
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
  it('replaces every occurrence of each secret with ***', () => {
    expect(maskSecrets('pw=s3cret, again s3cret', ['s3cret'])).toBe('pw=***, again ***');
  });

  it('ignores empty secrets and escapes regex characters', () => {
    expect(maskSecrets('nothing here', [''])).toBe('nothing here');
    expect(maskSecrets('value a.b+c here', ['a.b+c'])).toBe('value *** here');
  });
});

describe('SecretsMask', () => {
  it('registers values from placeholders and masks them', () => {
    const env = { USER: 'demo', PASSWORD: 'demo123' };
    const mask = new SecretsMask();
    mask.registerFrom('log in as {{env.USER}} with {{env.PASSWORD}}', env);
    expect(mask.mask('user demo typed demo123')).toBe('user *** typed ***');
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
        '- status: Unknown promo code "***".',
      );
    }
  });

  it('redacts a value the page re-spaced', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.PHRASE}}', { PHRASE: 'open sesame' });
    expect(mask.mask('said: open   sesame')).toBe('said: ***');
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

    expect(mask.mask('demo123 then demo')).toBe('*** then ***');
    // The widened comparison must not let the short one eat the long one's prefix.
    expect(mask.mask('DEMO123')).toBe('***');

    const spaced = new SecretsMask();
    spaced.registerFrom('{{env.PHRASE}}', { PHRASE: 'open sesame' });
    expect(spaced.mask('q=open%20sesame')).toBe('q=***');
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

    expect(mask.mask(text)).toBe('code *** and again ***');
    expect(mask.mask(text)).toBe('code *** and again ***');
    expect(mask.mask(text)).toBe('code *** and again ***');
  });

  it('masks a value registered after the first mask() call', () => {
    const mask = new SecretsMask();
    mask.registerFrom('{{env.A}}', { A: 'first' });
    expect(mask.mask('first second')).toBe('*** second');

    mask.registerFrom('{{env.B}}', { B: 'second' });
    expect(mask.mask('first second')).toBe('*** ***');
  });

  it('masks a value registered without a name, recording no near-miss for it', () => {
    const mask = new SecretsMask();
    mask.add('hunter2');
    expect(mask.mask('code HUNTER2')).toBe('code ***');
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
