/**
 * Transport layer — isolates transport selection from server logic.
 *
 * v2 SDK: uses StdioServerTransport from the /stdio sub-path and
 * WebStandardStreamableHTTPServerTransport for HTTP (Bun-compatible,
 * no node:http dependency).
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { findDatabasePath } from "./db/client.js";

export interface TransportOptions {
  http?: boolean;
  port?: number;
  host?: string;
}

/** Start the MCP server with the selected transport. */
export async function startServer(opts: TransportOptions = {}): Promise<void> {
  // Pre-validate DB access before starting.
  await findDatabasePath();

  const server = createServer();

  if (opts.http) {
    await startHttpTransport(server, opts.port ?? 18103, opts.host ?? "127.0.0.1");
  } else {
    await startStdioTransport(server);
  }
}

async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive; no explicit listen needed.
}

async function startHttpTransport(
  server: McpServer,
  port: number,
  host: string
): Promise<void> {
  const transport = new WebStandardStreamableHTTPServerTransport();

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Health check endpoint.
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // MCP endpoint.
    if (url.pathname === "/mcp") {
      return transport.handleRequest(req);
    }

    return new Response("Not Found", { status: 404 });
  };

  if (typeof Bun !== "undefined") {
    const httpServer = Bun.serve({ port, hostname: host, fetch: handler });
    await server.connect(transport);
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} — Streamable HTTP on http://${host}:${port}/mcp`
    );
    process.on("SIGINT", () => { httpServer.stop(); process.exit(0); });
    process.on("SIGTERM", () => { httpServer.stop(); process.exit(0); });
  } else {
    // Node 18+: use Node-native fetch + createServer adapter.
    const { createServer: nodeCreateServer } = await import("node:http");
    const nodeServer = nodeCreateServer((req, res) => {
      // Convert Node IncomingMessage → Web Request, then delegate to handler.
      const protocol = "http:";
      const urlStr = `${protocol}//${req.headers.host ?? `${host}:${port}`}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      const bodyChunks: Uint8Array[] = [];
      req.on("data", (chunk: Uint8Array) => bodyChunks.push(chunk));
      req.on("end", async () => {
        const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
        const webReq = new Request(urlStr, {
          method: req.method,
          headers,
          body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
        });
        const webRes = await handler(webReq);
        res.writeHead(webRes.status, Object.fromEntries(webRes.headers as unknown as Iterable<[string, string]>));
        const responseBody = await webRes.arrayBuffer();
        res.end(Buffer.from(responseBody));
      });
    });
    nodeServer.listen(port, host, async () => {
      await server.connect(transport);
      console.error(
        `${SERVER_NAME} v${SERVER_VERSION} — Streamable HTTP on http://${host}:${port}/mcp`
      );
    });
    process.on("SIGINT", () => { nodeServer.close(); process.exit(0); });
    process.on("SIGTERM", () => { nodeServer.close(); process.exit(0); });
  }
}
