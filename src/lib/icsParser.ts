export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  status?: string;
  rrule?: string;        // raw RRULE value, present on recurring base events
  exdates?: Date[];      // EXDATE excluded occurrence dates
  recurrenceId?: Date;   // RECURRENCE-ID, present on modified single instances
}

interface ParsedLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * RFC 5545 line unfolding: removes CRLF/LF followed by a single whitespace character.
 */
function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.length > 0);
}

function unescapeValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses a content line into name, parameters, and value.
 * Handles: NAME;PARAM1=VAL1;PARAM2=VAL2:value
 */
function parseLine(line: string): ParsedLine | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;

  const namePart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = namePart.split(";");
  const name = parts[0].toUpperCase();

  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx !== -1) {
      params[parts[i].slice(0, eqIdx).toUpperCase()] = parts[i].slice(eqIdx + 1);
    }
  }

  return { name, params, value };
}

/**
 * Parses an ICS date/datetime value.
 * Handles:
 *   - YYYYMMDD (all-day, VALUE=DATE)
 *   - YYYYMMDDTHHMMSSZ (UTC datetime)
 *   - YYYYMMDDTHHMMSS (local or TZID-specified datetime)
 */
export function parseICSDate(
  value: string,
  params: Record<string, string>
): { date: Date; allDay: boolean } {
  const isAllDay = params["VALUE"] === "DATE" || /^\d{8}$/.test(value);

  if (isAllDay) {
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10) - 1;
    const day = parseInt(value.slice(6, 8), 10);
    return { date: new Date(year, month, day), allDay: true };
  }

  if (value.endsWith("Z") && /^\d{8}T\d{6}Z$/.test(value)) {
    const date = new Date(
      Date.UTC(
        parseInt(value.slice(0, 4), 10),
        parseInt(value.slice(4, 6), 10) - 1,
        parseInt(value.slice(6, 8), 10),
        parseInt(value.slice(9, 11), 10),
        parseInt(value.slice(11, 13), 10),
        parseInt(value.slice(13, 15), 10)
      )
    );
    return { date, allDay: false };
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const date = new Date(
      parseInt(value.slice(0, 4), 10),
      parseInt(value.slice(4, 6), 10) - 1,
      parseInt(value.slice(6, 8), 10),
      parseInt(value.slice(9, 11), 10),
      parseInt(value.slice(11, 13), 10),
      parseInt(value.slice(13, 15), 10)
    );
    return { date, allDay: false };
  }

  // Fallback — let Date constructor try
  return { date: new Date(value), allDay: false };
}

/**
 * Parses an ICS text string and returns an array of calendar events.
 * Only VEVENT components are parsed; VTODO, VJOURNAL, etc. are ignored.
 */
export function parseICS(text: string): CalendarEvent[] {
  const lines = unfoldLines(text);
  const events: CalendarEvent[] = [];

  let inEvent = false;
  let current: Partial<CalendarEvent> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;
      if (current.uid && current.summary && current.start !== undefined) {
        events.push(current as CalendarEvent);
      }
      current = {};
      continue;
    }

    if (!inEvent) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;

    switch (parsed.name) {
      case "UID":
        current.uid = parsed.value;
        break;
      case "SUMMARY":
        current.summary = unescapeValue(parsed.value);
        break;
      case "DESCRIPTION":
        current.description = unescapeValue(parsed.value);
        break;
      case "LOCATION":
        current.location = unescapeValue(parsed.value);
        break;
      case "STATUS":
        current.status = parsed.value;
        break;
      case "RRULE":
        current.rrule = parsed.value;
        break;
      case "EXDATE": {
        // Value may be a comma-separated list of dates
        const dates = parsed.value
          .split(",")
          .map((v) => parseICSDate(v.trim(), parsed.params).date);
        current.exdates = [...(current.exdates ?? []), ...dates];
        break;
      }
      case "RECURRENCE-ID": {
        current.recurrenceId = parseICSDate(parsed.value, parsed.params).date;
        break;
      }
      case "DTSTART": {
        const { date, allDay } = parseICSDate(parsed.value, parsed.params);
        current.start = date;
        current.allDay = allDay;
        break;
      }
      case "DTEND": {
        const { date } = parseICSDate(parsed.value, parsed.params);
        current.end = date;
        break;
      }
    }
  }

  return events;
}
