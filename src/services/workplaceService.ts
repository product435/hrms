/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import {
  announcements as fixtureAnnouncements,
  auditEntries as fixtureAudit,
  documents as fixtureDocuments,
  expenses as fixtureExpenses,
  notifications as fixtureNotifications,
  tickets as fixtureTickets,
} from "@/lib/mock-data";
import { ALL_ROLES } from "@/lib/roles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  Announcement,
  AnnouncementTargetScope,
  AuditEntry,
  DocumentItem,
  ExpenseClaim,
  HelpdeskTicket,
  NotificationItem,
  Role,
} from "@/types";
import {
  currentEmployeeId,
  currentUserId,
  fromFixture,
  logAudit,
  matchesSearch,
  requireEmployeeId,
  requireOrganizationId,
  type QueryOptions,
} from "./api";

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function assertAllowedDocument(file: File): string {
  const baseName = file.name.split(/[/\\]/).pop()?.trim() ?? "";
  const extension = baseName.includes(".") ? (baseName.split(".").pop()?.toLowerCase() ?? "") : "";
  const contentType = DOCUMENT_CONTENT_TYPES[extension];
  if (!baseName || !contentType) {
    throw new Error("Only PDF, PNG, JPEG, and WebP files can be uploaded.");
  }
  const reported = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  const normalized = reported === "image/jpg" ? "image/jpeg" : reported;
  if (normalized && normalized !== contentType) {
    throw new Error("Only PDF, PNG, JPEG, and WebP files can be uploaded.");
  }
  if (file.size <= 0) throw new Error("The file is empty.");
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error("Files must be 10 MB or smaller.");
  return contentType;
}

const mapDocument = (r: any): DocumentItem => ({
  id: r.id,
  name: r.title,
  category: r.category,
  owner: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "Company Wide",
  size: `${Math.round(Number(r.file_size ?? 0) / 1024)} KB`,
  uploadedOn: r.uploaded_at,
  expiresOn: r.expiry_date,
  // Storage object path (documents bucket), not a URL -- the bucket is
  // private, so View/Open exchanges this for a short-lived signed URL
  // on demand rather than storing/exposing a public link.
  ...(r.file_url ? { filePath: r.file_url as string } : {}),
});
const mapExpense = (r: any): ExpenseClaim => ({
  id: r.id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  category: r.category,
  amount: Number(r.amount),
  date: r.expense_date,
  status: r.status,
  note: r.description ?? "",
});
const mapTicket = (r: any): HelpdeskTicket => ({
  id: r.id,
  subject: r.subject,
  category: r.category,
  raisedBy: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  priority: r.priority,
  status: r.status,
  createdOn: r.created_at,
  assignee: r.assignee?.full_name ?? "Unassigned",
  assignedTo: r.assigned_to ?? null,
});
const ANNOUNCEMENT_ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  hr: "HR",
  dept_head: "Department head",
  team_lead: "Team lead",
  employee: "Employee",
};

export type AnnouncementDraft = {
  title: string;
  content: string;
  priority: string;
  targetScope: AnnouncementTargetScope;
  targetDepartmentId?: string | null;
  targetRole?: string | null;
  expiresAt?: string | null;
};

function isAnnouncementRole(value: string | null | undefined): value is Role {
  return Boolean(value && ALL_ROLES.includes(value as Role));
}

function announcementAudience(
  scope: AnnouncementTargetScope,
  departmentName: string | null,
  role: Role | null,
) {
  if (scope === "department")
    return departmentName ? `Department · ${departmentName}` : "Department";
  if (scope === "role" && role) return `Role · ${ANNOUNCEMENT_ROLE_LABELS[role]}`;
  return "Everyone";
}

function announcementClosed(isActive: boolean, expiresAt: string | null) {
  if (!isActive) return true;
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry <= Date.now();
}

function announcementWriteRow(input: AnnouncementDraft) {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("Title is required.");
  if (!content) throw new Error("Content is required.");
  const priority =
    input.priority === "urgent" ? "urgent" : input.priority === "normal" ? "normal" : null;
  if (!priority) throw new Error("Priority must be normal or urgent.");

  const targetScope = input.targetScope;
  let targetDepartmentId: string | null = null;
  let targetRole: Role | null = null;
  if (targetScope === "department") {
    targetDepartmentId = input.targetDepartmentId?.trim() || null;
    if (!targetDepartmentId) throw new Error("Choose a department.");
  } else if (targetScope === "role") {
    if (!isAnnouncementRole(input.targetRole)) throw new Error("Choose a role.");
    targetRole = input.targetRole;
  } else if (targetScope !== "organization") {
    throw new Error("Choose who should see this announcement.");
  }

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const expiry = new Date(input.expiresAt);
    if (Number.isNaN(expiry.getTime())) throw new Error("Expiry must be a valid date and time.");
    expiresAt = expiry.toISOString();
  }

  return {
    title,
    content,
    priority,
    target_scope: targetScope,
    target_department_id: targetDepartmentId,
    target_role: targetRole,
    expires_at: expiresAt,
  };
}

