/**
 * Parses an ISO date string to a Date, treating date-only strings as local
 * midnight rather than UTC midnight.
 *
 * JavaScript's Date constructor parses "YYYY-MM-DD" as UTC midnight, which
 * shifts the displayed date backward by one day in negative-offset timezones
 * (e.g. "2026-02-25" → Feb 24 at 18:00 CST). Appending T00:00:00 forces
 * local-time interpretation.
 */
export function parseMailDate(dateStr: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T00:00:00`)
    : new Date(dateStr);
}

/** Returns a copy of date set to the very start of its local day (00:00:00.000). */
export function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns a copy of date set to the very end of its local day (23:59:59.999). */
export function toEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Returns the start of the day after date (i.e. 00:00:00.000 of date + 1 day).
 *
 * IMAP BEFORE is an exclusive upper bound at day granularity: "BEFORE <date>"
 * matches messages received before the start of <date>. To include all messages
 * received on the user's requested end date, pass toStartOfNextDay(endDate) as
 * the IMAP BEFORE criterion.
 */
export function toStartOfNextDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface MailDateRange {
  /** Inclusive start: start of the `since` day at 00:00:00.000 (local). */
  since: Date;
  /** Inclusive end: end of the `before` day at 23:59:59.999 (local), for display/filtering. */
  endOfDay: Date;
  /**
   * Exclusive upper bound for IMAP BEFORE criteria.
   * This is the start of the day after `endOfDay`.
   * IMAP BEFORE matches messages received before this date at day granularity.
   */
  imapBefore: Date;
}

/**
 * Builds a MailDateRange from optional ISO date strings.
 *
 * - `sinceStr` defaults to today (start of today).
 * - `beforeStr` defaults to 7 days after `sinceStr`.
 * - Pass the same value for both to query a single day.
 */
export function buildMailDateRange(sinceStr?: string, beforeStr?: string): MailDateRange {
  const since = toStartOfDay(sinceStr ? parseMailDate(sinceStr) : new Date());

  const endDate = beforeStr
    ? parseMailDate(beforeStr)
    : new Date(since.getTime() + 7 * 86_400_000);

  return {
    since,
    endOfDay: toEndOfDay(endDate),
    imapBefore: toStartOfNextDay(endDate),
  };
}
