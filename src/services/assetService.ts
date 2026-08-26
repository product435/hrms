import { assetEvents as fixtureEvents, assets as fixtureAssets } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Asset, AssetEvent, AssetRequest } from "@/types";
import { currentUserId, fromFixture, matchesSearch, requireEmployeeId, requireOrganizationId, type QueryOptions } from "./api";
const mapAssetRequest = (r: any): AssetRequest => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  category: r.category,
  details: r.details ?? "",
  status: r.status,
  reviewedByName: r.reviewer?.full_name ?? "",
  reviewedAt: r.reviewed_at ?? null,
  rejectionReason: r.rejection_reason ?? null,
  requestedAt: r.requested_at,
});
const mapAsset = (r: any): Asset => {
  const activeAssignment = (r.asset_assignments ?? []).find((a: any) => !a.returned_at);
  return {
    id: r.id,
    tag: r.asset_code ?? "",
    name: r.name,
    category: r.category,
    serial: r.serial_number ?? "",
    status: r.status,
    condition: r.condition,
    assignedTo: activeAssignment?.employees
      ? `${activeAssignment.employees.first_name ?? ""} ${activeAssignment.employees.last_name ?? ""}`.trim()
      : null,
    assignedOn: activeAssignment?.assigned_at ?? null,
    purchaseDate: r.purchase_date ?? "",
    value: Number(r.purchase_cost ?? 0),
    warrantyTill: r.warranty_until ?? "",
    location: r.location ?? "",
  };
};
export const assetService = {
  async create(input: {
    code: string;
    name: string;
    category: string;
    condition: string;
    status: string;
    serialNumber?: string;
    location?: string;
    purchaseCost?: number;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("assets")
      .insert({
        organization_id: organizationId,
        asset_code: input.code.trim(),
        name: input.name.trim(),
        category: input.category,
        condition: input.condition,
        status: input.status,
        serial_number: input.serialNumber?.trim() || null,
        location: input.location?.trim() || null,
        purchase_cost: input.purchaseCost ?? 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  async list(options: QueryOptions & { category?: string } = {}): Promise<Asset[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureAssets.filter(
          (a) =>
            matchesSearch([a.name, a.tag, a.serial, a.assignedTo], options.search) &&
            (!options.status || options.status === "all" || a.status === options.status) &&
            (!options.category || options.category === "all" || a.category === options.category),
        ),
      );
    let query = supabase
      .from("assets")
      .select("*, asset_assignments(employee_id, assigned_at, returned_at, employees(first_name,last_name))")
      .order("name");
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    if (options.category && options.category !== "all")
      query = query.eq("category", options.category);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapAsset)
      .filter((a) => matchesSearch([a.name, a.tag, a.serial, a.assignedTo], options.search));
  },
  async assignedTo(employeeId: string): Promise<Asset[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureAssets);
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id")
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee?.id) return [];
    const { data, error } = await supabase
      .from("asset_assignments")
      .select("asset_id")
      .eq("employee_id", employee.id)
      .is("returned_at", null);
    if (error) throw error;
    const assetIds = (data ?? []).map((row: any) => row.asset_id).filter(Boolean);
    if (!assetIds.length) return [];
    const assets = await supabase
      .from("assets")
      .select("*, asset_assignments(employee_id, assigned_at, returned_at, employees(first_name,last_name))")
      .in("id", assetIds);
    if (assets.error) throw assets.error;
    return (assets.data ?? []).map(mapAsset);
  },
  async history(tag?: string, employeeId?: string): Promise<AssetEvent[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(tag ? fixtureEvents.filter((e) => e.assetTag === tag) : fixtureEvents);
    // Repairs and assignments/returns live in separate tables; a filter on
    // an embedded resource (e.g. `.eq("assets.asset_code", tag)`) only
    // trims the embed, it doesn't exclude the parent row, so both queries
    // are fetched unfiltered by tag and narrowed client-side instead.
    let assignmentsQuery = supabase
      .from("asset_assignments")
      .select("*, assets(asset_code), employees(first_name,last_name)");
    let repairsQuery = supabase.from("asset_repairs").select("*, assets(asset_code)");
    if (employeeId) {
      assignmentsQuery = assignmentsQuery.eq("employee_id", employeeId);
      const assignments = await supabase.from("asset_assignments").select("asset_id").eq("employee_id", employeeId);
      if (assignments.error) throw assignments.error;
      const ids = (assignments.data ?? []).map((row) => row.asset_id).filter(Boolean);
      if (!ids.length) return [];
      repairsQuery = repairsQuery.in("asset_id", ids as string[]);
    }
    const [assignments, repairs] = await Promise.all([assignmentsQuery, repairsQuery]);
    if (assignments.error) throw assignments.error;
    if (repairs.error) throw repairs.error;
    const assignmentEvents: AssetEvent[] = (assignments.data ?? []).flatMap((r: any) => {
      const holder = r.employees ? `${r.employees.first_name ?? ""} ${r.employees.last_name ?? ""}`.trim() : "";
      const events: AssetEvent[] = [
        {
          id: `${r.id}-assigned`,
          assetTag: r.assets?.asset_code ?? "",
          type: "assigned" as const,
          actor: "",
          date: r.assigned_at ?? "",
          note: holder ? `Assigned to ${holder}` : "Assigned",
        },
      ];
      if (r.returned_at) {
        events.push({
          id: `${r.id}-returned`,
          assetTag: r.assets?.asset_code ?? "",
          type: "returned" as const,
          actor: "",
          date: r.returned_at,
          note: holder ? `Returned by ${holder}` : "Returned",
        });
      }
      return events;
    });
    const repairEvents: AssetEvent[] = (repairs.data ?? []).map((r: any) => ({
      id: r.id,
      assetTag: r.assets?.asset_code ?? "",
      type: "repair" as const,
      actor: "",
      date: r.sent_at ?? "",
      note: r.remarks ?? r.issue ?? "",
    }));
    return [...assignmentEvents, ...repairEvents]
      .filter((e) => !tag || e.assetTag === tag)
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  },
  async assign(tag: string, employeeId: string) {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ tag, employeeId });
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id")
      .eq("asset_code", tag)
      .single();
    if (assetError) throw assetError;
    const { data, error } = await supabase
      .from("asset_assignments")
      .insert({ asset_id: asset.id, employee_id: employeeId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async markReturned(tag: string) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ tag, status: "available" as const });
    const { data, error } = await supabase
      .from("assets")
      .update({ status: "available" })
      .eq("asset_code", tag)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async sendForRepair(tag: string, note: string) {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture({ tag, note, status: "in-repair" as const });
    const { data, error } = await supabase
      .from("assets")
      .update({ status: "in-repair" })
      .eq("asset_code", tag)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  // Employee-initiated ask for a new asset. Deliberately not the same thing
  // as assign() above: this only records what was requested and its
  // approval decision -- assigning a specific physical unit afterwards is
  // still the existing admin/hr asset-management workflow.
  async requestAsset(input: { category: string; details: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const employeeId = await requireEmployeeId();
    const { data, error } = await supabase
      .from("asset_requests")
      .insert({
        employee_id: employeeId,
        category: input.category,
        details: input.details.trim() || null,
      })
      .select("*, employees(first_name,last_name)")
      .single();
    if (error) throw error;
    return mapAssetRequest(data);
  },
  async myAssetRequests(employeeId: string): Promise<AssetRequest[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("asset_requests")
      .select("*, employees(first_name,last_name), reviewer:reviewed_by(full_name)")
      .eq("employee_id", employeeId)
      .order("requested_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAssetRequest);
  },
  // Admin/HR-only (RLS-enforced): every request across the organization.
  async listAssetRequests(): Promise<AssetRequest[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("asset_requests")
      .select("*, employees(first_name,last_name), reviewer:reviewed_by(full_name)")
      .order("requested_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAssetRequest);
  },
  async decideAssetRequest(id: string, decision: "approved" | "rejected", rejectionReason?: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const reviewerId = await currentUserId();
    const { error } = await supabase
      .from("asset_requests")
      .update({
        status: decision,
        ...(reviewerId ? { reviewed_by: reviewerId } : {}),
        reviewed_at: new Date().toISOString(),
        ...(decision === "rejected" ? { rejection_reason: rejectionReason?.trim() || null } : {}),
      })
      .eq("id", id);
    if (error) throw error;
  },
};
