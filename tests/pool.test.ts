import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '../src/runner/pool.js';

/** Resolves after `ms`, for ordering jobs deterministically without real waiting. */
const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('runWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    // The whole point of the ordering rule: a report whose rows depend on which
    // test finished first changes between runs of the same code.
    const results = await runWithConcurrency([30, 10, 20], 3, async (ms, index) => {
      await after(ms);
      return index;
    });

    expect(results).toEqual([0, 1, 2]);
  });

  it('never exceeds the requested concurrency', async () => {
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await after(5);
      inFlight--;
    });

    expect(peak).toBe(3);
  });

  it('keeps every worker busy rather than partitioning the work', async () => {
    // One slow job must hold up only itself. A fixed partition (worker i takes
    // every nth item) would leave two workers idle behind this one.
    const order: number[] = [];

    await runWithConcurrency([50, 1, 1, 1], 2, async (ms, index) => {
      await after(ms);
      order.push(index);
    });

    expect(order[order.length - 1]).toBe(0);
    expect(order).toHaveLength(4);
  });

  it('runs serially at a concurrency of 1', async () => {
    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency([1, 2, 3], 1, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await after(1);
      inFlight--;
    });

    expect(peak).toBe(1);
  });

  it('waits for work in flight before surfacing a failure', async () => {
    // `Promise.all` would reject immediately and leave the other workers
    // running with nobody awaiting them — here, browser contexts left open.
    let finished = 0;

    await expect(
      runWithConcurrency([0, 1, 2, 3], 4, async (_item, index) => {
        if (index === 0) throw new Error('boom');
        await after(10);
        finished++;
      }),
    ).rejects.toThrow('boom');

    expect(finished).toBe(3);
  });

  it('refuses a concurrency below 1 rather than choosing one', async () => {
    await expect(runWithConcurrency([1], 0, async () => 1)).rejects.toThrow(/at least 1/);
  });

  it('handles an empty list', async () => {
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
