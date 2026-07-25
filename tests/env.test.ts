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
});
