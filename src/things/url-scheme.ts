/**
 * Things URL scheme — the supported, non-fragile write path.
 *
 * `things:///json` accepts a `data` array of create/update operations
 * (todos, projects, headings, checklist-items, nested) and returns created IDs
 * via x-callback. `things:///add|update|update-project` are one-shot shorthands.
 * Writes go through the running Things app, which triggers Cloud sync via
 * Syncrony.framework automatically. RATIONALE: writing SQLite directly would
 * risk corruption + Cloud-sync desync; the URL scheme is the documented public
 * contract and is robust across Things versions.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const THINGS_APP_PATH = "/Applications/Things3.app";
const THINGS_APP_NAME = "Things3";

/** A single create/update operation for the `json` command. */
export interface JsonOp {
  type: "to-do" | "project" | "heading" | "checklist-item";
  operation?: "create" | "update";
  id?: string;
  attributes: Record<string, unknown>;
}

export interface CreateResult {
  command: "json";
  url: string;
  ids?: string[];
  ok: boolean;
  error?: string;
}

export interface UpdateResult {
  command: string;
  url: string;
  id: string;
  ok: boolean;
  error?: string;
}

async function assertThingsInstalled(): Promise<void> {
  // Cheap idempotent probe — `open -Ra` resolves without launching a window.
  await execFileAsync("open", ["-Ra", THINGS_APP_PATH]).catch(async () => {
    await execFileAsync("open", ["-Ra", THINGS_APP_NAME]).catch(() => {
      throw new Error(
        "Things 3 not found. Install it or set the app path."
      );
    });
  });
}

/** Launch Things if not running. Writes silently fail when the app is closed. */
export async function ensureThingsRunning(): Promise<boolean> {
  await assertThingsInstalled();
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    `tell application "System Events" to (name of processes) contains "${THINGS_APP_NAME}"`,
  ]);
  const running = stdout.trim() === "true";
  if (!running) {
    await execFileAsync("open", ["-a", THINGS_APP_NAME]);
    // Give it a moment to register the URL scheme handler.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return !running;
}

async function runAppleScript(script: string): Promise<string> {
  await assertThingsInstalled();
  const lines = script.split("\n");
  const args = lines.flatMap((l) => ["-e", l]);
  const { stdout } = await execFileAsync("osascript", args);
  return stdout.trim();
}

/**
 * Open a things:/// URL via AppleScript `do shell script "open -g"`. The `-g`
 * flag brings Things forward without stealing focus. Falls back to a plain
 * `open -g` if AppleScript is unavailable.
 */
async function openThingsUrl(
  command: string,
  params: string
): Promise<void> {
  await ensureThingsRunning();
  const query = params ? `?${params}` : "";
  const url = `things:///${command}${query}`;
  try {
    await runAppleScript(`do shell script "open -g \\"${url}\\""`);
  } catch {
    await execFileAsync("open", ["-g", url]);
  }
}

/** Build application/x-www-form-urlencoded params from a key/value map. */
function buildUrlParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    let encoded: string;
    if (Array.isArray(value)) {
      encoded = value.join(",");
    } else if (typeof value === "boolean") {
      encoded = value ? "true" : "false";
    } else {
      encoded = String(value);
    }
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`
    );
  }
  return parts.join("&");
}

/**
 * Execute the `things:///json` command — bulk create + update in one call.
 * `authToken` is required when any operation is an update.
 */
export async function executeJson(
  ops: JsonOp[],
  authToken: string | null,
  reveal = false
): Promise<CreateResult> {
  const hasUpdate = ops.some((o) => o.operation === "update");
  const params: Record<string, unknown> = {
    data: JSON.stringify(ops),
  };
  if (hasUpdate && authToken) params["auth-token"] = authToken;
  if (reveal) params.reveal = "true";

  const paramStr = buildUrlParams(params);
  const url = `things:///json?${paramStr}`;
  await openThingsUrl("json", paramStr);

  // The URL scheme does not return the x-callback IDs synchronously to a plain
  // `open`. For a single-user local server the caller verifies via things_query.
  // RATIONALE: implementing x-callback-url requires a listening HTTP server for
  // the callback; the cost outweighs the benefit when reads are sub-ms.
  // TODO: if callers need created IDs returned synchronously, wire x-callback.
  return { command: "json", url, ok: true };
}

/**
 * Execute a one-shot command (add, update, update-project, show, search, version).
 * Update-family commands require `authToken`.
 */
export async function executeCommand(
  command: string,
  params: Record<string, unknown>,
  authToken: string | null,
  requiresAuth: boolean
): Promise<{ command: string; url: string; ok: boolean }> {
  const finalParams = { ...params };
  if (requiresAuth && authToken) finalParams["auth-token"] = authToken;
  const paramStr = buildUrlParams(finalParams);
  await openThingsUrl(command, paramStr);
  return { command, url: `things:///${command}?${paramStr}`, ok: true };
}

/** Run an AppleScript snippet. Used by the trash + area-create paths. */
export async function runScript(script: string): Promise<string> {
  return runAppleScript(script);
}
