import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { loadImapConfig } from "../lib/imapConfig.js";
import {
  withImapClient,
  toMailMessageDetail,
  fmtDateTime,
  fmtSize,
  type MailBodyResult,
} from "../lib/imapClient.js";

interface GetMailBodyInput {
  uid: number;
  folder?: string;
  include_headers?: boolean;
}

const DEFAULT_FOLDER = "INBOX";
const BODY_MAX_BYTES = 50_000;

class GetMailBodyTool extends MCPTool<GetMailBodyInput> {
  name = "get_mail_body";
  description =
    "Fetches the body text of a single message by UID. " +
    "This is the highest-privilege mail tool — it grants access to full message content. " +
    "Set include_headers to true to also receive subject, sender, and recipient information alongside the body " +
    "(note: enabling include_headers grants the same header discovery as list_mail_details). " +
    `Body is truncated at ${BODY_MAX_BYTES.toLocaleString()} bytes.`;

  schema = {
    uid: {
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
        z.number()
      ),
      description: "IMAP UID of the message to fetch. Obtain UIDs from list_mail_messages or list_mail_details.",
    },
    folder: {
      type: z.string().optional(),
      description: "Mailbox folder containing the message. Defaults to INBOX.",
    },
    include_headers: {
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : v === "true" || v === true),
        z.boolean().optional()
      ),
      description:
        "If true, include subject, sender, recipients, and date alongside the body. " +
        "Defaults to false (body only). Enabling this grants the same header access as list_mail_details.",
    },
  };

  async execute(input: GetMailBodyInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const folder = input.folder ?? DEFAULT_FOLDER;

    try {
      return await withImapClient(config, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const fetchQuery = {
            uid: true,
            // Always fetch envelope so we can populate headers if requested
            envelope: true,
            flags: true,
            internalDate: true,
            size: true,
            // '1' is the first MIME body part (text/plain for most messages).
            // 'TEXT' covers the full body of simple non-MIME messages.
            bodyParts: ["1", "TEXT"] as string[],
          };

          const msg = await client.fetchOne(String(input.uid), fetchQuery, { uid: true });

          if (!msg) {
            return `Message UID ${input.uid} not found in ${folder}.`;
          }

          const bodyBuf =
            msg.bodyParts?.get("1") ??
            msg.bodyParts?.get("text") ??
            msg.bodyParts?.get("TEXT");

          const bodyText = bodyBuf && bodyBuf.length > 0
            ? bodyBuf.slice(0, BODY_MAX_BYTES).toString("utf8")
            : "(Body not available)";

          const result: MailBodyResult = {
            uid: msg.uid,
            body: bodyText,
            truncated: (bodyBuf?.length ?? 0) > BODY_MAX_BYTES,
            headers: input.include_headers ? toMailMessageDetail(msg) : undefined,
          };

          return this.format(result);
        } finally {
          lock.release();
        }
      });
    } catch (err) {
      return `IMAP error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private format(result: MailBodyResult): string {
    const lines: string[] = [];

    if (result.headers) {
      const h = result.headers;
      lines.push(
        `UID:     ${result.uid}`,
        `Subject: ${h.subject}`,
        `From:    ${h.from}`,
        `To:      ${h.to}`
      );
      if (h.cc !== "(none)") lines.push(`Cc:      ${h.cc}`);
      lines.push(
        `Date:    ${h.date ? fmtDateTime(h.date) : "(unknown)"}`,
        `Size:    ${fmtSize(h.size)}`,
        `Status:  ${h.isUnread ? "Unread" : "Read"}${h.isFlagged ? ", Flagged" : ""}`
      );
      lines.push("", "--- Body ---");
    }

    lines.push(result.body);

    if (result.truncated) {
      lines.push(`\n[Body truncated at ${BODY_MAX_BYTES.toLocaleString()} bytes]`);
    }

    return lines.join("\n");
  }
}

export default GetMailBodyTool;
