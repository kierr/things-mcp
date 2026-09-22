/**
 * Shared record types for Things entities.
 *
 * Field names match the MCP-facing JSON the LLM sees (camelCase), not the
 * snake_case SQLite columns. The db/ layer maps columns → these types.
 */

export type ItemType = "to-do" | "project" | "heading";
export type ItemStatus = "incomplete" | "canceled" | "completed";
export type StartBucket = "Inbox" | "Anytime" | "Someday" | "";

/** A single row from TMTask (to-do, project, or heading). */
export interface TaskRecord {
  id: string;
  type: ItemType;
  title: string;
  status: ItemStatus;
  trashed: boolean;
  notes: string;
  start: StartBucket;
  startDate: string | null;
  deadline: string | null;
  deadlineSuppressed: boolean;
  stopDate: string | null;
  created: string | null;
  modified: string | null;
  areaId: string | null;
  areaTitle: string | null;
  projectId: string | null;
  projectTitle: string | null;
  headingId: string | null;
  headingTitle: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  index: number;
  todayIndex: number;
  // Day-code of the last day this item appeared in Today (ISO date string,
  // null when never). A non-null todayRef equal to the real today means the
  // item is currently in the Today list; anything older is a stale leftover.
  todayRef: string | null;
}

export interface AreaRecord {
  id: string;
  title: string;
  tags: string[];
  projects?: TaskRecord[];
  todos?: TaskRecord[];
}

export interface TagRecord {
  id: string;
  title: string;
  shortcut: string | null;
  parent: string | null;
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: ItemStatus;
  stopDate: string | null;
}

/** Built-in Things list views addressable by `view`. */
export const VIEW_VALUES = [
  "inbox",
  "today",
  "upcoming",
  "anytime",
  "someday",
  "logbook",
  "trash",
  "recent",
  "deadlines",
  "repeating",
  "all-projects",
  "logged-projects",
] as const;
export type View = (typeof VIEW_VALUES)[number];
