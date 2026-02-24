import { describe, it, expect } from "vitest";
import { expandRecurring } from "../src/lib/rruleExpander.js";
import type { CalendarEvent } from "../src/lib/icsParser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<CalendarEvent> & { rrule: string }): CalendarEvent {
  return {
    uid: "test@test",
    summary: "Test Event",
    allDay: false,
    start: new Date(2024, 0, 1, 10, 0, 0), // Mon Jan 1 2024 10:00 local
    end:   new Date(2024, 0, 1, 11, 0, 0), // 1 hour duration
    ...overrides,
  };
}

function startTimes(events: CalendarEvent[]): Date[] {
  return events.map((e) => e.start);
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** End of day — matches how CalendarTool constructs window end dates. */
function eod(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 23, 59, 59, 999);
}

// ---------------------------------------------------------------------------
// WEEKLY
// ---------------------------------------------------------------------------

describe("expandRecurring – FREQ=WEEKLY", () => {
  it("generates weekly occurrences on the same weekday as DTSTART", () => {
    // DTSTART: Mon Jan 1 2024
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const result = expandRecurring(event, new Date(2024, 0, 1), eod(2024, 0, 29));
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22", "2024-01-29"]);
  });

  it("guitar lesson – finds occurrence on Feb 24 2026 (35 weeks after Jun 24 2025)", () => {
    // This is the exact real-world case that prompted recurrence support
    const event = makeEvent({
      uid: "gI7SXFau1qSthVe73-mSdgUYpE96@proton.me",
      summary: "Guitar lessons",
      rrule: "FREQ=WEEKLY",
      start: new Date(2025, 5, 24, 17, 0, 0), // Tue Jun 24 2025 17:00
      end:   new Date(2025, 5, 24, 17, 30, 0),
    });

    const weekStart = new Date(2026, 1, 23); // Mon Feb 23 2026
    const weekEnd   = new Date(2026, 2,  1); // Sun Mar 1  2026

    const result = expandRecurring(event, weekStart, weekEnd);
    const dates = startTimes(result).map(ymd);
    expect(dates).toContain("2026-02-24"); // Tuesday
  });

  it("guitar lesson occurrence has the correct time of day", () => {
    const event = makeEvent({
      rrule: "FREQ=WEEKLY",
      start: new Date(2025, 5, 24, 17, 0, 0),
      end:   new Date(2025, 5, 24, 17, 30, 0),
    });

    const result = expandRecurring(
      event,
      new Date(2026, 1, 23),
      new Date(2026, 2,  1)
    );

    const feb24 = result.find((e) => ymd(e.start) === "2026-02-24")!;
    expect(feb24).toBeDefined();
    expect(feb24.start.getHours()).toBe(17);
    expect(feb24.start.getMinutes()).toBe(0);
    expect(feb24.end!.getHours()).toBe(17);
    expect(feb24.end!.getMinutes()).toBe(30);
  });

  it("respects INTERVAL=2 (bi-weekly)", () => {
    // DTSTART Mon Jan 1 2024, every 2 weeks
    const event = makeEvent({ rrule: "FREQ=WEEKLY;INTERVAL=2" });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 1, 0) // Jan 31
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-15", "2024-01-29"]);
  });

  it("BYDAY restricts to specified weekdays", () => {
    // Every Mon/Wed/Fri starting Jan 1 2024 (Monday)
    const event = makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 7) // Jan 7
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-03", "2024-01-05"]);
  });

  it("BYDAY with INTERVAL=2 skips alternate weeks", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2" });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 21)
    );
    const dates = startTimes(result).map(ymd);
    // Week of Jan 1: Mon Jan 1, Wed Jan 3
    // Skip week of Jan 8
    // Week of Jan 15: Mon Jan 15, Wed Jan 17
    expect(dates).toEqual(["2024-01-01", "2024-01-03", "2024-01-15", "2024-01-17"]);
  });

  it("stops at UNTIL date", () => {
    const event = makeEvent({
      rrule: "FREQ=WEEKLY;UNTIL=20240115T235959Z",
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 31)
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-08", "2024-01-15"]);
  });

  it("stops after COUNT occurrences", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY;COUNT=3" });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2025, 0, 1) // wide window
    );
    expect(result).toHaveLength(3);
    expect(ymd(result[2].start)).toBe("2024-01-15");
  });

  it("instances have rrule cleared", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 14)
    );
    for (const occ of result) {
      expect(occ.rrule).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// DAILY
// ---------------------------------------------------------------------------

describe("expandRecurring – FREQ=DAILY", () => {
  it("generates daily occurrences", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY" });
    const result = expandRecurring(event, new Date(2024, 0, 1), eod(2024, 0, 5));
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual([
      "2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
    ]);
  });

  it("respects INTERVAL=3", () => {
    const event = makeEvent({ rrule: "FREQ=DAILY;INTERVAL=3" });
    const result = expandRecurring(event, new Date(2024, 0, 1), eod(2024, 0, 10));
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-04", "2024-01-07", "2024-01-10"]);
  });

  it("fast-forwards correctly when DTSTART is far in the past", () => {
    // DTSTART Jan 1 2020, query 4 years later
    const event = makeEvent({
      rrule: "FREQ=DAILY",
      start: new Date(2020, 0, 1, 10, 0, 0),
      end:   new Date(2020, 0, 1, 11, 0, 0),
    });
    const result = expandRecurring(event, new Date(2024, 0, 1), eod(2024, 0, 3));
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });
});

