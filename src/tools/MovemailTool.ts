import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { ImapFlow } from "imapflow";
import { loadImapConfig, toImapFlowOptions } from "../lib/imapConfig.js";

interface MoveMailInput {
  uid: number;
  destination: string;
  folder?: string;
}

class MoveMailTool extends MCPTool<MoveMailInput> {
  name = "move_mail";
  description =
    "Moves an email message to a different folder via IMAP (Proton Bridge or any IMAP server). " +
    "Use read_mail with action=list_folders to see available destination folders. " +
    "Configure the server via IMAP_HOST, IMAP_PORT, IMAP_USERNAME, IMAP_PASSWORD, IMAP_SECURITY env vars.";

  schema = {
    uid: {
      // Claude sometimes sends numbers as strings; preprocess handles both.
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
        z.number()
      ),
      description: "IMAP UID of the message to move. Use read_mail action=list_messages to find UIDs.",
    },
    destination: {
      type: z.string(),
      description:
        "Destination folder path (e.g. 'Archive', 'Sent', 'Folders/Work'). " +
        "Use read_mail action=list_folders to see available folders.",
    },
    folder: {
      type: z.string().optional(),
      description: "Source folder containing the message. Defaults to INBOX.",
    },
  };

  async execute(input: MoveMailInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const sourceFolder = input.folder ?? "INBOX";

    try {
      return await this.withClient(config, async (client) => {
        const lock = await client.getMailboxLock(sourceFolder);
        try {
          const result = await client.messageMove(String(input.uid), input.destination, {
            uid: true,
          });

          if (!result) {
            return (
              `Failed to move message UID ${input.uid} from ${sourceFolder} to ${input.destination}. ` +
              `The message may not exist or the destination folder may be invalid.`
            );
          }

          const newUid = result.uidMap?.get(input.uid);
          const lines = [
            `Message moved successfully.`,
            `From: ${sourceFolder}`,
            `To:   ${result.destination}`,
            `Original UID: ${input.uid}`,
          ];
          if (newUid !== undefined) {
            lines.push(`New UID: ${newUid}`);
          }
          return lines.join("\n");
        } finally {
          lock.release();
        }
      });
    } catch (err) {
      return `IMAP error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

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
}

export default MoveMailTool;
