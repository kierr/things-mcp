/**
 * Sandboxed code-mode for `things_exec`.
 *
 * Runs a JS subset in node:vm with a restricted `things` binding
 * (query/create/update/delete/search). No require, no process, no fs, no fetch,
 * no eval, no globals beyond safe builtins. RATIONALE: code mode concentrates
 * complex multi-step workflows (GTD inbox processing, weekly review) into one
 * tool rather than proliferating bespoke workflow tools. The sandbox makes it
 * safe enough for single-user local use. Would need a multi-tenant deployment
 * to reconsider — drop the tool entirely in that case.
 *
 * Registered only when THINGS_MCP_ENABLE_EXEC=1; otherwise the tool is absent
 * from tools/list and costs zero prompt tokens.
 */

import { createContext, runInContext } from "node:vm";
import { query } from "./db/queries.js";
import { executeJson, type JsonOp } from "./things/url-scheme.js";
import { getAuthTokenCached } from "./things/auth.js";
import { trashToDos } from "./things/applescript.js";
import { invalidateMetadata } from "./cache.js";

/** The `things` API exposed to the sandbox. */
export interface ThingsBinding {
  query: (opts: Record<string, unknown>) => Promise<unknown>;
  search: (q: string, opts?: Record<string, unknown>) => Promise<unknown>;
  create: (items: unknown[]) => Promise<unknown>;
  update: (updates: unknown[]) => Promise<unknown>;
  delete: (ids: string[]) => Promise<unknown>;
}

/** Build the read/write binding the sandbox script can call. */
export function makeThingsBinding(): ThingsBinding {
  return {
    query: (opts) => query(opts),
    search: (q, opts) => query({ ...opts, query: q }),
    create: async (items) => {
      const authToken = await getAuthTokenCached();
      const ops = items as JsonOp[];
      const result = await executeJson(ops, authToken, false);
      invalidateMetadata();
      return result;
    },
    update: async (updates) => {
      const authToken = await getAuthTokenCached();
      const ops = (updates as Array<{ type: "to-do" | "project"; id: string; attributes: Record<string, unknown> }>).map((u) => ({
        type: u.type,
        operation: "update" as const,
        id: u.id,
        attributes: u.attributes,
      }));
      const result = await executeJson(ops, authToken, false);
      invalidateMetadata();
      return result;
    },
    delete: async (ids) => {
      const result = await trashToDos(ids);
      invalidateMetadata();
      return result;
    },
  };
}

const SAFE_GLOBALS = [
  "Math",
  "JSON",
  "Date",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Map",
  "Set",
  "Promise",
  "Symbol",
  "RegExp",
  "Error",
  "Number",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "console",
];

/** Run a user script with the `things` binding. Returns the script's value. */
export async function runSandbox(
  script: string,
  binding: ThingsBinding
): Promise<unknown> {
  const sandbox: Record<string, unknown> = { things: binding, console };
  for (const name of SAFE_GLOBALS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox[name] = (globalThis as any)[name];
  }
  // No `process`, no `require`, no `globalThis`, no `eval`, no `Function`,
  // no `setTimeout`/`setInterval` (timers could be abused). The sandbox is
  // synchronous-shaped; async works via Promise but no I/O beyond `things`.
  const context = createContext(sandbox);
  // Wrap in an async IIFE so `await` works at the top level of the script.
  const wrapped = `(async () => {\n${script}\n})()`;
  return runInContext(wrapped, context, {
    timeout: 10_000,
    filename: "things-exec.js",
    displayErrors: true,
  });
}
