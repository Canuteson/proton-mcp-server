import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { parseICS, type CalendarEvent } from "../lib/icsParser.js";
import { expandRecurring } from "../lib/rruleExpander.js";

interface CalendarConfig {
  name: string;
  url: string;
}

/**
 * Loads calendar configurations from environment variables.
 *
 * Supported formats:
 *
 * 1. JSON array via PROTON_CALENDARS (preferred for multiple calendars):
 *    PROTON_CALENDARS='[{"name":"Family","url":"https://..."},{"name":"Work","url":"https://..."}]'
 *
 * 2. Individual env vars per calendar (CALENDAR_<NAME>_URL):
 *    CALENDAR_FAMILY_URL=https://...
 *    CALENDAR_WORK_URL=https://...
 */
function loadCalendars(): CalendarConfig[] {
  const json = process.env.PROTON_CALENDARS;

  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error(
        "PROTON_CALENDARS is not valid JSON. Expected an array like: " +
          '[{"name":"Family","url":"https://..."}]'
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error("PROTON_CALENDARS must be a JSON array.");
    }
    return parsed as CalendarConfig[];
  }

  // Fallback: discover from CALENDAR_<NAME>_URL env vars
  const calendars: CalendarConfig[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^CALENDAR_(.+)_URL$/);
    if (match && value) {
      const name = match[1]
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      calendars.push({ name, url: value });
    }
  }

  return calendars;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// How far back/ahead to pre-expand recurring event occurrences
const RECURRING_LOOKBACK_DAYS = 30;
const RECURRING_LOOKAHEAD_DAYS = 90;

interface CacheEntry {
  events: CalendarEvent[];
  expiresAt: number;
}

/** Caches all parsed events (regular + recurring base) keyed by calendar URL. */
const icsCache = new Map<string, CacheEntry>();

/** Caches pre-expanded recurring occurrences keyed by calendar URL. */
const recurringCache = new Map<string, CacheEntry>();

function getCached(url: string): CalendarEvent[] | null {
  const entry = icsCache.get(url);
  if (!entry || Date.now() > entry.expiresAt) {
    icsCache.delete(url);
    return null;
  }
  return entry.events;
}

