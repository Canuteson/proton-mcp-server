import { type ImapFlowOptions } from "imapflow";

export type ImapSecurity = "NONE" | "STARTTLS" | "TLS";

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /**
   * Connection security mode.
   * - STARTTLS (default): plaintext connection upgraded via STARTTLS extension.
   *   This is the Proton Bridge default for IMAP on port 1143.
   * - TLS: immediate TLS (IMAPS), typically port 993.
   * - NONE: plaintext, no TLS upgrade.
   */
  security: ImapSecurity;
  /**
   * Whether to validate the server's TLS certificate.
   * Defaults to false for Proton Bridge compatibility (self-signed local cert).
   * Set IMAP_REJECT_UNAUTHORIZED=true for connections to public mail servers.
   */
  rejectUnauthorized: boolean;
}

/**
 * Loads IMAP configuration from environment variables.
 *
 * Required:
 *   IMAP_USERNAME — mail account username
 *   IMAP_PASSWORD — mail account password (or Proton Bridge token)
 *
 * Optional:
 *   IMAP_HOST               — defaults to 127.0.0.1 (Proton Bridge)
 *   IMAP_PORT               — defaults to 1143 (Proton Bridge IMAP)
 *   IMAP_SECURITY           — NONE | STARTTLS | TLS, defaults to STARTTLS
 *   IMAP_REJECT_UNAUTHORIZED — true | false, defaults to false
 */
export function loadImapConfig(): ImapConfig {
  const username = process.env.IMAP_USERNAME;
  const password = process.env.IMAP_PASSWORD;

  if (!username) throw new Error("IMAP_USERNAME environment variable is required");
  if (!password) throw new Error("IMAP_PASSWORD environment variable is required");

  const securityRaw = (process.env.IMAP_SECURITY ?? "STARTTLS").toUpperCase();
  if (securityRaw !== "NONE" && securityRaw !== "STARTTLS" && securityRaw !== "TLS") {
    throw new Error(
      `IMAP_SECURITY must be one of: NONE, STARTTLS, TLS (got "${process.env.IMAP_SECURITY}")`
    );
  }

  const portRaw = process.env.IMAP_PORT;
  const port = portRaw !== undefined ? parseInt(portRaw, 10) : 1143;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`IMAP_PORT must be a valid port number (got "${portRaw}")`);
  }

  const rejectUnauthorized = process.env.IMAP_REJECT_UNAUTHORIZED === "true";

  return {
    host: process.env.IMAP_HOST ?? "127.0.0.1",
    port,
    username,
    password,
    security: securityRaw as ImapSecurity,
    rejectUnauthorized,
  };
}

/** Maps an ImapConfig to the options object expected by imapflow's ImapFlow constructor. */
export function toImapFlowOptions(config: ImapConfig): ImapFlowOptions {
  const base: ImapFlowOptions = {
    host: config.host,
    port: config.port,
    secure: config.security === "TLS",
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.rejectUnauthorized,
    },
    // Silence imapflow's built-in logging — MCP servers communicate via stdio
    // and any stray console output would corrupt the protocol stream.
    logger: false,
  };

  if (config.security === "STARTTLS") {
    // doSTARTTLS: true forces STARTTLS negotiation (fails if server doesn't support it)
    return { ...base, doSTARTTLS: true };
  } else if (config.security === "NONE") {
    // doSTARTTLS: false disables TLS negotiation entirely
    return { ...base, doSTARTTLS: false };
  }

  // TLS: secure: true is already set in base
  return base;
}
