import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');

// Inputs the action handles itself; they never reach the CLI as anything.
// `command` picks the subcommand, `version` pins the npm install, `install-browser`
// gates a playwright step, `working-directory` is a step field, and `api-key`
// lands in an environment variable the config points at by name.
const wrapperInputs = ['command', 'version', 'install-browser', 'working-directory', 'api-key'];

// Inputs the CLI reads from the environment rather than from a flag. The
// allowlist is not a free pass: each one is checked against the env: block below.
const envMappedInputs: Record<string, string> = {
  provider: 'BLASTPROOF_LLM_PROVIDER',
  model: 'BLASTPROOF_LLM_MODEL',
  'llm-base-url': 'BLASTPROOF_LLM_BASE_URL',
  url: 'BLASTPROOF_BASE_URL',
};

async function optionsOf(command: string): Promise<string[]> {
  const { stdout } = await run(process.execPath, [cli, command, '--help']);
  // commander indents an option by exactly two spaces and wraps its description
  // deeper, so this reads the flags and never a `--flag` named in prose.
  return stdout
    .split('\n')
    .map((line) => /^ {2}(--[a-z0-9-]+)/.exec(line)?.[1])
    .filter((flag): flag is string => flag !== undefined);
}

describe('action.yml', () => {
  it('parses as YAML', async () => {
    // Twice now an example containing an unquoted colon inside a description made
    // GitHub reject the whole manifest — and the only thing that caught it was a
    // workflow run after the push. This catches it before the commit.
    const raw = await readFile(path.join(root, 'action.yml'), 'utf8');
    expect(() => parse(raw)).not.toThrow();
  });

  it('exposes the inputs and output the docs promise', async () => {
    const manifest = parse(await readFile(path.join(root, 'action.yml'), 'utf8')) as {
      runs: { using: string };
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
    };
    expect(manifest.runs.using).toBe('composite');
    expect(Object.keys(manifest.outputs)).toContain('score');
    for (const input of ['api-key', 'command', 'base', 'min-score', 'fail-on-unmapped', 'version']) {
      expect(manifest.inputs).toHaveProperty(input);
    }
  });

  it('never interpolates an expression inside a description', async () => {
    // GitHub evaluates ${{ }} in descriptions, where contexts like `secrets`
    // do not exist — an illustrative example there breaks the action entirely.
    const raw = await readFile(path.join(root, 'action.yml'), 'utf8');
    const offending = raw
      .split('\n')
      .filter((line) => /description:/.test(line) && /\$\{\{/.test(line));
    expect(offending).toEqual([]);
  });

  describe('every input maps to something the CLI accepts', () => {
    let manifest: { inputs: Record<string, unknown> };
    let script: string;
    let envBlock: string;
    let flags: Set<string>;

    beforeAll(async () => {
      const raw = await readFile(path.join(root, 'action.yml'), 'utf8');
      manifest = parse(raw) as { inputs: Record<string, unknown> };
      script = raw.slice(raw.indexOf('runs:'));
      const envStart = raw.indexOf('BLASTPROOF_ACTION_API_KEY');
      envBlock = raw.slice(envStart, raw.indexOf('run: |', envStart));
      await expect(
        access(cli),
        `${cli} is missing — run \`npm run build\` before the tests; this one reads the built CLI's --help`,
      ).resolves.toBeUndefined();
      const perCommand = await Promise.all(['run', 'test', 'plan'].map(optionsOf));
      flags = new Set(perCommand.flat());
    });

    it('sends each flag-shaped input as a flag the CLI declares', () => {
      const unmapped: string[] = [];
      for (const input of Object.keys(manifest.inputs)) {
        if (wrapperInputs.includes(input) || input in envMappedInputs) continue;
        const flag = `--${input}`;
        // The boundary matters: `args+=(--min-scores` contains `args+=(--min-score`,
        // and a typo that passes for the wrong reason is worse than no test.
        const sent = new RegExp(`args\\+=\\(${flag}(?![a-z0-9-])`).test(script);
        if (!sent || !flags.has(flag)) unmapped.push(input);
      }
      expect(unmapped).toEqual([]);
    });

    it('passes each env-mapped input through the variable the CLI reads', () => {
      const missing = Object.entries(envMappedInputs).filter(
        ([input, variable]) => !envBlock.includes(`${variable}: \${{ inputs.${input} }}`),
      );
      expect(missing).toEqual([]);
    });

    it('names every allowlisted input, so a removed input cannot hide there', () => {
      const declared = Object.keys(manifest.inputs);
      const stale = [...wrapperInputs, ...Object.keys(envMappedInputs)].filter(
        (input) => !declared.includes(input),
      );
      expect(stale).toEqual([]);
    });

    it('passes no flag the CLI does not declare', () => {
      const used = [...script.matchAll(/args\+=\((--[a-z0-9-]+)/g)].map(([, flag]) => flag ?? '');
      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((flag) => !flags.has(flag))).toEqual([]);
    });
  });
});
