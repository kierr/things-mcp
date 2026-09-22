import { describe, it, expect, beforeEach } from "bun:test";
import * as cache from "../src/cache.js";

beforeEach(() => {
  cache.invalidateMetadata();
});

describe("cache TTL", () => {
  it("returns undefined for missing keys", () => {
    expect(cache.get("meta:areas")).toBeUndefined();
  });

  it("returns set values", () => {
    cache.set("meta:tags", [{ id: "t1", title: "5m" }]);
    const v = cache.get<{ id: string; title: string }[]>("meta:tags");
    expect(v).toEqual([{ id: "t1", title: "5m" }]);
  });

  it("expires after TTL", () => {
    cache.set("meta:x", "v", 1); // 1ms TTL
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get("meta:x")).toBeUndefined();
        resolve();
      }, 20);
    });
  });

  it("invalidateMetadata removes only meta: keys", () => {
    cache.set("meta:areas", [1, 2]);
    cache.set("auth-token", "abc");
    cache.invalidateMetadata();
    expect(cache.get("meta:areas")).toBeUndefined();
    expect(cache.get<string>("auth-token")).toBe("abc");
  });
});
