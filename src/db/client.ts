/**
 * Things 3 SQLite client.
 *
 * Opens read-only connections fresh per operation. Things runs the DB in WAL
 * mode; a fresh read-only connection sees the latest committed state including
 * the WAL, so concurrent reads are safe while Things writes. RATIONALE: a
 * pooled connection could miss WAL checkpoints; the open cost is sub-ms and
 * correctness beats throughput for a single-user local server. Would need a
 * measured per-op open cost >1ms on a hot path to reconsider.
 */

import os from "node:os";
import path from "node:path";
import { access, readdir } from "node:fs/promises";
import { openDatabase, type DbConnection } from "./adapter.js";

const THINGS_GROUP_CONTAINER = path.join(
  os.homedir(),
  "Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac"
);
const LEGACY_DATABASE_PATH = path.join(
  THINGS_GROUP_CONTAINER,
  "Things Database.thingsdatabase",
  "main.sqlite"
);

let cachedDbPath: string | null = null;

/** Discover the Things SQLite DB. Cached; rediscover on ENOENT. */
export async function findDatabasePath(): Promise<string> {
  if (process.env.THINGSDB) return process.env.THINGSDB;
  if (cachedDbPath) return cachedDbPath;

  const entries = await readdir(THINGS_GROUP_CONTAINER, {
    withFileTypes: true,
  }).catch(() => []);
  // ThingsData-* dirs — sort desc by name = newest (post-Cloud-restore).
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("ThingsData-"))
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((e) =>
      path.join(
        THINGS_GROUP_CONTAINER,
        e.name,
        "Things Database.thingsdatabase",
        "main.sqlite"
      )
    );

  for (const candidate of [...candidates, LEGACY_DATABASE_PATH]) {
    try {
      await access(candidate);
      cachedDbPath = candidate;
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Things database not found. Open Things 3 at least once on this Mac, or set THINGSDB."
  );
}

/** Run a read-only operation against a fresh DB connection. */
export async function withDatabase<T>(
  operation: (db: DbConnection) => T
): Promise<T> {
  const databasePath = await findDatabasePath();
  const db = openDatabase(databasePath);
  try {
    db.exec("PRAGMA query_only = ON");
    return operation(db);
  } finally {
    db.close();
  }
}

/** Read the Things URL-scheme auth token from TMSettings. */
export async function getAuthToken(): Promise<string | null> {
  return withDatabase((db) => {
    const row = db
      .prepare(
        "SELECT uriSchemeAuthenticationToken AS token FROM TMSettings WHERE uuid = ?"
      )
      .get("RhAzEf6qDxCD5PmnZVtBZR") as { token: string | null } | undefined;
    return row?.token ?? null;
  });
}

/** Invalidate the cached DB path (e.g. after a Things reinstall). */
export function invalidateDbPathCache(): void {
  cachedDbPath = null;
}
