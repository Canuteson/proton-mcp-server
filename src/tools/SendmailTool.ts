import { MCPTool } from "mcp-framework";
import { z } from "zod/v3";
import nodemailer from "nodemailer";
import { loadSmtpConfig, toNodemailerOptions } from "../lib/smtpConfig.js";

interface SendMailInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  reply_to?: string;
}

class SendMailTool extends MCPTool<SendMailInput> {
  name = "send_mail";
  description =
    "Sends an email via SMTP (Proton Bridge or any SMTP server). " +
    "Requires IMAP_USERNAME and IMAP_PASSWORD (or SMTP_USERNAME and SMTP_PASSWORD) " +
    "to be set. Configure the server via SMTP_HOST, SMTP_PORT, SMTP_SECURITY env vars.";

  schema = {
    to: {
      type: z.string(),
      description:
        "Recipient address(es). Accepts a single address ('alice@example.com'), " +
        "a display name with address ('Alice <alice@example.com>'), " +
        "or a comma-separated list for multiple recipients.",
    },
    subject: {
      type: z.string(),
      description: "Email subject line.",
    },
    body: {
      type: z.string(),
      description: "Plain-text body of the email.",
    },
    cc: {
      type: z.string().optional(),
      description: "CC recipient(s), comma-separated. Optional.",
    },
    bcc: {
      type: z.string().optional(),
      description: "BCC recipient(s), comma-separated. Optional.",
    },
    reply_to: {
      type: z.string().optional(),
      description: "Reply-To address. Optional.",
    },
  };

  async execute(input: SendMailInput): Promise<string> {
    let config;
    try {
      config = loadSmtpConfig();
    } catch (err) {
      return `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const transport = nodemailer.createTransport(toNodemailerOptions(config));

    const message: nodemailer.SendMailOptions = {
      from: config.username,
      to: input.to,
      subject: input.subject,
      text: input.body,
    };

    if (input.cc) message.cc = input.cc;
    if (input.bcc) message.bcc = input.bcc;
    if (input.reply_to) message.replyTo = input.reply_to;

    try {
      const info = await transport.sendMail(message);
      const accepted = (info.accepted as string[]).join(", ");
      const rejected = info.rejected as string[];

      const lines = [
        `Email sent successfully.`,
        `To: ${accepted}`,
        `Subject: ${input.subject}`,
        `Message ID: ${info.messageId}`,
      ];

      if (rejected.length > 0) {
        lines.push(`Warning: the following recipients were rejected: ${rejected.join(", ")}`);
      }

      return lines.join("\n");
    } catch (err) {
      return `SMTP error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      transport.close();
    }
  }
}

export default SendMailTool;
