/**
 * Auth-token cache. Read once from TMSettings, held for the process lifetime.
 * Invalidated only if a URL-scheme update returns an auth error (rotation).
 *
 * RATIONALE: the token rotates only when the user resets it in Things settings;
 * re-reading it per write would add a DB round-trip for zero benefit. Would need
 * the URL scheme to return a distinct "token invalid" error to reconsider.
 */

import { getAuthToken } from "../db/client.js";

let cached: string | null | undefined;

export async function getAuthTokenCached(): Promise<string | null> {
  if (cached === undefined) {
    cached = await getAuthToken();
  }
  return cached;
}

export function invalidateAuthToken(): void {
  cached = undefined;
}
