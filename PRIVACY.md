# Privacy Guide

proton-mcp is designed for Proton Mail users, many of whom chose Proton specifically because they care about privacy. Giving an AI access to your email and calendar is a significant step — this document explains exactly what protections are in place, what data flows where, and the controls you have over what any agent can see.

---

## Proton Bridge: your email stays encrypted end-to-end

Proton Mail stores your email encrypted in a way that only you can decrypt. [Proton Bridge](https://proton.me/mail/bridge) is a local proxy that runs on your machine, decrypts your mail using your private key, and exposes it over standard IMAP/SMTP — all locally. This means:

- **No plaintext email ever leaves your device** to reach this MCP server
- This server communicates with Bridge over `localhost` only (`127.0.0.1`)
- Proton's servers never see your decrypted message content
- The Bridge-generated IMAP/SMTP password you configure here is separate from your Proton account password, limiting blast radius if it is ever exposed

The same privacy guarantee applies to calendar URLs: each ICS link is a secret, capability-based URL that grants read access to one calendar's decrypted data. It is configured as an environment variable and never stored in code or committed to source.

---

## Tiered read access: share only what you need

Email is layered. Knowing that you received a message from someone is less sensitive than knowing what you discussed. proton-mcp reflects this with four separate read tools, each exposing a distinct level of detail. In any MCP client you can enable exactly the tools you're comfortable granting to an agent and leave the rest disabled.

| Tool | What it can see | What it cannot see |
|---|---|---|
| `list_mail_folders` | Folder names and special-use labels (Inbox, Sent, Trash…) | Everything else |
| `list_mail_messages` | Sender, recipients, date, size, read/flagged status | Subject, Cc, message body |
| `list_mail_details` | All of the above + subject and Cc | Message body |
| `get_mail_body` | Message body (optionally headers if `include_headers` is set) | Nothing additional by default |

This separation is enforced structurally, not just by documentation. Each tool maps the raw IMAP response into a narrowly typed object — `list_mail_messages` uses a type that does not have a `subject` field, so it is impossible for a bug in the formatter to accidentally leak subject text. The privacy boundaries are also covered by automated tests that assert both the mapped type structure and the formatted output string.

**Recommended starting point:** enable only `list_mail_folders` and `list_mail_messages`. Add `list_mail_details` when you need subject-level search. Add `get_mail_body` only for tasks that genuinely require reading message content.

Action tools (`send_mail`, `move_mail`, `delete_mail`) should be granted with particular care — they take actions on your behalf.

---

## Controlling tool access in Claude Desktop

Each tool in an MCP server can be individually enabled or disabled. When proton-mcp is connected, open the tool panel in Claude Desktop (the hammer icon in the input bar) to see the full list. Toggle off any tool you do not want an agent to be able to call.

### Allow once

When an agent attempts to call a tool for the first time, Claude Desktop shows an approval dialog. You can choose:

- **Allow once** — permits this single call, asks again next time. Use this for sensitive tools like `get_mail_body` or `delete_mail` to retain per-call awareness of what is being accessed.
- **Allow always** — permits the tool for the remainder of the session without prompting.

Prefer **Allow once** for any tool that accesses message content or takes irreversible actions.

### Incognito mode

Claude Desktop's Incognito mode prevents conversations from being stored or used to improve Anthropic's models. When working with personal email or calendar data you would not want retained, start a new chat in Incognito mode before invoking any mail tools:

`File → New Incognito Chat` (or the incognito button in the chat header)

Note that Incognito mode affects conversation storage; it does not change which tools are available or how the MCP server operates.

---

## Fully local inference with LM Studio

For maximum privacy, use [LM Studio](https://lmstudio.ai) instead of a cloud-hosted model. LM Studio runs models entirely on your machine — no prompts, tool calls, or results leave your device.

proton-mcp is MCP-compatible and model-agnostic. The configuration format is identical to Claude Desktop; see the [LM Studio setup section in README.md](./README.md#using-with-lm-studio-qwen3-llama-33-etc) for details.

**Models with reliable tool-calling support:**
- Qwen3 (any size) — recommended
- Llama 3.3 70B

With a local model, the full privacy stack looks like this:

```
Your device only:
  LM Studio (local model inference)
    ↕ MCP over stdio
  proton-mcp (this server)
    ↕ IMAP/SMTP over localhost
  Proton Bridge (local E2EE proxy)
    ↕ Encrypted HTTPS
  Proton's servers (never see plaintext)
```

No email content, subjects, sender addresses, calendar events, or AI prompts leave your machine at any point in this configuration.

---

## Summary of data flows by client

| Setup | Prompts/tool results sent to | Email content leaves device? |
|---|---|---|
| LM Studio + local model | Nowhere — fully local | No |
| Claude Desktop (Incognito) | Anthropic API (not stored) | Only what tools return |
| Claude Desktop (standard) | Anthropic API (may be stored) | Only what tools return |

In all cases, tool results contain only what the enabled tools are permitted to return. Disabling `get_mail_body` means no message content is ever included in any prompt or API call, regardless of client.
