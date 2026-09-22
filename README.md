# things-mcp

An MCP server for [Things 3](https://culturedcode.com/things/) on macOS. Six tools cover every read and write; a seventh (code mode) is opt-in. Works over stdio or Streamable HTTP, on Bun or Node.

## How it works

- **Reads** go straight at Things' SQLite database (read-only handle, WAL-safe), with SQL-level filtering, pagination, and field projection. No AppleScript subprocesses, no extra dependencies.
- **Writes** go through the documented [`things:///` URL scheme](https://culturedcode.com/things/support/articles/2803573/), which triggers Cloud sync. The database is never written to directly.
- **Trashing** uses AppleScript, because the URL scheme has no delete operation. Trashed items are recoverable until the trash is emptied.

One consequence of the URL scheme: writes commit asynchronously, so a query issued in the second after a create or update can return stale state. If ordering matters, poll `things_app` with `action: "sync"` until the task count changes.

## Tools

| Tool | What it does |
|---|---|
| `version` | Server version |
| `things_query` | Every read: 12 built-in views (inbox, today, upcoming, anytime, someday, logbook, trash, recent, deadlines, repeating, all-projects, logged-projects), entity types (todo, project, area, tag, heading), free-text search, filtering by status/tag/area/project/heading/dates, pagination, field projection |
| `things_create` | Create to-dos, projects, headings, and checklist items, singly or in bulk, with nesting (projects → headings → to-dos) |
| `things_update` | Update to-dos and projects in bulk: reschedule, complete, cancel, retag, move. Auth token is injected automatically |
| `things_delete` | Move to-dos to Trash in bulk (recoverable until emptied) |
| `things_app` | Housekeeping: `status`, `launch`, `sync`, `show`, `search`, `empty-trash` (irreversible) |
| `things_exec` | Run a JS snippet against a sandboxed Things client for multi-step workflows. Off by default; set `THINGS_MCP_ENABLE_EXEC=1` to enable |

All tools declare structured output schemas and spec annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), so clients that understand them can gate and display accordingly.

## Install

```bash
bunx @kkier/things-mcp
# or
npx @kkier/things-mcp
```

From source:

```bash
git clone https://github.com/kierr/things-mcp.git
cd things-mcp
bun install
bun run build
```

Requires Things 3 on macOS, opened at least once. Bun ≥ 1.3, or Node ≥ 24 (for `node:sqlite`).

## Run

Stdio (most clients spawn this directly):

```bash
bunx @kkier/things-mcp
```

Streamable HTTP (remote clients, Bifrost):

```bash
bunx @kkier/things-mcp --http --port 18103 --host 127.0.0.1
# MCP at http://localhost:18103/mcp, health probe at /health
```

With code mode enabled:

```bash
THINGS_MCP_ENABLE_EXEC=1 bunx @kkier/things-mcp --http --port 18103
```

## Client config

Claude Desktop / Claude Code (`bunx`, or `npx` for Node):

```json
{
  "mcpServers": {
    "things": { "command": "bunx", "args": ["@kkier/things-mcp"] }
  }
}
```

opencode:

```json
{
  "mcp": {
    "things": { "type": "local", "command": ["bunx", "@kkier/things-mcp"], "enabled": true }
  }
}
```

Bifrost (remote HTTP):

```json
{
  "mcp": {
    "things": { "enabled": true, "type": "remote", "url": "http://localhost:18103/mcp" }
  }
}
```

## Run as a macOS service

The server speaks HTTP natively, so no supergateway-style wrapper is needed. Example LaunchAgent (`~/Library/LaunchAgents/com.user.mcp-things.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.mcp-things</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/you/.bun/bin/things-mcp</string>
    <string>--http</string>
    <string>--port</string>
    <string>18103</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/mcp-things.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/mcp-things.err.log</string>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.user.mcp-things.plist` and check `curl -s localhost:18103/health`.

## Examples

Show what's due today:

```json
{ "view": "today", "fields": ["id", "title", "deadline", "tags"] }
```

Create a project with a heading and tasks in one call:

```json
{
  "items": [
    { "type": "project", "attributes": { "title": "Vacation", "items": [
      { "type": "heading", "attributes": { "title": "Sights" } },
      { "type": "to-do", "attributes": { "title": "Vatican City" } }
    ] } }
  ]
}
```

Complete a task and retag another, in bulk:

```json
{
  "updates": [
    { "type": "to-do", "id": "<uuid>", "attributes": { "completed": true } },
    { "type": "to-do", "id": "<uuid>", "attributes": { "add-tags": ["Work"] } }
  ]
}
```

Code mode (only with `THINGS_MCP_ENABLE_EXEC=1`):

```js
const inbox = await things.query({ view: "inbox", limit: 50, fields: ["id", "title"] });
return inbox.items.filter(t => t.title.includes("Cigna"));
```

## Develop

```bash
bun run dev               # stdio, hot reload
bun test                  # live-DB tests auto-skip if Things is absent
bun scripts/smoke.mjs     # end-to-end smoke against a real database
bun x tsc --noEmit        # typecheck
```

Built on the MCP SDK v2 (`@modelcontextprotocol/server`) with Zod v4 schemas throughout.

## License

MIT
