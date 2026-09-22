/**
 * In-process TTL cache for static Things metadata (areas, tags, projects).
 *
 * These change rarely but are read frequently as cross-references. A 30s TTL
 * + explicit invalidation on any write keeps them fresh without per-call DB
 * round-trips. RATIONALE: todo content changes too often and staleness risks
 * correctness, so it is NOT cached — only stable metadata. Would need a
 * measured hot-path read >1ms on areas/tags to reconsider the TTL.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 30_000;
const store = new Map<string, CacheEntry<unknown>>();

/** Get a cached value if present and unexpired, else undefined. */
export function get<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** Set a value with the default TTL. */
export function set<T>(key: string, value: T, ttlMs: number = TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Invalidate one key. */
export function invalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all metadata keys. Called on any write (create/update/delete)
 * since any of them could add/rename/remove a tag, area, or project.
 */
export function invalidateMetadata(): void {
  for (const key of store.keys()) {
    if (key.startsWith("meta:")) store.delete(key);
  }
}
