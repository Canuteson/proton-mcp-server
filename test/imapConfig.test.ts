import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadImapConfig, toImapFlowOptions } from "../src/lib/imapConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
  }

  // Apply
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    // Restore
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const requiredVars = {
  IMAP_USERNAME: "user@example.com",
  IMAP_PASSWORD: "secret",
};

// Clear all IMAP env vars before each test so tests are isolated
const allImapVars = [
  "IMAP_HOST",
  "IMAP_PORT",
  "IMAP_USERNAME",
  "IMAP_PASSWORD",
  "IMAP_SECURITY",
  "IMAP_REJECT_UNAUTHORIZED",
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of allImapVars) {
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
// loadImapConfig — required fields
// ---------------------------------------------------------------------------

describe("loadImapConfig — required fields", () => {
  it("throws if IMAP_USERNAME is missing", () => {
    process.env.IMAP_PASSWORD = "secret";
    expect(() => loadImapConfig()).toThrow("IMAP_USERNAME");
  });

  it("throws if IMAP_PASSWORD is missing", () => {
    process.env.IMAP_USERNAME = "user@example.com";
    expect(() => loadImapConfig()).toThrow("IMAP_PASSWORD");
  });

  it("throws if both username and password are missing", () => {
    expect(() => loadImapConfig()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadImapConfig — defaults
// ---------------------------------------------------------------------------

describe("loadImapConfig — defaults", () => {
  beforeEach(() => {
    process.env.IMAP_USERNAME = requiredVars.IMAP_USERNAME;
    process.env.IMAP_PASSWORD = requiredVars.IMAP_PASSWORD;
  });

  it("defaults host to 127.0.0.1 (Proton Bridge)", () => {
    const config = loadImapConfig();
    expect(config.host).toBe("127.0.0.1");
  });

  it("defaults port to 1143 (Proton Bridge IMAP)", () => {
    const config = loadImapConfig();
    expect(config.port).toBe(1143);
  });

  it("defaults security to STARTTLS", () => {
    const config = loadImapConfig();
    expect(config.security).toBe("STARTTLS");
  });

  it("defaults rejectUnauthorized to false (Proton Bridge uses self-signed cert)", () => {
    const config = loadImapConfig();
    expect(config.rejectUnauthorized).toBe(false);
  });

  it("returns provided username and password", () => {
    const config = loadImapConfig();
    expect(config.username).toBe("user@example.com");
    expect(config.password).toBe("secret");
  });
});

// ---------------------------------------------------------------------------
// loadImapConfig — overrides
// ---------------------------------------------------------------------------

describe("loadImapConfig — overrides", () => {
  beforeEach(() => {
    process.env.IMAP_USERNAME = requiredVars.IMAP_USERNAME;
    process.env.IMAP_PASSWORD = requiredVars.IMAP_PASSWORD;
  });

  it("accepts a custom host", () => {
    process.env.IMAP_HOST = "mail.example.com";
    expect(loadImapConfig().host).toBe("mail.example.com");
  });

  it("accepts a custom port", () => {
    process.env.IMAP_PORT = "993";
    expect(loadImapConfig().port).toBe(993);
  });

  it("accepts IMAP_SECURITY=TLS", () => {
    process.env.IMAP_SECURITY = "TLS";
    expect(loadImapConfig().security).toBe("TLS");
  });

  it("accepts IMAP_SECURITY=NONE", () => {
    process.env.IMAP_SECURITY = "NONE";
    expect(loadImapConfig().security).toBe("NONE");
  });

  it("accepts IMAP_SECURITY=STARTTLS explicitly", () => {
    process.env.IMAP_SECURITY = "STARTTLS";
    expect(loadImapConfig().security).toBe("STARTTLS");
  });

  it("accepts IMAP_SECURITY case-insensitively", () => {
    process.env.IMAP_SECURITY = "tls";
    expect(loadImapConfig().security).toBe("TLS");
  });

  it("sets rejectUnauthorized to true when IMAP_REJECT_UNAUTHORIZED=true", () => {
    process.env.IMAP_REJECT_UNAUTHORIZED = "true";
    expect(loadImapConfig().rejectUnauthorized).toBe(true);
  });

  it("keeps rejectUnauthorized false when IMAP_REJECT_UNAUTHORIZED=false", () => {
    process.env.IMAP_REJECT_UNAUTHORIZED = "false";
    expect(loadImapConfig().rejectUnauthorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadImapConfig — validation errors
// ---------------------------------------------------------------------------

describe("loadImapConfig — validation errors", () => {
  beforeEach(() => {
    process.env.IMAP_USERNAME = requiredVars.IMAP_USERNAME;
    process.env.IMAP_PASSWORD = requiredVars.IMAP_PASSWORD;
  });

  it("throws on an invalid IMAP_SECURITY value", () => {
    process.env.IMAP_SECURITY = "INVALID";
    expect(() => loadImapConfig()).toThrow("IMAP_SECURITY");
  });

  it("throws on a non-numeric IMAP_PORT", () => {
    process.env.IMAP_PORT = "abc";
    expect(() => loadImapConfig()).toThrow("IMAP_PORT");
  });

  it("throws on an out-of-range IMAP_PORT", () => {
    process.env.IMAP_PORT = "99999";
    expect(() => loadImapConfig()).toThrow("IMAP_PORT");
  });

  it("throws on IMAP_PORT=0", () => {
    process.env.IMAP_PORT = "0";
    expect(() => loadImapConfig()).toThrow("IMAP_PORT");
  });
});

// ---------------------------------------------------------------------------
// toImapFlowOptions
// ---------------------------------------------------------------------------

describe("toImapFlowOptions", () => {
  const baseConfig = {
    host: "127.0.0.1",
    port: 1143,
    username: "user@example.com",
    password: "secret",
    rejectUnauthorized: false,
  } as const;

  it("maps STARTTLS to secure=false and doSTARTTLS=true", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.secure).toBe(false);
    expect(opts.doSTARTTLS).toBe(true);
  });

  it("maps TLS to secure=true", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "TLS" });
    expect(opts.secure).toBe(true);
  });

  it("maps NONE to secure=false and doSTARTTLS=false", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "NONE" });
    expect(opts.secure).toBe(false);
    expect(opts.doSTARTTLS).toBe(false);
  });

  it("passes through host and port", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(1143);
  });

  it("sets auth.user and auth.pass from config", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.auth?.user).toBe("user@example.com");
    expect(opts.auth?.pass).toBe("secret");
  });

  it("passes rejectUnauthorized into tls options", () => {
    const optsDefault = toImapFlowOptions({ ...baseConfig, security: "STARTTLS", rejectUnauthorized: false });
    expect(optsDefault.tls?.rejectUnauthorized).toBe(false);

    const optsStrict = toImapFlowOptions({ ...baseConfig, security: "STARTTLS", rejectUnauthorized: true });
    expect(optsStrict.tls?.rejectUnauthorized).toBe(true);
  });

  it("disables imapflow logging (logger: false)", () => {
    const opts = toImapFlowOptions({ ...baseConfig, security: "STARTTLS" });
    expect(opts.logger).toBe(false);
  });
});
