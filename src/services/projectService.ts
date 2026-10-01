import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  CreateProjectInput,
  CreateProjectTaskInput,
  ProjectMember,
  ProjectMemberOption,
  ProjectMessage,
  ProjectRole,
  ProjectStatus,
  ProjectSummary,
  ProjectTask,
} from "@/types/project";
import type { TaskPriority, TaskStatus } from "@/types/work";
import { requireEmployeeId, requireOrganizationId } from "./api";

function database() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.");
  }
  /* eslint-disable @typescript-eslint/no-explicit-any -- generated Database types do not know these tables */
  const db = supabase as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return db;
}

interface PersonRow {
  first_name?: string | null;
  last_name?: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  description?: string | null;
  status?: ProjectStatus | null;
  priority?: TaskPriority | null;
  owner_id?: string | null;
  owner?: PersonRow | null;
  start_date?: string | null;
  due_date?: string | null;
  archived_at?: string | null;
  project_members?: { count: number }[] | null;
  tasks?: { status: string }[] | null;
}

interface MemberRow {
  id: string;
  project_id: string;
  employee_id: string;
  role_in_project: ProjectRole;
  added_at: string;
  employee?: PersonRow | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  assigned_to: string;
  assignee?: PersonRow | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date?: string | null;
  completed_at?: string | null;
  source_message_id?: string | null;
}

interface MessageRow {
  id: string;
  project_id: string;
  author_id?: string | null;
  author?: PersonRow | null;
  body_text: string;
  mentions?: string[] | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
}

function personName(p?: PersonRow | null, fallback = "Unknown") {
  const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  return name || fallback;
}

function mapProject(row: ProjectRow): ProjectSummary {
  const tasks = row.tasks ?? [];
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status ?? "planning",
    priority: row.priority ?? "medium",
    ownerId: row.owner_id ?? null,
    ownerName: personName(row.owner, "Unassigned"),
    startDate: row.start_date ?? null,
    dueDate: row.due_date ?? null,
    archivedAt: row.archived_at ?? null,
    memberCount: row.project_members?.[0]?.count ?? 0,
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => t.status === "done").length,
  };
}

function mapMember(row: MemberRow): ProjectMember {
  return {
    id: row.id,
    projectId: row.project_id,
    employeeId: row.employee_id,
    name: personName(row.employee),
    role: row.role_in_project,
    addedAt: row.added_at,
  };
}

function mapTask(row: TaskRow): ProjectTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? "",
    assignedTo: row.assigned_to,
    assignedToName: personName(row.assignee),
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date ?? null,
    completedAt: row.completed_at ?? null,
    sourceMessageId: row.source_message_id ?? null,
  };
}

function mapMessage(row: MessageRow): ProjectMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id ?? null,
    authorName: personName(row.author),
    bodyText: row.body_text,
    mentions: row.mentions ?? [],
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
  };
}

const PROJECT_SELECT =
  "id,name,description,status,priority,owner_id,start_date,due_date,archived_at," +
  "owner:employees!projects_owner_id_fkey(first_name,last_name)," +
  "project_members(count),tasks(status)";
const MEMBER_SELECT =
  "id,project_id,employee_id,role_in_project,added_at," +
  "employee:employees!project_members_employee_id_fkey(first_name,last_name)";
const TASK_SELECT =
  "id,project_id,title,description,assigned_to,priority,status,due_date,completed_at,source_message_id," +
  "assignee:employees!tasks_assigned_to_fkey(first_name,last_name)";
const MESSAGE_SELECT =
  "id,project_id,author_id,body_text,mentions,created_at,edited_at,deleted_at," +
  "author:employees!project_messages_author_id_fkey(first_name,last_name)";

export const MESSAGE_PAGE_SIZE = 100;

export async function listProjects(
  opts: { includeArchived?: boolean } = {},
): Promise<ProjectSummary[]> {
  const db = database();
  let query = db.from("projects").select(PROJECT_SELECT).order("created_at", { ascending: false });
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProjectRow[]).map(mapProject);
}

export async function getProject(projectId: string): Promise<ProjectSummary | null> {
  const db = database();
  const { data, error } = await db
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapProject(data as ProjectRow) : null;
}

