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
// payroll_records.basic/hra/allowances/bonus are a snapshot written by
// startRun() from the employee's salary_structures row that was in effect
// for that run's period -- not a live join -- so a later change to the
// employee's current salary structure never rewrites a past payslip.
const mapPayslip = (r: any): Payslip => {
  const totalDeductions = Number(r.total_deductions ?? 0);
  const pf = Number(r.pf ?? 0);
  const tax = Number(r.tax ?? 0);
  return {
    id: r.payslips?.[0]?.id ?? r.id,
    employeeId: r.employee_id,
    employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
    period: periodOf(r.payroll_runs?.year, r.payroll_runs?.month),
    basic: Number(r.basic ?? 0),
    hra: Number(r.hra ?? 0),
    allowances: Number(r.allowances ?? 0),
    bonus: Number(r.bonus ?? 0),
    pf,
    tax,
    otherDeductions: Math.max(totalDeductions - pf - tax, 0),
    net: Number(r.net_salary ?? 0),
    status: r.payment_status === "paid" ? "paid" : "pending",
  };
};
export const payrollService = {
  // Creates (or re-opens) the run, then generates one payroll_records row per
  // active employee, snapshotting the salary_structures row that was in
  // effect on or before the run's period -- not just whatever the employee's
  // structure happens to be right now. Re-running for the same year/month
  // upserts records in place rather than duplicating them.
  async startRun(input: { year: number; month: number }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data: run, error: runError } = await supabase
      .from("payroll_runs")
      .upsert(
        { organization_id: organizationId, year: input.year, month: input.month, status: "draft" },
        { onConflict: "organization_id,year,month", ignoreDuplicates: false },
      )
      .select("*")
      .single();
    if (runError) throw runError;

    const periodEnd = new Date(input.year, input.month, 0).toISOString().slice(0, 10);
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("employment_status", "active");
    if (employeesError) throw employeesError;
    const employeeIds = (employees ?? []).map((e) => e.id);
    if (!employeeIds.length) return run;

    const { data: structures, error: structuresError } = await supabase
      .from("salary_structures")
      .select("employee_id,basic,hra,allowances,bonus,gross_salary,deductions,effective_from")
      .in("employee_id", employeeIds)
      .lte("effective_from", periodEnd)
      .order("effective_from", { ascending: false });
    if (structuresError) throw structuresError;

    const latestByEmployee = new Map<string, (typeof structures)[number]>();
    (structures ?? []).forEach((s) => {
      if (!s.employee_id || latestByEmployee.has(s.employee_id)) return;
      latestByEmployee.set(s.employee_id, s);
    });

    const records = employeeIds.flatMap((employeeId) => {
      const structure = latestByEmployee.get(employeeId);
      if (!structure) return [];
      const gross = Number(structure.gross_salary ?? 0);
      const deductions = Number(structure.deductions ?? 0);
      return [
        {
          employee_id: employeeId,
          payroll_run_id: run.id,
          basic: structure.basic ?? 0,
          hra: structure.hra ?? 0,
          allowances: structure.allowances ?? 0,
          bonus: structure.bonus ?? 0,
          gross_salary: gross,
          pf: 0,
          tax: 0,
          total_deductions: deductions,
          net_salary: gross - deductions,
          payment_status: "pending",
        },
      ];
    });

    if (records.length) {
      const { error: recordsError } = await supabase
        .from("payroll_records")
        .upsert(records, { onConflict: "employee_id,payroll_run_id" });
      if (recordsError) throw recordsError;
    }
    return run;
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
      .select("*, employees(first_name,last_name), payroll_runs(year,month), payslips(id)")
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
      .or(`id.eq.${id},payroll_record_id.eq.${id}`)
      .maybeSingle();
    if (error) throw error;
    return { id, url: data?.payslip_url ?? null };
  },
};
