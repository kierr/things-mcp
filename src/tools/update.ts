/** `things_update` — bulk update via things:///json. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { executeJson, type JsonOp } from "../things/url-scheme.js";
import { getAuthTokenCached } from "../things/auth.js";
import { invalidateMetadata } from "../cache.js";

const InputSchema = {
  updates: z
    .array(
      z.object({
        type: z
          .enum(["to-do", "project"])
          .describe("Item type to update."),
        id: z.string().describe("UUID of the item to update."),
        attributes: z
          .record(z.string(), z.unknown())
          .describe(
            "Attributes to change (when, deadline, add-tags, completed, canceled, project, area, heading, notes, etc.)."
          ),
      })
    )
    .min(1)
    .describe("One or many update operations."),
};

const OutputSchema = {
  command: z.string(),
  url: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
};

export function registerUpdateTool(server: McpServer): void {
  server.registerTool(
    "things_update",
    {
      title: "Update Things",
      description:
        "Bulk-update to-dos and projects via things:///json. Supports completing, canceling, rescheduling, retagging, moving, and more. Requires auth token (auto-injected).",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const authToken = await getAuthTokenCached();
      const ops: JsonOp[] = args.updates.map((u) => ({
        type: u.type as JsonOp["type"],
        operation: "update" as const,
        id: u.id,
        attributes: u.attributes,
      }));
      const result = await executeJson(ops, authToken, false);
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
