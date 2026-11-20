// Reads a run's JUnit replay counters, writes them to the job summary, and
// fails the job when they show replay did not do what the run expects
// (openspec change dogfood-replays-what-passed, design D3).
//
//   node .github/scripts/replay-check.mjs cold junit-cold.xml
//   node .github/scripts/replay-check.mjs warm junit-warm.xml
//
// cold: nothing was saved before the run, so no step may have been replayed;
//       one that was means a cache from somewhere else reached the run.
// warm: at least half the steps the counters cover were replayed. Below that,
//       replay stopped working while the score, which the model keeps at 100,
//       says nothing. Missing counters count as nothing replayed.
import { appendFileSync, readFileSync } from 'node:fs';

const FLOOR = 0.5;
const [mode, file] = process.argv.slice(2);
if ((mode !== 'cold' && mode !== 'warm') || !file) {
  console.error('usage: replay-check.mjs cold|warm <junit.xml>');
  process.exit(2);
}

const xml = readFileSync(file, 'utf8');
const counter = (name) => {
  const match = xml.match(new RegExp(`<property name="${name}" value="(\\d+)"/>`));
  return match ? Number(match[1]) : 0;
};
const replayed = counter('replayed_steps');
const model = counter('model_steps');
const healed = counter('healed_steps');

const label = mode === 'cold' ? 'Cold run' : 'Warm run';
const line = `${label}: ${replayed} steps replayed, ${model} resolved by the model (${healed} healed)`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);

let failure;
if (mode === 'cold' && replayed > 0) {
  failure = `the cold run replayed ${replayed} steps, so something was saved before it started`;
} else if (mode === 'warm') {
  const covered = replayed + model;
  if (covered === 0 || replayed / covered < FLOOR) {
    failure = `the warm run replayed ${replayed} of ${covered} steps, below half: replay did not work`;
  }
}
if (failure) {
  console.log(`::error::${failure}`);
  process.exit(1);
}