function setCached(url: string, events: CalendarEvent[]): void {
  icsCache.set(url, { events, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getCachedRecurring(url: string): CalendarEvent[] | null {
  const entry = recurringCache.get(url);
  if (!entry || Date.now() > entry.expiresAt) {
    recurringCache.delete(url);
    return null;
  }
  return entry.events;
}

function setCachedRecurring(url: string, events: CalendarEvent[]): void {
  recurringCache.set(url, { events, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Expands all recurring events from a parsed ICS feed into individual
 * occurrences covering the pre-configured look-back / look-ahead window.
 *
 * Handles EXDATE and RECURRENCE-ID (modified single instances) by building
 * per-UID exclusion sets so those dates are skipped during expansion.
 * Modified instances are already present in allEvents as standalone VEVENTs
 * and will be returned by the regular event filter.
 */
function expandAllRecurring(allEvents: CalendarEvent[]): CalendarEvent[] {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RECURRING_LOOKBACK_DAYS * 86_400_000);
  const windowEnd   = new Date(now.getTime() + RECURRING_LOOKAHEAD_DAYS * 86_400_000);

  // Collect RECURRENCE-ID timestamps per UID so we can exclude them from expansion
  const recurrenceIdsByUid = new Map<string, Set<number>>();
  for (const event of allEvents) {
    if (event.recurrenceId) {
      const set = recurrenceIdsByUid.get(event.uid) ?? new Set<number>();
      set.add(event.recurrenceId.getTime());
      recurrenceIdsByUid.set(event.uid, set);
    }
  }

  const occurrences: CalendarEvent[] = [];

  for (const event of allEvents) {
    if (!event.rrule) continue;

    const excluded = new Set<number>([
      ...(event.exdates ?? []).map((d) => d.getTime()),
      ...(recurrenceIdsByUid.get(event.uid) ?? []),
    ]);

    occurrences.push(...expandRecurring(event, windowStart, windowEnd, excluded));
  }

  return occurrences;
}

/**
 * Parses a user-supplied date string as local midnight.
 *
 * JavaScript's Date constructor treats ISO date-only strings ("YYYY-MM-DD") as
 * UTC midnight, which shifts the date to the previous calendar day in any
 * negative-offset timezone (e.g. "2026-02-24" → Feb 23 at 18:00 in CST).
 * Appending T00:00:00 forces the engine to use local time instead.
 */
function parseInputDate(dateStr: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T00:00:00`)
    : new Date(dateStr);
}

interface CalendarInput {
  action: "list_calendars" | "get_events";
  calendar_name?: string;
  start_date?: string;
  end_date?: string;
}

class CalendarTool extends MCPTool<CalendarInput> {
  name = "calendar";
  description =
    "Fetches events from Proton Mail calendars via secret ICS links. " +
    "Use 'list_calendars' to see which calendars are configured, then " +
    "'get_events' to retrieve events for a specific calendar and date range.";

  schema = {
    action: {
      type: z.enum(["list_calendars", "get_events"]),
      description:
        "Action to perform: 'list_calendars' returns all configured calendar names; " +
        "'get_events' fetches events from a specific calendar for a date range.",
    },
    calendar_name: {
      type: z.string().optional(),
      description:
        "Name of the calendar to fetch events from. Required when action is 'get_events'. " +
        "Use list_calendars first to see available names.",
    },
    start_date: {
      type: z.string().optional(),
      description:
        "Start of the date range in ISO 8601 format (e.g. '2024-01-15'). " +
        "Defaults to today when omitted. " +
        "For a single-day query (e.g. 'today' or 'this Friday'), set both " +
        "start_date and end_date to the same date.",
    },
    end_date: {
      type: z.string().optional(),
      description:
        "End of the date range in ISO 8601 format (e.g. '2024-01-22'). " +
        "Defaults to 7 days after start_date when omitted. " +
        "For a single-day query, set this to the same value as start_date.",
    },
  };

  async execute(input: CalendarInput): Promise<string> {
    if (input.action === "list_calendars") {
      return this.listCalendars();
    }
    return this.getEvents(input);
  }

  private listCalendars(): string {
    let calendars: CalendarConfig[];
    try {
      calendars = loadCalendars();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (calendars.length === 0) {
      return (
        "No calendars are configured.\n\n" +
        "To add calendars, set one of the following environment variables:\n\n" +
        "Option 1 — JSON array (recommended):\n" +
        '  PROTON_CALENDARS=\'[{"name":"Family","url":"https://..."},{"name":"Work","url":"https://..."}]\'\n\n' +
        "Option 2 — individual variables per calendar:\n" +
        "  CALENDAR_FAMILY_URL=https://...\n" +
        "  CALENDAR_WORK_URL=https://..."
      );
    }

    const lines = [`Configured calendars (${calendars.length}):`, ""];
    for (const cal of calendars) {
      lines.push(`- ${cal.name}`);
    }
    return lines.join("\n");
  }

  private async getEvents(input: CalendarInput): Promise<string> {
    if (!input.calendar_name) {
      return "Error: calendar_name is required for the get_events action. Use list_calendars first to see available calendar names.";
    }

    let calendars: CalendarConfig[];
    try {
      calendars = loadCalendars();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const calendar = calendars.find(
      (c) => c.name.toLowerCase() === input.calendar_name!.toLowerCase()
    );

    if (!calendar) {
      const names = calendars.map((c) => `"${c.name}"`).join(", ");
      return (
        `Calendar "${input.calendar_name}" not found.\n` +
        `Available calendars: ${names || "none configured"}.`
      );
    }

    const startDate = input.start_date
      ? parseInputDate(input.start_date)
      : this.startOfToday();

    if (isNaN(startDate.getTime())) {
      return `Invalid start_date: "${input.start_date}". Use ISO 8601 format, e.g. "2024-01-15".`;
    }

    let endDate: Date;
    if (input.end_date) {
      endDate = parseInputDate(input.end_date);
      if (isNaN(endDate.getTime())) {
        return `Invalid end_date: "${input.end_date}". Use ISO 8601 format, e.g. "2024-01-22".`;
      }
    } else {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
    }
    endDate.setHours(23, 59, 59, 999);

    let allParsed = getCached(calendar.url);

    if (!allParsed) {
      let icsText: string;
      try {
        const response = await fetch(calendar.url);
        if (!response.ok) {
          return `Failed to fetch calendar "${calendar.name}": HTTP ${response.status} ${response.statusText}`;
        }
        icsText = await response.text();
      } catch (err) {
        return `Failed to fetch calendar "${calendar.name}": ${err instanceof Error ? err.message : String(err)}`;
      }
      allParsed = parseICS(icsText);
      setCached(calendar.url, allParsed);
      // Always recompute recurring occurrences when we do a fresh fetch
      recurringCache.delete(calendar.url);
    }

    // Expand recurring events if not already cached
    let recurringOccurrences = getCachedRecurring(calendar.url);
    if (!recurringOccurrences) {
      recurringOccurrences = expandAllRecurring(allParsed);
      setCachedRecurring(calendar.url, recurringOccurrences);
    }

    // Combine: non-recurring events + expanded occurrences, then filter by range
    const regularEvents = allParsed.filter((e) => !e.rrule);
    const combined = [...regularEvents, ...recurringOccurrences];

    const events = combined
      .filter((event) => {
        const eventEnd = event.end ?? event.start;
        return event.start <= endDate && eventEnd >= startDate;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    return this.formatEvents(calendar.name, events, startDate, endDate);
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatEvents(
    calendarName: string,
    events: CalendarEvent[],
    start: Date,
    end: Date
  ): string {
    const lines: string[] = [
      `Calendar: ${calendarName}`,
      `Range: ${this.formatDateShort(start)} – ${this.formatDateShort(end)}`,
      "",
    ];

    if (events.length === 0) {
      lines.push("No events found in this date range.");
      return lines.join("\n");
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const cancelled = event.status === "CANCELLED" ? " [CANCELLED]" : "";
      lines.push(`${i + 1}. ${event.summary}${cancelled}`);

      if (event.allDay) {
        lines.push(`   Date: ${this.formatDateLong(event.start)} (All Day)`);
      } else {
        const endStr = event.end ? ` – ${this.formatTime(event.end)}` : "";
        lines.push(
          `   Date: ${this.formatDateLong(event.start)} at ${this.formatTime(event.start)}${endStr}`
        );
      }

      if (event.location) {
        lines.push(`   Location: ${event.location}`);
      }

      if (event.description) {
        const trimmed = event.description.replace(/\n/g, " ").trim();
        const preview =
          trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
        lines.push(`   Description: ${preview}`);
      }

      lines.push("");
    }

    lines.push(
      `Total: ${events.length} event${events.length !== 1 ? "s" : ""}`
    );
    return lines.join("\n");
  }

  private formatDateShort(date: Date): string {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  private formatDateLong(date: Date): string {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }
}

export default CalendarTool;
