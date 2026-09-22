/**
 * Query dispatcher for the `things_query` tool.
 *
 * Loads all tasks (with joins for tags + checklist) in one query, then applies
 * view semantics + user filters in JS. RATIONALE: the Things DB is small
 * (hundreds to low-thousands of rows for a single user); a full-table load with
 * joins is sub-ms, and the view semantics (today/someday/recent) are too complex
 * to express cleanly in a single SQL WHERE. Pushing user filters (status, tag,
 * area, project, type) into SQL would save negligible time and double the
 * code-path surface. Would need a measured scan >5ms on a hot path to reconsider.
 */

import type { DbConnection } from "./adapter.js";
import { withDatabase } from "./client.js";
import * as cache from "../cache.js";
import {
  mapStatus,
  mapStart,
  mapType,
  parseThingsDate,
  parseUnixTimestamp,
  parseRelativePeriod,
  toUnixSeconds,
} from "./schema.js";
import type {
  TaskRecord,
  AreaRecord,
  TagRecord,
  ChecklistItem,
  View,
} from "../things/types.js";

/** Default field set returned when `fields` is not specified (token-light). */
const DEFAULT_FIELDS = [
  "id",
  "type",
  "title",
  "status",
  "start",
  "startDate",
  "deadline",
  "tags",
  "projectId",
  "projectTitle",
  "areaId",
  "areaTitle",
] as const;

/** All selectable fields for `fields` projection. */
const ALL_FIELDS = [
  "id",
  "type",
  "title",
  "status",
  "trashed",
  "notes",
  "start",
  "startDate",
  "deadline",
  "deadlineSuppressed",
  "stopDate",
  "created",
  "modified",
  "areaId",
  "areaTitle",
  "projectId",
  "projectTitle",
  "headingId",
  "headingTitle",
  "tags",
  "checklist",
  "index",
  "todayIndex",
] as const;

export type Field = (typeof ALL_FIELDS)[number];

export interface QueryOptions {
  view?: View;
  type?: "todo" | "project" | "area" | "tag" | "heading";
  id?: string;
  query?: string;
  status?: "incomplete" | "completed" | "canceled";
  tag?: string;
  area?: string;
  project?: string;
  heading?: string;
  startDate?: string;
  deadline?: string;
  period?: string;
  includeItems?: boolean;
  fields?: string[];
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  items: unknown[];
  total: number;
  limit: number;
  offset: number;
  view?: string;
}

type RawRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "");
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

