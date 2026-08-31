import {
  announcements as fixtureAnnouncements,
  auditEntries as fixtureAudit,
  documents as fixtureDocuments,
  expenses as fixtureExpenses,
  notifications as fixtureNotifications,
  tickets as fixtureTickets,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  Announcement,
  AuditEntry,
  DocumentItem,
  ExpenseClaim,
  HelpdeskTicket,
  NotificationItem,
} from "@/types";
import { currentUserId, fromFixture, logAudit, matchesSearch, requireEmployeeId, requireOrganizationId, type QueryOptions } from "./api";
const mapDocument = (r: any): DocumentItem => ({
  id: r.id,
  name: r.title,
  category: r.category,
  owner: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "Company Wide",
  size: `${Math.round(Number(r.file_size ?? 0) / 1024)} KB`,
  uploadedOn: r.uploaded_at,
  expiresOn: r.expiry_date,
  // No verification/review flag exists on the documents table.
  verified: false,
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
const mapAnnouncement = (r: any): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.content,
  // No audience-targeting column exists; announcements are organization-wide.
  audience: "All",
  author: r.author?.full_name ?? "",
  publishedOn: r.published_at,
  // No pin flag; "urgent" priority surfaces the same way pinned did.
  pinned: r.priority === "urgent",
});
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
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureDocuments,
      );
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
    const path = `${employeeId}/${crypto.randomUUID()}-${file.name}`;
    const storage = supabase.storage.from("documents");
    const upload = await storage.upload(path, file, { upsert: false });
    if (upload.error) throw upload.error;
    try {
      const uploadedBy = await currentUserId();
      const { data, error } = await supabase.from("documents").insert({
        employee_id: employeeId,
        title: file.name,
        category,
        file_size: file.size,
        file_type: file.type || null,
        file_url: path,
        uploaded_by: uploadedBy,
      }).select("id").single();
      if (error) throw error;
      void logAudit("document_upload", "documents", data.id, null, { title: file.name, category });
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
  async createExpenseClaim(input: { category: string; amount: number; date: string; note?: string }) {
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
    void logAudit("expense_claim_create", "expense_claims", data.id, null, { category: input.category, amount: input.amount });
    return data;
  },
  async decideExpenseClaim(id: string, decision: "approved" | "rejected", rejectionReason?: string) {
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
    const { error } = await supabase.from("expense_claims").update({ status: "reimbursed" }).eq("id", id);
    if (error) throw error;
  },
  async createTicket(input: { subject: string; category: string; priority: string; description?: string }) {
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
    void logAudit("helpdesk_ticket_create", "helpdesk_tickets", data.id, null, { subject: input.subject, category: input.category });
    return data;
  },
  async updateTicketStatus(id: string, status: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("helpdesk_tickets")
      .update({ status, ...(status === "resolved" || status === "closed" ? { resolved_at: new Date().toISOString() } : {}) })
      .eq("id", id);
    if (error) throw error;
    void logAudit("helpdesk_ticket_status_update", "helpdesk_tickets", id, null, { status });
  },
  async updateTicketAssignee(id: string, assignedTo: string | null) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.from("helpdesk_tickets").update({ assigned_to: assignedTo }).eq("id", id);
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
  async createAnnouncement(input: { title: string; content: string; priority: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const publishedBy = await currentUserId();
    const { data, error } = await supabase
      .from("announcements")
      .insert({
        organization_id: organizationId,
        title: input.title.trim(),
        content: input.content.trim(),
        priority: input.priority,
        ...(publishedBy ? { published_by: publishedBy } : {}),
        published_at: new Date().toISOString(),
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
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
  async announcements(): Promise<Announcement[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureAnnouncements);
    const { data, error } = await supabase
      .from("announcements")
      .select("*, author:published_by(full_name)")
      .order("published_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAnnouncement);
  },
  async notifications(): Promise<NotificationItem[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureNotifications);
    const userId = await currentUserId();
    let query = supabase.from("notifications").select("*").order("created_at", { ascending: false });
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
  // authenticated user to update their own rows -- no schema change needed
  // for either of these, only the read path was missing a write UI before.
  async markNotificationRead(id: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    if (error) throw error;
  },
  async markAllNotificationsRead(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const userId = await currentUserId();
    if (!userId) return;
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
    if (error) throw error;
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
