import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import { loadImapConfig, toImapFlowOptions } from "../lib/imapConfig.js";
import { buildMailDateRange } from "../lib/mailHelpers.js";

interface ReadMailInput {
  action: "list_folders" | "list_messages" | "get_message";
  // list_messages params
  folder?: string;
  since?: string;
  before?: string;
  from?: string;
  subject?: string;
  unread_only?: boolean;
  limit?: number;
  // get_message params
  uid?: number;
  include_body?: boolean;
}

const DEFAULT_FOLDER = "INBOX";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const BODY_MAX_BYTES = 50_000;

class ReadMailTool extends MCPTool<ReadMailInput> {
  name = "read_mail";
  description =
    "Reads email via IMAP (Proton Bridge or any IMAP server). " +
    "Use 'list_folders' to see available mailboxes, " +
    "'list_messages' to search and list messages with optional filters (date range, sender, subject, unread), " +
    "and 'get_message' to fetch the full content of a specific message by UID. " +
    "Configure the server via IMAP_HOST, IMAP_PORT, IMAP_USERNAME, IMAP_PASSWORD, IMAP_SECURITY env vars.";

  schema = {
    action: {
      type: z.enum(["list_folders", "list_messages", "get_message"]),
      description:
        "'list_folders' — lists all available mailbox folders. " +
        "'list_messages' — searches for messages (use folder, since, before, from, subject, unread_only, limit to filter). " +
        "'get_message' — fetches a single message by UID (requires uid; use include_body to get the message body).",
    },
    folder: {
      type: z.string().optional(),
      description:
        "Mailbox folder to operate on (e.g. 'INBOX', 'Sent', 'Drafts'). " +
        "Defaults to INBOX. Use list_folders to see all available folders.",
    },
    since: {
      type: z.string().optional(),
      description:
        "Return messages received on or after this date (ISO 8601, e.g. '2026-02-25'). " +
        "Defaults to today. For a single-day query set since and before to the same date.",
    },
    before: {
      type: z.string().optional(),
      description:
        "Return messages received on or before this date (ISO 8601, e.g. '2026-02-25'). " +
        "Defaults to 7 days after since. For a single-day query set since and before to the same date.",
    },
    from: {
      type: z.string().optional(),
      description: "Filter messages by sender address (partial match).",
    },
    subject: {
      type: z.string().optional(),
      description: "Filter messages by subject (partial match).",
    },
    unread_only: {
      type: z.boolean().optional(),
      description: "If true, only return unread (unseen) messages. Defaults to false.",
    },
    limit: {
      type: z.number().optional(),
      description: `Maximum number of messages to return (1–${MAX_LIMIT}). Defaults to ${DEFAULT_LIMIT}. Returns most recent first.`,
    },
    uid: {
      type: z.number().optional(),
      description: "IMAP UID of the message to fetch. Required for get_message.",
    },
    include_body: {
      type: z.boolean().optional(),
      description:
        "If true, include the message body in the response. Defaults to false (headers only). " +
        `Body is truncated at ${BODY_MAX_BYTES.toLocaleString()} bytes.`,
    },
  };

