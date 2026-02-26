import { ImapFlow, type MessageAddressObject, type FetchMessageObject } from "imapflow";
import { loadImapConfig, toImapFlowOptions } from "./imapConfig.js";

// ---------------------------------------------------------------------------
// Privacy-scoped types
//
// Each type represents a distinct access level. Tools return only the type
// matching their permission tier — TypeScript enforces that higher-tier fields
// (e.g. subject) cannot appear in lower-tier results (e.g. MailMessageMeta).
// ---------------------------------------------------------------------------

/** Folder info returned by list_mail_folders. No message content or metadata. */
export interface MailFolderInfo {
  path: string;
  specialUse?: string;
}

/**
 * Basic message metadata — returned by list_mail_messages.
 * Intentionally excludes subject and cc to limit topic discovery.
 */
export interface MailMessageMeta {
  uid: number;
  from: string;
  to: string;
  date: Date | null;
  size: number;
  isUnread: boolean;
  isFlagged: boolean;
}

/**
 * Full message headers — returned by list_mail_details.
 * Extends MailMessageMeta with subject and cc.
 */
export interface MailMessageDetail extends MailMessageMeta {
  subject: string;
  cc: string;
}

/**
 * Message body result — returned by get_mail_body.
 * NOTE: the optional `headers` field grants subject/sender discovery when present.
 */
export interface MailBodyResult {
  uid: number;
  body: string;
  truncated: boolean;
  headers?: MailMessageDetail;
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/** Connects an ImapFlow client, runs fn, then logs out. Cleans up on error. */
export async function withImapClient<T>(
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
// Mapping helpers — FetchMessageObject → narrow types
// ---------------------------------------------------------------------------

/**
 * Maps a raw imapflow message to MailMessageMeta.
 * envelope.subject is intentionally never accessed.
 */
export function toMailMessageMeta(msg: FetchMessageObject): MailMessageMeta {
  return {
    uid: msg.uid,
    from: fmtAddresses(msg.envelope?.from),
    to: fmtAddresses(msg.envelope?.to),
    date: msg.envelope?.date ?? null,
    size: msg.size ?? 0,
    isUnread: msg.flags ? !msg.flags.has("\\Seen") : false,
    isFlagged: msg.flags ? msg.flags.has("\\Flagged") : false,
  };
}

/** Maps a raw imapflow message to MailMessageDetail (includes subject + cc). */
export function toMailMessageDetail(msg: FetchMessageObject): MailMessageDetail {
  return {
    ...toMailMessageMeta(msg),
    subject: msg.envelope?.subject ?? "(no subject)",
    cc: fmtAddresses(msg.envelope?.cc),
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtAddresses(addrs?: MessageAddressObject[]): string {
  if (!addrs || addrs.length === 0) return "(none)";
  return addrs
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .join(", ");
}

export function fmtDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(date: Date): string {
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

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
