/** version tool — reports the Things URL-scheme version and server version. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "../server.js";

const OutputSchema = {
  server: z.string(),
  version: z.string(),
};

export function registerVersionTool(server: McpServer): void {
  server.registerTool(
    "version",
    {
      title: "Version",
      description: "Report things-mcp server version.",
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = { server: SERVER_NAME, version: SERVER_VERSION };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result,
      };
    }
  );
}
