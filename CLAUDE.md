# proton-mcp

MCP server that exposes Proton Mail calendars to Claude Desktop. Proton Mail calendar URLs are secret ICS download links that decrypt calendar data — they must never be committed to source, only provided via environment variables.

## Project structure

```
src/
  index.ts              — MCPServer entry point; tools are auto-discovered from src/tools/
  tools/
    CalendarTool.ts     — main tool: list_calendars and get_events actions
  lib/
    icsParser.ts        — custom RFC 5545 ICS parser, no external dependencies
```

## Build

```bash
npm run build   # runs tsc then mcp-build (adds shebang, validates tools)
npm start       # runs dist/index.js
```

Output goes to `dist/`. The mcp-framework auto-discovers any class that extends `MCPTool` and is the default export of a file in `dist/tools/`.

## Critical: Zod v3/v4 conflict — always import from `"zod/v3"`

Root `node_modules/zod` (v3.25.76) ships the **Zod v4 API** as its default export. The mcp-framework has its own nested copy that uses the **Zod v3 API**. This causes two problems:

1. **TypeScript**: `ZodObject` types are structurally incompatible → `TS2416` if you use `z.object({...})` as the schema and pass it as a generic type parameter.
2. **Runtime**: `instanceof z.ZodOptional` in the framework's `generateSchemaFromLegacyFormat` uses its v3 class — v4 `ZodOptional` instances fail the check, so **all fields get marked `required`** even when `.optional()` is used.

**Fix: always import from `"zod/v3"` in tool files:**
```typescript
import { z } from "zod/v3";  // NOT "zod"
```

**Also use the legacy `ToolInputSchema` format** (not `z.object({...})`), to avoid the TypeScript `ZodObject` incompatibility:

```typescript
interface MyInput {
  field: string;
  optional?: string;
}

class MyTool extends MCPTool<MyInput> {
  schema = {
    field: {
      type: z.string(),
      description: "...",
    },
    optional: {
      type: z.string().optional(),
      description: "...",
    },
  };

  async execute(input: MyInput) { ... }
}
```

## Calendar configuration (env vars)

Calendars are configured at runtime via environment variables — not in code. Two formats are supported:

**Option 1 — JSON array (preferred):**
```
PROTON_CALENDARS='[{"name":"Family","url":"https://calendar.proton.me/..."},{"name":"Work","url":"https://..."}]'
```

**Option 2 — individual vars per calendar:**
```
CALENDAR_FAMILY_URL=https://...
CALENDAR_WORK_URL=https://...
```

`CALENDAR_<NAME>_URL` vars are auto-discovered; `NAME` is converted to title case (underscores → spaces).

## CalendarTool actions

| Action | Required params | Optional params |
|---|---|---|
| `list_calendars` | — | — |
| `get_events` | `calendar_name` | `start_date`, `end_date` (ISO 8601) |

`start_date` defaults to today; `end_date` defaults to 7 days after `start_date`. Calendar name matching is case-insensitive.

## ICS parser notes

`src/lib/icsParser.ts` is a standalone parser with no npm dependencies. It handles:
- RFC 5545 line unfolding (CRLF + leading whitespace)
- All-day events: `DATE` value type or bare `YYYYMMDD`
- UTC datetimes: `YYYYMMDDTHHMMSSZ`
- Local/TZID datetimes: `YYYYMMDDTHHMMSS` (treated as local time)
- Value unescaping: `\n`, `\,`, `\\`

Only `VEVENT` components are parsed. `VTODO`, `VJOURNAL`, recurrence expansion are not implemented.

## Claude Desktop config

```json
{
  "mcpServers": {
    "proton-mcp": {
      "command": "node",
      "args": ["/Full/path/to/project/proton-mcp/dist/index.js"],
      "env": {
        "PROTON_CALENDARS": "[{\"name\":\"Family\",\"url\":\"https://...\"}]"
      }
    }
  }
}
```
