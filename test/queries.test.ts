/**
 * Integration tests against the LIVE Things DB (when present).
 *
 * Skips automatically when the Things DB isn't found (CI, non-mac, Things not
 * yet opened). RATIONALE: the bundled ThingsTesting.sqlite3 fixture is from an
 * older schema (uses `dueDate` not `deadline`), so assertions against it would
 * test a stale schema; the live DB is the real contract we ship against.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { query } from "../src/db/queries.js";
import { invalidateDbPathCache, findDatabasePath } from "../src/db/client.js";
import * as cache from "../src/cache.js";

let haveDb = false;
beforeAll(async () => {
  try {
    await findDatabasePath();
    haveDb = true;
  } catch {
    haveDb = false;
  }
  invalidateDbPathCache();
  cache.invalidateMetadata();
});

describe("things_query (live DB)", () => {
  it("returns inbox items", async () => {
    if (!haveDb) return; // skip when Things DB is absent (CI, non-mac)
    const r = await query({ view: "inbox", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.items.length).toBeLessThanOrEqual(50);
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });

  it("paginates with limit + offset", async () => {
    if (!haveDb) return;
    const page1 = await query({ view: "inbox", limit: 5, offset: 0 });
    const page2 = await query({ view: "inbox", limit: 5, offset: 5 });
    expect(page1.items.length).toBeLessThanOrEqual(5);
    if (page1.items.length === 5 && page2.items.length > 0) {
      const ids1 = new Set(page1.items.map((i) => (i as { id: string }).id));
      for (const item of page2.items) {
        expect(ids1.has((item as { id: string }).id)).toBe(false);
      }
    }
    expect(page1.total).toBe(page2.total);
  });

  it("returns areas via type=area", async () => {
    if (!haveDb) return;
    const r = await query({ type: "area", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    for (const area of r.items) {
      expect((area as { id: string }).id).toBeTruthy();
      expect((area as { tags: string[] }).tags).toBeInstanceOf(Array);
    }
  });

  it("returns tags via type=tag", async () => {
    if (!haveDb) return;
    const r = await query({ type: "tag", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    for (const tag of r.items) {
      expect((tag as { title: string }).title).toBeTruthy();
    }
  });

  it("filters by query substring", async () => {
    if (!haveDb) return;
    const r = await query({ query: "a", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("fetches a single item by id", async () => {
    if (!haveDb) return;
    const list = await query({ view: "inbox", limit: 1 });
    if (list.items.length === 0) return;
    const id = (list.items[0] as { id: string }).id;
    const r = await query({ id, fields: ["id", "title"] });
    expect(r.items.length).toBe(1);
    expect((r.items[0] as { id: string }).id).toBe(id);
  });

  it("projects to requested fields only", async () => {
    if (!haveDb) return;
    const r = await query({ view: "inbox", limit: 1, fields: ["id", "title"] });
    if (r.items.length === 0) return;
    const keys = Object.keys(r.items[0] as object);
    expect(keys).toEqual(expect.arrayContaining(["id", "title"]));
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("checklist");
  });

  it("returns today items", async () => {
    if (!haveDb) return;
    const r = await query({ view: "today", limit: 50 });
    expect(r.view).toBe("today");
  });

  it("returns anytime items", async () => {
    if (!haveDb) return;
    const r = await query({ view: "anytime", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("returns logbook items with period filter", async () => {
    if (!haveDb) return;
    const r = await query({ view: "logbook", period: "1y", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("returns all-projects view", async () => {
    if (!haveDb) return;
    const r = await query({ view: "all-projects", limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    for (const p of r.items) {
      expect((p as { type: string }).type).toBe("project");
    }
  });

  it("rejects an invalid period", async () => {
    if (!haveDb) return;
    await expect(query({ view: "recent", period: "notaperiod" })).rejects.toThrow();
  });
});
