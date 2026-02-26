/**
 * Privacy boundary tests for the granular mail tools.
 *
 * These tests enforce that each tool returns only the data its access level
 * permits. Specifically:
 *   - toMailMessageMeta must not contain a `subject` property
 *   - list_mail_messages output must not expose subject text
 *   - list_mail_details output must expose subject text
 *   - get_mail_body without include_headers must not expose subject
 *   - get_mail_body with include_headers must expose subject
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() factories
// ---------------------------------------------------------------------------

const { mockLock, mockClient, MockImapFlow, mockLoadImapConfig, mockToImapFlowOptions } =
  vi.hoisted(() => {
    const mockLock = { release: vi.fn() };
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      search: vi.fn(),
      fetchAll: vi.fn(),
      fetchOne: vi.fn(),
    };
    const MockImapFlow = vi.fn(function () {
      return mockClient;
    });
    const mockLoadImapConfig = vi.fn().mockReturnValue({
      host: "127.0.0.1",
      port: 1143,
      username: "user@example.com",
      password: "secret",
      security: "STARTTLS",
      rejectUnauthorized: false,
    });
    const mockToImapFlowOptions = vi.fn().mockReturnValue({});
    return { mockLock, mockClient, MockImapFlow, mockLoadImapConfig, mockToImapFlowOptions };
  });

vi.mock("imapflow", () => ({ ImapFlow: MockImapFlow }));
vi.mock("../src/lib/imapConfig.js", () => ({
  loadImapConfig: mockLoadImapConfig,
  toImapFlowOptions: mockToImapFlowOptions,
}));

import { toMailMessageMeta, toMailMessageDetail } from "../src/lib/imapClient.js";
import ListMailFoldersTool from "../src/tools/ListMailFoldersTool.js";
import ListMailMessagesTool from "../src/tools/ListMailMessagesTool.js";
import ListMailDetailsTool from "../src/tools/ListMailDetailsTool.js";
import GetMailBodyTool from "../src/tools/GetMailBodyTool.js";

// ---------------------------------------------------------------------------
// Shared fixture — a realistic FetchMessageObject with a known secret subject
// ---------------------------------------------------------------------------

const SECRET_SUBJECT = "Confidential: Q1 Budget Review";

function makeFetchMessage(overrides: Partial<{
  uid: number;
  subject: string;
  fromName: string;
  fromAddr: string;
  toAddr: string;
  ccAddr: string;
  seen: boolean;
}> = {}) {
  const o = {
    uid: 42,
    subject: SECRET_SUBJECT,
    fromName: "Alice",
    fromAddr: "alice@example.com",
    toAddr: "bob@example.com",
    ccAddr: "",
    seen: true,
    ...overrides,
  };

  return {
    uid: o.uid,
    envelope: {
      subject: o.subject,
      from: [{ name: o.fromName, address: o.fromAddr }],
      to: [{ address: o.toAddr }],
      cc: o.ccAddr ? [{ address: o.ccAddr }] : [],
      date: new Date("2026-02-26T10:00:00Z"),
    },
    flags: new Set(o.seen ? ["\\Seen"] : []),
    size: 2048,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.logout.mockResolvedValue(undefined);
  mockClient.getMailboxLock.mockResolvedValue(mockLock);
  mockLock.release.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// toMailMessageMeta — type-level privacy boundary
// ---------------------------------------------------------------------------

describe("toMailMessageMeta", () => {
  it("does not include a subject property", () => {
    const msg = makeFetchMessage();
    const meta = toMailMessageMeta(msg as never);

    expect("subject" in meta).toBe(false);
    expect((meta as Record<string, unknown>).subject).toBeUndefined();
  });

  it("does not include a cc property", () => {
    const msg = makeFetchMessage({ ccAddr: "carol@example.com" });
    const meta = toMailMessageMeta(msg as never);

    expect("cc" in meta).toBe(false);
    expect((meta as Record<string, unknown>).cc).toBeUndefined();
  });

  it("includes expected metadata fields", () => {
    const msg = makeFetchMessage({ seen: false });
    const meta = toMailMessageMeta(msg as never);

    expect(meta.uid).toBe(42);
    expect(meta.from).toBe("Alice <alice@example.com>");
    expect(meta.to).toBe("bob@example.com");
    expect(meta.date).toBeInstanceOf(Date);
    expect(meta.size).toBe(2048);
    expect(meta.isUnread).toBe(true);
    expect(meta.isFlagged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toMailMessageDetail — confirms subject is present at the detail level
// ---------------------------------------------------------------------------

describe("toMailMessageDetail", () => {
  it("includes subject and cc", () => {
    const msg = makeFetchMessage({ ccAddr: "carol@example.com" });
    const detail = toMailMessageDetail(msg as never);

    expect(detail.subject).toBe(SECRET_SUBJECT);
    expect(detail.cc).toBe("carol@example.com");
  });

  it("inherits all MailMessageMeta fields", () => {
    const msg = makeFetchMessage();
    const detail = toMailMessageDetail(msg as never);

    expect(detail.uid).toBe(42);
    expect(detail.from).toBe("Alice <alice@example.com>");
    expect(detail.to).toBe("bob@example.com");
    expect(detail.size).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// list_mail_folders — no message data at all
// ---------------------------------------------------------------------------

describe("ListMailFoldersTool", () => {
  it("returns only folder names and special-use labels", async () => {
    mockClient.list.mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "Sent", specialUse: "\\Sent" },
    ]);

    const tool = new ListMailFoldersTool();
    const output = await tool.execute({});

    expect(output).toContain("INBOX");
    expect(output).toContain("Sent");
    // No message content
    expect(output).not.toContain("@example.com");
    expect(output).not.toContain("Subject");
  });
});

// ---------------------------------------------------------------------------
// list_mail_messages — must not leak subject
// ---------------------------------------------------------------------------

describe("ListMailMessagesTool", () => {
  function setupMocks(messages = [makeFetchMessage()]) {
    mockClient.search.mockResolvedValue(messages.map((m) => m.uid));
    mockClient.fetchAll.mockResolvedValue(messages);
  }

  it("does not include subject in output", async () => {
    setupMocks();
    const tool = new ListMailMessagesTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).not.toContain(SECRET_SUBJECT);
    expect(output).not.toContain("Subject:");
    expect(output).not.toContain("subject");
  });

  it("includes sender and recipient", async () => {
    setupMocks();
    const tool = new ListMailMessagesTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).toContain("alice@example.com");
    expect(output).toContain("bob@example.com");
  });

  it("includes UID, date, size, and flags", async () => {
    setupMocks([makeFetchMessage({ seen: false })]);
    const tool = new ListMailMessagesTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).toContain("UID 42");
    expect(output).toContain("UNREAD");
    expect(output).toMatch(/\d+(\.\d+)?\s*(B|KB|MB)/); // size
  });

  it("does not include Cc even when present on the message", async () => {
    setupMocks([makeFetchMessage({ ccAddr: "carol@example.com" })]);
    const tool = new ListMailMessagesTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).not.toContain("carol@example.com");
    expect(output).not.toContain("Cc:");
  });

  it("does not expose subject when from filter is used", async () => {
    setupMocks();
    const tool = new ListMailMessagesTool();
    const output = await tool.execute({
      since: "2026-02-26",
      before: "2026-02-26",
      from: "alice@example.com",
    });

    expect(output).not.toContain(SECRET_SUBJECT);
    expect(output).not.toContain("Subject:");
  });
});

// ---------------------------------------------------------------------------
// list_mail_details — must include subject and cc
// ---------------------------------------------------------------------------

describe("ListMailDetailsTool", () => {
  function setupMocks(messages = [makeFetchMessage({ ccAddr: "carol@example.com" })]) {
    mockClient.search.mockResolvedValue(messages.map((m) => m.uid));
    mockClient.fetchAll.mockResolvedValue(messages);
  }

  it("includes subject in output", async () => {
    setupMocks();
    const tool = new ListMailDetailsTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).toContain(SECRET_SUBJECT);
  });

  it("includes Cc when present", async () => {
    setupMocks();
    const tool = new ListMailDetailsTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).toContain("carol@example.com");
    expect(output).toContain("Cc:");
  });

  it("omits Cc line when Cc is empty", async () => {
    setupMocks([makeFetchMessage()]);
    const tool = new ListMailDetailsTool();
    const output = await tool.execute({ since: "2026-02-26", before: "2026-02-26" });

    expect(output).not.toContain("Cc:");
  });

  it("accepts subject filter and shows subject in results", async () => {
    setupMocks();
    const tool = new ListMailDetailsTool();
    const output = await tool.execute({
      since: "2026-02-26",
      before: "2026-02-26",
      subject: "Budget",
    });

    expect(output).toContain("Subject filter: Budget");
    expect(output).toContain(SECRET_SUBJECT);
  });
});

// ---------------------------------------------------------------------------
// get_mail_body — body only by default; headers only when explicitly requested
// ---------------------------------------------------------------------------

describe("GetMailBodyTool", () => {
  const BODY_TEXT = "Hello, this is the email body.";

  function setupMock(subject = SECRET_SUBJECT) {
    const msg = {
      ...makeFetchMessage({ subject }),
      bodyParts: new Map([["1", Buffer.from(BODY_TEXT)]]),
    };
    mockClient.fetchOne.mockResolvedValue(msg);
  }

  describe("without include_headers (default)", () => {
    it("returns body text", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42 });

      expect(output).toContain(BODY_TEXT);
    });

    it("does not include subject in output", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42 });

      expect(output).not.toContain(SECRET_SUBJECT);
      expect(output).not.toContain("Subject:");
    });

    it("does not include sender or recipient in output", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42 });

      expect(output).not.toContain("alice@example.com");
      expect(output).not.toContain("bob@example.com");
      expect(output).not.toContain("From:");
      expect(output).not.toContain("To:");
    });
  });

  describe("with include_headers: true", () => {
    it("includes subject in output", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42, include_headers: true });

      expect(output).toContain(SECRET_SUBJECT);
      expect(output).toContain("Subject:");
    });

    it("includes sender and recipient", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42, include_headers: true });

      expect(output).toContain("alice@example.com");
      expect(output).toContain("bob@example.com");
    });

    it("includes body text alongside headers", async () => {
      setupMock();
      const tool = new GetMailBodyTool();
      const output = await tool.execute({ uid: 42, include_headers: true });

      expect(output).toContain(BODY_TEXT);
      expect(output).toContain("--- Body ---");
    });
  });

  it("returns not-found message for missing UID", async () => {
    mockClient.fetchOne.mockResolvedValue(null);
    const tool = new GetMailBodyTool();
    const output = await tool.execute({ uid: 999 });

    expect(output).toContain("not found");
    expect(output).toContain("999");
  });
});