  async execute(input: ReadMailInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      if (input.action === "list_folders") {
        return await this.listFolders(config);
      } else if (input.action === "list_messages") {
        return await this.listMessages(input, config);
      } else {
        return await this.getMessage(input, config);
      }
    } catch (err) {
      return `IMAP error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /** Connects, runs fn, then logs out. Handles cleanup even on error. */
  private async withClient<T>(
    config: ReturnType<typeof loadImapConfig>,
    fn: (client: ImapFlow) => Promise<T>
  ): Promise<T> {
    const client = new ImapFlow(toImapFlowOptions(config));
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout();
    }
  }

  // ---------------------------------------------------------------------------
  // list_folders
  // ---------------------------------------------------------------------------

  private async listFolders(config: ReturnType<typeof loadImapConfig>): Promise<string> {
    return this.withClient(config, async (client) => {
      const folders = await client.list();

      if (folders.length === 0) {
        return "No folders found.";
      }

      const lines: string[] = [`Folders (${folders.length}):`, ""];
      for (const folder of folders.sort((a, b) => a.path.localeCompare(b.path))) {
        const special = folder.specialUse ? ` [${folder.specialUse}]` : "";
        lines.push(`- ${folder.path}${special}`);
      }
      return lines.join("\n");
    });
  }

  // ---------------------------------------------------------------------------
  // list_messages
  // ---------------------------------------------------------------------------

  private async listMessages(
    input: ReadMailInput,
    config: ReturnType<typeof loadImapConfig>
  ): Promise<string> {
    const folder = input.folder ?? DEFAULT_FOLDER;
    const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const range = buildMailDateRange(input.since, input.before);

    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const criteria: Record<string, unknown> = {
          since: range.since,
          before: range.imapBefore,
        };
        if (input.from) criteria.from = input.from;
        if (input.subject) criteria.subject = input.subject;
        if (input.unread_only) criteria.seen = false;

        const allUids = await client.search(criteria, { uid: true });
        if (!allUids || allUids.length === 0) {
          return this.formatNoMessages(folder, range.since, range.endOfDay, input);
        }

        // Most recent messages have the highest UIDs — take the last N, then reverse
        // so the result is sorted most-recent-first.
        const uidsToFetch = allUids.slice(-limit).reverse();

        const messages = await client.fetchAll(
          uidsToFetch,
          { uid: true, envelope: true, flags: true, internalDate: true, size: true },
          { uid: true }
        );

        return this.formatMessageList(
          messages,
          folder,
          range.since,
          range.endOfDay,
          allUids.length,
          limit,
          input
        );
      } finally {
        lock.release();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // get_message
  // ---------------------------------------------------------------------------

  private async getMessage(
    input: ReadMailInput,
    config: ReturnType<typeof loadImapConfig>
  ): Promise<string> {
    if (!input.uid) {
      return "Error: uid is required for the get_message action.";
    }

    const folder = input.folder ?? DEFAULT_FOLDER;

    return this.withClient(config, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const fetchQuery = input.include_body
          ? {
              uid: true,
              envelope: true,
              flags: true,
              internalDate: true,
              size: true,
              // '1' is the first MIME body part (text/plain for most messages).
              // 'TEXT' covers the full body of simple non-MIME messages.
              bodyParts: ["1", "TEXT"] as string[],
            }
          : {
              uid: true,
              envelope: true,
              flags: true,
              internalDate: true,
              size: true,
            };

        const msg = await client.fetchOne(String(input.uid), fetchQuery, { uid: true });

        if (!msg) {
          return `Message UID ${input.uid} not found in ${folder}.`;
        }

        return this.formatMessage(msg, input.include_body ?? false);
      } finally {
        lock.release();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  private formatNoMessages(
    folder: string,
    since: Date,
    endOfDay: Date,
    input: ReadMailInput
  ): string {
    const lines = [
      `No messages found in ${folder}`,
      `Range: ${this.fmtDate(since)} – ${this.fmtDate(endOfDay)}`,
    ];
    if (input.from) lines.push(`From filter: ${input.from}`);
    if (input.subject) lines.push(`Subject filter: ${input.subject}`);
    if (input.unread_only) lines.push("Filter: unread only");
    return lines.join("\n");
  }

  private formatMessageList(
    messages: FetchMessageObject[],
    folder: string,
    since: Date,
    endOfDay: Date,
    totalFound: number,
    limit: number,
    input: ReadMailInput
  ): string {
    const lines: string[] = [
      `Folder: ${folder}`,
      `Range: ${this.fmtDate(since)} – ${this.fmtDate(endOfDay)}`,
    ];

    if (input.from) lines.push(`From filter: ${input.from}`);
    if (input.subject) lines.push(`Subject filter: ${input.subject}`);
    if (input.unread_only) lines.push("Filter: unread only");

    lines.push(
      `Showing ${messages.length} of ${totalFound} message${totalFound !== 1 ? "s" : ""} (most recent first)`,
      ""
    );

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const env = msg.envelope;
      const isUnread = msg.flags ? !msg.flags.has("\\Seen") : false;
      const isFlagged = msg.flags ? msg.flags.has("\\Flagged") : false;

      const flagStr = [isUnread ? "UNREAD" : "read", isFlagged ? "flagged" : null]
        .filter(Boolean)
        .join(", ");

      lines.push(`${i + 1}. [UID ${msg.uid}] ${env?.subject ?? "(no subject)"}`);
      lines.push(`   From: ${this.fmtAddresses(env?.from)}`);
      lines.push(`   To:   ${this.fmtAddresses(env?.to)}`);
      lines.push(`   Date: ${env?.date ? this.fmtDateTime(env.date) : "(unknown)"}`);
      if (msg.size) lines.push(`   Size: ${this.fmtSize(msg.size)}`);
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

  private formatMessage(msg: FetchMessageObject, includeBody: boolean): string {
    const env = msg.envelope;
    const isUnread = msg.flags ? !msg.flags.has("\\Seen") : false;
    const isFlagged = msg.flags ? msg.flags.has("\\Flagged") : false;

    const lines: string[] = [
      `UID:     ${msg.uid}`,
      `Subject: ${env?.subject ?? "(no subject)"}`,
      `From:    ${this.fmtAddresses(env?.from)}`,
      `To:      ${this.fmtAddresses(env?.to)}`,
    ];

    if (env?.cc && env.cc.length > 0) lines.push(`Cc:      ${this.fmtAddresses(env.cc)}`);
    lines.push(`Date:    ${env?.date ? this.fmtDateTime(env.date) : "(unknown)"}`);
    if (msg.size) lines.push(`Size:    ${this.fmtSize(msg.size)}`);
    lines.push(`Status:  ${isUnread ? "Unread" : "Read"}${isFlagged ? ", Flagged" : ""}`);

    if (includeBody && msg.bodyParts) {
      // Prefer MIME part 1 (text/plain in most messages); fall back to TEXT
      const bodyBuf =
        msg.bodyParts.get("1") ??
        msg.bodyParts.get("text") ??
        msg.bodyParts.get("TEXT");

      lines.push("", "--- Body ---");

      if (bodyBuf && bodyBuf.length > 0) {
        const bodyText = bodyBuf.slice(0, BODY_MAX_BYTES).toString("utf8");
        lines.push(bodyText);
        if (bodyBuf.length > BODY_MAX_BYTES) {
          lines.push(`\n[Body truncated at ${BODY_MAX_BYTES.toLocaleString()} bytes]`);
        }
      } else {
        lines.push("(Body not available)");
      }
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Small formatting utilities
  // ---------------------------------------------------------------------------

  private fmtAddresses(addrs?: MessageAddressObject[]): string {
    if (!addrs || addrs.length === 0) return "(none)";
    return addrs
      .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
      .join(", ");
  }

  private fmtDate(date: Date): string {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  private fmtDateTime(date: Date): string {
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  private fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

export default ReadMailTool;
