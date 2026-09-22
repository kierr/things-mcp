/** `things_delete` — bulk trash via AppleScript (URL scheme has no delete). */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { trashToDos } from "../things/applescript.js";
import { invalidateMetadata } from "../cache.js";

const InputSchema = {
  ids: z
    .array(z.string())
    .min(1)
    .describe(
      "UUIDs of to-dos to trash. Recoverable from Trash until emptied."
    ),
};

const OutputSchema = {
  trashed: z.array(z.string()),
  failed: z.array(
    z.object({ id: z.string(), error: z.string() })
  ),
};

export function registerDeleteTool(server: McpServer): void {
  server.registerTool(
    "things_delete",
    {
      title: "Delete Things",
      description:
        "Move to-dos to Trash via AppleScript. The Things URL scheme has no delete operation. Items are recoverable from Trash until emptied (things_app empty-trash).",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const result = await trashToDos(args.ids);
      invalidateMetadata();
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
