/** `things_query` — all reads via direct SQLite. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { query, type QueryResult } from "../db/queries.js";
import { VIEW_VALUES } from "../things/types.js";

// Zod v4: use z.enum() with a readonly tuple (the const assertion on VIEW_VALUES
// produces a readonly tuple, which z.enum requires).
const ViewSchema = z.enum(VIEW_VALUES);

const InputSchema = {
  view: ViewSchema.optional().describe(
    "Built-in Things list. inbox|today|upcoming|anytime|someday|logbook|trash|recent|deadlines|repeating|all-projects|logged-projects"
  ),
  type: z
    .enum(["todo", "project", "area", "tag", "heading"])
    .optional()
    .describe(
      "Entity type. area/tag bypass the view pipeline and return entity records."
    ),
  id: z.string().optional().describe("Fetch one item by UUID."),
  query: z
    .string()
    .optional()
    .describe(
      "Substring search across title, notes, tags, project, area, heading."
    ),
  status: z
    .enum(["incomplete", "completed", "canceled"])
    .optional()
    .describe("Filter by status."),
  tag: z.string().optional().describe("Filter by tag title."),
  area: z
    .string()
    .optional()
    .describe("Filter by area UUID or title."),
  project: z
    .string()
    .optional()
    .describe("Filter by project UUID or title."),
  heading: z
    .string()
    .optional()
    .describe("Filter by heading UUID or title."),
  startDate: z
    .string()
    .optional()
    .describe("Filter by start date (YYYY-MM-DD)."),
  deadline: z
    .string()
    .optional()
    .describe("Filter by deadline (YYYY-MM-DD)."),
  period: z
    .string()
    .optional()
    .describe(
      "For logbook/recent views: relative period (3d, 1w, 2m, 1y)."
    ),
  includeItems: z
    .boolean()
    .optional()
    .default(false)
    .describe("Expand nested children (areas with projects+todos)."),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Field projection. Default: id,type,title,status,start,startDate,deadline,tags,projectId,projectTitle,areaId,areaTitle."
    ),
  limit: z.number().optional().default(50).describe("Max items (default 50)."),
  offset: z.number().optional().default(0).describe("Skip N items."),
};

const OutputSchema = {
  items: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  view: z.string().optional(),
};

export function registerQueryTool(server: McpServer): void {
  server.registerTool(
    "things_query",
    {
      title: "Query Things",
      description:
        "Query Things 3 items — all reads through one tool. Supports 12 built-in views (inbox, today, upcoming, anytime, someday, logbook, trash, recent, deadlines, repeating, all-projects, logged-projects), entity types (todo, project, area, tag, heading), free-text search, and rich filtering. Paginated, field-projected, token-light.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const result: QueryResult = await query(args);
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
