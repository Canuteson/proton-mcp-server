import { describe, it, expect } from "vitest";
import {
  parseMailDate,
  toStartOfDay,
  toEndOfDay,
  toStartOfNextDay,
  buildMailDateRange,
} from "../src/lib/mailHelpers.js";

// ---------------------------------------------------------------------------
// parseMailDate
// ---------------------------------------------------------------------------

describe("parseMailDate", () => {
  it("parses a date-only string as local midnight, not UTC midnight", () => {
    const d = parseMailDate("2026-02-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // 0-indexed → February
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it("parses a datetime string as-is", () => {
    const d = parseMailDate("2026-02-25T14:30:00");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it("date-only string uses local midnight (hours = 0)", () => {
    // Regression guard: if parsed as UTC midnight, hours would be non-zero
    // in any timezone with a non-zero offset.
    const d = parseMailDate("2026-12-01");
    // Regardless of timezone, local midnight means getHours() === 0
    expect(d.getHours()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toStartOfDay
// ---------------------------------------------------------------------------

describe("toStartOfDay", () => {
  it("sets time to 00:00:00.000", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    const result = toStartOfDay(input);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("preserves the date", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    const result = toStartOfDay(input);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(25);
  });

  it("does not mutate the original date", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    toStartOfDay(input);
    expect(input.getHours()).toBe(14); // unchanged
  });
});

// ---------------------------------------------------------------------------
// toEndOfDay
// ---------------------------------------------------------------------------

describe("toEndOfDay", () => {
  it("sets time to 23:59:59.999", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    const result = toEndOfDay(input);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });

  it("preserves the date", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    const result = toEndOfDay(input);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(25);
  });

  it("does not mutate the original date", () => {
    const input = new Date("2026-02-25T14:30:45.123");
    toEndOfDay(input);
    expect(input.getHours()).toBe(14); // unchanged
  });
});

// ---------------------------------------------------------------------------
// toStartOfNextDay
// ---------------------------------------------------------------------------

describe("toStartOfNextDay", () => {
  it("advances the date by one day", () => {
    const input = new Date("2026-02-25T14:30:00");
    const result = toStartOfNextDay(input);
    expect(result.getDate()).toBe(26);
    expect(result.getMonth()).toBe(1);
  });

  it("rolls over month boundary correctly", () => {
    const input = new Date("2026-02-28T00:00:00");
    const result = toStartOfNextDay(input);
    expect(result.getMonth()).toBe(2); // March (0-indexed)
    expect(result.getDate()).toBe(1);
  });

  it("rolls over year boundary correctly", () => {
    const input = new Date("2026-12-31T00:00:00");
    const result = toStartOfNextDay(input);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(1);
  });

  it("sets time to 00:00:00.000", () => {
    const input = new Date("2026-02-25T23:59:59.999");
    const result = toStartOfNextDay(input);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildMailDateRange — single-day queries
// ---------------------------------------------------------------------------

describe("buildMailDateRange — single day", () => {
  it("since = start of day (00:00:00.000)", () => {
    const range = buildMailDateRange("2026-02-25", "2026-02-25");
    expect(range.since.getFullYear()).toBe(2026);
    expect(range.since.getMonth()).toBe(1);
    expect(range.since.getDate()).toBe(25);
    expect(range.since.getHours()).toBe(0);
    expect(range.since.getMinutes()).toBe(0);
    expect(range.since.getSeconds()).toBe(0);
    expect(range.since.getMilliseconds()).toBe(0);
  });

  it("endOfDay = end of day (23:59:59.999)", () => {
    const range = buildMailDateRange("2026-02-25", "2026-02-25");
    expect(range.endOfDay.getFullYear()).toBe(2026);
    expect(range.endOfDay.getMonth()).toBe(1);
    expect(range.endOfDay.getDate()).toBe(25);
    expect(range.endOfDay.getHours()).toBe(23);
    expect(range.endOfDay.getMinutes()).toBe(59);
    expect(range.endOfDay.getSeconds()).toBe(59);
    expect(range.endOfDay.getMilliseconds()).toBe(999);
  });

  it("imapBefore = start of next day (exclusive upper bound for IMAP BEFORE)", () => {
    const range = buildMailDateRange("2026-02-25", "2026-02-25");
    // IMAP BEFORE 2026-02-26 matches all messages received on 2026-02-25
    expect(range.imapBefore.getFullYear()).toBe(2026);
    expect(range.imapBefore.getMonth()).toBe(1);
    expect(range.imapBefore.getDate()).toBe(26);
    expect(range.imapBefore.getHours()).toBe(0);
    expect(range.imapBefore.getMinutes()).toBe(0);
    expect(range.imapBefore.getSeconds()).toBe(0);
    expect(range.imapBefore.getMilliseconds()).toBe(0);
  });

  it("since and endOfDay are on the same calendar date for a single-day query", () => {
    const range = buildMailDateRange("2026-02-25", "2026-02-25");
    expect(range.since.getDate()).toBe(range.endOfDay.getDate());
    expect(range.since.getMonth()).toBe(range.endOfDay.getMonth());
  });

  it("imapBefore is exactly one day after since for a single-day query", () => {
    const range = buildMailDateRange("2026-02-25", "2026-02-25");
    const diff = range.imapBefore.getTime() - range.since.getTime();
    expect(diff).toBe(24 * 60 * 60 * 1000); // exactly 24 hours
  });
});

// ---------------------------------------------------------------------------
// buildMailDateRange — multi-day queries
// ---------------------------------------------------------------------------

describe("buildMailDateRange — multi-day", () => {
  it("since is start of the since date", () => {
    const range = buildMailDateRange("2026-02-20", "2026-02-25");
    expect(range.since.getDate()).toBe(20);
    expect(range.since.getHours()).toBe(0);
  });

  it("endOfDay is end of the before date", () => {
    const range = buildMailDateRange("2026-02-20", "2026-02-25");
    expect(range.endOfDay.getDate()).toBe(25);
    expect(range.endOfDay.getHours()).toBe(23);
    expect(range.endOfDay.getMinutes()).toBe(59);
    expect(range.endOfDay.getSeconds()).toBe(59);
  });

  it("imapBefore is the day after the before date", () => {
    const range = buildMailDateRange("2026-02-20", "2026-02-25");
    expect(range.imapBefore.getDate()).toBe(26);
    expect(range.imapBefore.getHours()).toBe(0);
  });

  it("spans a month boundary correctly", () => {
    const range = buildMailDateRange("2026-01-30", "2026-02-02");
    expect(range.since.getMonth()).toBe(0); // January
    expect(range.since.getDate()).toBe(30);
    expect(range.endOfDay.getMonth()).toBe(1); // February
    expect(range.endOfDay.getDate()).toBe(2);
    expect(range.imapBefore.getMonth()).toBe(1); // February
    expect(range.imapBefore.getDate()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildMailDateRange — defaults
// ---------------------------------------------------------------------------

describe("buildMailDateRange — defaults", () => {
  it("since defaults to start of today", () => {
    const before = new Date();
    before.setHours(0, 0, 0, 0);
    const range = buildMailDateRange();
    // since should equal today's midnight (within a few ms of test execution)
    expect(range.since.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(range.since.getHours()).toBe(0);
    expect(range.since.getMinutes()).toBe(0);
    expect(range.since.getSeconds()).toBe(0);
  });

  it("before defaults to 7 days after since", () => {
    const range = buildMailDateRange("2026-02-25");
    const expectedEndDay = new Date("2026-03-04T00:00:00"); // 7 days after Feb 25
    expect(range.endOfDay.getDate()).toBe(expectedEndDay.getDate());
    expect(range.endOfDay.getMonth()).toBe(expectedEndDay.getMonth());
  });

  it("imapBefore defaults to 8 days after since", () => {
    const range = buildMailDateRange("2026-02-25");
    // 7 days default window → imapBefore = day 8
    const expectedImapBefore = new Date("2026-03-05T00:00:00");
    expect(range.imapBefore.getDate()).toBe(expectedImapBefore.getDate());
    expect(range.imapBefore.getMonth()).toBe(expectedImapBefore.getMonth());
  });
});
