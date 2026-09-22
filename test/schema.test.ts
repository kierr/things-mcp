import { describe, it, expect } from "bun:test";
import {
  mapType,
  mapStatus,
  mapStart,
  parseUnixTimestamp,
  parseThingsDate,
  parseRelativePeriod,
  toUnixSeconds,
} from "../src/db/schema.js";

describe("mapType", () => {
  it("maps numeric type codes", () => {
    expect(mapType(0)).toBe("to-do");
    expect(mapType(1)).toBe("project");
    expect(mapType(2)).toBe("heading");
    expect(mapType(undefined)).toBe("to-do");
    expect(mapType(99)).toBe("to-do");
  });
});

describe("mapStatus", () => {
  it("maps numeric status codes", () => {
    expect(mapStatus(0)).toBe("incomplete");
    expect(mapStatus(1)).toBe("incomplete");
    expect(mapStatus(2)).toBe("canceled");
    expect(mapStatus(3)).toBe("completed");
  });
});

describe("mapStart", () => {
  it("maps numeric start buckets", () => {
    expect(mapStart(0)).toBe("Inbox");
    expect(mapStart(1)).toBe("Anytime");
    expect(mapStart(2)).toBe("Someday");
    expect(mapStart(3)).toBe("");
  });
});

describe("parseUnixTimestamp", () => {
  it("converts seconds to ISO string", () => {
    expect(parseUnixTimestamp(0)).toBeNull();
    expect(parseUnixTimestamp(null)).toBeNull();
    expect(parseUnixTimestamp(undefined)).toBeNull();
    expect(parseUnixTimestamp(-1)).toBeNull();
    // 2026-01-01T00:00:00Z = 1767225600
    expect(parseUnixTimestamp(1767225600)).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("parseThingsDate", () => {
  it("returns null for empty/zero", () => {
    expect(parseThingsDate(null)).toBeNull();
    expect(parseThingsDate(0)).toBeNull();
    expect(parseThingsDate(undefined)).toBeNull();
  });

  it("decodes a packed day code (low 7 bits zero)", () => {
    // The day-code format: year in bits ≥9, month bits 5-8, day bits 0-4.
    // 2026-06-23 → year=2026, month=6, day=23
    // dayCode = (2026 << 9) | (6 << 5) | 23 = 1037312 + 192 + 23 = 1037527
    // Packed with 7 zero low bits: 1037527 << 7 = 132803456
    const packed = 1037527 << 7;
    expect(parseThingsDate(packed)).toBe("2026-06-23");
  });

  it("decodes a raw day code when low 7 bits are non-zero (fallback path)", () => {
    // Same date, but with non-zero low bits → uses the value as-is.
    const dayCode = (2026 << 9) | (6 << 5) | 23;
    // Force the fallback branch by OR-ing a low-bits flag.
    expect(parseThingsDate(dayCode | 0x01)).toBe("2026-06-23");
  });
});

describe("parseRelativePeriod", () => {
  it("parses d/w/m/y suffixes", () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const dDate = parseRelativePeriod("3d");
    expect(dDate.getTime()).toBeLessThanOrEqual(now - 3 * dayMs + 1000);
    expect(dDate.getTime()).toBeGreaterThanOrEqual(now - 3 * dayMs - 1000);

    const wDate = parseRelativePeriod("1w");
    expect(wDate.getTime()).toBeLessThanOrEqual(now - 7 * dayMs + 1000);

    const mDate = parseRelativePeriod("2m");
    expect(mDate.getTime()).toBeLessThan(now);

    const yDate = parseRelativePeriod("1y");
    expect(yDate.getTime()).toBeLessThan(now);
  });

  it("rejects bad formats", () => {
    expect(() => parseRelativePeriod("3days")).toThrow();
    expect(() => parseRelativePeriod("abc")).toThrow();
    expect(() => parseRelativePeriod("")).toThrow();
  });
});

describe("toUnixSeconds", () => {
  it("converts a Date to seconds", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(toUnixSeconds(d)).toBe(1767225600);
  });
});
