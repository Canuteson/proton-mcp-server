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
    messageMove: vi.fn(),
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

import MoveMailTool from "../src/tools/MovemailTool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool() {
  return new MoveMailTool();
}

const baseInput = { uid: 42, destination: "Archive" };

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

describe("move_mail — configuration errors", () => {
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

describe("move_mail — IMAP errors", () => {
  it("returns an IMAP error message when connect throws", async () => {
    mockClient.connect.mockRejectedValue(new Error("Connection refused"));
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/IMAP error/);
    expect(result).toMatch(/Connection refused/);
  });

  it("releases the lock even when messageMove throws", async () => {
    mockClient.messageMove.mockRejectedValue(new Error("Server error"));
    await makeTool().execute(baseInput);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("logs out even when messageMove throws", async () => {
    mockClient.messageMove.mockRejectedValue(new Error("Server error"));
    await makeTool().execute(baseInput);
    expect(mockClient.logout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failed move (messageMove returns false)
// ---------------------------------------------------------------------------

describe("move_mail — failed move", () => {
  it("returns a failure message when messageMove returns false", async () => {
    mockClient.messageMove.mockResolvedValue(false);
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/Failed to move/);
    expect(result).toMatch(/42/); // uid
    expect(result).toMatch(/Archive/); // destination
  });

  it("includes the source folder name in the failure message", async () => {
    mockClient.messageMove.mockResolvedValue(false);
    const result = await makeTool().execute({ ...baseInput, folder: "Drafts" });
    expect(result).toMatch(/Drafts/);
  });
});

// ---------------------------------------------------------------------------
// Successful move
// ---------------------------------------------------------------------------

describe("move_mail — successful move", () => {
  it("returns a success message with source and destination", async () => {
    mockClient.messageMove.mockResolvedValue({
      path: "INBOX",
      destination: "Archive",
      uidMap: new Map([[42, 99]]),
    });
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/moved successfully/i);
    expect(result).toMatch(/INBOX/);
    expect(result).toMatch(/Archive/);
  });

  it("includes the original UID in the success message", async () => {
    mockClient.messageMove.mockResolvedValue({
      path: "INBOX",
      destination: "Archive",
      uidMap: new Map([[42, 99]]),
    });
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/42/);
  });

  it("includes the new UID when uidMap is provided", async () => {
    mockClient.messageMove.mockResolvedValue({
      path: "INBOX",
      destination: "Archive",
      uidMap: new Map([[42, 99]]),
    });
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/99/);
  });

  it("succeeds without a new UID when uidMap is absent", async () => {
    mockClient.messageMove.mockResolvedValue({
      path: "INBOX",
      destination: "Archive",
    });
    const result = await makeTool().execute(baseInput);
    expect(result).toMatch(/moved successfully/i);
  });
});

// ---------------------------------------------------------------------------
// Folder defaults and overrides
// ---------------------------------------------------------------------------

describe("move_mail — folder handling", () => {
  beforeEach(() => {
    mockClient.messageMove.mockResolvedValue({
      path: "INBOX",
      destination: "Archive",
      uidMap: new Map([[42, 99]]),
    });
  });

  it("defaults to INBOX when folder is not specified", async () => {
    await makeTool().execute(baseInput);
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("uses the specified source folder", async () => {
    await makeTool().execute({ ...baseInput, folder: "Sent" });
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("Sent");
  });

  it("passes the destination folder to messageMove", async () => {
    await makeTool().execute({ ...baseInput, destination: "Folders/Work" });
    expect(mockClient.messageMove).toHaveBeenCalledWith(
      "42",
      "Folders/Work",
      { uid: true }
    );
  });

  it("releases the lock after a successful move", async () => {
    await makeTool().execute(baseInput);
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("logs out after a successful move", async () => {
    await makeTool().execute(baseInput);
    expect(mockClient.logout).toHaveBeenCalled();
  });
});
