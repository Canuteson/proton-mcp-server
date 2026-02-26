import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { loadImapConfig } from "../lib/imapConfig.js";
import {
  withImapClient,
  toMailMessageMeta,
  fmtDate,
  fmtDateTime,
  fmtSize,
  type MailMessageMeta,
} from "../lib/imapClient.js";
import { buildMailDateRange } from "../lib/mailHelpers.js";

interface ListMailMessagesInput {
  folder?: string;
  since?: string;
  before?: string;
  from?: string;
  unread_only?: boolean;
  limit?: number;
}

const DEFAULT_FOLDER = "INBOX";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

class ListMailMessagesTool extends MCPTool<ListMailMessagesInput> {
  name = "list_mail_messages";
  description =
    "Lists messages with basic metadata: UID, sender, recipients, date, size, and read/flagged status. " +
    "Subject is intentionally excluded to limit topic discovery — use list_mail_details to include subjects. " +
    "Supports filtering by folder, date range, sender address, and read status.";

  schema = {
    folder: {
      type: z.string().optional(),
      description: "Mailbox folder to search (e.g. 'INBOX', 'Sent'). Defaults to INBOX.",
    },
    since: {
      type: z.string().optional(),
      description:
        "Return messages received on or after this date (ISO 8601, e.g. '2026-02-25'). " +
        "Defaults to today.",
    },
    before: {
      type: z.string().optional(),
      description:
        "Return messages received on or before this date (ISO 8601, e.g. '2026-02-25'). " +
        "Defaults to 7 days after since.",
    },
    from: {
      type: z.string().optional(),
      description: "Filter messages by sender address (partial match).",
    },
    unread_only: {
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : v === "true" || v === true),
        z.boolean().optional()
      ),
      description: "If true, only return unread messages. Defaults to false.",
    },
    limit: {
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
        z.number().optional()
      ),
      description: `Maximum messages to return (1–${MAX_LIMIT}). Defaults to ${DEFAULT_LIMIT}. Most recent first.`,
    },
  };

  async execute(input: ListMailMessagesInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const folder = input.folder ?? DEFAULT_FOLDER;
    const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const range = buildMailDateRange(input.since, input.before);

    try {
      return await withImapClient(config, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const criteria: Record<string, unknown> = {
            since: range.since,
            before: range.imapBefore,
          };
          if (input.from) criteria.from = input.from;
          if (input.unread_only) criteria.seen = false;

          const allUids = await client.search(criteria, { uid: true });
          if (!allUids || allUids.length === 0) {
            const lines = [
              `No messages found in ${folder}`,
              `Range: ${fmtDate(range.since)} – ${fmtDate(range.endOfDay)}`,
            ];
            if (input.from) lines.push(`From filter: ${input.from}`);
            if (input.unread_only) lines.push("Filter: unread only");
            return lines.join("\n");
          }

          const uidsToFetch = allUids.slice(-limit).reverse();
          const raw = await client.fetchAll(
            uidsToFetch,
            { uid: true, envelope: true, flags: true, internalDate: true, size: true },
            { uid: true }
          );

          // Map immediately to narrow type — subject is never accessed
          const messages: MailMessageMeta[] = raw.map(toMailMessageMeta);

          return this.format(messages, folder, range, allUids.length, limit, input);
        } finally {
          lock.release();
        }
      });
    } catch (err) {
      return `IMAP error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private format(
    messages: MailMessageMeta[],
    folder: string,
    range: ReturnType<typeof buildMailDateRange>,
    totalFound: number,
    limit: number,
    input: ListMailMessagesInput
  ): string {
    const lines = [
      `Folder: ${folder}`,
      `Range: ${fmtDate(range.since)} – ${fmtDate(range.endOfDay)}`,
    ];
    if (input.from) lines.push(`From filter: ${input.from}`);
    if (input.unread_only) lines.push("Filter: unread only");
    lines.push(
      `Showing ${messages.length} of ${totalFound} message${totalFound !== 1 ? "s" : ""} (most recent first)`,
      ""
    );

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const flagStr = [m.isUnread ? "UNREAD" : "read", m.isFlagged ? "flagged" : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`${i + 1}. [UID ${m.uid}]`);
      lines.push(`   From:  ${m.from}`);
      lines.push(`   To:    ${m.to}`);
      lines.push(`   Date:  ${m.date ? fmtDateTime(m.date) : "(unknown)"}`);
      lines.push(`   Size:  ${fmtSize(m.size)}`);
      lines.push(`   Flags: ${flagStr}`);
      lines.push("");
    }

    if (totalFound > limit) {
      lines.push(
        `${totalFound - limit} older message${totalFound - limit !== 1 ? "s" : ""} not shown. ` +
          `Narrow the date range or increase limit (max ${MAX_LIMIT}).`
      );
    }

    return lines.join("\n");
  }
}

export default ListMailMessagesTool;
