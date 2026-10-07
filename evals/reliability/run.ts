/**
 * `npm run eval:reliability` — how often a verdict is wrong (design
 * measure-verdict-reliability).
 *
 * Runs the dogfood suite against an unmodified copy of the demo app (false FAIL)
 * and each mutant's target test against a copy carrying that mutant (false PASS),
 * `EVAL_SAMPLES` times (default 5) on each model in `EVAL_MODELS`. The model is
 * passed to the built CLI as `BLASTPROOF_LLM_MODEL`; provider, base URL and key
 * resolve as `blastproof run` resolves them.
 *
 * `EVAL_MUTANTS=a,b` runs only those mutants; `EVAL_SUITE=0` skips the
 * unmodified suite. Both are for checking a mutant, not for a published number.
 * `EVAL_RESCORE=<dir>` scores the logs and reports of an earlier run in that
 * directory again, with the same settings, without calling a model.
 *
 * Needs a model and a key, so it is not part of CI. Exit 1 only when the
 * benchmark could not run as declared (a mutant that does not apply, no build).
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { createModel } from '../../src/llm/provider.js';
import { discoverTestFiles, parseTestFile, TESTS_RELATIVE_DIR, type TestFile } from '../../src/runner/testfile.js';
import { evalModels } from '../judge/models.js';
import { checkMutants, loadMutants, materialize, REPO_ROOT, type Mutant } from './mutants.js';
import {
  authFailure,
  formatRate,
  parseJUnit,
  scoreMutant,
  scoreSuite,
  tally,
  type JUnitCase,
  type MutantOutcome,
  type SuiteOutcome,
} from './score.js';

const CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const MUTANT_OUTCOMES = ['caught', 'caught-elsewhere', 'false-pass', 'incomplete'] as const;
const SUITE_OUTCOMES = ['pass', 'false-fail', 'incomplete'] as const;

const samples = Number(process.env.EVAL_SAMPLES ?? 5);
const onlyMutants = (process.env.EVAL_MUTANTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const runSuite = process.env.EVAL_SUITE !== '0';
const rescore = process.env.EVAL_RESCORE ? path.resolve(process.env.EVAL_RESCORE) : undefined;

if (!rescore && !existsSync(CLI)) {
  console.error(`No build at ${path.relative(REPO_ROOT, CLI)}. Run \`npm run build\` first: the benchmark measures the CLI a user runs.`);
  process.exit(1);
}

const config = await loadConfig(REPO_ROOT);
const configured = createModel(config.llm);
const models = evalModels(process.env.EVAL_MODELS, configured.modelId);

let mutants = loadMutants();
if (onlyMutants.length > 0) {
  const unknown = onlyMutants.filter((id) => !mutants.some((m) => m.id === id));
  if (unknown.length > 0) {
    console.error(`EVAL_MUTANTS names no such mutant: ${unknown.join(', ')}`);
    process.exit(1);
  }
  mutants = mutants.filter((m) => onlyMutants.includes(m.id));
}
const problems = await checkMutants(mutants);
const tests = await Promise.all((await discoverTestFiles(path.join(REPO_ROOT, TESTS_RELATIVE_DIR))).map((file) => parseTestFile(file)));
for (const m of mutants) {
  const target = tests.find((t) => path.relative(REPO_ROOT, t.path) === m.test);
  const query = target?.summary.toLowerCase();
  const matched = tests.filter((t) => query !== undefined && t.summary.toLowerCase().includes(query));
  if (matched.length > 1) problems.push(`mutant ${m.id}: --query "${target?.summary}" would select ${matched.length} tests`);
}
if (problems.length > 0) {
  console.error(`The benchmark cannot run as declared:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

const outDir =
  rescore ?? path.join(REPO_ROOT, '.blastproof', 'reports', `reliability-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(outDir, { recursive: true });

console.log(
  `reliability benchmark: ${runSuite ? `${tests.length} test(s) unmodified + ` : ''}${mutants.length} mutant(s) x ` +
    `${samples} sample(s), provider=${configured.provider} model(s)=${models.join(', ')}\nlogs: ${path.relative(REPO_ROOT, outDir)}\n`,
);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** Starts the copy's server and resolves once it listens. The child is stopped by the caller, by handle. */
async function serve(appDir: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(appDir, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`demo app did not start on port ${port}`)), 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`demo app exited with code ${code}`));
    });
  });
  return { url: `http://localhost:${port}`, stop: () => child.kill() };
}

interface RunEvidence {
  /** The testcases of the run's JUnit report, empty when it wrote none. */
  cases: JUnitCase[];
  /** The step the run's sign-in failed at, when it did. */
  authFailedAt?: string;
}

/** What a finished run left behind: its JUnit report and its console log. */
async function evidence(base: string): Promise<RunEvidence> {
  const xml = await readFile(`${base}.xml`, 'utf8').catch(() => '');
  const log = await readFile(`${base}.log`, 'utf8').catch(() => '');
  return { cases: parseJUnit(xml), authFailedAt: authFailure(log) };
}

