import { describe, expect, it } from 'vitest';
import { defaultSnapshot, executeTest } from '../src/runner/executor.js';
import type { AgentBrain } from '../src/llm/brain.js';
import type { PageLike } from '../src/runner/actions.js';

/**
 * Throwaway verification (not part of the repo, deleted after the run): proves
 * DEF-003's two new tests in tests/auth.test.ts are genuinely regression tests,
 * not vacuously-passing ones, by reconstructing the *old* buggy shape of
 * `fromSteps` — eagerly defaulting `snapshot` to `defaultSnapshot` with no
 * `maxSnapshotLines` threaded through — using only real, unmodified, exported
 * pieces (`defaultSnapshot`, `executeTest`) from src/runner/executor.js. No file
 * under src/** or tests/** is edited to run this.
 */

function fakeSnapshotPage(rawYaml: string): PageLike {
  return {
    async goto() {
      return undefined;
    },
    getByRole: () => ({}) as never,
    getByLabel: () => ({}) as never,
    getByText: () => ({}) as never,
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => 'http://localhost:4173/login',
    locator: () => ({ ariaSnapshot: async () => rawYaml }),
  } as unknown as PageLike;
}

const rawYaml = Array.from({ length: 50 }, (_, i) => `- text "line ${i}"`).join('\n');

describe('DEF-003 regression sensitivity (throwaway, not part of the repo)', () => {
  it('the login-journey-snapshot test would fail against the old bypass shape', async () => {
    const page = fakeSnapshotPage(rawYaml);
    let seenSnapshot = '';
    const brain: AgentBrain = {
      async nextAction(input) {
        seenSnapshot = input.snapshot;
        return { action: 'done', reasoning: 'ok' };
      },
      async judge() {
        return { pass: true, reason: 'n/a' };
      },
    };

    // OLD auth.ts shape: `snapshot = defaultSnapshot` (options.snapshot ?? defaultSnapshot),
    // eagerly bound with no maxSnapshotLines threaded through, before executeTest's
    // own cap-aware fallback ever gets a chance to run.
    const oldShapeSnapshot = defaultSnapshot; // no cap threaded, as the old bug did

    await executeTest(
      page,
      {
        path: '<auth>',
        summary: 'authentication',
        steps: ['check something'],
        priority: 'P0',
        tags: [],
        routes: [],
        auth: false,
      },
      {
        brain,
        sessionDir: '/tmp/does-not-matter',
        baseUrl: 'http://localhost:4173',
        timeoutMs: 30_000,
        snapshot: oldShapeSnapshot,
        // maxSnapshotLines intentionally NOT passed — mirrors the old bug: it
        // never reached the page render because `snapshot` was already bound.
      },
    );

    // Same assertion the real DEF-003 test makes. Against the old shape it fails:
    // no truncation marker appears because the cap was bypassed entirely.
    expect(seenSnapshot).not.toContain('truncated after 10 lines');
    expect(seenSnapshot.split('\n').length).toBeGreaterThan(10);
  });

  it('the auth.verify judge-call test would fail against the old bypass shape', async () => {
    const page = fakeSnapshotPage(rawYaml);

    // OLD auth.ts shape at the verify call site: `await snapshot(page)` where
    // `snapshot` was eagerly bound to plain `defaultSnapshot`, uncapped.
    const oldShapeSnapshot = defaultSnapshot;
    const judgeSnapshot = await oldShapeSnapshot(page);

    expect(judgeSnapshot).not.toContain('truncated after 10 lines');
    expect(judgeSnapshot.split('\n').length).toBeGreaterThan(10);
  });
});
