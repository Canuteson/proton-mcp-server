import { MCPTool } from "mcp-framework";
import { z } from "zod";

interface SendmailInput {
  message: string;
}

class SendmailTool extends MCPTool<SendmailInput> {
  name = "sendmail";
  description = "Sendmail tool description";

  schema = {
    message: {
      type: z.string(),
      description: "Message to process",
    },
  };

  async execute(input: SendmailInput) {
    return `Processed: ${input.message}`;
  }
}

export default SendmailTool;