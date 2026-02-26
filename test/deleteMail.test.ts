import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock objects so they are available inside vi.mock() factories,
// which are hoisted above imports by vitest.
// ---------------------------------------------------------------------------

const { mockLock, mockClient, MockImapFlow, mockLoadImapConfig, mockToImapFlowOptions } = vi.hoisted(() => {
  const mockLock = { release: vi.fn() };
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    messageDelete: vi.fn(),
  };
  // Must be a regular function (not arrow) so it can be called with `new`.
  // Returning an object from a constructor causes `new` to return that object.
  const MockImapFlow = vi.fn(function () { return mockClient; });
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

vi.mock("imapflow", () => ({
  ImapFlow: MockImapFlow,
}));

vi.mock("../src/lib/imapConfig.js", () => ({
  loadImapConfig: mockLoadImapConfig,
  toImapFlowOptions: mockToImapFlowOptions,
}));

import DeleteMailTool from "../src/tools/DeletemailTool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool() {
  return new DeleteMailTool();
}

const baseInput = { uid: 42 };

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.logout.mockResolvedValue(undefined);
  mockClient.getMailboxLock.mockResolvedValue(mockLock);
  mockLock.release.mockReturnValue(undefined);
  mockLoadImapConfig.mockReturnValue({
    host: "127.0.0.1",
    port: 1143,
    username: "user@example.com",
    password: "secret",
    security: "STARTTLS",
    rejectUnauthorized: false,
  });
  mockToImapFlowOptions.mockReturnValue({});
});

// ---------------------------------------------------------------------------
// Configuration errors
// ---------------------------------------------------------------------------

describe("delete_mail — configuration errors", () => {
  it("returns a configuration error message when loadImapConfig throws", async () => {
    mockLoadImapConfig.mockImplementation(() => {
      throw new Error("IMAP_USERNAME is required");
    });
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/Configuration error/);
    expect(result).toMatch(/IMAP_USERNAME/);
  });
});

// ---------------------------------------------------------------------------
// IMAP connection errors
// ---------------------------------------------------------------------------

describe("delete_mail — IMAP errors", () => {
  it("returns an IMAP error message when connect throws", async () => {
    mockClient.connect.mockRejectedValue(new Error("Connection refused"));
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/IMAP error/);
    expect(result).toMatch(/Connection refused/);
  });

  it("releases the lock even when messageDelete throws", async () => {
    mockClient.messageDelete.mockRejectedValue(new Error("Server error"));
    await makeTool().execute(baseInput);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("logs out even when messageDelete throws", async () => {
    mockClient.messageDelete.mockRejectedValue(new Error("Server error"));
    await makeTool().execute(baseInput);
    expect(mockClient.logout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failed delete (messageDelete returns false)
// ---------------------------------------------------------------------------

describe("delete_mail — failed delete", () => {
  it("returns a failure message when messageDelete returns false", async () => {
    mockClient.messageDelete.mockResolvedValue(false);
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/Failed to delete/);
    expect(result).toMatch(/42/); // uid
  });

  it("includes the folder name in the failure message", async () => {
    mockClient.messageDelete.mockResolvedValue(false);
    const result = await makeTool().execute({ ...baseInput, folder: "Drafts" });
    expect(result).toMatch(/Drafts/);
  });
});

// ---------------------------------------------------------------------------
// Successful delete
// ---------------------------------------------------------------------------

describe("delete_mail — successful delete", () => {
  it("returns a success message with the UID and folder", async () => {
    mockClient.messageDelete.mockResolvedValue(true);
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/deleted/i);
    expect(result).toMatch(/42/);
    expect(result).toMatch(/INBOX/);
  });

  it("includes the custom folder in the success message", async () => {
    mockClient.messageDelete.mockResolvedValue(true);
    const result = await makeTool().execute({ ...baseInput, folder: "Trash" });
    expect(result).toMatch(/Trash/);
  });
});

// ---------------------------------------------------------------------------
// Folder defaults and overrides
// ---------------------------------------------------------------------------

describe("delete_mail — folder handling", () => {
  beforeEach(() => {
    mockClient.messageDelete.mockResolvedValue(true);
  });

  it("defaults to INBOX when folder is not specified", async () => {
    await makeTool().execute(baseInput);
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("uses the specified folder", async () => {
    await makeTool().execute({ ...baseInput, folder: "Sent" });
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("Sent");
  });

  it("passes the UID string to messageDelete with uid:true", async () => {
    await makeTool().execute(baseInput);
    expect(mockClient.messageDelete).toHaveBeenCalledWith("42", { uid: true });
  });

  it("releases the lock after a successful delete", async () => {
    await makeTool().execute(baseInput);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("logs out after a successful delete", async () => {
    await makeTool().execute(baseInput);
    expect(mockClient.logout).toHaveBeenCalled();
  });
});
