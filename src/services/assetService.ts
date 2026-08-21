import { assetEvents as fixtureEvents, assets as fixtureAssets } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Asset, AssetEvent } from "@/types";
import { fromFixture, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";
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
    let query = supabase.from("asset_repairs").select("*, assets(asset_code)");
    if (tag) query = query.eq("assets.asset_code", tag);
    if (employeeId) {
      const assignments = await supabase.from("asset_assignments").select("asset_id").eq("employee_id", employeeId);
      if (assignments.error) throw assignments.error;
      const ids = (assignments.data ?? []).map((row) => row.asset_id).filter(Boolean);
      if (!ids.length) return [];
      query = query.in("asset_id", ids as string[]);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => ({
        id: r.id,
        assetTag: r.assets?.asset_code ?? "",
        type: "repair" as const,
        actor: "",
        date: r.sent_at ?? "",
        note: r.remarks ?? r.issue ?? "",
      }))
      .filter((e) => !tag || e.assetTag === tag);
  },
  async assign(tag: string, employeeName: string) {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ tag, employeeName });
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id")
      .or(`email.eq.${employeeName},first_name.eq.${employeeName.split(" ")[0]}`)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee?.id) throw new Error("The selected employee could not be found.");
    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("id")
      .eq("asset_code", tag)
      .single();
    if (assetError) throw assetError;
    const { data, error } = await supabase
      .from("asset_assignments")
      .insert({ asset_id: asset.id, employee_id: employee.id })
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
};