function loadTagsByTask(db: DbConnection): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT TASK_TAG.tasks AS task_id, TAG.title AS tag_title
       FROM TMTaskTag AS TASK_TAG
       LEFT JOIN TMTag AS TAG ON TAG.uuid = TASK_TAG.tags
       ORDER BY TAG."index"`
    )
    .all() as Array<{ task_id: string; tag_title: string | null }>;
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.tag_title) continue;
    const arr = out.get(r.task_id) ?? [];
    arr.push(r.tag_title);
    out.set(r.task_id, arr);
  }
  return out;
}

function loadChecklistByTask(db: DbConnection): Map<string, ChecklistItem[]> {
  const rows = db
    .prepare(
      `SELECT task AS task_id, uuid, title, status, stopDate
       FROM TMChecklistItem
       ORDER BY "index"`
    )
    .all() as Array<{
    task_id: string;
    uuid: string;
    title: string;
    status: number;
    stopDate: number | null;
  }>;
  const out = new Map<string, ChecklistItem[]>();
  for (const r of rows) {
    const arr = out.get(r.task_id) ?? [];
    arr.push({
      id: r.uuid,
      title: r.title,
      status: mapStatus(r.status),
      stopDate: parseUnixTimestamp(r.stopDate),
    });
    out.set(r.task_id, arr);
  }
  return out;
}

function loadTaskRows(db: DbConnection): RawRow[] {
  return db
    .prepare(
      `SELECT DISTINCT
         TASK.uuid, TASK.type, TASK.trashed, TASK.title, TASK.status, TASK.notes,
         TASK.start, TASK.startDate, TASK.deadline, TASK.deadlineSuppressionDate,
         TASK.stopDate, TASK.creationDate, TASK.userModificationDate, TASK.todayIndex,
         TASK."index" AS itemIndex,
         AREA.uuid AS area, AREA.title AS area_title,
         PROJECT.uuid AS project, PROJECT.title AS project_title,
         HEADING.uuid AS heading, HEADING.title AS heading_title,
         PROJECT_OF_HEADING.uuid AS project_of_heading,
         PROJECT_OF_HEADING.title AS project_of_heading_title,
         TASK.todayIndexReferenceDate AS today_ref
       FROM TMTask AS TASK
       LEFT JOIN TMTask AS PROJECT ON TASK.project = PROJECT.uuid
       LEFT JOIN TMArea AS AREA ON TASK.area = AREA.uuid
       LEFT JOIN TMTask AS HEADING ON TASK.heading = HEADING.uuid
       LEFT JOIN TMTask AS PROJECT_OF_HEADING ON HEADING.project = PROJECT_OF_HEADING.uuid
       WHERE TASK.rt1_recurrenceRule IS NULL
       ORDER BY TASK."index"`
    )
    .all() as RawRow[];
}

function hydrateTasks(db: DbConnection): TaskRecord[] {
  const tagsByTask = loadTagsByTask(db);
  const checklistByTask = loadChecklistByTask(db);
  const rows = loadTaskRows(db);
  return rows.map((row) => hydrateTask(row, tagsByTask, checklistByTask));
}

function hydrateTask(
  row: RawRow,
  tagsByTask: Map<string, string[]>,
  checklistByTask: Map<string, ChecklistItem[]>
): TaskRecord {
  const id = text(row.uuid);
  const directProjectId = text(row.project) || null;
  const directProjectTitle = text(row.project_title) || null;
  const projectOfHeadingId = text(row.project_of_heading) || null;
  const projectOfHeadingTitle = text(row.project_of_heading_title) || null;
  return {
    id,
    type: mapType(row.type),
    title: text(row.title),
    status: mapStatus(row.status),
    trashed: truthy(row.trashed),
    notes: text(row.notes),
    start: mapStart(row.start),
    startDate: parseThingsDate(row.startDate),
    deadline: parseThingsDate(row.deadline),
    deadlineSuppressed:
      row.deadlineSuppressionDate !== null &&
      row.deadlineSuppressionDate !== undefined,
    stopDate: parseUnixTimestamp(row.stopDate),
    created: parseUnixTimestamp(row.creationDate),
    modified: parseUnixTimestamp(row.userModificationDate),
    areaId: text(row.area) || null,
    areaTitle: text(row.area_title) || null,
    projectId: directProjectId ?? projectOfHeadingId,
    projectTitle: directProjectTitle ?? projectOfHeadingTitle,
    headingId: text(row.heading) || null,
    headingTitle: text(row.heading_title) || null,
    tags: tagsByTask.get(id) ?? [],
    checklist: checklistByTask.get(id) ?? [],
    index: Number(row.itemIndex) || 0,
    todayIndex: Number(row.todayIndex) || 0,
    // Day-code of the last day this item appeared in Today (packed Things
    // date int; may be NULL). Compared against the real today to decide
    // whether a todayIndex value is current or a stale leftover.
    todayRef: parseThingsDate(row.today_ref),
  };
}

function loadAreas(
  db: DbConnection,
  tasks: TaskRecord[],
  includeItems: boolean
): AreaRecord[] {
  // includeItems changes the shape, so cache only the includeItems=false form.
  if (!includeItems) {
    const cached = cache.get<AreaRecord[]>("meta:areas");
    if (cached) return cached;
  }
  const rows = db
    .prepare(`SELECT uuid, title FROM TMArea ORDER BY "index"`)
    .all() as Array<{ uuid: string; title: string }>;
  const tagRows = db
    .prepare(
      `SELECT AREA_TAG.areas AS area_id, TAG.title AS tag_title
       FROM TMAreaTag AS AREA_TAG
       LEFT JOIN TMTag AS TAG ON TAG.uuid = AREA_TAG.tags
       ORDER BY TAG."index"`
    )
    .all() as Array<{ area_id: string; tag_title: string | null }>;
  const tagsByArea = new Map<string, string[]>();
  for (const r of tagRows) {
    if (!r.tag_title) continue;
    const arr = tagsByArea.get(r.area_id) ?? [];
    arr.push(r.tag_title);
    tagsByArea.set(r.area_id, arr);
  }
  const result = rows.map((row) => {
    const area: AreaRecord = {
      id: row.uuid,
      title: row.title,
      tags: tagsByArea.get(row.uuid) ?? [],
    };
    if (includeItems) {
      area.projects = tasks.filter(
        (t) => t.type === "project" && t.areaId === row.uuid && !t.trashed
      );
      area.todos = tasks.filter(
        (t) =>
          t.type === "to-do" &&
          t.areaId === row.uuid &&
          !t.trashed &&
          !t.projectId
      );
    }
    return area;
  });
  if (!includeItems) cache.set("meta:areas", result);
  return result;
}

function loadTags(db: DbConnection): TagRecord[] {
  const cached = cache.get<TagRecord[]>("meta:tags");
  if (cached) return cached;
  const rows = db
    .prepare(`SELECT uuid, title, shortcut, parent FROM TMTag ORDER BY "index"`)
    .all() as Array<{
    uuid: string;
    title: string;
    shortcut: string | null;
    parent: string | null;
  }>;
  const result = rows.map((r) => ({
    id: r.uuid,
    title: r.title,
    shortcut: r.shortcut,
    parent: r.parent,
  }));
  cache.set("meta:tags", result);
  return result;
}

/* ----------------------------- view filters ----------------------------- */

function todayOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function incompleteNonTrashed(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter(
    (t) => t.type === "to-do" && !t.trashed && t.status === "incomplete"
  );
}

function getSomedayContext(tasks: TaskRecord[]): {
  somedayProjectIds: Set<string>;
  headingToProject: Map<string, string>;
} {
  const somedayProjectIds = new Set(
    tasks
      .filter((t) => t.type === "project" && !t.trashed && t.start === "Someday")
      .map((t) => t.id)
  );
  const headingToProject = new Map<string, string>();
  for (const t of tasks) {
    if (
      t.type === "heading" &&
      !t.trashed &&
      t.projectId &&
      somedayProjectIds.has(t.projectId)
    ) {
      headingToProject.set(t.id, t.projectId);
    }
  }
  return { somedayProjectIds, headingToProject };
}

function isInSomedayProject(
  task: TaskRecord,
  somedayProjectIds: Set<string>,
  headingToProject: Map<string, string>
): boolean {
  if (task.projectId && somedayProjectIds.has(task.projectId)) return true;
  if (!task.projectId && task.headingId && headingToProject.has(task.headingId))
    return true;
  return false;
}

function filterOutSomedayProjectTasks(tasks: TaskRecord[]): TaskRecord[] {
  const { somedayProjectIds, headingToProject } = getSomedayContext(tasks);
  return tasks.filter(
    (t) => !isInSomedayProject(t, somedayProjectIds, headingToProject)
  );
}

function viewInbox(tasks: TaskRecord[]): TaskRecord[] {
  return incompleteNonTrashed(tasks).filter((t) => t.start === "Inbox");
}

function viewToday(tasks: TaskRecord[]): TaskRecord[] {
  const today = todayOnly();
  const incomplete = filterOutSomedayProjectTasks(incompleteNonTrashed(tasks));
  // Items the user (or a repeating template) placed in Today: todayRef is the
  // day-code of the last day the item appeared in Today. RATIONALE: todayIndex
  // alone is NOT a Today marker — Things leaves stale todayIndex values on
  // items long after they leave Today (11k+ rows have one). Only a todayRef
  // equal to the real today means "currently in Today".
  const flagged = incomplete.filter((t) => t.todayRef === today);
  // Due/overdue Anytime items surface in Today ONLY when they carry a
  // deadline (a real commitment). A bare startDate without a deadline is
  // just a "not before" marker, not a due date — Things itself does not
  // show such items in Today (verified: cleared Today shows blank while
  // 2022-startDate items with no deadline exist). RATIONALE: without this
  // guard every stale startDate ever set pollutes Today permanently.
  const regular = incomplete.filter(
    (t) =>
      t.start === "Anytime" &&
      t.startDate !== null &&
      t.startDate <= today &&
      t.deadline !== null
  );
  const unconfirmed = incomplete.filter(
    (t) => t.start === "Someday" && t.startDate !== null && t.startDate < today
  );
  const overdue = incomplete.filter(
    (t) => t.deadline !== null && t.deadline < today && !t.deadlineSuppressed
  );
  const byId = new Map<string, TaskRecord>();
  for (const t of [...flagged, ...regular, ...unconfirmed, ...overdue])
    byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => {
    if (a.todayIndex !== b.todayIndex) return a.todayIndex - b.todayIndex;
    return (a.startDate ?? "").localeCompare(b.startDate ?? "");
  });
}

function viewUpcoming(tasks: TaskRecord[]): TaskRecord[] {
  const today = todayOnly();
  return filterOutSomedayProjectTasks(incompleteNonTrashed(tasks)).filter(
    (t) => t.start === "Someday" && t.startDate !== null && t.startDate > today
  );
}

function viewAnytime(tasks: TaskRecord[]): TaskRecord[] {
  return filterOutSomedayProjectTasks(incompleteNonTrashed(tasks)).filter(
    (t) => t.start === "Anytime"
  );
}

function viewSomeday(tasks: TaskRecord[]): TaskRecord[] {
  const incomplete = incompleteNonTrashed(tasks);
  const { somedayProjectIds, headingToProject } = getSomedayContext(tasks);
  const byId = new Map<string, TaskRecord>();
  for (const t of incomplete) {
    if (t.start === "Someday" && t.startDate === null) byId.set(t.id, t);
    else if (isInSomedayProject(t, somedayProjectIds, headingToProject))
      byId.set(t.id, t);
  }
  return [...byId.values()];
}

function viewLogbook(tasks: TaskRecord[], period?: string): TaskRecord[] {
  const since = period ? toUnixSeconds(parseRelativePeriod(period)) : null;
  let out = tasks.filter(
    (t) =>
      !t.trashed &&
      t.type === "to-do" &&
      (t.status === "completed" || t.status === "canceled")
  );
  if (since !== null) {
    out = out.filter((t) => {
      const ts = t.stopDate ? Date.parse(t.stopDate) / 1000 : null;
      return ts !== null && ts >= since;
    });
  }
  return [...out].sort((a, b) =>
    (b.stopDate ?? "").localeCompare(a.stopDate ?? "")
  );
}

function viewTrash(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter((t) => t.trashed);
}

function viewRecent(tasks: TaskRecord[], period: string): TaskRecord[] {
  const since = toUnixSeconds(parseRelativePeriod(period));
  return tasks
    .filter(
      (t) =>
        !t.trashed && t.created !== null && Date.parse(t.created) / 1000 >= since
    )
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
}

function viewDeadlines(tasks: TaskRecord[]): TaskRecord[] {
  const today = todayOnly();
  return incompleteNonTrashed(tasks).filter(
    (t) => t.deadline !== null && t.deadline >= today
  );
}

function viewRepeating(tasks: TaskRecord[]): TaskRecord[] {
  // Repeating tasks are filtered out at the SQL layer (rt1_recurrenceRule IS NULL).
  // To expose repeating templates we'd need a second query; for now return empty
  // with a NOTE. RATIONALE: the SQL filter excludes repeating rows from the main
  // load to keep the common views clean; surfacing them needs a separate path.
  // TODO: add a repeating-templates query if a caller needs it.
  return [];
}

function viewAllProjects(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter((t) => t.type === "project" && !t.trashed);
}

function viewLoggedProjects(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter(
    (t) =>
      t.type === "project" &&
      !t.trashed &&
      (t.status === "completed" || t.status === "canceled")
  );
}

const VIEW_FILTERS: Record<
  View,
  (tasks: TaskRecord[], period?: string) => TaskRecord[]
> = {
  inbox: viewInbox,
  today: viewToday,
  upcoming: viewUpcoming,
  anytime: viewAnytime,
  someday: viewSomeday,
  logbook: (t, p) => viewLogbook(t, p),
  trash: (t) => viewTrash(t),
  recent: (t, p) => viewRecent(t, p ?? "1w"),
  deadlines: (t) => viewDeadlines(t),
  repeating: (t) => viewRepeating(t),
  "all-projects": (t) => viewAllProjects(t),
  "logged-projects": (t) => viewLoggedProjects(t),
};

/* --------------------------- user filters --------------------------- */

function matchQuery(
  task: TaskRecord | AreaRecord | TagRecord,
  query: string
): boolean {
  const lower = query.toLowerCase();
  const values: string[] = [];
  if ("title" in task) values.push(task.title);
  if ("notes" in task) values.push((task as TaskRecord).notes);
  if ("tags" in task && Array.isArray(task.tags)) values.push(...task.tags);
  if ("projectTitle" in task) {
    const pt = (task as TaskRecord).projectTitle;
    if (pt) values.push(pt);
  }
  if ("headingTitle" in task) {
    const ht = (task as TaskRecord).headingTitle;
    if (ht) values.push(ht);
  }
  if ("areaTitle" in task) {
    const at = (task as TaskRecord).areaTitle;
    if (at) values.push(at);
  }
  if ("shortcut" in task) {
    const sc = (task as TagRecord).shortcut;
    if (sc) values.push(sc);
  }
  return values.some((v) => v.toLowerCase().includes(lower));
}

function applyTaskFilters(
  tasks: TaskRecord[],
  opts: QueryOptions
): TaskRecord[] {
  let out = tasks;
  if (opts.type === "todo") out = out.filter((t) => t.type === "to-do");
  else if (opts.type === "project") out = out.filter((t) => t.type === "project");
  else if (opts.type === "heading") out = out.filter((t) => t.type === "heading");

  if (opts.status)
    out = out.filter((t) => t.status === opts.status);
  if (opts.tag) out = out.filter((t) => t.tags.includes(opts.tag as string));
  if (opts.area) {
    const a = opts.area;
    out = out.filter((t) => t.areaId === a || t.areaTitle === a);
  }
  if (opts.project) {
    const p = opts.project;
    out = out.filter((t) => t.projectId === p || t.projectTitle === p);
  }
  if (opts.heading) {
    const h = opts.heading;
    out = out.filter((t) => t.headingId === h || t.headingTitle === h);
  }
  if (opts.query) out = out.filter((t) => matchQuery(t, opts.query as string));
  if (opts.id) out = out.filter((t) => t.id === opts.id);
  return out;
}

function projectFields(task: TaskRecord, fields?: string[]): unknown {
  const sel = fields && fields.length > 0 ? fields : DEFAULT_FIELDS;
  const out: Record<string, unknown> = {};
  for (const f of sel) {
    if (f === "start") out.start = task.start;
    else if (f in task) out[f] = (task as unknown as Record<string, unknown>)[f];
  }
  return out;
}

/* --------------------------- public entry --------------------------- */

/** Execute a `things_query` against the live DB. */
export async function query(opts: QueryOptions): Promise<QueryResult> {
  return withDatabase((db) => {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const includeItems = opts.includeItems ?? false;

    // Entity-typed queries (areas/tags) bypass the task view pipeline.
    if (opts.type === "area") {
      const tasks = hydrateTasks(db);
      let areas = loadAreas(db, tasks, includeItems);
      if (opts.query) areas = areas.filter((a) => matchQuery(a, opts.query as string));
      if (opts.id) areas = areas.filter((a) => a.id === opts.id);
      return paginate(areas, limit, offset, opts.view);
    }
    if (opts.type === "tag") {
      let tags = loadTags(db);
      if (opts.query) tags = tags.filter((t) => matchQuery(t, opts.query as string));
      if (opts.id) tags = tags.filter((t) => t.id === opts.id);
      return paginate(tags, limit, offset, opts.view);
    }

    const tasks = hydrateTasks(db);
    let scoped: TaskRecord[];

    if (opts.view) {
      const filter = VIEW_FILTERS[opts.view];
      scoped = filter(tasks, opts.period);
      // For views, additional user filters apply on top.
      scoped = applyTaskFilters(scoped, opts);
    } else if (opts.id) {
      scoped = tasks.filter((t) => t.id === opts.id);
    } else {
      scoped = applyTaskFilters(tasks, opts);
    }

    const projected = scoped.map((t) => projectFields(t, opts.fields));
    return paginate(projected, limit, offset, opts.view);
  });
}

function paginate(
  items: unknown[],
  limit: number,
  offset: number,
  view?: string
): QueryResult {
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  return { items: sliced, total, limit, offset, view };
}
