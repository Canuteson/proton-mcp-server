import { describe, it, expect } from "vitest";
import { parseICS } from "../src/lib/icsParser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeICS(vevent: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    vevent.trim(),
    "END:VCALENDAR",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe("parseICS – basic fields", () => {
  it("parses a simple timed event", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:simple@test
SUMMARY:Team meeting
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
STATUS:CONFIRMED
END:VEVENT`);

    const events = parseICS(ics);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.uid).toBe("simple@test");
    expect(e.summary).toBe("Team meeting");
    expect(e.allDay).toBe(false);
    expect(e.status).toBe("CONFIRMED");
    expect(e.start).toEqual(new Date(Date.UTC(2024, 0, 15, 10, 0, 0)));
    expect(e.end).toEqual(new Date(Date.UTC(2024, 0, 15, 11, 0, 0)));
  });

  it("parses an all-day event (VALUE=DATE)", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:allday@test
SUMMARY:Birthday
DTSTART;VALUE=DATE:20240301
DTEND;VALUE=DATE:20240302
END:VEVENT`);

    const events = parseICS(ics);
    expect(events[0].allDay).toBe(true);
    expect(events[0].start).toEqual(new Date(2024, 2, 1));
  });

  it("parses an all-day event (bare YYYYMMDD)", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:allday2@test
SUMMARY:Holiday
DTSTART:20240704
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.allDay).toBe(true);
    expect(event.start).toEqual(new Date(2024, 6, 4));
  });

  it("parses a TZID-qualified datetime as local time", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:tzid@test
SUMMARY:Guitar lessons
DTSTART;TZID=America/Chicago:20250624T170000
DTEND;TZID=America/Chicago:20250624T173000
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.allDay).toBe(false);
    expect(event.start.getHours()).toBe(17);
    expect(event.start.getMinutes()).toBe(0);
  });

  it("unescapes special characters in SUMMARY and DESCRIPTION", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:escape@test
SUMMARY:Lunch\\, dinner
DESCRIPTION:Line1\\nLine2
DTSTART:20240101T120000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.summary).toBe("Lunch, dinner");
    expect(event.description).toBe("Line1\nLine2");
  });

  it("unfolds long lines", () => {
    // RFC 5545 folded line: CRLF + space
    const ics =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n" +
      "UID:fold@test\r\n" +
      "SUMMARY:This is a very long summar\r\n y that is folded\r\n" +
      "DTSTART:20240101T100000Z\r\n" +
      "END:VEVENT\r\nEND:VCALENDAR";

    const [event] = parseICS(ics);
    expect(event.summary).toBe("This is a very long summary that is folded");
  });

  it("ignores VEVENTs missing required fields", () => {
    const ics = makeICS(`
BEGIN:VEVENT
SUMMARY:No UID or start
END:VEVENT`);

    expect(parseICS(ics)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recurring event fields
// ---------------------------------------------------------------------------

describe("parseICS – recurring event fields", () => {
  it("parses RRULE on a recurring event", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:guitar@proton.me
SUMMARY:Guitar lessons
DTSTART;TZID=America/Chicago:20250624T170000
DTEND;TZID=America/Chicago:20250624T173000
RRULE:FREQ=WEEKLY
STATUS:CONFIRMED
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.rrule).toBe("FREQ=WEEKLY");
  });

  it("parses a complex RRULE with multiple parameters", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:complex@test
SUMMARY:Stand-up
DTSTART:20240101T090000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1;UNTIL=20241231T235959Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1;UNTIL=20241231T235959Z"
    );
  });

  it("parses a single EXDATE", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:exdate@test
SUMMARY:Weekly sync
DTSTART:20240101T100000Z
RRULE:FREQ=WEEKLY
EXDATE:20240108T100000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.exdates).toHaveLength(1);
    expect(event.exdates![0]).toEqual(
      new Date(Date.UTC(2024, 0, 8, 10, 0, 0))
    );
  });

  it("parses multiple comma-separated EXDATEs on one line", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:exdates@test
SUMMARY:Weekly sync
DTSTART:20240101T100000Z
RRULE:FREQ=WEEKLY
EXDATE:20240108T100000Z,20240115T100000Z,20240122T100000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.exdates).toHaveLength(3);
  });

  it("parses multiple EXDATE lines and accumulates them", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:exdates2@test
SUMMARY:Weekly sync
DTSTART:20240101T100000Z
RRULE:FREQ=WEEKLY
EXDATE:20240108T100000Z
EXDATE:20240115T100000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.exdates).toHaveLength(2);
  });

  it("parses RECURRENCE-ID on a modified instance", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:guitar@proton.me
SUMMARY:Guitar lessons (rescheduled)
DTSTART:20260224T180000Z
DTEND:20260224T183000Z
RECURRENCE-ID:20260224T170000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.recurrenceId).toEqual(
      new Date(Date.UTC(2026, 1, 24, 17, 0, 0))
    );
    expect(event.rrule).toBeUndefined();
  });

  it("regular events have no rrule, exdates, or recurrenceId", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:plain@test
SUMMARY:One-off event
DTSTART:20240101T100000Z
END:VEVENT`);

    const [event] = parseICS(ics);
    expect(event.rrule).toBeUndefined();
    expect(event.exdates).toBeUndefined();
    expect(event.recurrenceId).toBeUndefined();
  });

  it("parses multiple events including a mix of recurring and regular", () => {
    const ics = makeICS(`
BEGIN:VEVENT
UID:recurring@test
SUMMARY:Weekly
DTSTART:20240101T100000Z
RRULE:FREQ=WEEKLY
END:VEVENT
BEGIN:VEVENT
UID:oneoff@test
SUMMARY:One-off
DTSTART:20240110T140000Z
END:VEVENT`);

    const events = parseICS(ics);
    expect(events).toHaveLength(2);
    const recurring = events.find((e) => e.uid === "recurring@test")!;
    const oneoff = events.find((e) => e.uid === "oneoff@test")!;
    expect(recurring.rrule).toBe("FREQ=WEEKLY");
    expect(oneoff.rrule).toBeUndefined();
  });
});
