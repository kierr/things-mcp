/** `things_exec` — sandboxed code mode (opt-in, env-gated). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { runSandbox, makeThingsBinding } from "../sandbox.js";

const InputSchema = {
  script: z
    .string()
    .min(1)
    .describe(
      "JavaScript to execute against a sandboxed things client (query, search, create, update, delete). Must return a value."
    ),
};

const OutputSchema = {
  result: z.unknown(),
  error: z.string().optional(),
};

export function registerExecTool(server: McpServer): void {
  server.registerTool(
    "things_exec",
    {
      title: "Execute Things Script",
      description:
        "Run a JavaScript snippet against a sandboxed Things client. Access: things.query(), things.create(), things.update(), things.delete(). Must return a value. Env-gated (THINGS_MCP_ENABLE_EXEC=1).",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await runSandbox(args.script, makeThingsBinding());
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ result }),
            },
          ],
          structuredContent: { result },
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error }),
            },
          ],
          structuredContent: { result: null, error },
          isError: true,
        };
      }
    }
  );
}
