/**
 * Capturing the whole session a login leaves behind (design carry-the-whole-session).
 *
 * `context.storageState()` alone holds cookies and local storage. An app that keeps
 * its session in IndexedDB or session storage was signed in for the login and
 * signed out for every test (#59). This module captures both, and repairs what
 * Playwright's own IndexedDB capture drops.
 */

/** Playwright storage state: cookies plus per-origin storage. */
export interface StorageState {
  cookies: unknown[];
  origins: unknown[];
}

/** Session storage of the origin the login ended on, which Playwright never captures (design D3). */
export interface SessionStorageSeed {
  origin: string;
  items: { name: string; value: string }[];
}

/**
 * Written into session storage beside the seeded items, so a tab is seeded once
 * and a key the app removes afterwards stays removed (design D3).
 */
export const SESSION_SEEDED_MARKER = 'blastproof:session-seeded';

/** The page subset a capture reads; a real Playwright `Page` satisfies it. */
export interface EvaluatingPage {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
}

/** What the seeding script receives: the seed and the marker it writes. */
export type SeedArg = SessionStorageSeed & { marker: string };

/** The context subset seeding needs; a real Playwright `BrowserContext` satisfies it. */
export interface SeedableContext {
  addInitScript(script: (arg: SeedArg) => void, arg: SeedArg): Promise<unknown>;
}

// What Playwright writes for IndexedDB in a storage state (`indexedDB: true`).
interface IdbRecord {
  key?: unknown;
  keyEncoded?: unknown;
  value?: unknown;
  valueEncoded?: unknown;
}
interface IdbStore {
  name: string;
  records: IdbRecord[];
  keyPath?: string;
  keyPathArray?: string[];
}
interface IdbDatabase {
  name: string;
  stores: IdbStore[];
}
interface OriginState {
  origin: string;
  indexedDB?: IdbDatabase[];
}

/** A falsy value as read from the page: plain when JSON can carry it, else Playwright's encoding. */
type FalsyValue = { plain: 0 | '' | false } | { v: 'null' | 'NaN' | '-0' };

/** The falsy keys and values of one origin's IndexedDB, by position in key order (design D2). */
export interface FalsyRecords {
  origin: string;
  databases: {
    name: string;
    stores: { name: string; count: number; keys: [number, 0 | ''][]; values: [number, FalsyValue][] }[];
  }[];
}

// The DOM this module's page functions touch. The build's `lib` has no DOM, and
// these functions run in the page, never in Node.
interface IdbRequest<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface IdbObjectStore {
  getAllKeys(): IdbRequest<unknown[]>;
  getAll(): IdbRequest<unknown[]>;
}
interface IdbOpenDatabase {
  objectStoreNames: ArrayLike<string> & Iterable<string>;
  transaction(names: ArrayLike<string>, mode: 'readonly'): { objectStore(name: string): IdbObjectStore };
  close(): void;
}
interface PageGlobals {
  location: { origin: string };
  indexedDB: {
    databases(): Promise<{ name?: string }[]>;
    open(name: string): IdbRequest<IdbOpenDatabase>;
  };
  sessionStorage: {
    length: number;
    key(index: number): string | null;
    getItem(name: string): string | null;
    setItem(name: string, value: string): void;
  };
}

/**
 * Runs in the page: every IndexedDB record of this origin whose key or value is
 * falsy, by position. Playwright's collector keeps a key or value only when it is
 * truthy, so `0`, `''`, `false` and `null` leave a record with neither field.
 * `getAllKeys` and `getAll` return records in key order, the order Playwright's
 * collector walked them. Only the falsy entries cross back, so a database of
 * binary pages is not transferred twice.
 */