/** One CLI run against a fresh copy of the app; under EVAL_RESCORE, the evidence an earlier run left. */
async function runOnce(model: string, label: string, mutant: Mutant | undefined, query: string | undefined): Promise<RunEvidence> {
  const base = path.join(outDir, `${model.replace(/[^A-Za-z0-9.-]+/g, '_')}--${label}`);
  if (rescore) return evidence(base);
  const appDir = await mkdtemp(path.join(tmpdir(), 'blastproof-reliability-'));
  try {
    await materialize(appDir, mutant);
    const server = await serve(appDir);
    try {
      const args = [CLI, 'run', '--url', server.url, '--junit', `${base}.xml`, ...(query ? ['--query', query] : [])];
      const log = createWriteStream(`${base}.log`);
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, args, {
          cwd: REPO_ROOT,
          env: { ...process.env, BLASTPROOF_LLM_MODEL: model },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.pipe(log, { end: false });
        child.stderr.pipe(log, { end: false });
        child.once('close', resolve);
      });
      await new Promise<void>((resolve) => log.end(`\n[exit ${code}]\n`, resolve));
      return evidence(base);
    } finally {
      server.stop();
    }
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

interface MutantSample { model: string; mutant: string; sample: number; outcome: MutantOutcome; failedStep?: string }
interface SuiteSample { model: string; test: string; sample: number; outcome: SuiteOutcome; failedStep?: string }

const mutantSamples: MutantSample[] = [];
const suiteSamples: SuiteSample[] = [];

async function runModel(model: string, suite: TestFile[]): Promise<void> {
  for (let sample = 1; sample <= samples; sample++) {
    if (runSuite) {
      const run = await runOnce(model, `suite-${sample}`, undefined, undefined);
      for (const test of suite) {
        const file = path.relative(REPO_ROOT, test.path);
        const testcase = run.cases.find((c) => c.file === file);
        const outcome = scoreSuite(testcase, run.authFailedAt);
        const failedStep = testcase?.failedStep ?? (run.authFailedAt && `sign-in: ${run.authFailedAt}`);
        suiteSamples.push({ model, test: file, sample, outcome, failedStep });
        if (outcome !== 'pass') console.log(`${model} suite s${sample}: ${outcome} ${test.summary}`);
      }
    }
    for (const m of mutants) {
      const target = suite.find((t) => path.relative(REPO_ROOT, t.path) === m.test);
      const run = await runOnce(model, `${m.id}-${sample}`, m, target?.summary);
      const testcase = run.cases.find((c) => c.file === m.test);
      const outcome = scoreMutant(testcase, m.step, run.authFailedAt);
      const failedStep = testcase?.failedStep ?? (run.authFailedAt && `sign-in: ${run.authFailedAt}`);
      mutantSamples.push({ model, mutant: m.id, sample, outcome, failedStep });
      console.log(`${model} ${m.id} s${sample}: ${outcome}`);
    }
  }
}

await Promise.all(models.map((model) => runModel(model, tests)));

console.log('\n--- Result ---------------------------------------------------');
for (const model of models) {
  console.log(`\n${model}`);
  if (runSuite) {
    const t = tally(suiteSamples.filter((s) => s.model === model).map((s) => s.outcome), SUITE_OUTCOMES);
    console.log(`  unmodified suite   false FAIL ${formatRate(t.counts['false-fail'], t.decided)}   incomplete ${t.counts.incomplete}`);
    for (const s of suiteSamples.filter((s) => s.model === model && s.outcome !== 'pass')) {
      console.log(`    ${s.test} s${s.sample}: ${s.outcome}${s.failedStep ? ` at "${s.failedStep}"` : ''}`);
    }
  }
  for (const cls of ['literal', 'subtle'] as const) {
    const ids = new Set(mutants.filter((m) => m.class === cls).map((m) => m.id));
    if (ids.size === 0) continue;
    const t = tally(mutantSamples.filter((s) => s.model === model && ids.has(s.mutant)).map((s) => s.outcome), MUTANT_OUTCOMES);
    console.log(
      `  ${cls.padEnd(7)} mutants    false PASS ${formatRate(t.counts['false-pass'], t.decided)}   ` +
        `caught elsewhere ${t.counts['caught-elsewhere']}   incomplete ${t.counts.incomplete}`,
    );
  }
  for (const m of mutants) {
    const outcomes = mutantSamples.filter((s) => s.model === model && s.mutant === m.id);
    const wrong = outcomes.filter((s) => s.outcome !== 'caught');
    if (wrong.length === 0) continue;
    console.log(`    ${m.id}: ${wrong.map((s) => `s${s.sample} ${s.outcome}${s.failedStep ? ` at "${s.failedStep}"` : ''}`).join('; ')}`);
  }
}

await writeFile(
  path.join(outDir, 'results.json'),
  JSON.stringify({ models, samples, mutants: mutants.map((m) => ({ id: m.id, class: m.class })), suiteSamples, mutantSamples }, null, 2),
);
console.log(`\nresults: ${path.relative(REPO_ROOT, path.join(outDir, 'results.json'))}`);
