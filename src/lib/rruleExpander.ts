import type { CalendarEvent } from "./icsParser.js";

// Maps RFC 5545 day codes to JS Date.getDay() values (0=Sun … 6=Sat)
const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface ParsedByDay {
  n?: number; // nth occurrence prefix (e.g. 2 = "2nd", -1 = "last")
  day: number; // JS weekday 0–6
}

interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  until?: Date;
  count?: number;
  byDay: ParsedByDay[];
  byMonthDay: number[];
  byMonth: number[]; // 0-indexed (Jan=0)
}

function parseRRule(str: string): RRule | null {
  const props: Record<string, string> = {};
  for (const seg of str.split(";")) {
    const i = seg.indexOf("=");
    if (i !== -1) props[seg.slice(0, i)] = seg.slice(i + 1);
  }

  const freq = props["FREQ"] as RRule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  const rule: RRule = {
    freq,
    interval: props["INTERVAL"] ? Math.max(1, parseInt(props["INTERVAL"], 10)) : 1,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
  };

  if (props["UNTIL"]) {
    const s = props["UNTIL"];
    if (s.endsWith("Z") && s.length >= 15) {
      rule.until = new Date(
        Date.UTC(
          +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
          +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15)
        )
      );
    } else if (s.length >= 8) {
      rule.until = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    }
  }

  if (props["COUNT"]) rule.count = parseInt(props["COUNT"], 10);

  if (props["BYDAY"]) {
    rule.byDay = props["BYDAY"].split(",").flatMap((d) => {
      const m = d.match(/^(-?\d+)?([A-Z]{2})$/);
      return m && DAY_MAP[m[2]] !== undefined
        ? [{ n: m[1] !== undefined ? +m[1] : undefined, day: DAY_MAP[m[2]] }]
        : [];
    });
  }

  if (props["BYMONTHDAY"]) {
    rule.byMonthDay = props["BYMONTHDAY"].split(",").map(Number);
  }

  if (props["BYMONTH"]) {
    rule.byMonth = props["BYMONTH"].split(",").map((n) => +n - 1);
  }

  return rule;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Returns a new Date on date's calendar day but with source's time-of-day. */
function withTime(date: Date, source: Date): Date {
  return new Date(
    date.getFullYear(), date.getMonth(), date.getDate(),
    source.getHours(), source.getMinutes(), source.getSeconds()
  );
}

/** Advance an anchor date by one recurrence period. */
function advanceAnchor(rule: RRule, d: Date): Date {
  const r = new Date(d);
  switch (rule.freq) {
    case "DAILY":   r.setDate(d.getDate() + rule.interval); break;
    case "WEEKLY":  r.setDate(d.getDate() + 7 * rule.interval); break;
    case "MONTHLY": r.setMonth(d.getMonth() + rule.interval); break;
    case "YEARLY":  r.setFullYear(d.getFullYear() + rule.interval); break;
  }
  return r;
}

/**
 * Returns the date of the nth (or last, if n<0) occurrence of weekday in a month.
 * Returns null if that occurrence doesn't exist.
 */
function nthWeekdayOfMonth(
  year: number, month: number, weekday: number, n: number
): Date | null {
  if (n > 0) {
    const firstOfMonth = new Date(year, month, 1);
    const diff = (weekday - firstOfMonth.getDay() + 7) % 7;
    const day = 1 + diff + (n - 1) * 7;
    return day <= daysInMonth(year, month) ? new Date(year, month, day) : null;
  } else {
    const lastDay = daysInMonth(year, month);
    const lastOfMonth = new Date(year, month, lastDay);
    const diff = (lastOfMonth.getDay() - weekday + 7) % 7;
    const day = lastDay - diff + (n + 1) * 7;
    return day >= 1 ? new Date(year, month, day) : null;
  }
}

/**
 * Generates candidate occurrence dates for a single anchor period.
 * dtStart provides the time-of-day to apply to all candidates.
 */