export async function createProject(input: CreateProjectInput): Promise<string> {
  const db = database();
  const organizationId = await requireOrganizationId();
  const ownerId = await requireEmployeeId();
  const name = input.name.trim();
  if (!name) throw new Error("Project name is required.");
  const { data, error } = await db
    .from("projects")
    .insert({
      organization_id: organizationId,
      owner_id: ownerId,
      name,
      description: input.description?.trim() || null,
      status: input.status ?? "planning",
      priority: input.priority ?? "medium",
      start_date: input.startDate || null,
      due_date: input.dueDate || null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("A project with this name already exists.");
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Omit<CreateProjectInput, "name">> & { name?: string; archived?: boolean },
): Promise<void> {
  const db = database();
  const row: { [key: string]: unknown } = {};
  if (patch.name !== undefined) row["name"] = patch.name.trim();
  if (patch.description !== undefined) row["description"] = patch.description.trim() || null;
  if (patch.status !== undefined) row["status"] = patch.status;
  if (patch.priority !== undefined) row["priority"] = patch.priority;
  if (patch.startDate !== undefined) row["start_date"] = patch.startDate || null;
  if (patch.dueDate !== undefined) row["due_date"] = patch.dueDate || null;
  if (patch.archived !== undefined)
    row["archived_at"] = patch.archived ? new Date().toISOString() : null;
  const { error } = await db.from("projects").update(row).eq("id", projectId);
  if (error) throw new Error(error.message);
}

interface DirectoryRow {
  id?: string | null;
  full_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
}

/** Active employees in the caller's organisation. Plain employees get an empty list. */
export async function listProjectMemberDirectory(): Promise<ProjectMemberOption[]> {
  const db = database();
  const { data, error } = await db.rpc("project_member_directory");
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const people: ProjectMemberOption[] = [];
  for (const row of (data ?? []) as DirectoryRow[]) {
    const id = row.id ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    people.push({
      id,
      fullName: row.full_name?.trim() || "Employee",
      departmentId: row.department_id ?? null,
      departmentName: row.department_name?.trim() ?? "",
    });
  }
  return people;
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const db = database();
  const { data, error } = await db
    .from("project_members")
    .select(MEMBER_SELECT)
    .eq("project_id", projectId)
    .order("added_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MemberRow[]).map(mapMember);
}

export async function addProjectMember(
  projectId: string,
  employeeId: string,
  role: ProjectRole = "contributor",
): Promise<void> {
  const db = database();
  const { error } = await db.from("project_members").insert({
    project_id: projectId,
    employee_id: employeeId,
    role_in_project: role,
  });
  if (error) {
    if (error.code === "23505") throw new Error("This person is already a member.");
    throw new Error(error.message);
  }
}

export async function updateProjectMemberRole(memberId: string, role: ProjectRole): Promise<void> {
  const db = database();
  const { error } = await db
    .from("project_members")
    .update({ role_in_project: role })
    .eq("id", memberId);
  if (error) throw new Error(error.message);
}

/** Fails with a clear message when the member still has open tasks (enforced in the database). */
export async function removeProjectMember(memberId: string): Promise<void> {
  const db = database();
  const { error } = await db.from("project_members").delete().eq("id", memberId);
  if (error) throw new Error(error.message);
}

export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const db = database();
  const { data, error } = await db
    .from("tasks")
    .select(TASK_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TaskRow[]).map(mapTask);
}

export async function createProjectTask(input: CreateProjectTaskInput): Promise<void> {
  const db = database();
  const organizationId = await requireOrganizationId();
  const assignedBy = await requireEmployeeId();
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required.");
  const { error } = await db.from("tasks").insert({
    organization_id: organizationId,
    project_id: input.projectId,
    assigned_by: assignedBy,
    assigned_to: input.assignedTo,
    title,
    description: input.description?.trim() || null,
    priority: input.priority ?? "medium",
    due_date: input.dueDate || null,
    source_message_id: input.sourceMessageId ?? null,
  });
  if (error) throw new Error(error.message);
}

/** The checklist tick: done <-> todo. `tasks_guard_write` maintains completed_at. */
export async function setProjectTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const db = database();
  const { error } = await db.from("tasks").update({ status }).eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function deleteProjectTask(taskId: string): Promise<void> {
  const db = database();
  const { error } = await db.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
}

/**
 * Newest-first page. Pass the oldest loaded `createdAt` as `before` to page upward.
 * Returned in ascending order for display.
 */
export async function listProjectMessages(
  projectId: string,
  before?: string,
): Promise<ProjectMessage[]> {
  const db = database();
  let query = db
    .from("project_messages")
    .select(MESSAGE_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as MessageRow[]).map(mapMessage).reverse();
}

export async function getProjectMessage(messageId: string): Promise<ProjectMessage | null> {
  const db = database();
  const { data, error } = await db
    .from("project_messages")
    .select(MESSAGE_SELECT)
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapMessage(data as MessageRow) : null;
}

export async function postProjectMessage(
  projectId: string,
  bodyText: string,
  mentions: string[] = [],
): Promise<ProjectMessage> {
  const db = database();
  const text = bodyText.trim();
  if (!text) throw new Error("Message cannot be empty.");
  if (text.length > 5000) throw new Error("Message is too long (max 5000 characters).");
  const authorId = await requireEmployeeId();
  const { data, error } = await db
    .from("project_messages")
    .insert({ project_id: projectId, author_id: authorId, body_text: text, mentions })
    .select(MESSAGE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapMessage(data as MessageRow);
}

export async function deleteProjectMessage(messageId: string): Promise<void> {
  const db = database();
  const { error } = await db
    .from("project_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw new Error(error.message);
}

/**
 * Subscribe to new/updated messages. Returns an unsubscribe function.
 * `onStatus` fires with "error" so callers can fall back to polling.
 */
export function subscribeToProjectMessages(
  projectId: string,
  onChange: (messageId: string) => void,
  onStatus?: (status: "subscribed" | "error") => void,
): () => void {
  if (!supabase) return () => undefined;
  const client = supabase;
  const channel = client
    .channel(`project-messages:${projectId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "project_messages",
        filter: `project_id=eq.${projectId}`,
      },
      (payload) => {
        const id = (payload.new as { id?: string } | null)?.id;
        if (id) onChange(id);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("subscribed");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus?.("error");
    });
  return () => {
    void client.removeChannel(channel);
  };
}
