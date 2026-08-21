import { payrollRuns as fixtureRuns, payslips as fixturePayslips } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { PayrollRun, Payslip } from "@/types";
import { fromFixture, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";
const periodOf = (year: unknown, month: unknown) =>
  year && month ? `${year}-${String(month).padStart(2, "0")}` : "";

const mapRun = (r: any): PayrollRun => {
  const records = r.payroll_records ?? [];
  return {
    id: r.id,
    period: periodOf(r.year, r.month),
    employees: records.length,
    gross: records.reduce((s: number, rec: any) => s + Number(rec.gross_salary ?? 0), 0),
    deductions: records.reduce((s: number, rec: any) => s + Number(rec.total_deductions ?? 0), 0),
    net: records.reduce((s: number, rec: any) => s + Number(rec.net_salary ?? 0), 0),
    status: r.status,
    payDate: r.processed_at ?? "",
  };
};
// `payroll_records` carries the numbers per employee per run; `payslips` only
// links a record to a generated PDF. `basic`/`hra`/`allowances`/`bonus` aren't
// tracked per run in this schema (only the current `salary_structures` row),
// so they read from there as a best-effort snapshot rather than the figures
// actually used for that specific run.
const mapPayslip = (r: any): Payslip => {
  const structure = r.employees?.salary_structures?.[0];
  const totalDeductions = Number(r.total_deductions ?? 0);
  const pf = Number(r.pf ?? 0);
  const tax = Number(r.tax ?? 0);
  return {
    id: r.payslips?.[0]?.id ?? r.id,
    employeeId: r.employee_id,
    employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
    period: periodOf(r.payroll_runs?.year, r.payroll_runs?.month),
    basic: Number(structure?.basic ?? 0),
    hra: Number(structure?.hra ?? 0),
    allowances: Number(structure?.allowances ?? 0),
    bonus: Number(structure?.bonus ?? 0),
    pf,
    tax,
    otherDeductions: Math.max(totalDeductions - pf - tax, 0),
    net: Number(r.net_salary ?? 0),
    status: r.payment_status === "paid" ? "paid" : "pending",
  };
};
export const payrollService = {
  async startRun(input: { year: number; month: number }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("payroll_runs")
      .upsert(
        { organization_id: organizationId, year: input.year, month: input.month, status: "draft" },
        { onConflict: "organization_id,year,month", ignoreDuplicates: false },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
  async runs(): Promise<PayrollRun[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureRuns);
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("*, payroll_records(gross_salary,net_salary,total_deductions)")
      .order("year", { ascending: false })
      .order("month", { ascending: false });
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
      .from("payroll_records")
      .select(
        "*, employees(first_name,last_name, salary_structures(basic,hra,allowances,bonus)), payroll_runs(year,month), payslips(id)",
      )
      .order("payroll_run_id", { ascending: false });
    if (options.employeeId) query = query.eq("employee_id", options.employeeId);
    if (options.status && options.status !== "all") query = query.eq("payment_status", options.status);
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
      .eq("payroll_record_id", id)
      .maybeSingle();
    if (error) throw error;
    return { id, url: data?.payslip_url ?? null };
  },
};
