/**
 * `npm run eval:judge` — replays the judge regression corpus through the real
 * judge (design ask-the-judge-about-the-step, D4).
 *
 * Needs a model and a key, so it is not part of CI. It runs before a change to
 * the judge merges, as the dogfood suite runs before a release. The model comes
 * from `.blastproof/config.yaml` and the usual `BLASTPROOF_*` overrides, exactly
 * as `blastproof run` resolves it.
 *
 * `EVAL_MODELS` replays on several models through that same provider (design
 * replay-the-judge-corpus-on-two-models, D1). The reference pair, which a judge
 * change must pass on, is in CONTRIBUTING.md.
 *
 * Exit 1 when a case not marked `knownFailing` is judged wrong in any sample on
 * any model.
 */
import { loadConfig } from '../../src/config.js';
import { createBrain } from '../../src/llm/brain.js';
import { createModel } from '../../src/llm/provider.js';
import { RunBudget } from '../../src/runner/budget.js';
import { evalModels } from './models.js';
import { loadCorpus, runCorpusOnModels, wrongOn } from './corpus.js';

const samples = Number(process.env.EVAL_SAMPLES ?? 3);
const config = await loadConfig(process.cwd());
const configured = createModel(config.llm);
const models = evalModels(process.env.EVAL_MODELS, configured.modelId);
const judges = models.map((model) => {
  const brain = createBrain(createModel({ ...config.llm, model }).model, undefined, new RunBudget());
  return { model, judge: brain.judge.bind(brain) };
});
const cases = loadCorpus();

console.log(
  `judge corpus: ${cases.length} case(s) x ${samples} sample(s), provider=${configured.provider} ` +
    `model(s)=${models.join(', ')}\n`,
);
const outcome = await runCorpusOnModels(cases, judges, samples);

for (const entry of outcome.results) {
  const wrong = wrongOn(entry);
  const mark = wrong.length === 0 ? 'ok  ' : entry.case.knownFailing ? 'xfail' : 'FAIL';
  const scores = entry.perModel.map(({ result }) => `${result.right}/${result.samples}`).join(' ');
  const known = entry.case.knownFailing ? ` (known: ${entry.case.knownFailing})` : '';
  console.log(`${mark} ${entry.case.incident.padEnd(5)} ${entry.case.id.padEnd(46)} ${entry.case.verdict} ${scores}${known}`);
  for (const { model, result } of entry.perModel) {
    if (result.right < result.samples && result.wrongReason) {
      console.log(`        ${model}: ${result.wrongReason.slice(0, 220)}`);
    }
  }
}

for (const entry of outcome.nowPassing) {
  console.log(
    `\nnow passing: ${entry.case.id} is marked knownFailing ${entry.case.knownFailing} and was judged right ` +
      `on every model. Remove the marker.`,
  );
}
if (outcome.regressions.length > 0) {
  console.error(`\n${outcome.regressions.length} case(s) not marked knownFailing were judged wrong:`);
  for (const entry of outcome.regressions) {
    console.error(`  ${entry.case.file}: ${entry.case.id} (wrong on ${wrongOn(entry).join(', ')})`);
  }
  process.exit(1);
}
console.log('\nno regression');