function getCandidates(rule: RRule, anchor: Date, dtStart: Date): Date[] {
  switch (rule.freq) {
    case "DAILY":
      return [withTime(anchor, dtStart)];

    case "WEEKLY": {
      // When no BYDAY, repeat on the same weekday as dtStart
      const targetDays =
        rule.byDay.length > 0
          ? rule.byDay.map((b) => b.day)
          : [dtStart.getDay()];

      // Find Monday of the anchor's ISO week
      const dow = anchor.getDay();
      const monday = new Date(anchor);
      monday.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));

      return targetDays.map((day) => {
        // Mon-based offset: MO=0, TU=1, …, SU=6
        const offset = day === 0 ? 6 : day - 1;
        const d = new Date(monday);
        d.setDate(monday.getDate() + offset);
        return withTime(d, dtStart);
      });
    }

    case "MONTHLY": {
      const y = anchor.getFullYear();
      const m = anchor.getMonth();

      if (rule.byMonthDay.length > 0) {
        return rule.byMonthDay.flatMap((md) => {
          const day = md > 0 ? md : daysInMonth(y, m) + md + 1;
          return day >= 1 && day <= daysInMonth(y, m)
            ? [withTime(new Date(y, m, day), dtStart)]
            : [];
        });
      }

      if (rule.byDay.length > 0) {
        return rule.byDay.flatMap(({ n, day }) => {
          if (n !== undefined) {
            const d = nthWeekdayOfMonth(y, m, day, n);
            return d ? [withTime(d, dtStart)] : [];
          }
          // All occurrences of this weekday in the month
          const results: Date[] = [];
          for (let i = 1; i <= daysInMonth(y, m); i++) {
            const d = new Date(y, m, i);
            if (d.getDay() === day) results.push(withTime(d, dtStart));
          }
          return results;
        });
      }

      // Default: same day-of-month as dtStart, skip if month is shorter
      const day = dtStart.getDate();
      return day <= daysInMonth(y, m)
        ? [withTime(new Date(y, m, day), dtStart)]
        : [];
    }

    case "YEARLY": {
      const y = anchor.getFullYear();
      const months =
        rule.byMonth.length > 0 ? rule.byMonth : [dtStart.getMonth()];

      return months.flatMap((m) => {
        if (rule.byDay.length > 0) {
          return rule.byDay.flatMap(({ n, day }) => {
            if (n !== undefined) {
              const d = nthWeekdayOfMonth(y, m, day, n);
              return d ? [withTime(d, dtStart)] : [];
            }
            const results: Date[] = [];
            for (let i = 1; i <= daysInMonth(y, m); i++) {
              const d = new Date(y, m, i);
              if (d.getDay() === day) results.push(withTime(d, dtStart));
            }
            return results;
          });
        }
        const day = dtStart.getDate();
        return day <= daysInMonth(y, m)
          ? [withTime(new Date(y, m, day), dtStart)]
          : [];
      });
    }
  }
}

/**
 * Expands a recurring calendar event into individual occurrence instances
 * within the given window.
 *
 * @param event        The base recurring event (must have event.rrule set)
 * @param windowStart  Start of the expansion window
 * @param windowEnd    End of the expansion window
 * @param excludedTimes Set of epoch-ms timestamps to exclude (from EXDATE /
 *                     RECURRENCE-ID of modified instances)
 */
export function expandRecurring(
  event: CalendarEvent,
  windowStart: Date,
  windowEnd: Date,
  excludedTimes: Set<number> = new Set()
): CalendarEvent[] {
  if (!event.rrule) return [];

  const rule = parseRRule(event.rrule);
  if (!rule) return [];

  const duration =
    event.end ? event.end.getTime() - event.start.getTime() : 0;

  const results: CalendarEvent[] = [];
  let totalCount = 0; // counts every generated occurrence for COUNT enforcement

  let anchor = new Date(event.start);

  // Fast-forward to near windowStart when there's no COUNT limit.
  // Skipping is safe without COUNT because we don't need to track skipped ones.
  if (!rule.count && anchor < windowStart) {
    const DAY_MS = 86_400_000;
    const approxMs =
      rule.freq === "DAILY"   ? rule.interval * DAY_MS :
      rule.freq === "WEEKLY"  ? rule.interval * 7 * DAY_MS :
      rule.freq === "MONTHLY" ? rule.interval * 30 * DAY_MS :
      /* YEARLY */              rule.interval * 365 * DAY_MS;

    // Subtract 2 periods to avoid overshooting the window
    const skip = Math.max(
      0,
      Math.floor((windowStart.getTime() - anchor.getTime()) / approxMs) - 2
    );
    for (let i = 0; i < skip; i++) anchor = advanceAnchor(rule, anchor);
  }

  const MAX_ITER = 5000;

  for (let iter = 0; iter < MAX_ITER && anchor <= windowEnd; iter++) {
    if (rule.until && anchor > rule.until) break;

    const candidates = getCandidates(rule, anchor, event.start);

    for (const c of candidates) {
      if (c < event.start) continue; // before event inception

      if (rule.until && c > rule.until) return results;

      totalCount++;
      if (rule.count !== undefined && totalCount > rule.count) return results;

      if (c > windowEnd) return results;

      if (!excludedTimes.has(c.getTime())) {
        const end = duration > 0 ? new Date(c.getTime() + duration) : undefined;
        const occEnd = end ?? c;
        // Include only if the occurrence overlaps the window
        if (c <= windowEnd && occEnd >= windowStart) {
          results.push({
            ...event,
            start: c,
            end,
            rrule: undefined,    // instances are not themselves recurring
            exdates: undefined,
          });
        }
      }
    }

    anchor = advanceAnchor(rule, anchor);
  }

  return results;
}
