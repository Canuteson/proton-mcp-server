# proton-mcp

An MCP server that exposes your Proton Mail calendars to Claude Desktop via ICS secret links.

## Configure Calendars

Calendar URLs are provided via environment variables and never hard-coded.

### Option 1 — JSON array (recommended for multiple calendars)

Set `PROTON_CALENDARS` to a JSON array of `{ name, url }` objects. Get each URL from
**Proton Calendar → Settings → Other calendars → Link for viewing**.

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

### Option 2 — individual env vars per calendar

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args": ["/Full/path/to/project/proton-mcp/dist/index.js"],
      "env": {
        "CALENDAR_FAMILY_URL": "https://calendar.proton.me/api/calendar/v1/url/...",
        "CALENDAR_WORK_URL": "https://calendar.proton.me/api/calendar/v1/url/..."
      }
    }
  }
}
```

Claude Desktop config file location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

## Using the Calendar Tool

Ask Claude things like:
- *"List my available calendars"*
- *"Fetch all events for the following week from my Family calendar"*
- *"What's on my Work calendar this Monday through Friday?"*

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

```

## Project Structure

```
proton-mcp/
├── src/
│   ├── tools/        # MCP Tools
│   │   └── ExampleTool.ts
│   └── index.ts      # Server entry point
├── package.json
└── tsconfig.json
```

## Adding Components

The project comes with an example tool in `src/tools/ExampleTool.ts`. You can add more tools using the CLI:

```bash
# Add a new tool
mcp add tool my-tool

# Example tools you might create:
mcp add tool data-processor
mcp add tool api-client
mcp add tool file-handler
```

## Tool Development

Example tool structure:

```typescript
import { MCPTool } from "mcp-framework";
import { z } from "zod";

interface MyToolInput {
  message: string;
}

class MyTool extends MCPTool<MyToolInput> {
  name = "my_tool";
  description = "Describes what your tool does";

  schema = {
    message: {
      type: z.string(),
      description: "Description of this input parameter",
    },
  };

  async execute(input: MyToolInput) {
    // Your tool logic here
    return `Processed: ${input.message}`;
  }
}

export default MyTool;
```

## Publishing to npm

1. Update your package.json:
   - Ensure `name` is unique and follows npm naming conventions
   - Set appropriate `version`
   - Add `description`, `author`, `license`, etc.
   - Check `bin` points to the correct entry file

2. Build and test locally:
   ```bash
   npm run build
   npm link
   proton-mcp  # Test your CLI locally
   ```

3. Login to npm (create account if necessary):
   ```bash
   npm login
   ```

4. Publish your package:
   ```bash
   npm publish
   ```

After publishing, users can add it to their claude desktop client (read below) or run it with npx
```

## Using with Claude Desktop

### Local Development

Add this configuration to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args":["/absolute/path/to/proton-mcp/dist/index.js"]
    }
  }
}
```

### After Publishing

Add this configuration to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "npx",
      "args": ["proton-mcp"]
    }
  }
}
```

## Building and Testing

1. Make changes to your tools
2. Run `npm run build` to compile
3. The server will automatically load your tools on startup

## Learn More

- [MCP Framework Github](https://github.com/QuantGeekDev/mcp-framework)
- [MCP Framework Docs](https://mcp-framework.com)