const mapAnnouncement = (
  r: any,
  readIds: Set<string>,
  departmentNames: Map<string, string>,
): Announcement => {
  const targetScope: AnnouncementTargetScope =
    r.target_scope === "department" || r.target_scope === "role" ? r.target_scope : "organization";
  const targetRole = isAnnouncementRole(r.target_role) ? r.target_role : null;
  const departmentName = r.target_department_id
    ? (departmentNames.get(r.target_department_id) ?? null)
    : null;
  const expiresAt = r.expires_at ?? null;
  const isActive = r.is_active !== false;
  const priority = r.priority === "urgent" ? "urgent" : "normal";
  return {
    id: r.id,
    title: r.title ?? "",
    body: r.content ?? "",
    audience: announcementAudience(targetScope, departmentName, targetRole),
    author: r.author?.full_name ?? "",
    publishedOn: r.published_at ?? "",
    pinned: priority === "urgent",
    priority,
    isActive,
    expired: Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now()),
    read: readIds.has(r.id),
    expiresAt,
    targetScope,
    targetDepartmentId: r.target_department_id ?? null,
    targetDepartmentName: departmentName,
    targetRole,
  };
};
export const workplaceService = {
  async documents(options: QueryOptions & { category?: string } = {}): Promise<DocumentItem[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureDocuments.filter(
          (d) =>
            matchesSearch([d.name, d.owner, d.category], options.search) &&
            (!options.category || options.category === "all" || d.category === options.category),
        ),
      );
    let query = supabase
      .from("documents")
      .select("*, employees(first_name,last_name)")
      .order("uploaded_at", { ascending: false });
    if (options.category && options.category !== "all")
      query = query.eq("category", options.category);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapDocument)
      .filter((d) => matchesSearch([d.name, d.owner, d.category], options.search));
  },
  async documentsOf(employeeId: string): Promise<DocumentItem[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureDocuments);
    const query = supabase
      .from("documents")
      .select("*, employees(first_name,last_name)")
      .eq("employee_id", employeeId)
      .order("uploaded_at", { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapDocument);
  },
  // The documents bucket is private -- View/Open exchanges the stored object
  // path for a short-lived signed URL on demand (subject to the same
  // storage.objects RLS as everything else here) rather than ever minting or
  // storing a public link.
  async getDocumentUrl(filePath: string): Promise<string> {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(filePath, 120);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Could not generate a link for this document.");
    return data.signedUrl;
  },
  async uploadDocument(file: File, employeeId: string, category = "Other") {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const contentType = assertAllowedDocument(file);
    const baseName = file.name.split(/[/\\]/).pop()?.trim() || "document";
    const path = `${employeeId}/${crypto.randomUUID()}-${baseName}`;
    const storage = supabase.storage.from("documents");
    const upload = await storage.upload(path, file, { upsert: false, contentType });
    if (upload.error) throw upload.error;
    try {
      const uploadedBy = await currentUserId();
      const { data, error } = await supabase
        .from("documents")
        .insert({
          employee_id: employeeId,
          title: baseName,
          category,
          file_size: file.size,
          file_type: contentType,
          file_url: path,
          uploaded_by: uploadedBy,
        })
        .select("id")
        .single();
      if (error) throw error;
      void logAudit("document_upload", "documents", data.id, null, { title: baseName, category });
      return data;
    } catch (error) {
      // Do not leave an orphaned object when the metadata insert is rejected.
      await storage.remove([path]);
      throw error;
    }
  },
  async expenses(options: QueryOptions = {}): Promise<ExpenseClaim[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureExpenses.filter(
          (e) =>
            matchesSearch([e.employeeName, e.category, e.note], options.search) &&
            (!options.status || options.status === "all" || e.status === options.status),
        ),
      );
    let query = supabase
      .from("expense_claims")
      .select("*, employees(first_name,last_name)")
      .order("expense_date", { ascending: false });
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapExpense)
      .filter((e) => matchesSearch([e.employeeName, e.category, e.note], options.search));
  },
  async createExpenseClaim(input: {
    category: string;
    amount: number;
    date: string;
    note?: string;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const employeeId = await requireEmployeeId();
    const { data, error } = await supabase
      .from("expense_claims")
      .insert({
        employee_id: employeeId,
        category: input.category,
        amount: input.amount,
        expense_date: input.date,
        description: input.note?.trim() || null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    void logAudit("expense_claim_create", "expense_claims", data.id, null, {
      category: input.category,
      amount: input.amount,
    });
    return data;
  },
  async decideExpenseClaim(
    id: string,
    decision: "approved" | "rejected",
    rejectionReason?: string,
  ) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const approverId = await currentUserId();
    const { error } = await supabase
      .from("expense_claims")
      .update({
        status: decision,
        ...(approverId ? { approved_by: approverId } : {}),
        approved_at: new Date().toISOString(),
        ...(decision === "rejected" ? { rejection_reason: rejectionReason?.trim() || null } : {}),
      })
      .eq("id", id);
    if (error) throw error;
    void logAudit("expense_claim_decide", "expense_claims", id, null, { status: decision });
  },
  // Reimbursement is the one status the existing UI already promises (the
  // page copy says "review, approve and reimburse", and the status filter
  // already lists "Reimbursed") but had no action to actually reach --
  // status is free text with no separate paid/payment-date column, so this
  // is just the same shape as decideExpenseClaim for the one missing value.
  async markExpenseReimbursed(id: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("expense_claims")
      .update({ status: "reimbursed" })
      .eq("id", id);
    if (error) throw error;
  },
  async createTicket(input: {
    subject: string;
    category: string;
    priority: string;
    description?: string;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const employeeId = await requireEmployeeId();
    const { data, error } = await supabase
      .from("helpdesk_tickets")
      .insert({
        employee_id: employeeId,
        subject: input.subject.trim(),
        category: input.category,
        priority: input.priority,
        description: input.description?.trim() || null,
        status: "open",
      })
      .select("id")
      .single();
    if (error) throw error;
    void logAudit("helpdesk_ticket_create", "helpdesk_tickets", data.id, null, {
      subject: input.subject,
      category: input.category,
    });
    return data;
  },
  async updateTicketStatus(id: string, status: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("helpdesk_tickets")
      .update({
        status,
        ...(status === "resolved" || status === "closed"
          ? { resolved_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", id);
    if (error) throw error;
    void logAudit("helpdesk_ticket_status_update", "helpdesk_tickets", id, null, { status });
  },
  async updateTicketAssignee(id: string, assignedTo: string | null) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("helpdesk_tickets")
      .update({ assigned_to: assignedTo })
      .eq("id", id);
    if (error) throw error;
  },
  // Assignee options for helpdesk tickets: assigned_to references profiles,
  // not employees, so this reads profiles directly (role-filtered to
  // admin/hr) rather than reusing employeeService, whose ids don't match.
  async supportStaff(): Promise<{ id: string; name: string }[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["admin", "hr"])
      .order("full_name");
    if (error) throw error;
    return (data ?? []).map((p) => ({ id: p.id, name: (p.full_name ?? "").trim() || "Unnamed" }));
  },
  async announcementDepartments(): Promise<{ id: string; name: string }[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase.from("departments").select("id, name").order("name");
    if (error) throw error;
    return (data ?? [])
      .filter((row) => row.id && row.name)
      .map((row) => ({ id: row.id, name: row.name ?? "Department" }));
  },
  async createAnnouncement(input: AnnouncementDraft) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const publishedBy = await currentUserId();
    const row = announcementWriteRow(input);
    const { data, error } = await supabase
      .from("announcements")
      .insert({
        organization_id: organizationId,
        ...row,
        ...(publishedBy ? { published_by: publishedBy } : {}),
        published_at: new Date().toISOString(),
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    void logAudit("announcement_create", "announcements", data.id, null, {
      target_scope: row.target_scope,
      priority: row.priority,
    });
    return data;
  },
  async updateAnnouncement(id: string, input: AnnouncementDraft) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const row = announcementWriteRow(input);
    const { data, error } = await supabase
      .from("announcements")
      .update(row)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("You cannot change this announcement.");
    void logAudit("announcement_update", "announcements", id, null, {
      target_scope: row.target_scope,
      priority: row.priority,
    });
  },
  async setAnnouncementActive(id: string, isActive: boolean) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase
      .from("announcements")
      .update({ is_active: isActive })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error(
        isActive
          ? "You cannot publish this announcement."
          : "You cannot unpublish this announcement.",
      );
    void logAudit(
      isActive ? "announcement_publish" : "announcement_unpublish",
      "announcements",
      id,
      null,
      {
        is_active: isActive,
      },
    );
  },
  async deleteAnnouncement(id: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("You cannot delete this announcement.");
    void logAudit("announcement_delete", "announcements", id);
  },
  async markAnnouncementRead(id: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const userId = await currentUserId();
    const employeeId = await currentEmployeeId();
    if (!userId && !employeeId) throw new Error("Sign in again to mark this announcement as read.");
    const { error } = await supabase.from("announcement_reads").insert({
      announcement_id: id,
      ...(userId ? { user_id: userId } : {}),
      ...(employeeId ? { employee_id: employeeId } : {}),
      read_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") throw error;
  },
  async tickets(options: QueryOptions = {}): Promise<HelpdeskTicket[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureTickets.filter(
          (t) =>
            matchesSearch([t.subject, t.raisedBy, t.category], options.search) &&
            (!options.status || options.status === "all" || t.status === options.status),
        ),
      );
    let query = supabase
      .from("helpdesk_tickets")
      .select("*, employees(first_name,last_name), assignee:assigned_to(full_name)")
      .order("created_at", { ascending: false });
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapTicket)
      .filter((t) => matchesSearch([t.subject, t.raisedBy, t.category], options.search));
  },
  async announcements(options: { includeClosed?: boolean } = {}): Promise<Announcement[]> {
    if (!isSupabaseConfigured || !supabase) {
      return fromFixture(
        fixtureAnnouncements.filter(
          (item) => options.includeClosed || (item.isActive && !item.expired),
        ),
      );
    }
    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id, title, content, priority, published_at, is_active, expires_at, target_scope, target_department_id, target_role, author:published_by(full_name)",
      )
      .order("published_at", { ascending: false });
    if (error) throw error;
    const rows = data ?? [];
    const ids = rows.map((row) => row.id);
    const departmentIds = [
      ...new Set(
        rows.map((row) => row.target_department_id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const readIds = new Set<string>();
    if (ids.length) {
      const reads = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .in("announcement_id", ids);
      if (reads.error) throw reads.error;
      for (const row of reads.data ?? []) readIds.add(row.announcement_id);
    }
    const departmentNames = new Map<string, string>();
    if (departmentIds.length) {
      const departments = await supabase
        .from("departments")
        .select("id, name")
        .in("id", departmentIds);
      if (departments.error) throw departments.error;
      for (const row of departments.data ?? []) {
        if (row.id) departmentNames.set(row.id, row.name ?? "Department");
      }
    }
    return rows
      .map((row) => mapAnnouncement(row, readIds, departmentNames))
      .filter((item) => options.includeClosed || !announcementClosed(item.isActive, item.expiresAt))
      .sort((a, b) => {
        const rank = (item: Announcement) =>
          item.isActive && !item.expired ? 0 : item.expired ? 1 : 2;
        const byState = rank(a) - rank(b);
        if (byState !== 0) return byState;
        return (b.publishedOn || "").localeCompare(a.publishedOn || "");
      });
  },
  async notifications(): Promise<NotificationItem[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureNotifications);
    const userId = await currentUserId();
    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? "",
      description: r.message ?? "",
      type: (r.type ?? "system") as NotificationItem["type"],
      createdAt: r.created_at ?? "",
      read: r.is_read ?? false,
      ...(r.reference_id ? { referenceId: r.reference_id } : {}),
      ...(r.reference_type ? { referenceType: r.reference_type } : {}),
    }));
  },
  // notifications_self_all (user_id = auth.uid()) already permits an
  // authenticated user to update their own rows -- no schema change needed.
  async markRead(id: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    if (error) throw error;
  },
  async markAllRead(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const userId = await currentUserId();
    if (!userId) return;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) throw error;
  },
  async markNotificationRead(id: string): Promise<void> {
    return this.markRead(id);
  },
  async markAllNotificationsRead(): Promise<void> {
    return this.markAllRead();
  },
  async auditTrail(options: QueryOptions = {}): Promise<AuditEntry[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureAudit.filter((a) => matchesSearch([a.actor, a.action, a.entity], options.search)),
      );
    // audit_logs has no severity column in this schema -- there is no real
    // severity dimension to filter or display, so none is fabricated here.
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*, actor:user_id(full_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .map((r) => ({
        id: r.id,
        actor: r.actor?.full_name ?? "System",
        action: r.action ?? "",
        entity: r.entity_type ?? "",
        ip: typeof r.ip_address === "string" ? r.ip_address : "",
        timestamp: r.created_at ?? "",
      }))
      .filter((a) => matchesSearch([a.actor, a.action, a.entity], options.search));
  },
};
