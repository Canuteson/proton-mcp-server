import { MCPTool } from "mcp-framework";
import { loadImapConfig } from "../lib/imapConfig.js";
import { withImapClient, type MailFolderInfo } from "../lib/imapClient.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ListMailFoldersInput {}

class ListMailFoldersTool extends MCPTool<ListMailFoldersInput> {
  name = "list_mail_folders";
  description =
    "Lists all available mailbox folders. " +
    "Returns folder names and special-use labels (Inbox, Sent, Trash, etc.) only — " +
    "no message content, subjects, or sender information.";

  schema = {};

  async execute(_input: ListMailFoldersInput): Promise<string> {
    let config;
    try {
      config = loadImapConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      return await withImapClient(config, async (client) => {
        const folders = await client.list();

        if (folders.length === 0) return "No folders found.";

        const infos: MailFolderInfo[] = folders
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => ({ path: f.path, specialUse: f.specialUse }));

        const lines = [`Folders (${infos.length}):`, ""];
        for (const f of infos) {
          const special = f.specialUse ? ` [${f.specialUse}]` : "";
          lines.push(`- ${f.path}${special}`);
        }
        return lines.join("\n");
      });
    } catch (err) {
      return `IMAP error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export default ListMailFoldersTool;
