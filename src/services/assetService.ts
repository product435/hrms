import { assetEvents as fixtureEvents, assets as fixtureAssets } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Asset, AssetEvent } from "@/types";
import { fromFixture, matchesSearch, type QueryOptions } from "./api";
const mapAsset = (r: any): Asset => ({
  id: r.id,
  tag: r.tag,
  name: r.name,
  category: r.category,
  serial: r.serial ?? "",
  status: r.status,
  condition: r.condition,
  assignedTo: r.assigned?.full_name ??
    (r.assigned ? `${r.assigned.first_name ?? ""} ${r.assigned.last_name ?? ""}`.trim() : null),
  assignedOn: r.assigned_on,
  purchaseDate: r.purchase_date ?? "",
  value: Number(r.value),
  warrantyTill: r.warranty_till ?? "",
  location: r.location ?? "",
});
export const assetService = {
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
      .select("*")
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
  async assignedTo(employeeName: string): Promise<Asset[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureAssets.filter((a) => a.assignedTo === employeeName));
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id")
      .or(`email.eq.${employeeName},first_name.eq.${employeeName.split(" ")[0]}`)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee?.id) return [];
    const { data, error } = await supabase
      .from("asset_assignments")
      .select("asset_id")
      .eq("employee_id", employee.id);
    if (error) throw error;
    const assetIds = (data ?? []).map((row: any) => row.asset_id).filter(Boolean);
    if (!assetIds.length) return [];
    const assets = await supabase.from("assets").select("*").in("id", assetIds);
    if (assets.error) throw assets.error;
    return (assets.data ?? []).map(mapAsset);
  },
  async history(tag?: string): Promise<AssetEvent[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(tag ? fixtureEvents.filter((e) => e.assetTag === tag) : fixtureEvents);
    const query = supabase.from("asset_repairs").select("*");
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => ({
        id: r.id,
        assetTag: r.asset_id ?? "",
        type: "repair" as const,
        actor: "",
        date: r.reported_on ?? "",
        note: r.note ?? "",
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
      .eq("name", tag)
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
      .eq("name", tag)
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
      .eq("name", tag)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
