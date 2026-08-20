import { payrollRuns as fixtureRuns, payslips as fixturePayslips } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { PayrollRun, Payslip } from "@/types";
import { fromFixture, matchesSearch, type QueryOptions } from "./api";
const mapRun = (r: any): PayrollRun => ({
  id: r.id,
  period: r.period,
  employees: r.employee_count,
  gross: Number(r.gross),
  deductions: Number(r.deductions),
  net: Number(r.net),
  status: r.status,
  payDate: r.pay_date ?? "",
});
const mapPayslip = (r: any): Payslip => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  period: r.period,
  basic: Number(r.basic),
  hra: Number(r.hra),
  allowances: Number(r.allowances),
  bonus: Number(r.bonus),
  pf: Number(r.pf),
  tax: Number(r.tax),
  otherDeductions: Number(r.other_deductions),
  net: Number(r.net),
  status: r.status,
});
export const payrollService = {
  async runs(): Promise<PayrollRun[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureRuns);
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("*")
      .order("period", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRun);
  },
  async payslips(options: QueryOptions = {}): Promise<Payslip[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixturePayslips.filter(
          (p) =>
            matchesSearch([p.employeeName, p.period], options.search) &&
            (!options.employeeId || p.employeeId === options.employeeId) &&
            (!options.status || options.status === "all" || p.status === options.status),
        ),
      );
    let query = supabase
      .from("payslips")
      .select("*, employees(first_name,last_name)")
      .order("period", { ascending: false });
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapPayslip)
      .filter((p) => matchesSearch([p.employeeName, p.period], options.search));
  },
  async downloadPayslip(id: string) {
    if (!isSupabaseConfigured || !supabase) return fromFixture({ id, url: null });
    const { data, error } = await supabase
      .from("payslips")
      .select("payslip_url")
      .eq("id", id)
      .single();
    if (error) throw error;
    return { id, url: data.payslip_url };
  },
};
