/**
 * `npm run eval:judge` — replays the judge regression corpus through the real
 * judge (design ask-the-judge-about-the-step, D4).
 *
 * Needs a model and a key, so it is not part of CI. It runs before a change to
 * the judge merges, as the dogfood suite runs before a release. The model comes
 * from `.blastproof/config.yaml` and the usual `BLASTPROOF_*` overrides, exactly
 * as `blastproof run` resolves it.
 *
 * Exit 1 when a case not marked `knownFailing` is judged wrong in any sample.
 */
import { loadConfig } from '../../src/config.js';
import { createBrain } from '../../src/llm/brain.js';
import { createModel } from '../../src/llm/provider.js';
import { RunBudget } from '../../src/runner/budget.js';
import { loadCorpus, runCorpus } from './corpus.js';

const samples = Number(process.env.EVAL_SAMPLES ?? 3);
const config = await loadConfig(process.cwd());
const { model, provider, modelId } = createModel(config.llm);
const brain = createBrain(model, undefined, new RunBudget());
const cases = loadCorpus();

console.log(`judge corpus: ${cases.length} case(s) x ${samples} sample(s), provider=${provider} model=${modelId}\n`);
const outcome = await runCorpus(cases, (s, e, snap, h) => brain.judge(s, e, snap, h), samples);

for (const r of outcome.results) {
  const mark = r.right === r.samples ? 'ok  ' : r.case.knownFailing ? 'xfail' : 'FAIL';
  const known = r.case.knownFailing ? ` (known: ${r.case.knownFailing})` : '';
  console.log(`${mark} ${r.case.incident.padEnd(5)} ${r.case.id.padEnd(46)} ${r.case.verdict} ${r.right}/${r.samples}${known}`);
  if (r.right < r.samples && r.wrongReason) console.log(`        judge: ${r.wrongReason.slice(0, 220)}`);
}

for (const r of outcome.nowPassing) {
  console.log(`\nnow passing: ${r.case.id} is marked knownFailing ${r.case.knownFailing} and was judged right ${r.right}/${r.samples}. Remove the marker.`);
}
if (outcome.regressions.length > 0) {
  console.error(`\n${outcome.regressions.length} case(s) not marked knownFailing were judged wrong:`);
  for (const r of outcome.regressions) console.error(`  ${r.case.file}: ${r.case.id}`);
  process.exit(1);
}
console.log('\nno regression');
