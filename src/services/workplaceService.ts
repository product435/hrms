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
import { currentUserId, fromFixture, matchesSearch, type QueryOptions } from "./api";
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
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapExpense)
      .filter((e) => matchesSearch([e.employeeName, e.category, e.note], options.search));
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
  async auditTrail(options: QueryOptions = {}): Promise<AuditEntry[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureAudit.filter(
          (a) =>
            matchesSearch([a.actor, a.action, a.entity], options.search) &&
            (!options.status || options.status === "all" || a.severity === options.status),
        ),
      );
    // audit_logs has no severity column in this schema, so severity filtering
    // is a no-op here (kept as "info" for every row) rather than querying a
    // column that doesn't exist.
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
        severity: "info" as const,
      }))
      .filter(
        (a) =>
          matchesSearch([a.actor, a.action, a.entity], options.search) &&
          (!options.status || options.status === "all" || a.severity === options.status),
      );
  },
};
