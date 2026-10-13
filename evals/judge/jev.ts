/**
 * Replays the judge corpus through Jev, TypeSafe AI's decision model, to measure
 * whether it could judge a step (docs/model-evaluations/jev.md).
 *
 * Jev returns no text, so it cannot be a `judge()`: its answer is one `noul`
 * question (the probability of "yes") asked with the judge's own system prompt as
 * the instructions and the judge's own user prompt as the state. A probability of
 * 0.5 or more counts as PASS.
 *
 * `OPENROUTER_API_KEY` is required. `JEV_MODEL` defaults to `typesafe/jev-1.13`,
 * `EVAL_SAMPLES` to 3. Not part of CI.
 */
import { assertSystemPrompt, assertUserPrompt } from '../../src/llm/prompts.js';
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
  let state = assertUserPrompt(c.step, c.expectation, c.snapshot, c.history);
  if (c.usedEarlier?.length) {
    state += `\n\nVariables typed in earlier steps of this test: ${c.usedEarlier.join(', ')}`;
  }
  const yes: number[] = [];
  for (let i = 0; i < samples; i++) {
    const answer = await ask(state);
    cost += answer.usage?.cost ?? 0;
    snapshot = answer.model;
    yes.push(answer.answers.pass.noul);
  }
  const ok = yes.filter((p) => p >= 0.5 === (c.verdict === 'PASS')).length;
  if (ok === samples) right++;
  if (c.verdict === 'FAIL') {
    falsePass.of++;
    if (ok < samples) falsePass.cases++;
  }
  const mark = ok === samples ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${c.incident.padEnd(5)} ${c.id.padEnd(42)} ${c.verdict} ${ok}/${samples}  p(yes) ${yes.map((p) => p.toFixed(2)).join(' ')}`);
}
console.log(
  `\n${snapshot}: ${right}/${cases.length} cases right in every sample; ` +
    `false PASS on ${falsePass.cases} of ${falsePass.of} FAIL cases; cost $${cost.toFixed(5)}`,
);
