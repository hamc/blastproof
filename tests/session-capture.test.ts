import { describe, expect, it } from 'vitest';
import { captureSession, repairIndexedDB, type FalsyRecords, type StorageState } from '../src/session-capture.js';

const ORIGIN = 'http://localhost:3001';

/**
 * Records as Playwright 1.62's `storageState({ indexedDB: true })` writes them,
 * taken from the budgeting app's demo (design carry-the-whole-session, D2). Its
 * collector sets a key or value only `if (trivial)`, so the SQLite page stored
 * under the key `0` and the `null` setting came out with neither field: `{}` and
 * `{ key: 'server-url' }`. Restoring that state fails, since an out-of-line store
 * needs a key.
 */
function capturedByPlaywright(): StorageState {
  return {
    cookies: [],
    origins: [
      {
        origin: ORIGIN,
        localStorage: [],
        indexedDB: [
          {
            name: 'actual',
            version: 9,
            stores: [
              {
                name: 'asyncStorage',
                autoIncrement: false,
                indexes: [],
                records: [{ key: 'lastBudget', value: '_test-budget' }, { key: 'server-url' }],
              },
              {
                name: 'files',
                keyPath: 'filepath',
                autoIncrement: false,
                indexes: [],
                records: [{ value: { filepath: '/documents/a', contents: 'x' } }],
              },
            ],
          },
          {
            name: 'documents-db.sqlite',
            version: 1,
            stores: [
              {
                name: 'data',
                autoIncrement: false,
                indexes: [],
                records: [{}, { key: 1, valueEncoded: { ab: { b: 'AAA=' } } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** What the page reports for that state: positions in key order. */
function readOnThePage(): FalsyRecords {
  return {
    origin: ORIGIN,
    databases: [
      {
        name: 'actual',
        stores: [
          { name: 'asyncStorage', count: 2, keys: [], values: [[1, { v: 'null' }]] },
          { name: 'files', count: 1, keys: [], values: [] },
        ],
      },
      { name: 'documents-db.sqlite', stores: [{ name: 'data', count: 2, keys: [[0, 0]], values: [[0, { plain: '' }]] }] },
    ],
  };
}

type Origin = { origin: string; indexedDB?: { stores: { records: Record<string, unknown>[] }[] }[] };
const storesOf = (state: StorageState) => (state.origins[0] as Origin).indexedDB!.flatMap((db) => db.stores);

describe('repairIndexedDB (carry-the-whole-session, D2)', () => {
  it('puts back the falsy keys and values Playwright dropped', () => {
    const repaired = repairIndexedDB(capturedByPlaywright(), readOnThePage())!;

    const [asyncStorage, files, data] = storesOf(repaired);
    // `null` goes back encoded: Playwright restores `record.value ?? decode(valueEncoded)`,
    // so a plain `value: null` would come back as undefined.
    expect(asyncStorage!.records[1]).toEqual({ key: 'server-url', valueEncoded: { v: 'null' } });
    expect(files!.records).toEqual([{ value: { filepath: '/documents/a', contents: 'x' } }]);
    expect(data!.records[0]).toEqual({ key: 0, value: '' });
    expect(data!.records[1]).toEqual({ key: 1, valueEncoded: { ab: { b: 'AAA=' } } });
  });

  it('leaves the state it was given untouched', () => {
    const state = capturedByPlaywright();
    repairIndexedDB(state, readOnThePage());
    expect(state).toEqual(capturedByPlaywright());
  });

  it('carries NaN and -0 in Playwright encoding', () => {
    const state = capturedByPlaywright();
    const page = readOnThePage();
    page.databases[0]!.stores[0]!.values = [[1, { v: 'NaN' }]];
    expect(storesOf(repairIndexedDB(state, page)!)[0]!.records[1]).toEqual({
      key: 'server-url',
      valueEncoded: { v: 'NaN' },
    });
  });

  it('refuses when a store changed size between the two reads', () => {
    const page = readOnThePage();
    page.databases[1]!.stores[0]!.count = 3;
    expect(repairIndexedDB(capturedByPlaywright(), page)).toBeUndefined();
  });

  it('refuses a dropped entry the page does not report', () => {
    const page = readOnThePage();
    page.databases[1]!.stores[0]!.keys = [];
    expect(repairIndexedDB(capturedByPlaywright(), page)).toBeUndefined();
  });

  it('refuses a falsy key where the capture holds another key', () => {
    const page = readOnThePage();
    page.databases[1]!.stores[0]!.keys = [
      [0, 0],
      [1, 0],
    ];
    expect(repairIndexedDB(capturedByPlaywright(), page)).toBeUndefined();
  });

  it('refuses a falsy value where the capture holds a truthy one', () => {
    const page = readOnThePage();
    page.databases[0]!.stores[0]!.values = [
      [0, { plain: '' }],
      [1, { v: 'null' }],
    ];
    expect(repairIndexedDB(capturedByPlaywright(), page)).toBeUndefined();
  });

  it('accepts a capture that already kept the falsy entries', () => {
    // What a Playwright with its collector fixed would write: the repair finds nothing to do.
    const state = capturedByPlaywright();
    const data = storesOf(state)[2]!;
    data.records[0] = { key: 0, value: '' };
    const repaired = repairIndexedDB(state, readOnThePage());
    expect(storesOf(repaired!)[2]!.records[0]).toEqual({ key: 0, value: '' });
  });

  it("drops another origin's IndexedDB when it has a dropped entry, and keeps the rest of its state", () => {
    const state = capturedByPlaywright();
    state.origins.push({
      origin: 'https://id.example.com',
      localStorage: [{ name: 'k', value: 'v' }],
      indexedDB: [{ name: 'idp', version: 1, stores: [{ name: 's', autoIncrement: false, indexes: [], records: [{}] }] }],
    });

    const other = repairIndexedDB(state, readOnThePage())!.origins[1] as Origin & { localStorage: unknown[] };

    expect(other.indexedDB).toBeUndefined();
    expect(other.localStorage).toEqual([{ name: 'k', value: 'v' }]);
  });

  it("keeps another origin's IndexedDB when nothing in it was dropped", () => {
    const state = capturedByPlaywright();
    const idb = [{ name: 'idp', version: 1, stores: [{ name: 's', autoIncrement: false, indexes: [], records: [{ key: 'a', value: 1 }] }] }];
    state.origins.push({ origin: 'https://id.example.com', localStorage: [], indexedDB: idb });

    expect((repairIndexedDB(state, readOnThePage())!.origins[1] as Origin).indexedDB).toEqual(idb);
  });
});

describe('captureSession (carry-the-whole-session, D1–D3)', () => {
  function page(reads: FalsyRecords[], items: { name: string; value: string }[] = []) {
    let read = 0;
    return {
      async evaluate<R>(fn: () => R | Promise<R>): Promise<R> {
        return (fn.name === 'readFalsyRecords' ? reads[Math.min(read++, reads.length - 1)] : { origin: ORIGIN, items }) as R;
      },
    };
  }

  it('asks Playwright for IndexedDB and returns the repaired state with the session storage', async () => {
    const asked: unknown[] = [];
    const context = {
      async storageState(options?: { indexedDB?: boolean }) {
        asked.push(options);
        return capturedByPlaywright();
      },
    };

    const session = await captureSession(context, page([readOnThePage()], [{ name: 'bid', value: '1' }]));

    expect(asked).toEqual([{ indexedDB: true }]);
    expect(storesOf(session.storageState)[2]!.records[0]).toEqual({ key: 0, value: '' });
    expect(session.sessionStorage).toEqual({ origin: ORIGIN, items: [{ name: 'bid', value: '1' }] });
  });

  it('captures again when the app wrote between the two reads', async () => {
    let captures = 0;
    const context = {
      async storageState() {
        captures++;
        return capturedByPlaywright();
      },
    };
    const moved = readOnThePage();
    moved.databases[1]!.stores[0]!.count = 3;

    await captureSession(context, page([moved, readOnThePage()]));

    expect(captures).toBe(2);
  });

  it('gives up after three captures that disagree', async () => {
    const context = { storageState: async () => capturedByPlaywright() };
    const moved = readOnThePage();
    moved.databases[1]!.stores[0]!.count = 3;

    await expect(captureSession(context, page([moved]))).rejects.toThrow(
      /kept writing to its IndexedDB while the session was read \(3 attempts\)/,
    );
  });

  it('returns no session storage when the page had none', async () => {
    const context = { storageState: async () => capturedByPlaywright() };
    const session = await captureSession(context, page([readOnThePage()]));
    expect(session).not.toHaveProperty('sessionStorage');
  });
});
