import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import { ImapFlow } from "imapflow";
import { loadImapConfig, toImapFlowOptions } from "../lib/imapConfig.js";

interface DeleteMailInput {
  uid: number;
  folder?: string;
}

class DeleteMailTool extends MCPTool<DeleteMailInput> {
  name = "delete_mail";
  description =
    "Permanently deletes an email message via IMAP (Proton Bridge or any IMAP server). " +
    "This action cannot be undone. The message will be expunged from the mailbox immediately. " +
    "Configure the server via IMAP_HOST, IMAP_PORT, IMAP_USERNAME, IMAP_PASSWORD, IMAP_SECURITY env vars.";

  schema = {
    uid: {
      // Claude sometimes sends numbers as strings; preprocess handles both.
      type: z.preprocess(
        (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
        z.number()
      ),
      description: "IMAP UID of the message to delete. Use read_mail action=list_messages to find UIDs.",
    },
    folder: {
      type: z.string().optional(),
      description: "Folder containing the message. Defaults to INBOX.",
    },
  };

  async execute(input: DeleteMailInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const folder = input.folder ?? "INBOX";

    try {
      return await this.withClient(config, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const success = await client.messageDelete(String(input.uid), { uid: true });

          if (!success) {
            return (
              `Failed to delete message UID ${input.uid} from ${folder}. ` +
              `The message may not exist in this folder.`
            );
          }

          return `Message UID ${input.uid} deleted from ${folder}.`;
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

export default DeleteMailTool;
