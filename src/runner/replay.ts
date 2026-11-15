import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAction } from '../llm/schemas.js';
import type { SnapshotElement } from './snapshot.js';

/**
 * The actions of a passing step, saved so the next run can perform them without
 * asking the model (design replay-the-actions-of-a-passing-step).
 *
 * Nothing here is a selector: a target is the role and the name its snapshot
 * line showed, the two things `bindTarget` already compares. A ref is never
 * saved, since a ref is valid for one snapshot only.
 */

/** Bumped when the saved form changes; a file of another version is nothing saved. */
export const REPLAY_VERSION = 1;

/** One successful action of a step, as the next run needs it (design D2). */
export interface SavedAction {
  action: string;
  /** Absent for an action with no target: a navigate, or a press of the focused element. */
  role?: string;
  /** The accessible name the snapshot showed, or the line's text when it had none. */
  name?: string;
  /** As written, before `{{env.*}}` is resolved. */
  value?: string;
  /** Whether the page differed after it, refs aside. */
  changed: boolean;
}

/** How the step closed: on `done`, or on a judgment that passed this claim. */
export type SavedClose = { by: 'done' } | { by: 'judgment'; claim: string };

export interface SavedStep {
  key: string;
  actions: SavedAction[];
  close: SavedClose;
}

export interface SavedTest {
  version: number;
  device?: string;
  steps: SavedStep[];
}

/** What a test's run hands back for saving (design D6). */
export interface ReplayOutcome {
  /** The steps that passed in this run, as performed in this run. */
  steps: SavedStep[];
  /** Keys of the steps whose replay ended; never replayed again. */
  ended: string[];
}

/** How a step was decided (design D9). */
export type DecidedBy = 'replayed' | 'model' | 'healed';

/**
 * A step's key: its position, its text as written and its text as judged, so
 * editing the step or the check judged with it drops the entry (design D2).
 */
export function stepKey(index: number, setup: boolean, written: string, judged: string): string {
  return createHash('sha256')
    .update(JSON.stringify([index, setup, written, judged]))
    .digest('hex')
    .slice(0, 32);
}

/** Compared as `bindTarget` compares a name: case and runs of whitespace aside. */
function normalise(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The ref a saved target has in a fresh snapshot: the one element of that role
 * and name, or `undefined` when there is none or more than one (design D3).
 * Several matches are never told apart by position: that is the first hit the
 * refs removed (#60, #132).
 */
export function refOf(saved: SavedAction, refs: ReadonlyMap<string, SnapshotElement>): string | undefined {
  let found: string | undefined;
  for (const [ref, element] of refs) {
    if (normalise(element.role) !== normalise(saved.role)) continue;
    if (normalise(element.name ?? element.text) !== normalise(saved.name)) continue;
    if (found !== undefined) return undefined;
    found = ref;
  }
  return found;
}

const REPLAYED = 'replayed from the last passing run';

/**
 * The step's next decision from its saved entry, or `undefined` when a saved
 * target cannot be found again. Past the last action it is the step's close.
 */
export function replayedDecision(
  entry: SavedStep,
  at: number,
  refs: ReadonlyMap<string, SnapshotElement>,
): AgentAction | undefined {
  const saved = entry.actions[at];
  if (saved === undefined) {
    return entry.close.by === 'done'
      ? { action: 'done', reasoning: REPLAYED }
      : { action: 'assert', expectation: entry.close.claim, reasoning: REPLAYED };
  }
  const action = saved.action as AgentAction['action'];
  if (saved.role === undefined) return { action, value: saved.value, reasoning: REPLAYED };
  const ref = refOf(saved, refs);
  if (ref === undefined) return undefined;
  const element = refs.get(ref)!;
  return {
    action,
    target: { ref, role: element.role, name: element.name ?? element.text },
    value: saved.value,
    reasoning: REPLAYED,
  };
}

/** `.blastproof/cache/replay/` under the project (design D7). */
export function replayDir(cwd: string): string {
  return path.join(cwd, '.blastproof', 'cache', 'replay');
}

/** One file per test, named for a person and made unique by the test's path. */
export function replayFile(cwd: string, testPath: string): string {
  const relative = path.relative(cwd, testPath).split(path.sep).join('/');
  const stem = path
    .basename(testPath)
    .replace(/\.ya?ml$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 60);
  const hash = createHash('sha256').update(relative).digest('hex').slice(0, 12);
  return path.join(replayDir(cwd), `${stem}-${hash}.json`);
}

/** A field left out, or a string: a file edited by hand must not reach the loop as another type. */
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

function isSavedAction(value: unknown): value is SavedAction {
  if (typeof value !== 'object' || value === null) return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.action === 'string' &&
    typeof action.changed === 'boolean' &&
    optionalString(action.role) &&
    optionalString(action.name) &&
    optionalString(action.value)
  );
}

function isSavedStep(value: unknown): value is SavedStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  const close = step.close as Record<string, unknown> | undefined;
  return (
    typeof step.key === 'string' &&
    Array.isArray(step.actions) &&
    step.actions.every(isSavedAction) &&
    typeof close === 'object' &&
    close !== null &&
    (close.by === 'done' || (close.by === 'judgment' && typeof close.claim === 'string'))
  );
}

/**
 * A test's saved steps, or none. A missing, unreadable, malformed or
 * older-format file, or one saved as another device, is nothing saved and
 * never an error: the directory is safe to delete (design D7).
 */
export async function loadReplay(file: string, device: string | undefined): Promise<SavedStep[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SavedTest>;
    if (parsed.version !== REPLAY_VERSION || !Array.isArray(parsed.steps)) return [];
    if ((parsed.device ?? undefined) !== device) return [];
    return parsed.steps.filter(isSavedStep);
  } catch {
    return [];
  }
}

/**
 * What a test's file holds after a run (design D6). A passing test saves the
 * steps of that run. A failed one saves nothing new and keeps what it had,
 * minus every step whose replay ended; `undefined` is a file left as it is.
 */
export function stepsToSave(passed: boolean, before: SavedStep[], outcome: ReplayOutcome): SavedStep[] | undefined {
  if (passed) return outcome.steps;
  // Nothing ended, so the file already says this. Not rewriting it also keeps
  // what another device saved, which was read as nothing, from being emptied.
  if (outcome.ended.length === 0) return undefined;
  const ended = new Set(outcome.ended);
  return before.filter((step) => !ended.has(step.key));
}

/** Written by a temporary file and a rename, so a reader never sees half a file. */
export async function saveReplay(file: string, device: string | undefined, steps: SavedStep[]): Promise<void> {
  const body: SavedTest = { version: REPLAY_VERSION, ...(device ? { device } : {}), steps };
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

/** `Replay: 21 steps replayed, 2 resolved by the model (1 healed)`. */
export function replaySummary(decided: Array<DecidedBy | undefined>): string {
  const replayed = decided.filter((d) => d === 'replayed').length;
  const healed = decided.filter((d) => d === 'healed').length;
  const model = decided.filter((d) => d === 'model').length + healed;
  const steps = (n: number): string => `${n} ${n === 1 ? 'step' : 'steps'}`;
  return `Replay: ${steps(replayed)} replayed, ${model} resolved by the model${healed > 0 ? ` (${healed} healed)` : ''}`;
}
