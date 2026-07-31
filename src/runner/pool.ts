/**
 * Runs an ordered list of jobs with a bounded number in flight, returning their
 * results in **input order** (design tests-in-parallel, D4).
 *
 * Input order, not completion order, is the point: a report whose rows depend on
 * which test happened to finish first changes between runs of the same code, and
 * people diff reports.
 *
 * Deliberately not a dependency. A bounded pool is this file; pulling in a
 * library for it would add a supply-chain surface to a tool whose own pitch is
 * that it gates other people's merges.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) throw new RangeError(`concurrency must be at least 1, got ${concurrency}`);

  const results = new Array<R>(items.length);
  let next = 0;

  // Each worker pulls the next index until there are none left, so a slow job
  // holds up only itself — a fixed partition (worker i takes every nth item)
  // would leave workers idle behind one long test.
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }

  // `allSettled`, not `all`: `all` rejects on the first failure while the other
  // workers keep running, which here would mean browser contexts left open with
  // nobody awaiting them, and an unhandled rejection if a second worker failed
  // too. Every worker is waited for, then the first failure is re-thrown — so a
  // genuine error still ends the run, but not while work is still in flight.
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure && failure.status === 'rejected') throw failure.reason;
  return results;
}
