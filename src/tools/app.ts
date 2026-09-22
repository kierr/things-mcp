/** `things_app` — housekeeping: status, launch, sync, show, search, empty-trash. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { isThingsRunning, getThingsVersion, emptyTrash } from "../things/applescript.js";
import { ensureThingsRunning } from "../things/url-scheme.js";
import { executeCommand } from "../things/url-scheme.js";
import { getAuthTokenCached } from "../things/auth.js";
import { findDatabasePath } from "../db/client.js";
import { invalidateMetadata } from "../cache.js";

const InputSchema = {
  action: z
    .enum(["status", "launch", "sync", "show", "search", "empty-trash"])
    .describe("Housekeeping action."),
  id: z
    .string()
    .optional()
    .describe(
      "For show: list id (inbox, today, upcoming, anytime, someday, logbook, trash) or item UUID."
    ),
  query: z
    .string()
    .optional()
    .describe("For search: query string."),
};

const OutputSchema = {
  running: z.boolean().optional(),
  appVersion: z.string().optional(),
  dbPath: z.string().optional(),
  authTokenPresent: z.boolean().optional(),
  launched: z.boolean().optional(),
  taskCount: z.number().optional(),
  hint: z.string().optional(),
  command: z.string().optional(),
  url: z.string().optional(),
  ok: z.boolean().optional(),
  emptied: z.boolean().optional(),
  warning: z.string().optional(),
  error: z.string().optional(),
};

export function registerAppTool(server: McpServer): void {
  server.registerTool(
    "things_app",
    {
      title: "Things App",
      description:
        "Things app housekeeping: status probe, launch, sync, show list/item, search, empty-trash. Mixed read/write — empty-trash is destructive.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const result = await handleAppAction(args);
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

async function handleAppAction(args: {
  action: string;
  id?: string;
  query?: string;
}): Promise<Record<string, unknown>> {
  switch (args.action) {
    case "status": {
      const [running, version, dbPath] = await Promise.all([
        isThingsRunning().catch(() => false),
        getThingsVersion().catch(() => null),
        findDatabasePath().catch(() => null),
      ]);
      const hasToken = !!(await getAuthTokenCached());
      return {
        running,
        appVersion: version,
        dbPath,
        authTokenPresent: hasToken,
      };
    }
    case "launch": {
      const launched = await ensureThingsRunning();
      return { launched };
    }
    case "sync": {
      // Probe commit state — read the DB row count as a proxy.
      const { withDatabase } = await import("../db/client.js");
      const count = await withDatabase((db) =>
        (db.prepare("SELECT COUNT(*) AS c FROM TMTask WHERE rt1_recurrenceRule IS NULL").get() as { c: number }).c
      );
      return { taskCount: count, hint: "Task count as commit-state proxy; compare before/after write." };
    }
    case "show": {
      const authToken = await getAuthTokenCached();
      const id = args.id ?? "inbox";
      return executeCommand("show", { id }, authToken, false);
    }
    case "search": {
      const authToken = await getAuthTokenCached();
      const query = args.query ?? "";
      return executeCommand("search", { query }, authToken, false);
    }
    case "empty-trash": {
      await emptyTrash();
      invalidateMetadata();
      return { emptied: true, warning: "Trash emptied — this is irreversible." };
    }
    default:
      return { error: `Unknown action: ${args.action}` };
  }
}
