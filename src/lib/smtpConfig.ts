import type SMTPTransport from "nodemailer/lib/smtp-transport";

export type SmtpSecurity = "NONE" | "STARTTLS" | "TLS";

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /**
   * Connection security mode.
   * - STARTTLS (default): plaintext connection upgraded via STARTTLS if the server offers it.
   *   This is the Proton Bridge default for SMTP on port 1025.
   * - TLS: immediate TLS (SMTPS), typically port 465.
   * - NONE: plaintext, no TLS negotiation.
   */
  security: SmtpSecurity;
  /**
   * Whether to validate the server's TLS certificate.
   * Defaults to false for Proton Bridge compatibility (self-signed local cert).
   */
  rejectUnauthorized: boolean;
}

/**
 * Loads SMTP configuration from environment variables.
 *
 * Required (at least one of each pair must be set):
 *   SMTP_USERNAME — mail account username; falls back to IMAP_USERNAME
 *   SMTP_PASSWORD — mail account password; falls back to IMAP_PASSWORD
 *
 * Optional:
 *   SMTP_HOST               — defaults to 127.0.0.1 (Proton Bridge)
 *   SMTP_PORT               — defaults to 1025 (Proton Bridge SMTP)
 *   SMTP_SECURITY           — NONE | STARTTLS | TLS, defaults to STARTTLS
 *   SMTP_REJECT_UNAUTHORIZED — true | false, defaults to false
 *
 * Proton Bridge uses the same credentials for both IMAP and SMTP, so
 * SMTP_USERNAME/SMTP_PASSWORD will automatically inherit from IMAP_USERNAME/
 * IMAP_PASSWORD if the SMTP-specific vars are not set.
 */
export function loadSmtpConfig(): SmtpConfig {
  const username = process.env.SMTP_USERNAME ?? process.env.IMAP_USERNAME;
  const password = process.env.SMTP_PASSWORD ?? process.env.IMAP_PASSWORD;

  if (!username) {
    throw new Error(
      "SMTP_USERNAME (or IMAP_USERNAME) environment variable is required"
    );
  }
  if (!password) {
    throw new Error(
      "SMTP_PASSWORD (or IMAP_PASSWORD) environment variable is required"
    );
  }

  const securityRaw = (process.env.SMTP_SECURITY ?? "STARTTLS").toUpperCase();
  if (securityRaw !== "NONE" && securityRaw !== "STARTTLS" && securityRaw !== "TLS") {
    throw new Error(
      `SMTP_SECURITY must be one of: NONE, STARTTLS, TLS (got "${process.env.SMTP_SECURITY}")`
    );
  }

  const portRaw = process.env.SMTP_PORT;
  const port = portRaw !== undefined ? parseInt(portRaw, 10) : 1025;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a valid port number (got "${portRaw}")`);
  }

  const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === "true";

  return {
    host: process.env.SMTP_HOST ?? "127.0.0.1",
    port,
    username,
    password,
    security: securityRaw as SmtpSecurity,
    rejectUnauthorized,
  };
}

/** Maps a SmtpConfig to the options object expected by nodemailer's createTransport. */
export function toNodemailerOptions(config: SmtpConfig): SMTPTransport.Options {
  const base: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.rejectUnauthorized,
    },
  };

  if (config.security === "TLS") {
    return { ...base, secure: true };
  } else if (config.security === "STARTTLS") {
    // secure: false lets nodemailer upgrade via STARTTLS if the server offers it.
    // requireTLS: false (the default) means it won't fail if STARTTLS isn't available,
    // which is fine for the local Proton Bridge connection.
    return { ...base, secure: false };
  } else {
    // NONE: disable TLS negotiation entirely
    return { ...base, secure: false, ignoreTLS: true };
  }
}
