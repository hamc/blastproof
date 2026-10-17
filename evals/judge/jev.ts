/**
 * Replays the judge corpus through a decision model (Jev, TypeSafe AI's, by
 * default), to measure whether it could judge a step
 * (docs/model-evaluations/decision-models.md).
 *
 * Jev returns no text, so it cannot be a `judge()`: its answer is one `noul`
 * question (the probability of "yes") asked with the judge's own system prompt as
 * the instructions and the judge's own user prompt as the state. A probability of
 * 0.5 or more counts as PASS.
 *
 * It gets what `judge()` gives the LLM and keeps what `judge()` does after it: the
 * step, the claim and the record with every `{{env.NAME}}` rewritten as
 * `[redacted NAME]`, and `secretMismatch` over the verdict. The first version of
 * this script did neither, and measured Jev on a step and a page in two
 * vocabularies, without the check every LLM verdict gets: 6 false PASSes that the
 * judge would not have given (#174).
 *
 * `OPENROUTER_API_KEY` is required. `JEV_MODEL` defaults to `typesafe/jev-1.13`
 * and takes any model on OpenRouter's Decisions API, such as `liquid/d1-ultra`;
 * `EVAL_SAMPLES` to 3. Not part of CI.
 */
import { assertSystemPrompt, assertUserPrompt } from '../../src/llm/prompts.js';
import { secretMismatch } from '../../src/llm/brain.js';
import { placeholdersAsLabels } from '../../src/runner/env.js';
import { loadCorpus } from './corpus.js';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const model = process.env.JEV_MODEL ?? 'typesafe/jev-1.13';
const samples = Number(process.env.EVAL_SAMPLES ?? 3);
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is not set. Export your OpenRouter key and run again.');
  process.exit(1);
}

const system = assertSystemPrompt();
const instructions = system.slice(0, system.indexOf('Answer with pass=true/false')).trim();
const criteria = {
  true: 'The snapshot shows the state the step asks for. Every value the step names appears where the step places it, committed (not only typed into an open, unsubmitted field). An outcome that is an absence is shown by the thing being absent.',
  false: 'Some part of the outcome the step asks for is not shown, or cannot be assessed from this snapshot: a value is missing or different, appears only somewhere else on the page, or only inside an unsubmitted control, or the claim is true of something other than what the step asks.',
};

interface DecisionResponse {
  model: string;
  answers: { pass: { noul: number } };
  usage?: { cost?: number };
}

async function ask(state: string): Promise<DecisionResponse> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state, questions: { pass: { type: 'noul', instructions, criteria } } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as DecisionResponse;
}

const cases = loadCorpus();
let cost = 0;
let snapshot = '';
let right = 0;
const falsePass = { cases: 0, of: 0 };
console.log(`judge corpus on ${model}: ${cases.length} case(s) x ${samples} sample(s)\n`);
for (const c of cases) {
  const step = placeholdersAsLabels(c.step);
  const history = c.history?.map((e) => ({
    action: placeholdersAsLabels(e.action),
    result: placeholdersAsLabels(e.result),
  }));
  let state = assertUserPrompt(step, placeholdersAsLabels(c.expectation), c.snapshot, history);
  if (c.usedEarlier?.length) {
    state += `\n\nVariables typed in earlier steps of this test: ${c.usedEarlier.join(', ')}`;
  }
  const yes: number[] = [];
  const passes: boolean[] = [];
  let checked = false;
  for (let i = 0; i < samples; i++) {
    const answer = await ask(state);
    cost += answer.usage?.cost ?? 0;
    snapshot = answer.model;
    const p = answer.answers.pass.noul;
    yes.push(p);
    const verdict = secretMismatch(step, c.snapshot, history, c.usedEarlier ?? [], { pass: p >= 0.5, reason: '' });
    if (verdict.pass !== p >= 0.5) checked = true;
    passes.push(verdict.pass);
  }
  const ok = passes.filter((pass) => pass === (c.verdict === 'PASS')).length;
  if (ok === samples) right++;
  if (c.verdict === 'FAIL') {
    falsePass.of++;
    if (ok < samples) falsePass.cases++;
  }
  const mark = ok === samples ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${c.incident.padEnd(5)} ${c.id.padEnd(42)} ${c.verdict} ${ok}/${samples}  p(yes) ${yes.map((p) => p.toFixed(2)).join(' ')}${checked ? '  (failed by the label check)' : ''}`);
}
console.log(
  `\n${snapshot}: ${right}/${cases.length} cases right in every sample; ` +
    `false PASS on ${falsePass.cases} of ${falsePass.of} FAIL cases; cost $${cost.toFixed(5)}`,
);
