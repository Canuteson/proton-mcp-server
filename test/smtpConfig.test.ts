import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSmtpConfig, toNodemailerOptions } from "../src/lib/smtpConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allSmtpVars = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_SECURITY",
  "SMTP_REJECT_UNAUTHORIZED",
];

// Also clear IMAP fallback vars
const allImapVars = ["IMAP_USERNAME", "IMAP_PASSWORD"];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of [...allSmtpVars, ...allImapVars]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ---------------------------------------------------------------------------
// loadSmtpConfig — required fields
// ---------------------------------------------------------------------------

describe("loadSmtpConfig — required fields", () => {
  it("throws if neither SMTP_USERNAME nor IMAP_USERNAME is set", () => {
    process.env.SMTP_PASSWORD = "secret";
    expect(() => loadSmtpConfig()).toThrow("SMTP_USERNAME");
  });

  it("throws if neither SMTP_PASSWORD nor IMAP_PASSWORD is set", () => {
    process.env.SMTP_USERNAME = "user@example.com";
    expect(() => loadSmtpConfig()).toThrow("SMTP_PASSWORD");
  });

  it("throws if both username and password are missing", () => {
    expect(() => loadSmtpConfig()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadSmtpConfig — IMAP credential fallback
// ---------------------------------------------------------------------------

describe("loadSmtpConfig — IMAP credential fallback", () => {
  it("uses IMAP_USERNAME as fallback when SMTP_USERNAME is not set", () => {
    process.env.IMAP_USERNAME = "imap-user@example.com";
    process.env.IMAP_PASSWORD = "imap-secret";
    const config = loadSmtpConfig();
    expect(config.username).toBe("imap-user@example.com");
  });

  it("uses IMAP_PASSWORD as fallback when SMTP_PASSWORD is not set", () => {
    process.env.IMAP_USERNAME = "imap-user@example.com";
    process.env.IMAP_PASSWORD = "imap-secret";
    const config = loadSmtpConfig();
    expect(config.password).toBe("imap-secret");
  });

  it("prefers SMTP_USERNAME over IMAP_USERNAME when both are set", () => {
    process.env.SMTP_USERNAME = "smtp-user@example.com";
    process.env.SMTP_PASSWORD = "smtp-secret";
    process.env.IMAP_USERNAME = "imap-user@example.com";
    process.env.IMAP_PASSWORD = "imap-secret";
    const config = loadSmtpConfig();
    expect(config.username).toBe("smtp-user@example.com");
    expect(config.password).toBe("smtp-secret");
  });
});

// ---------------------------------------------------------------------------
// loadSmtpConfig — defaults
// ---------------------------------------------------------------------------

describe("loadSmtpConfig — defaults", () => {
  beforeEach(() => {
    process.env.SMTP_USERNAME = "user@example.com";
    process.env.SMTP_PASSWORD = "secret";
  });

  it("defaults host to 127.0.0.1 (Proton Bridge)", () => {
    expect(loadSmtpConfig().host).toBe("127.0.0.1");
  });

  it("defaults port to 1025 (Proton Bridge SMTP)", () => {
    expect(loadSmtpConfig().port).toBe(1025);
  });

  it("defaults security to STARTTLS", () => {
    expect(loadSmtpConfig().security).toBe("STARTTLS");
  });

  it("defaults rejectUnauthorized to false", () => {
    expect(loadSmtpConfig().rejectUnauthorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadSmtpConfig — overrides
// ---------------------------------------------------------------------------

describe("loadSmtpConfig — overrides", () => {
  beforeEach(() => {
    process.env.SMTP_USERNAME = "user@example.com";
    process.env.SMTP_PASSWORD = "secret";
  });

  it("accepts a custom host", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    expect(loadSmtpConfig().host).toBe("smtp.example.com");
  });

  it("accepts a custom port", () => {
    process.env.SMTP_PORT = "465";
    expect(loadSmtpConfig().port).toBe(465);
  });

  it("accepts SMTP_SECURITY=TLS", () => {
    process.env.SMTP_SECURITY = "TLS";
    expect(loadSmtpConfig().security).toBe("TLS");
  });

  it("accepts SMTP_SECURITY=NONE", () => {
    process.env.SMTP_SECURITY = "NONE";
    expect(loadSmtpConfig().security).toBe("NONE");
  });

  it("accepts SMTP_SECURITY case-insensitively", () => {
    process.env.SMTP_SECURITY = "tls";
    expect(loadSmtpConfig().security).toBe("TLS");
  });

  it("sets rejectUnauthorized to true when SMTP_REJECT_UNAUTHORIZED=true", () => {
    process.env.SMTP_REJECT_UNAUTHORIZED = "true";
    expect(loadSmtpConfig().rejectUnauthorized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadSmtpConfig — validation errors
// ---------------------------------------------------------------------------

describe("loadSmtpConfig — validation errors", () => {
  beforeEach(() => {
    process.env.SMTP_USERNAME = "user@example.com";
    process.env.SMTP_PASSWORD = "secret";
  });

  it("throws on an invalid SMTP_SECURITY value", () => {
    process.env.SMTP_SECURITY = "INVALID";
    expect(() => loadSmtpConfig()).toThrow("SMTP_SECURITY");
  });

  it("throws on a non-numeric SMTP_PORT", () => {
    process.env.SMTP_PORT = "abc";
    expect(() => loadSmtpConfig()).toThrow("SMTP_PORT");
  });

  it("throws on an out-of-range SMTP_PORT", () => {
    process.env.SMTP_PORT = "99999";
    expect(() => loadSmtpConfig()).toThrow("SMTP_PORT");
  });

  it("throws on SMTP_PORT=0", () => {
    process.env.SMTP_PORT = "0";
    expect(() => loadSmtpConfig()).toThrow("SMTP_PORT");
  });
});

// ---------------------------------------------------------------------------
// toNodemailerOptions
// ---------------------------------------------------------------------------

describe("toNodemailerOptions", () => {
  const baseConfig = {
    host: "127.0.0.1",
    port: 1025,
    username: "user@example.com",
    password: "secret",
    rejectUnauthorized: false,
  } as const;

  it("maps STARTTLS to secure=false (nodemailer negotiates STARTTLS automatically)", () => {
    const opts = toNodemailerOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBeFalsy();
  });

  it("maps TLS to secure=true", () => {
    const opts = toNodemailerOptions({ ...baseConfig, security: "TLS" });
    expect(opts.secure).toBe(true);
  });

  it("maps NONE to secure=false and ignoreTLS=true", () => {
    const opts = toNodemailerOptions({ ...baseConfig, security: "NONE" });
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBe(true);
  });

  it("passes through host and port", () => {
    const opts = toNodemailerOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(1025);
  });

  it("sets auth.user and auth.pass from config", () => {
    const opts = toNodemailerOptions({ ...baseConfig, security: "STARTTLS" });
    expect((opts.auth as { user: string; pass: string }).user).toBe("user@example.com");
    expect((opts.auth as { user: string; pass: string }).pass).toBe("secret");
  });

  it("passes rejectUnauthorized into tls options", () => {
    const optsDefault = toNodemailerOptions({ ...baseConfig, security: "STARTTLS", rejectUnauthorized: false });
    expect(optsDefault.tls?.rejectUnauthorized).toBe(false);

    const optsStrict = toNodemailerOptions({ ...baseConfig, security: "STARTTLS", rejectUnauthorized: true });
    expect(optsStrict.tls?.rejectUnauthorized).toBe(true);
  });
});