async function readFalsyRecords(): Promise<FalsyRecords> {
  const g = globalThis as unknown as PageGlobals;
  const done = <T>(request: IdbRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const encode = (value: unknown): FalsyValue | undefined => {
    if (value === null) return { v: 'null' };
    if (typeof value === 'number' && Number.isNaN(value)) return { v: 'NaN' };
    if (Object.is(value, -0)) return { v: '-0' };
    if (value === 0 || value === '' || value === false) return { plain: value };
    return undefined;
  };
  const databases: FalsyRecords['databases'] = [];
  for (const info of await g.indexedDB.databases()) {
    if (!info.name) continue;
    const db = await done(g.indexedDB.open(info.name));
    try {
      if (db.objectStoreNames.length === 0) {
        databases.push({ name: info.name, stores: [] });
        continue;
      }
      // Every request is issued before the first await: a transaction left with
      // nothing pending between two awaits may commit under the next request.
      const transaction = db.transaction(db.objectStoreNames, 'readonly');
      const reads = [...db.objectStoreNames].map((name) => {
        const store = transaction.objectStore(name);
        return Promise.all([done(store.getAllKeys()), done(store.getAll())]).then(([keys, values]) => ({
          name,
          count: keys.length,
          keys: keys.flatMap((key, i): [number, 0 | ''][] => (key === 0 || key === '' ? [[i, key]] : [])),
          values: values.flatMap((value, i): [number, FalsyValue][] => {
            const encoded = encode(value);
            return encoded ? [[i, encoded]] : [];
          }),
        }));
      });
      databases.push({ name: info.name, stores: await Promise.all(reads) });
    } finally {
      db.close();
    }
  }
  return { origin: g.location.origin, databases };
}

/** Runs in the page: its origin's session storage. */
function readSessionStorage(): SessionStorageSeed {
  const g = globalThis as unknown as PageGlobals;
  const items: SessionStorageSeed['items'] = [];
  for (let i = 0; i < g.sessionStorage.length; i++) {
    const name = g.sessionStorage.key(i);
    if (name !== null) items.push({ name, value: g.sessionStorage.getItem(name) ?? '' });
  }
  return { origin: g.location.origin, items };
}

/** Runs in every document of a seeded context: writes the session storage once per tab (design D3). */
function seedSessionStorage(seed: SeedArg): void {
  const g = globalThis as unknown as PageGlobals;
  if (g.location.origin !== seed.origin) return;
  try {
    if (g.sessionStorage.getItem(seed.marker) !== null) return;
    for (const { name, value } of seed.items) g.sessionStorage.setItem(name, value);
    g.sessionStorage.setItem(seed.marker, '1');
  } catch {
    // A sandboxed frame has no storage to seed; the app cannot read one there either.
  }
}

const isMissing = (record: IdbRecord, field: 'key' | 'value') =>
  !(field in record) && !(`${field}Encoded` in record);

const isOutOfLine = (store: IdbStore) => store.keyPath === undefined && store.keyPathArray === undefined;

/**
 * Puts back the keys and values Playwright dropped (design D2), from what the
 * login's last page reports. Returns undefined when the two reads disagree, which
 * means the app wrote to its database between them and the capture is retried.
 *
 * Only the page's origin can be repaired. Another origin whose IndexedDB has a
 * dropped entry loses its IndexedDB rather than the whole state: before this
 * change no origin's IndexedDB was captured, and a record with no key cannot be
 * restored at all (Playwright fails the context).
 */
export function repairIndexedDB(state: StorageState, found: FalsyRecords): StorageState | undefined {
  const origins = structuredClone(state.origins) as OriginState[];
  for (const origin of origins) {
    const databases = origin.indexedDB ?? [];
    if (origin.origin !== found.origin) {
      const broken = databases.some((db) =>
        db.stores.some((store) =>
          store.records.some((r) => (isOutOfLine(store) && isMissing(r, 'key')) || isMissing(r, 'value')),
        ),
      );
      if (broken) delete origin.indexedDB;
      continue;
    }
    for (const db of databases) {
      for (const store of db.stores) {
        const read = found.databases.find((d) => d.name === db.name)?.stores.find((s) => s.name === store.name);
        if (!read || read.count !== store.records.length) return undefined;
        const keys = new Map(read.keys);
        const values = new Map(read.values);
        for (const [i, record] of store.records.entries()) {
          if (isOutOfLine(store)) {
            const key = keys.get(i);
            if (isMissing(record, 'key')) {
              if (key === undefined) return undefined;
              record.key = key;
            } else if (key !== undefined && record.key !== key) {
              return undefined;
            }
          }
          const value = values.get(i);
          if (isMissing(record, 'value')) {
            if (value === undefined) return undefined;
            if ('plain' in value) record.value = value.plain;
            else record.valueEncoded = value;
          } else if (value !== undefined && 'value' in record && record.value) {
            // The page has a falsy value where the capture holds a truthy one.
            return undefined;
          }
        }
      }
    }
  }
  return { ...state, origins };
}

/**
 * How many times a capture is taken again when the app wrote to its database
 * between Playwright's read and the repair's. A login's last page is usually
 * quiet; three tries cover a write in flight without hiding one that never stops.
 */
const CAPTURE_ATTEMPTS = 3;

/** The context subset a capture reads; a real Playwright `BrowserContext` satisfies it. */
export interface CapturingContext {
  storageState(options?: { indexedDB?: boolean }): Promise<StorageState>;
}

/**
 * Captures the session the login left in `context`, read on `page`, the page the
 * login ended on: cookies, local storage, IndexedDB with the repair, and the
 * page's session storage (design D1–D3).
 */
export async function captureSession(
  context: CapturingContext,
  page: EvaluatingPage,
): Promise<{ storageState: StorageState; sessionStorage?: SessionStorageSeed }> {
  for (let attempt = 1; ; attempt++) {
    const state = await context.storageState({ indexedDB: true });
    const found = await page.evaluate(readFalsyRecords);
    const repaired = repairIndexedDB(state, found);
    if (repaired) {
      const sessionStorage = await page.evaluate(readSessionStorage);
      return {
        storageState: repaired,
        ...(sessionStorage.items.length > 0 && sessionStorage.origin !== 'null' ? { sessionStorage } : {}),
      };
    }
    if (attempt === CAPTURE_ATTEMPTS) {
      throw new Error(`the app kept writing to its IndexedDB while the session was read (${CAPTURE_ATTEMPTS} attempts)`);
    }
  }
}

/** Gives `context` the session storage of `seed`, written once per tab of its origin (design D3). */
export async function seedSessionStorageInto(context: SeedableContext, seed: SessionStorageSeed): Promise<void> {
  await context.addInitScript(seedSessionStorage, { ...seed, marker: SESSION_SEEDED_MARKER });
}

export function isSessionStorageSeed(value: unknown): value is SessionStorageSeed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SessionStorageSeed).origin === 'string' &&
    Array.isArray((value as SessionStorageSeed).items) &&
    (value as SessionStorageSeed).items.every(
      (item) => typeof item?.name === 'string' && typeof item?.value === 'string',
    )
  );
}
