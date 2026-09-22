/**
 * AppleScript bridge — for operations the URL scheme doesn't cover.
 *
 * - Trash (URL scheme has no delete/trashed attribute)
 * - Area create (URL scheme only assigns to existing areas)
 * - App status + version probes
 * - Empty trash
 *
 * NOTE: Things' AppleScript bridge can be slow (seconds) when the app is
 * indexing after writes. We set a 30s per-op timeout and treat timeouts as
 * recoverable errors. RATIONALE: the bridge is the only supported path for
 * these ops; SQLite writes would risk corruption. Would need Cultured Code to
 * add trash/area-create to the URL scheme to drop this layer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const THINGS_APP_PATH = "/Applications/Things3.app";
const THINGS_APP_NAME = "Things3";
const APPLESCRIPT_TIMEOUT_MS = 30_000;

export async function isThingsRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      `tell application "System Events" to (name of processes) contains "${THINGS_APP_NAME}"`,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getThingsVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      `tell application "${THINGS_APP_NAME}" to return version`,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Move one or many to-dos to Trash in a single AppleScript call. */
export async function trashToDos(ids: string[]): Promise<{
  trashed: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  if (ids.length === 0) return { trashed: [], failed: [] };

  // Build one script that trashes each id; collect per-id results.
  const lines: string[] = ["tell application \"Things3\"", "set results to {}"];
  for (const id of ids) {
    lines.push(
      `try`,
      `set end of results to "OK:${id}"`,
      `set t to to do id "${id}"`,
      `set trashed of t to true`,
      `on error errMsg`,
      `set end of results to "ERR:${id}:" & errMsg`,
      `end try`
    );
  }
  lines.push("return results as string", "end tell");

  const script = lines.join("\n");
  const { stdout } = await execFileAsync(
    "osascript",
    ["-e", script],
    { timeout: APPLESCRIPT_TIMEOUT_MS }
  );

  const trashed: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const line of stdout.split(",")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("OK:")) trashed.push(trimmed.slice(3));
    else if (trimmed.startsWith("ERR:")) {
      const rest = trimmed.slice(4);
      const colon = rest.indexOf(":");
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const err = colon >= 0 ? rest.slice(colon + 1) : "unknown error";
      failed.push({ id, error: err });
    }
  }
  return { trashed, failed };
}

/** Create a new area. The URL scheme has no area-create, only area assignment. */
export async function createArea(title: string): Promise<string | null> {
  const script = `tell application "${THINGS_APP_NAME}" to make new area with properties {name:${escapeString(title)}}`;
  const { stdout } = await execFileAsync(
    "osascript",
    ["-e", script],
    { timeout: APPLESCRIPT_TIMEOUT_MS }
  );
  return stdout.trim() || null;
}

/** Empty the Trash list (irreversible). */
export async function emptyTrash(): Promise<boolean> {
  const script = `tell application "${THINGS_APP_NAME}" to empty trash`;
  await execFileAsync("osascript", ["-e", script], {
    timeout: APPLESCRIPT_TIMEOUT_MS,
  });
  return true;
}

/** AppleScript string escape — double up double-quotes. */
function escapeString(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
