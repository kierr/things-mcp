/**
 * MCP server factory — registers all tools with the MCP SDK v2 server.
 *
 * The server is transport-agnostic; transport selection lives in transport.ts.
 * Tool handlers are in src/tools/, registered via registerTool with v2's
 * structured output schemas and annotations.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { registerVersionTool } from "./tools/version.js";
import { registerQueryTool } from "./tools/query.js";
import { registerCreateTool } from "./tools/create.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerAppTool } from "./tools/app.js";

export const SERVER_NAME = "things-mcp";
export const SERVER_VERSION = "2.0.0";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } }
  );

  registerVersionTool(server);
  registerQueryTool(server);
  registerCreateTool(server);
  registerUpdateTool(server);
  registerDeleteTool(server);
  registerAppTool(server);

  // Optional: sandboxed code-mode tool (env-gated, zero prompt cost when off).
  if (process.env.THINGS_MCP_ENABLE_EXEC === "1") {
    import("./tools/exec.js").then(({ registerExecTool }) =>
      registerExecTool(server)
    );
  }

  return server;
}
