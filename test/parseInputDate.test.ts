import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Re-implement the helper here to test it in isolation.
// The actual function lives in CalendarTool.ts (module-private).
// ---------------------------------------------------------------------------

function parseInputDate(dateStr: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T00:00:00`)
    : new Date(dateStr);
}

describe("parseInputDate", () => {
  it("parses a date-only string as local midnight, not UTC midnight", () => {
    const d = parseInputDate("2026-02-24");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // February (0-indexed)
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("single-day query: start and end on the same date cover the full local day", () => {
    const start = parseInputDate("2026-02-24");
    const end = parseInputDate("2026-02-24");
    end.setHours(23, 59, 59, 999);

    // An event at 17:00 local on Feb 24 should fall within the range
    const guitarLesson = new Date(2026, 1, 24, 17, 0, 0);
    expect(guitarLesson >= start).toBe(true);
    expect(guitarLesson <= end).toBe(true);
  });

  it("does not shift the date backward in negative UTC-offset timezones", () => {
    // The bug: new Date("2026-02-24") in UTC-6 gives Feb 23 at 18:00 local.
    // With the fix, it should always give Feb 24 at 00:00 local.
    const d = parseInputDate("2026-02-24");
    // Regardless of the local timezone offset, the calendar date must be Feb 24.
    expect(d.getDate()).toBe(24);
    expect(d.getMonth()).toBe(1);
  });

  it("passes datetime strings through unchanged", () => {
    const d = parseInputDate("2026-02-24T15:30:00");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(30);
  });

  it("returns an invalid Date for garbage input", () => {
    expect(isNaN(parseInputDate("not-a-date").getTime())).toBe(true);
  });
});
