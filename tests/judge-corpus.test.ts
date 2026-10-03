import { describe, expect, it } from 'vitest';
import { loadCorpus, runCorpus, type JudgeCase } from '../evals/judge/corpus.js';

// The replay needs a model and a key, so it is not run here (design
// ask-the-judge-about-the-step, D4). What is checked here is that the corpus
// cannot rot in CI: every file parses, every case says where it came from, and
// no case carries a value it should only ever hold as a label.
const cases = loadCorpus();

describe('the judge regression corpus', () => {
  it('loads, with at least one case per incident it was built from', () => {
    const incidents = new Set(cases.map((c) => c.incident));
    for (const incident of ['#31', '#35', '#87', '#112', '#120', '#121']) {
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
