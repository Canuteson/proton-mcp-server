# proton-mcp

An MCP server that gives LLM tools including Claude Desktop and LM Studio access to your Proton Mail calendars and email via Proton Bridge.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/proton-mcp.git
cd proton-mcp
npm install
npm run build
```

### 2. Get your Proton Calendar URLs

In Proton Calendar, go to **Settings → Other calendars → Link for viewing** for each calendar you want to expose. Each URL is a secret ICS download link — treat it like a password.

### 3. Install and configure Proton Bridge (for email)

[Proton Bridge](https://proton.me/mail/bridge) is a local proxy that exposes your Proton Mail account over standard IMAP and SMTP. It must be running whenever the MCP server needs to read or send email.

After installing and signing in to Proton Bridge, find the IMAP credentials in the Bridge app under **Settings → Mailbox configuration**. You will need:

- **IMAP username** — your full Proton Mail address (e.g. `you@proton.me`)
- **IMAP password** — the Bridge-generated password (different from your Proton account password)

The Bridge runs locally on `127.0.0.1:1143` (IMAP) and `127.0.0.1:1025` (SMTP) by default; these are already the MCP server defaults.

### 4. Configure Claude Desktop

Open (or create) your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

Add the following, replacing the path, calendar URLs, and Bridge credentials:

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args": ["/Full/path/to/project/proton-mcp/dist/index.js"],
      "env": {
        "PROTON_CALENDARS": "[{\"name\":\"Family\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"},{\"name\":\"Work\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"}]",
        "IMAP_USERNAME": "you@proton.me",
        "IMAP_PASSWORD": "your-bridge-generated-password"
      }
    }
  }
}
```

Use the full absolute path to the `dist/index.js` file in the cloned repo.

### 5. Restart Claude Desktop

Fully quit and relaunch Claude Desktop. The `proton-mcp` server will connect automatically on startup.

---

## Email configuration reference

The IMAP defaults are pre-configured for Proton Bridge. You only need `IMAP_USERNAME` and `IMAP_PASSWORD` for a standard Proton Bridge setup. All other settings have working defaults.

| Variable | Default | Description |
|---|---|---|
| `IMAP_USERNAME` | *(required)* | Your mail account username / email address |
| `IMAP_PASSWORD` | *(required)* | Your password (for Proton Bridge: use the Bridge-generated password, not your Proton account password) |
| `IMAP_HOST` | `127.0.0.1` | IMAP server hostname |
| `IMAP_PORT` | `1143` | IMAP server port |
| `IMAP_SECURITY` | `STARTTLS` | Connection security: `STARTTLS`, `TLS`, or `NONE` |
| `IMAP_REJECT_UNAUTHORIZED` | `false` | Set to `true` to enforce TLS certificate validation (Proton Bridge uses a self-signed local cert, so this must stay `false` for Bridge) |

### SMTP configuration (for sending email)

SMTP uses the same credentials as IMAP by default — `IMAP_USERNAME` and `IMAP_PASSWORD` are automatically reused, so no extra config is needed for Proton Bridge. You can override with dedicated SMTP vars if needed:

| Variable | Default | Description |
|---|---|---|
| `SMTP_USERNAME` | *(falls back to `IMAP_USERNAME`)* | SMTP username |
| `SMTP_PASSWORD` | *(falls back to `IMAP_PASSWORD`)* | SMTP password |
| `SMTP_HOST` | `127.0.0.1` | SMTP server hostname |
| `SMTP_PORT` | `1025` | SMTP server port |
| `SMTP_SECURITY` | `STARTTLS` | Connection security: `STARTTLS`, `TLS`, or `NONE` |
| `SMTP_REJECT_UNAUTHORIZED` | `false` | Set to `true` to enforce TLS certificate validation |

### Using with another IMAP provider

To connect to a standard IMAP server instead of Proton Bridge, override the defaults:

```json
"env": {
  "IMAP_USERNAME": "you@example.com",
  "IMAP_PASSWORD": "your-password",
  "IMAP_HOST": "imap.example.com",
  "IMAP_PORT": "993",
  "IMAP_SECURITY": "TLS",
  "IMAP_REJECT_UNAUTHORIZED": "true"
}
```

Common provider settings:

