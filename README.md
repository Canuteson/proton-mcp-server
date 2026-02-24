# proton-mcp

An MCP server that gives LLM tools including Claude Desktop and LM Studio access to your Proton Mail calendars via ICS secret links.

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

### 3. Configure Claude Desktop

Open (or create) your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

Add the following, replacing the path and calendar URLs:

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args": ["/Full/path/to/project/proton-mcp/dist/index.js"],
      "env": {
        "PROTON_CALENDARS": "[{\"name\":\"Family\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"},{\"name\":\"Work\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"}]"
      }
    }
  }
}
```

Use the full absolute path to the `dist/index.js` file in the cloned repo.

### 4. Restart Claude Desktop

Fully quit and relaunch Claude Desktop. The `proton-mcp` server will connect automatically on startup.

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
        "PROTON_CALENDARS": "[{\"name\":\"Family\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"},{\"name\":\"Work\",\"url\":\"https://calendar.proton.me/api/calendar/v1/url/...\"}]"
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

Ask things like:

- *"What calendars do I have?"*
- *"What's on my Work calendar this week?"*
- *"Show me all Family events for the next two weeks"*

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
