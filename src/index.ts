/**
 * things-mcp — entrypoint.
 *
 * Parses CLI args and starts the appropriate transport.
 * Bun or Node ≥24 (for node:sqlite).
 */

import { startServer } from "./transport.js";

function parseArgs(argv: string[]): {
  http: boolean;
  port: number;
  host: string;
} {
  const args = argv.slice(2);
  let http = false;
  let port = 18103;
  let host = "127.0.0.1";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--http":
        http = true;
        break;
      case "--port":
        port = parseInt(args[++i] ?? "18103", 10);
        break;
      case "--host":
        host = args[++i] ?? "127.0.0.1";
        break;
      case "--help":
      case "-h":
        console.log(`things-mcp — Things 3 MCP server

Usage:
  things-mcp [--http] [--port PORT] [--host HOST]

Options:
  --http        Use Streamable HTTP transport (default: stdio)
  --port PORT   HTTP port (default: 18103)
  --host HOST   HTTP host (default: 127.0.0.1)
  --help        Show this help

Environment:
  THINGS_MCP_ENABLE_EXEC=1   Enable the things_exec code-mode tool
`);
        process.exit(0);
    }
  }

  return { http, port, host };
}

const opts = parseArgs(process.argv);
startServer(opts).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