| Provider | Host | Port | Security |
|---|---|---|---|
| Gmail | `imap.gmail.com` | `993` | `TLS` |
| Outlook / Hotmail | `outlook.office365.com` | `993` | `TLS` |
| Fastmail | `imap.fastmail.com` | `993` | `TLS` |
| Proton Bridge (local) | `127.0.0.1` | `1143` | `STARTTLS` *(default)* |

---

## Using with LM Studio (Qwen3, Llama 3.3, etc.)

No changes to the server are needed — MCP is model-agnostic. LM Studio uses the same config format as Claude Desktop, just in a different file.

**Requirements:** LM Studio 0.3.17 or later.

### 1. Choose a model that supports tool calling

Not all local models handle tool calls reliably. These work well:

- **Qwen3** (any size) — strong tool calling support, recommended
- **Llama 3.3 70B** — good tool calling support

Download your preferred model in LM Studio before continuing.

### 2. Edit `mcp.json`

Open LM Studio, go to the **Program** tab in the right sidebar, and click **Edit mcp.json**. Add the `proton-mcp` entry (same `command`/`args`/`env` shape as the Claude Desktop config):

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args": ["/Full/path/to/project/proton-mcp/dist/index.js"],
      "env": {
        "PROTON_CALENDARS": "[{\"name\":\"Family\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"},{\"name\":\"Work\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"}]",
        "IMAP_USERNAME": "you@proton.me",
        "IMAP_PASSWORD": "your-bridge-generated-password"
      }
    }
  }
}
```

LM Studio auto-reloads `mcp.json` on save. The file lives at:

- **macOS/Linux**: `~/.lmstudio/mcp.json`
- **Windows**: `%USERPROFILE%\.lmstudio\mcp.json`

### 3. Tips for reliable tool calling

- Set model **temperature to 0.1** or lower — higher values cause malformed tool call JSON
- Set **context length to at least 4096**
- LM Studio will show a confirmation dialog the first time a tool is called; you can choose to always allow it

---

## Usage

### Calendar

Ask things like:

- *"What calendars do I have?"*
- *"What's on my Work calendar this week?"*
- *"Show me all Family events for the next two weeks"*

### Email

Ask things like:

- *"What emails did I receive today?"*
- *"Show me unread messages in my inbox"*
- *"Find emails from alice@example.com this week"*
- *"Read the full content of that last email"*
- *"Send an email to bob@example.com with the subject 'Hello'"*
- *"Move that email to my Archive folder"*
- *"Delete that message"*

---

## Tools reference

### `list_calendars` / `get_events` (via `calendar` tool)

| Action | Required params | Optional params |
|---|---|---|
| `list_calendars` | — | — |
| `get_events` | `calendar_name` | `start_date`, `end_date` (ISO 8601) |

### `read_mail`

| Action | Required params | Optional params |
|---|---|---|
| `list_folders` | — | — |
| `list_messages` | — | `folder`, `since`, `before`, `from`, `subject`, `unread_only`, `limit` |
| `get_message` | `uid` | `folder`, `include_body` |

### `send_mail`

| Param | Required | Description |
|---|---|---|
| `to` | yes | Recipient(s), comma-separated |
| `subject` | yes | Subject line |
| `body` | yes | Plain-text body |
| `cc` | no | CC recipient(s) |
| `bcc` | no | BCC recipient(s) |
| `reply_to` | no | Reply-To address |

### `move_mail`

| Param | Required | Description |
|---|---|---|
| `uid` | yes | IMAP UID of the message (use `read_mail` → `list_messages` to find UIDs) |
| `destination` | yes | Destination folder path (use `read_mail` → `list_folders` to see options) |
| `folder` | no | Source folder, defaults to `INBOX` |

### `delete_mail`

Permanently deletes a message — this cannot be undone.

| Param | Required | Description |
|---|---|---|
| `uid` | yes | IMAP UID of the message to delete |
| `folder` | no | Folder containing the message, defaults to `INBOX` |

---

## Calendar env var formats

**Option 1 — JSON array (recommended):**

```
PROTON_CALENDARS='[{"name":"Family","url":"https://..."},{"name":"Work","url":"https://..."}]'
```

**Option 2 — individual vars per calendar:**

```
CALENDAR_FAMILY_URL=https://...
CALENDAR_WORK_URL=https://...
```

With Option 2, the `CALENDAR_<NAME>_URL` variables are auto-discovered and `NAME` is used as the calendar name (underscores converted to spaces).
