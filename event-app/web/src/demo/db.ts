/**
 * Browser stand-in for server/db/client.ts: a better-sqlite3-shaped wrapper over sql.js
 * (SQLite compiled to WebAssembly), so the real server modules run unchanged in the demo.
 */
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schema from '../../../server/db/schema.sql?raw';
import { MIGRATIONS } from '../../../server/db/migrations';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

const norm = (params: unknown[]): SqlValue[] =>
  params.flat().map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as SqlValue)));

export class DemoDb {
  private depth = 0;
  constructor(public raw: Database) {}

  prepare(sql: string) {
    const raw = this.raw;
    return {
      get: (...params: unknown[]) => {
        const st = raw.prepare(sql);
        try {
          st.bind(norm(params));
          return st.step() ? st.getAsObject() : undefined;
        } finally {
          st.free();
        }
      },
      all: (...params: unknown[]) => {
        const st = raw.prepare(sql);
        const rows: Record<string, SqlValue>[] = [];
        try {
          st.bind(norm(params));
          while (st.step()) rows.push(st.getAsObject());
          return rows;
        } finally {
          st.free();
        }
      },
      run: (...params: unknown[]): RunResult => {
        raw.run(sql, norm(params));
        const changes = raw.getRowsModified();
        const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
        return { changes, lastInsertRowid: Number(id ?? 0) };
      },
    };
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  pragma(statement: string, opts: { simple?: boolean } = {}) {
    const res = this.raw.exec(`PRAGMA ${statement}`);
    return opts.simple ? res[0]?.values[0]?.[0] : res;
  }

  /** Same contract as better-sqlite3: returns a function that runs `fn` atomically (nesting via savepoints). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    return (...args: A): R => {
      const sp = `sp${this.depth++}`;
      this.raw.exec(`SAVEPOINT ${sp}`);
      try {
        const out = fn(...args);
        this.raw.exec(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        this.depth--;
      }
    };
  }

  close() {
    this.raw.close();
  }
}

/** Decode the inlined wasm (a data: URL in the single-file build) without fetch, which the page's CSP may block. */
async function wasmBinary(): Promise<ArrayBuffer> {
  if (wasmUrl.startsWith('data:')) {
    const bin = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  return (await fetch(wasmUrl)).arrayBuffer();
}

export async function openDemoDb(saved?: Uint8Array): Promise<DemoDb> {
  const SQL = await initSqlJs({ wasmBinary: await wasmBinary() });
  const db = new DemoDb(new SQL.Database(saved));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  const version = Number(db.pragma('user_version', { simple: true }) ?? 0);
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}

// The same helpers server/db/client.ts exports, for modules that import them at runtime.
export function getSetting(db: DemoDb, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DemoDb, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export const openDb = () => {
  throw new Error('openDb is not available in the demo; use openDemoDb');
};
