import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadReplay,
  refOf,
  replayedDecision,
  replayFile,
  replaySummary,
  saveReplay,
  stepKey,
  stepsToSave,
  type SavedStep,
} from '../src/runner/replay.js';
import type { SnapshotElement } from '../src/runner/snapshot.js';

const refs = (...elements: Array<[string, SnapshotElement]>): Map<string, SnapshotElement> => new Map(elements);

const step = (key: string, name = 'Add note'): SavedStep => ({
  key,
  actions: [{ action: 'click', role: 'button', name, changed: true }],
  close: { by: 'done' },
});

describe('finding a saved element again (design D3)', () => {
  const saved = { action: 'click', role: 'button', name: 'Add note', changed: true };

  it('gives the ref of the one element of that role and name', () => {
    const page = refs(['e1', { role: 'textbox', name: 'Add note' }], ['e2', { role: 'button', name: 'Add note' }]);
    expect(refOf(saved, page)).toBe('e2');
  });

  it('compares the name as a target is bound: case and whitespace aside', () => {
    expect(refOf(saved, refs(['e7', { role: 'button', name: '  add   NOTE ' }]))).toBe('e7');
  });

  it('reads the line text of an element with no name', () => {
    expect(refOf(saved, refs(['e3', { role: 'button', text: 'Add note' }]))).toBe('e3');
  });

  it('gives nothing when the element is gone', () => {
    expect(refOf(saved, refs(['e1', { role: 'button', name: 'Save note' }]))).toBeUndefined();
  });

  it('never chooses between two elements of the same name', () => {
    const page = refs(['e1', { role: 'button', name: 'Add note' }], ['e2', { role: 'button', name: 'Add note' }]);
    expect(refOf(saved, page)).toBeUndefined();
    expect(replayedDecision(step('k'), 0, page)).toBeUndefined();
  });
});

describe('the next decision of a saved step', () => {
  const page = refs(['e2', { role: 'button', name: 'Add note' }]);

  it('is the saved action on the fresh ref', () => {
    expect(replayedDecision(step('k'), 0, page)).toMatchObject({
      action: 'click',
      target: { ref: 'e2', role: 'button', name: 'Add note' },
    });
  });

  it('is the close once the actions are done', () => {
    expect(replayedDecision(step('k'), 1, page)).toMatchObject({ action: 'done' });
    const judged: SavedStep = { ...step('k'), close: { by: 'judgment', claim: 'the note is listed' } };
    expect(replayedDecision(judged, 1, page)).toMatchObject({ action: 'assert', expectation: 'the note is listed' });
  });

  it('replays an action with no target with no target', () => {
    const press: SavedStep = { key: 'k', actions: [{ action: 'press', value: 'Escape', changed: false }], close: { by: 'done' } };
    const decision = replayedDecision(press, 0, refs());
    expect(decision).toMatchObject({ action: 'press', value: 'Escape' });
    expect(decision!.target).toBeUndefined();
  });
});

describe('a step key (design D2)', () => {
  it('changes with the position, the step as written and the step as judged', () => {
    const key = stepKey(0, false, 'add the note', 'add the note');
    expect(stepKey(0, false, 'add the note', 'add the note')).toBe(key);
    expect(stepKey(1, false, 'add the note', 'add the note')).not.toBe(key);
    expect(stepKey(0, true, 'add the note', 'add the note')).not.toBe(key);
    expect(stepKey(0, false, 'add a note', 'add the note')).not.toBe(key);
    expect(stepKey(0, false, 'add the note', 'add the note and verify it')).not.toBe(key);
  });
});

describe('what a test saves after a run (design D6)', () => {
  it('saves the steps of the run when the test passed', () => {
    expect(stepsToSave(true, [step('old')], { steps: [step('new')], ended: [] })).toEqual([step('new')]);
  });

  it('keeps what a failed test had, minus the steps whose replay ended', () => {
    const before = [step('a'), step('b'), step('c')];
    expect(stepsToSave(false, before, { steps: [step('a')], ended: ['b'] })).toEqual([step('a'), step('c')]);
  });
});

describe('the saved file (design D7)', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'blastproof-replay-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('is one file per test under .blastproof/cache, unique by path', () => {
    const a = replayFile(cwd, path.join(cwd, '.blastproof/tests/notes.yaml'));
    const b = replayFile(cwd, path.join(cwd, '.blastproof/tests/admin/notes.yaml'));
    expect(path.relative(cwd, a)).toMatch(/^\.blastproof[/\\]cache[/\\]replay[/\\]notes-[0-9a-f]{12}\.json$/);
    expect(a).not.toBe(b);
  });

  it('reads back what it wrote, and leaves no temporary file', async () => {
    const file = replayFile(cwd, path.join(cwd, 'notes.yaml'));
    await saveReplay(file, undefined, [step('k')]);
    expect(await loadReplay(file, undefined)).toEqual([step('k')]);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('treats a missing, corrupt or older-format file as nothing saved', async () => {
    const file = replayFile(cwd, path.join(cwd, 'notes.yaml'));
    expect(await loadReplay(file, undefined)).toEqual([]);
    await saveReplay(file, undefined, [step('k')]);
    await writeFile(file, '{ not json', 'utf8');
    expect(await loadReplay(file, undefined)).toEqual([]);
    await writeFile(file, JSON.stringify({ version: 0, steps: [step('k')] }), 'utf8');
    expect(await loadReplay(file, undefined)).toEqual([]);
  });

  it('drops a malformed step and keeps the rest', async () => {
    const file = replayFile(cwd, path.join(cwd, 'notes.yaml'));
    await saveReplay(file, undefined, [step('k')]);
    const body = JSON.parse(await readFile(file, 'utf8'));
    body.steps.push({ key: 'bad', actions: 'none' });
    await writeFile(file, JSON.stringify(body), 'utf8');
    expect(await loadReplay(file, undefined)).toEqual([step('k')]);
  });

  it('does not replay what was saved as another device', async () => {
    const file = replayFile(cwd, path.join(cwd, 'notes.yaml'));
    await saveReplay(file, 'Pixel 7', [step('k')]);
    expect(await loadReplay(file, 'Pixel 7')).toEqual([step('k')]);
    expect(await loadReplay(file, undefined)).toEqual([]);
    expect(await loadReplay(file, 'iPhone 15')).toEqual([]);
  });
});

describe('the summary line (design D9)', () => {
  it('counts a healed step among those the model resolved', () => {
    const decided = [...Array(21).fill('replayed'), 'model', 'healed'];
    expect(replaySummary(decided)).toBe('Replay: 21 steps replayed, 2 resolved by the model (1 healed)');
  });

  it('says one step, and leaves the healed count out when there is none', () => {
    expect(replaySummary(['replayed', 'model'])).toBe('Replay: 1 step replayed, 1 resolved by the model');
  });
});
