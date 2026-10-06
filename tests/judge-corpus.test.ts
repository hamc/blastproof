import { describe, expect, it } from 'vitest';
import { loadCorpus, runCorpus, runCorpusOnModels, wrongOn, type JudgeCase } from '../evals/judge/corpus.js';
import { evalModels } from '../evals/judge/models.js';
import { ProviderRefusedError } from '../src/runner/budget.js';

// The replay needs a model and a key, so it is not run here (design
// ask-the-judge-about-the-step, D4). What is checked here is that the corpus
// cannot rot in CI: every file parses, every case says where it came from, and
// no case carries a value it should only ever hold as a label.
const cases = loadCorpus();

describe('the judge regression corpus', () => {
  it('loads, with at least one case per incident it was built from', () => {
    const incidents = new Set(cases.map((c) => c.incident));
    for (const incident of ['#31', '#35', '#87', '#112', '#120', '#121', '#141']) {
      expect(incidents).toContain(incident);
    }
  });

  it('gives every case a unique id', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites the archived design for every reconstructed case that came from one', () => {
    for (const c of cases.filter((x) => x.provenance.kind === 'reconstructed')) {
      // Rebuilt either from an archived design or from a live capture of the
      // demo app: both are named, so a reader can check the source.
      expect(c.provenance.source).toMatch(/openspec\/changes\/archive\/|examples\/demo-app/);
    }
  });

  it('holds masked text only: no email address and no value used to capture it', () => {
    // The values set in the environment while the cases were captured. Each
    // must appear only as its label; a case holding one is a leak in a file
    // meant to be committed.
    const captureValues = ['admin@juice-sh.op', 'admin123', 'jim@juice-sh.op', 'HUNTER2', 'SAVE99', 'demo123'];
    for (const c of cases) {
      const text = JSON.stringify(c);
      expect(text, c.id).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      for (const value of captureValues) expect(text.toLowerCase(), c.id).not.toContain(value.toLowerCase());
    }
  });
});

describe('runCorpus', () => {
  const pass: JudgeCase = { ...cases[0]!, id: 'p', verdict: 'PASS', knownFailing: undefined };
  const fail: JudgeCase = { ...cases[0]!, id: 'f', verdict: 'FAIL', knownFailing: undefined };
  const known: JudgeCase = { ...cases[0]!, id: 'k', verdict: 'FAIL', knownFailing: '#120' };
  const always = (pass: boolean) => async () => ({ pass, reason: 'stub' });

  it('reports a case not marked knownFailing that is judged wrong as a regression', async () => {
    const outcome = await runCorpus([pass, fail], always(true), 2);
    expect(outcome.regressions.map((r) => r.case.id)).toEqual(['f']);
  });

  it('does not count a knownFailing case as a regression, and reports it when it starts passing', async () => {
    const wrong = await runCorpus([known], always(true), 2);
    expect(wrong.regressions).toEqual([]);
    expect(wrong.nowPassing).toEqual([]);

    const fixed = await runCorpus([known], always(false), 2);
    expect(fixed.nowPassing.map((r) => r.case.id)).toEqual(['k']);
  });

  it('counts a case right only when every sample is', async () => {
    let n = 0;
    const flaky = async () => ({ pass: n++ % 2 === 0, reason: 'stub' });
    const outcome = await runCorpus([pass], flaky, 2);
    expect(outcome.results[0]!.right).toBe(1);
    expect(outcome.regressions).toHaveLength(1);
  });
});

