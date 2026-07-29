import { describe, expect, it, vi } from 'vitest';

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

import { runPreflight } from '../src/preflight.js';
import type { PreflightConfig } from '../src/preflight.js';

const CONFIG: PreflightConfig = {
  base_url: 'http://localhost:4173',
  llm: { provider: 'anthropic' },
  browser: { headless: true, timeout_ms: 30_000 },
};

describe('runPreflight', () => {
  it('is silent (no failures) and performs no I/O when nothing applies — a dry run', async () => {
    const fetchMock = vi.fn();

    const result = await runPreflight(
      { browser: false, model: false, baseUrl: false },
      CONFIG,
      fetchMock,
    );

    expect(result.ok).toBe(true);
    expect(launchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes silently when every check succeeds, and hands back the launched browser', async () => {
    const browser = { close: vi.fn() };
    launchMock.mockResolvedValue(browser);
    const fetchMock = vi.fn().mockResolvedValue({});

    const result = await runPreflight({ browser: true, model: true, baseUrl: true }, CONFIG, fetchMock);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.browser).toBe(browser);
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('reports two independent failures together, not just the first (design D2)', async () => {
    launchMock.mockRejectedValue(new Error("Executable doesn't exist at /nope/chrome"));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === CONFIG.base_url) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve({});
    });

    const result = await runPreflight({ browser: true, model: true, baseUrl: true }, CONFIG, fetchMock);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failures).toHaveLength(2);
    // Each names what was attempted, not merely that it failed.
    expect(result.failures.some((f) => /not installed/i.test(f))).toBe(true);
    expect(result.failures.some((f) => f.includes(CONFIG.base_url) && /not responding/i.test(f))).toBe(
      true,
    );
  });

  it('closes a browser that did launch when a sibling check fails, rather than leaking it', async () => {
    const browser = { close: vi.fn() };
    launchMock.mockResolvedValue(browser);
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'));

    const result = await runPreflight({ browser: true, model: true, baseUrl: false }, CONFIG, fetchMock);

    expect(result.ok).toBe(false);
    expect(browser.close).toHaveBeenCalled();
  });

  it('names the provider and the endpoint when the model is unreachable (connection refused)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const result = await runPreflight({ browser: false, model: true, baseUrl: false }, CONFIG, fetchMock);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failures[0]).toContain('anthropic');
    expect(result.failures[0]).toContain('api.anthropic.com');
    // A refused connection is a different fact from a timeout, and leads to a
    // different action — the two messages must not read the same way.
    expect(result.failures[0]).not.toMatch(/did not respond within/);
  });

  it('reports the app is not responding, naming the URL (connection refused)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runPreflight(
      { browser: false, model: false, baseUrl: true },
      CONFIG,
      fetchMock,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failures[0]).toContain(CONFIG.base_url);
    expect(result.failures[0]).toMatch(/not responding \(/);
    expect(result.failures[0]).not.toMatch(/did not respond within/);
  });

  // DEF-002: a probe that times out (the app/provider is slow, not necessarily
  // down) must read differently from one that was refused outright — they call
  // for different actions. `probe`'s own AbortController is the only thing that
  // ever aborts its fetch, so simulating the abort event Node's real `fetch`
  // raises when that fires (a DOMException named AbortError) exercises exactly
  // the path the real timeout takes, without waiting out the real 15s limit.
  function fetchThatTimesOut(): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
  }

  it('distinguishes a timed-out base_url probe from a refused one, naming the limit', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = fetchThatTimesOut();
      const resultPromise = runPreflight(
        { browser: false, model: false, baseUrl: true },
        CONFIG,
        fetchMock,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failures[0]).toContain(CONFIG.base_url);
      expect(result.failures[0]).toContain('did not respond within 15s');
      // Names the limit, and reads as "might still be starting", not "is down".
      expect(result.failures[0]).toMatch(/starting/i);
      expect(result.failures[0]).not.toMatch(/is not responding \(/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes a timed-out model probe from a refused one, naming the limit', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = fetchThatTimesOut();
      const resultPromise = runPreflight({ browser: false, model: true, baseUrl: false }, CONFIG, fetchMock);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.failures[0]).toContain('anthropic');
      expect(result.failures[0]).toContain('did not respond within 15s');
      expect(result.failures[0]).not.toMatch(/\(getaddrinfo|\(ECONNREFUSED/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out before the documented limit — a slow-but-working endpoint still passes', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            setTimeout(() => resolve({}), 14_000);
          }),
      );

      const resultPromise = runPreflight(
        { browser: false, model: false, baseUrl: true },
        CONFIG,
        fetchMock,
      );
      await vi.advanceTimersByTimeAsync(14_000);
      const result = await resultPromise;

      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats any HTTP response as reachable, even one the fetch call resolves without inspecting', async () => {
    // Shallow check (design D6): the check never inspects the response, so a
    // 401/404 still counts as "the endpoint answered".
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });

    const result = await runPreflight({ browser: false, model: true, baseUrl: true }, CONFIG, fetchMock);

    expect(result.ok).toBe(true);
  });
});