// ---------------------------------------------------------------------------
// MONTHLY
// ---------------------------------------------------------------------------

describe("expandRecurring – FREQ=MONTHLY", () => {
  it("repeats on the same day of month as DTSTART", () => {
    // DTSTART Jan 15
    const event = makeEvent({
      rrule: "FREQ=MONTHLY",
      start: new Date(2024, 0, 15, 10, 0, 0),
      end:   new Date(2024, 0, 15, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 4, 31) // Jan–May
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual([
      "2024-01-15", "2024-02-15", "2024-03-15", "2024-04-15", "2024-05-15",
    ]);
  });

  it("BYMONTHDAY specifies the day", () => {
    const event = makeEvent({
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
      start: new Date(2024, 0, 1, 10, 0, 0),
      end:   new Date(2024, 0, 1, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 2, 31)
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
  });

  it("BYDAY=2TU gives the 2nd Tuesday of each month", () => {
    const event = makeEvent({
      rrule: "FREQ=MONTHLY;BYDAY=2TU",
      start: new Date(2024, 0, 9, 10, 0, 0), // 2nd Tuesday of Jan 2024
      end:   new Date(2024, 0, 9, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 2, 31)
    );
    const dates = startTimes(result).map(ymd);
    // 2nd Tuesday: Jan 9, Feb 13, Mar 12
    expect(dates).toEqual(["2024-01-09", "2024-02-13", "2024-03-12"]);
    for (const d of result) {
      expect(d.start.getDay()).toBe(2); // Tuesday
    }
  });

  it("BYDAY=-1FR gives the last Friday of each month", () => {
    const event = makeEvent({
      rrule: "FREQ=MONTHLY;BYDAY=-1FR",
      start: new Date(2024, 0, 26, 10, 0, 0), // last Friday of Jan 2024
      end:   new Date(2024, 0, 26, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 2, 31)
    );
    const dates = startTimes(result).map(ymd);
    // Last Friday: Jan 26, Feb 23, Mar 29
    expect(dates).toEqual(["2024-01-26", "2024-02-23", "2024-03-29"]);
    for (const d of result) {
      expect(d.start.getDay()).toBe(5); // Friday
    }
  });

  it("skips months where the day does not exist (e.g. Jan 31 → no Feb 31)", () => {
    const event = makeEvent({
      rrule: "FREQ=MONTHLY",
      start: new Date(2024, 0, 31, 10, 0, 0), // Jan 31
      end:   new Date(2024, 0, 31, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 3, 30)
    );
    const dates = startTimes(result).map(ymd);
    // Feb has no 31st → skipped; March has 31st; April has no 31st → skipped
    expect(dates).toEqual(["2024-01-31", "2024-03-31"]);
  });
});

// ---------------------------------------------------------------------------
// YEARLY
// ---------------------------------------------------------------------------

describe("expandRecurring – FREQ=YEARLY", () => {
  it("repeats on the same date each year", () => {
    const event = makeEvent({
      rrule: "FREQ=YEARLY",
      start: new Date(2020, 6, 4, 10, 0, 0), // Jul 4
      end:   new Date(2020, 6, 4, 11, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2020, 0, 1),
      new Date(2024, 11, 31)
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual([
      "2020-07-04", "2021-07-04", "2022-07-04", "2023-07-04", "2024-07-04",
    ]);
  });

  it("BYMONTH+BYDAY: last Monday of November (US Thanksgiving-style)", () => {
    const event = makeEvent({
      // 4th Thursday of November
      rrule: "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
      start: new Date(2023, 10, 23, 17, 0, 0), // Nov 23 2023
      end:   new Date(2023, 10, 23, 21, 0, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2023, 0, 1),
      new Date(2025, 11, 31)
    );
    const dates = startTimes(result).map(ymd);
    // 4th Thursday of November: 2023=Nov 23, 2024=Nov 28, 2025=Nov 27
    expect(dates).toEqual(["2023-11-23", "2024-11-28", "2025-11-27"]);
    for (const d of result) {
      expect(d.start.getDay()).toBe(4); // Thursday
      expect(d.start.getMonth()).toBe(10); // November (0-indexed)
    }
  });
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

describe("expandRecurring – exclusions", () => {
  it("skips dates in the excludedTimes set (EXDATE)", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const skip = new Date(2024, 0, 8, 10, 0, 0); // second occurrence
    const excluded = new Set([skip.getTime()]);

    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      eod(2024, 0, 22),
      excluded
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).toEqual(["2024-01-01", "2024-01-15", "2024-01-22"]);
    expect(dates).not.toContain("2024-01-08");
  });

  it("skips multiple excluded dates", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const excl = [
      new Date(2024, 0, 8, 10, 0, 0),
      new Date(2024, 0, 22, 10, 0, 0),
    ];
    const excluded = new Set(excl.map((d) => d.getTime()));

    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      eod(2024, 0, 29),
      excluded
    );
    const dates = startTimes(result).map(ymd);
    expect(dates).not.toContain("2024-01-08");
    expect(dates).not.toContain("2024-01-22");
    expect(dates).toContain("2024-01-01");
    expect(dates).toContain("2024-01-15");
    expect(dates).toContain("2024-01-29");
  });

  it("returns no events before DTSTART even if window starts earlier", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const result = expandRecurring(
      event,
      new Date(2023, 0, 1), // window starts a year before DTSTART
      new Date(2024, 0, 14)
    );
    const dates = startTimes(result).map(ymd);
    // Only Jan 1 and Jan 8 2024 — nothing before DTSTART
    expect(dates).toEqual(["2024-01-01", "2024-01-08"]);
  });

  it("returns empty when window is entirely before DTSTART", () => {
    const event = makeEvent({ rrule: "FREQ=WEEKLY" });
    const result = expandRecurring(
      event,
      new Date(2023, 0, 1),
      new Date(2023, 11, 31)
    );
    expect(result).toHaveLength(0);
  });

  it("returns empty when COUNT is exhausted before window", () => {
    // 3 weekly occurrences Jan 1–15 2024; window is Feb 2024
    const event = makeEvent({ rrule: "FREQ=WEEKLY;COUNT=3" });
    const result = expandRecurring(
      event,
      new Date(2024, 1, 1),
      new Date(2024, 1, 29)
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Event metadata preservation
// ---------------------------------------------------------------------------

describe("expandRecurring – metadata preservation", () => {
  it("preserves summary, description, location, status", () => {
    const event = makeEvent({
      rrule: "FREQ=WEEKLY",
      summary: "Guitar lessons",
      description: "Weekly guitar practice",
      location: "Music school",
      status: "CONFIRMED",
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 7)
    );
    const occ = result[0];
    expect(occ.summary).toBe("Guitar lessons");
    expect(occ.description).toBe("Weekly guitar practice");
    expect(occ.location).toBe("Music school");
    expect(occ.status).toBe("CONFIRMED");
  });

  it("preserves the event duration across all occurrences", () => {
    // 90-minute event
    const event = makeEvent({
      rrule: "FREQ=WEEKLY",
      start: new Date(2024, 0, 1, 17, 0, 0),
      end:   new Date(2024, 0, 1, 18, 30, 0),
    });
    const result = expandRecurring(
      event,
      new Date(2024, 0, 1),
      new Date(2024, 0, 21)
    );
    for (const occ of result) {
      const durationMs = occ.end!.getTime() - occ.start.getTime();
      expect(durationMs).toBe(90 * 60 * 1000);
    }
  });
});