describe('an unusable answer (replay-the-judge-corpus-on-two-models, D4)', () => {
  const pass: JudgeCase = { ...cases[0]!, id: 'p', verdict: 'PASS', knownFailing: undefined };
  const other: JudgeCase = { ...cases[0]!, id: 'q', verdict: 'PASS', knownFailing: undefined };

  it('is a wrong sample with the error as its reason, and the replay goes on', async () => {
    // Seen with a model whose answer ran to 65536 tokens without closing its
    // JSON: the replay crashed and no later case was judged.
    let n = 0;
    const judge = async () => {
      if (n++ === 0) throw new Error('No object generated: could not parse the response.');
      return { pass: true, reason: 'stub' };
    };
    const outcome = await runCorpus([pass, other], judge, 2);
    expect(outcome.results.map((r) => r.right)).toEqual([1, 2]);
    expect(outcome.results[0]!.wrongReason).toBe('error: No object generated: could not parse the response.');
  });

  it('still ends the replay on a stop of the run', async () => {
    const judge = async (): Promise<never> => {
      throw new ProviderRefusedError(402, 'no credit');
    };
    await expect(runCorpus([pass], judge, 1)).rejects.toThrow(ProviderRefusedError);
  });
});

describe('replaying on several models (replay-the-judge-corpus-on-two-models, D1, D3)', () => {
  const pass: JudgeCase = { ...cases[0]!, id: 'p', verdict: 'PASS', knownFailing: undefined };
  const known: JudgeCase = { ...cases[0]!, id: 'k', verdict: 'PASS', knownFailing: '#129' };
  const always = (verdict: boolean) => async () => ({ pass: verdict, reason: 'stub' });

  it('is a regression when an unmarked case is wrong on any model, naming that model', async () => {
    const outcome = await runCorpusOnModels(
      [pass],
      [
        { model: 'a', judge: always(true) },
        { model: 'b', judge: always(false) },
      ],
      2,
    );
    expect(outcome.regressions.map((r) => r.case.id)).toEqual(['p']);
    expect(wrongOn(outcome.regressions[0]!)).toEqual(['b']);
  });

  it('reports a known failure as fixed only when every model gets it right', async () => {
    // #129: right on one model of the reference pair, wrong on the default.
    const split = await runCorpusOnModels(
      [known],
      [
        { model: 'default', judge: always(false) },
        { model: 'other', judge: always(true) },
      ],
      2,
    );
    expect(split.nowPassing).toEqual([]);
    expect(split.regressions).toEqual([]);
    expect(wrongOn(split.results[0]!)).toEqual(['default']);

    const fixed = await runCorpusOnModels(
      [known],
      [
        { model: 'default', judge: always(true) },
        { model: 'other', judge: always(true) },
      ],
      2,
    );
    expect(fixed.nowPassing.map((r) => r.case.id)).toEqual(['k']);
  });

  it('keeps each case\'s results in the order the models were given', async () => {
    const outcome = await runCorpusOnModels(
      [pass],
      [
        { model: 'first', judge: always(true) },
        { model: 'second', judge: always(false) },
      ],
      1,
    );
    expect(outcome.models).toEqual(['first', 'second']);
    expect(outcome.results[0]!.perModel.map((m) => [m.model, m.result.right])).toEqual([
      ['first', 1],
      ['second', 0],
    ]);
  });

  it('reads EVAL_MODELS, and falls back to the configured model', () => {
    expect(evalModels(undefined, 'configured')).toEqual(['configured']);
    expect(evalModels('  ', 'configured')).toEqual(['configured']);
    expect(evalModels('anthropic/claude-haiku-4.5, openai/gpt-6-luna,', 'configured')).toEqual([
      'anthropic/claude-haiku-4.5',
      'openai/gpt-6-luna',
    ]);
    expect(evalModels('a,a,b', 'configured')).toEqual(['a', 'b']);
  });
});

describe('a case carries the secrets used before its step (a-secret-used-earlier-in-the-test-counts, D3)', () => {
  it('hands them to the judgment', async () => {
    const c = cases.find((x) => x.id === '141-already-signed-in')!;
    let seen: readonly string[] | undefined;
    await runCorpus([c], async (_s, _e, _n, _h, usedEarlier) => {
      seen = usedEarlier;
      return { pass: true, reason: 'stub' };
    }, 1);
    expect(seen).toEqual(['DEMO_EMAIL', 'DEMO_PASSWORD']);
  });
});
