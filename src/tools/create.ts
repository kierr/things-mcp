/** `things_create` — bulk create via things:///json. */
import { z, type ZodType } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { executeJson, type JsonOp } from "../things/url-scheme.js";
import { getAuthTokenCached } from "../things/auth.js";
import { invalidateMetadata } from "../cache.js";

// Self-referencing schema: items can contain nested items.
// Zod v4: z.lazy with explicit type annotation breaks the circular inference.
// Define the inner shape separately, then wrap.
const ItemAttributesSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Type-specific attributes (title, notes, when, deadline, tags, area, project, heading, checklist-items, etc.). See Things URL scheme docs."
  );

interface ItemShape {
  type: "to-do" | "project" | "heading" | "checklist-item";
  attributes: Record<string, unknown>;
  items?: ItemShape[];
}

const ItemSchema: ZodType<ItemShape> = z.object({
  type: z
    .enum(["to-do", "project", "heading", "checklist-item"])
    .describe("Thing type to create."),
  attributes: ItemAttributesSchema,
  items: z
    .array(z.lazy(() => ItemSchema))
    .optional()
    .describe("Nested sub-items (headings under projects, todos under headings)."),
});

const InputSchema = {
  items: z
    .array(ItemSchema)
    .min(1)
    .describe(
      "One or many items to create in a single bulk call. Supports nesting."
    ),
  reveal: z
    .boolean()
    .optional()
    .default(false)
    .describe("Show the created item(s) in Things."),
};

const OutputSchema = {
  command: z.string(),
  url: z.string(),
  ids: z.array(z.string()).optional(),
  ok: z.boolean(),
  error: z.string().optional(),
};

export function registerCreateTool(server: McpServer): void {
  server.registerTool(
    "things_create",
    {
      title: "Create Things",
      description:
        "Bulk-create to-dos, projects, headings, and checklist-items via things:///json. Supports nesting (projects → headings → todos). Bulk-safe.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const authToken = await getAuthTokenCached();
      const ops: JsonOp[] = mapItems(args.items);
      const result = await executeJson(ops, authToken, args.reveal ?? false);
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

/** Flatten nested item tree into a flat array of JsonOp (depth-first). */
function mapItems(items: ItemShape[], parentType?: string): JsonOp[] {
  const ops: JsonOp[] = [];
  for (const item of items) {
    const { type, attributes, items: children } = item;
    ops.push({
      type: type as JsonOp["type"],
      operation: "create",
      attributes,
    });
    if (children && children.length > 0) {
      for (const child of children) {
        const childAttrs = { ...child.attributes };
        if (parentType === "project" || type === "project") {
          childAttrs.project = attributes.title ?? childAttrs.project;
        } else if (parentType === "heading" || type === "heading") {
          childAttrs.heading = attributes.title ?? childAttrs.heading;
        }
        ops.push(...mapItems([child], type));
      }
    }
  }
  return ops;
}
