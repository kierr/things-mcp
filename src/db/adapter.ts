/**
 * SQLite adapter — picks `bun:sqlite` on Bun, `node:sqlite` on Node 24+.
 *
 * Both expose a `DatabaseSync`-shaped API (`prepare`, `exec`, `close`). On Bun
 * we use the native `bun:sqlite` Database (fastest, no native deps). On Node
 * 24+ we use the built-in `node:sqlite`. RATIONALE: the runtime detection keeps
 * the server portable across the two runtimes the MCP TS SDK supports, without
 * a native dependency. Would need a third runtime (Deno) to reconsider.
 */

export interface DbConnection {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  close(): void;
}

export interface DbStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

let cachedCtor: (path: string, opts?: { readOnly?: boolean }) => DbConnection;

function getCtor(): (path: string, opts?: { readOnly?: boolean }) => DbConnection {
  if (cachedCtor) return cachedCtor;
  // Bun: native bun:sqlite (no node:sqlite in 1.3.x).
  if (typeof Bun !== "undefined") {
    // dynamic import so Node doesn't try to resolve `bun:sqlite`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite");
    cachedCtor = (path, opts) => {
      const db = new Database(path, opts?.readOnly ? { readonly: true } : {});
      return {
        exec: (s) => db.exec(s),
        prepare: (s) => db.prepare(s),
        close: () => db.close(),
      };
    };
    return cachedCtor;
  }
  // Node 24+: built-in node:sqlite.
  const { DatabaseSync } = require("node:sqlite");
  cachedCtor = (path, opts) => {
    const db = new DatabaseSync(path, opts);
    return {
      exec: (s) => db.exec(s),
      prepare: (s) => db.prepare(s),
      close: () => db.close(),
    };
  };
  return cachedCtor;
}

export function openDatabase(path: string): DbConnection {
  return getCtor()(path, { readOnly: true });
}
