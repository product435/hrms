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
  name: r.name,
  category: r.category,
  owner: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "Company Wide",
  size: `${Math.round(Number(r.size_bytes ?? 0) / 1024)} KB`,
  uploadedOn: r.uploaded_on,
  expiresOn: r.expires_on,
  verified: r.verified,
});
const mapExpense = (r: any): ExpenseClaim => ({
  id: r.id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  category: r.category,
  amount: Number(r.amount),
  date: r.expense_date,
  status: r.status,
  note: r.note ?? "",
});
const mapTicket = (r: any): HelpdeskTicket => ({
  id: r.id,
  subject: r.subject,
  category: r.category,
  raisedBy: r.raised_by_profile?.full_name ?? "",
  priority: r.priority,
  status: r.status,
  createdOn: r.created_at,
  assignee: r.assignee?.full_name ?? "Unassigned",
});
const mapAnnouncement = (r: any): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  audience: r.audience,
  author: r.author?.full_name ?? "",
  publishedOn: r.published_on,
  pinned: r.pinned,
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
      .order("uploaded_on", { ascending: false });
    if (options.category && options.category !== "all")
      query = query.eq("category", options.category);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapDocument)
      .filter((d) => matchesSearch([d.name, d.owner, d.category], options.search));
  },
  async documentsOf(owner: string): Promise<DocumentItem[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureDocuments.filter((d) => d.owner === owner || d.owner === "Company Wide"),
      );
    const { data, error } = await supabase
      .from("documents")
      .select("*, employees(first_name,last_name)")
      .or(`employee_id.is.null,employees.first_name.eq.${owner.split(" ")[0]}`);
    if (error) throw error;
    return (data ?? []).map(mapDocument);
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
      .from("expenses")
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
      .from("helpdesk_requests")
      .select("*, raised_by_profile:raised_by(full_name), assignee:assignee_id(full_name)")
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
      .select("*, author:author_id(full_name)")
      .order("pinned", { ascending: false })
      .order("published_on", { ascending: false });
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
    return (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      type: r.type,
      createdAt: r.created_at,
      read: r.read,
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
    let query = supabase
      .from("audit_logs")
      .select("*, actor:actor_id(full_name)")
      .order("created_at", { ascending: false });
    if (options.status && options.status !== "all") query = query.eq("severity", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => ({
        id: r.id,
        actor: r.actor?.full_name ?? "System",
        action: r.action,
        entity: r.entity,
        ip: r.ip ?? "",
        timestamp: r.created_at,
        severity: r.severity,
      }))
      .filter((a) => matchesSearch([a.actor, a.action, a.entity], options.search));
  },
};
