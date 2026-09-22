/**
 * Things 3 SQLite schema constants + date parsing.
 *
 * Schema reverse-engineered from the live DB (TMTask/TMArea/TMTag/...).
 * Date decoding follows SupaThings-MCP's reverse engineering of the packed
 * day-code format.
 */

/** Numeric type values on TMTask.type. */
export function mapType(value: unknown): "to-do" | "project" | "heading" {
  switch (Number(value)) {
    case 1:
      return "project";
    case 2:
      return "heading";
    default:
      return "to-do";
  }
}

/** Numeric status values on TMTask.status. */
export function mapStatus(
  value: unknown
): "incomplete" | "canceled" | "completed" {
  switch (Number(value)) {
    case 2:
      return "canceled";
    case 3:
      return "completed";
    default:
      return "incomplete";
  }
}

/** Numeric start values on TMTask.start. */
export function mapStart(
  value: unknown
): "Inbox" | "Anytime" | "Someday" | "" {
  switch (Number(value)) {
    case 0:
      return "Inbox";
    case 1:
      return "Anytime";
    case 2:
      return "Someday";
    default:
      return "";
  }
}

/** Unix timestamp (seconds) → ISO string, or null. */
export function parseUnixTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

/**
 * Parse a Things date-only column.
 *
 * Things stores date-only values as a packed day code left-shifted by 7 bits
 * (the low 7 bits carry other flags). The day code itself encodes year/month/day
 * bit-packed: year in bits ≥9, month in bits 5-8, day in bits 0-4. RATIONALE:
 * decoding the raw integer directly produces years like 8104; the >>7 unwrap is
 * required to recover the real date. Ported from SupaThings-MCP.
 */
export function parseThingsDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const dayCode = (numeric & 0x7f) === 0 ? numeric >> 7 : numeric;
  const year = dayCode >> 9;
  const month = (dayCode >> 5) & 0x0f;
  const day = dayCode & 0x1f;

  if (!year || !month || !day) return null;
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** Parse a relative period like "3d", "1w", "2m", "1y" → a past Date. */
export function parseRelativePeriod(period: string): Date {
  const match = /^(\d+)([dwmy])$/i.exec(period.trim());
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Invalid period "${period}". Use forms like 3d, 1w, 2m, 1y.`
    );
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const date = new Date();
  switch (unit) {
    case "d":
      date.setDate(date.getDate() - amount);
      break;
    case "w":
      date.setDate(date.getDate() - amount * 7);
      break;
    case "m":
      date.setMonth(date.getMonth() - amount);
      break;
    case "y":
      date.setFullYear(date.getFullYear() - amount);
      break;
  }
  return date;
}

/** Convert a Date to a Unix timestamp (seconds). */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
