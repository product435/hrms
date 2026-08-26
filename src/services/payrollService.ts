import { payrollRuns as fixtureRuns, payslips as fixturePayslips } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { PayrollRun, Payslip } from "@/types";
import { currentUserId, fromFixture, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";
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
    // If this period was already processed, re-clicking Start must not
    // silently revert its status back to draft or reset its (already paid)
    // records back to pending -- return the existing run untouched instead.
    const existing = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("year", input.year)
      .eq("month", input.month)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.status === "processed" || existing.data?.status === "approved") return existing.data;

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
  // Locks a draft run's numbers and hands it off for approval. Deliberately
  // does not touch payroll_records or payslips -- that only happens on
  // approveRun(), so a processed-but-not-yet-approved run never shows as
  // paid. Guarded so it can only fire from "draft", once.
  async processRun(runId: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data: run, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (fetchError) throw fetchError;
    if (run.status !== "draft") {
      throw new Error(`This run is already "${run.status}" and cannot be processed again.`);
    }
    const { data: records, error: recordsError } = await supabase
      .from("payroll_records")
      .select("id")
      .eq("payroll_run_id", runId);
    if (recordsError) throw recordsError;
    if (!records?.length) throw new Error("This payroll run has no records to process.");

    const processedBy = await currentUserId();
    const { error: runError } = await supabase
      .from("payroll_runs")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
        ...(processedBy ? { processed_by: processedBy } : {}),
      })
      .eq("id", runId);
    if (runError) throw runError;
  },
  // Final sign-off: marks every record in the run paid and generates one
  // payslip per record (skipping any that already have one, so re-approving
  // after a partial failure never duplicates). Only fires from "processed".
  //
  // No real PDF-generation capability exists anywhere in this project, and
  // building one would be exactly the "large PDF-generation system" this was
  // told not to invent. Instead each payslip is a small, real, private text
  // file -- genuine stored content built from this record's actual figures,
  // not a fake URL -- uploaded to the same private `documents` bucket
  // Documents already uses, under the same <employeeId>/... path convention.
  // That reuses the bucket's existing self/admin-hr/manager RLS policies
  // as-is: no new bucket, no new storage policy, no new table.
  async approveRun(runId: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data: run, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("status, year, month")
      .eq("id", runId)
      .single();
    if (fetchError) throw fetchError;
    if (run.status !== "processed") {
      throw new Error(
        run.status === "approved" ? "This run has already been approved." : "This run must be processed before it can be approved.",
      );
    }

    const { data: records, error: recordsError } = await supabase
      .from("payroll_records")
      .select("id, employee_id, basic, hra, allowances, bonus, pf, tax, total_deductions, net_salary, employees(first_name,last_name)")
      .eq("payroll_run_id", runId);
    if (recordsError) throw recordsError;
    if (!records?.length) throw new Error("This payroll run has no records to approve.");

    const now = new Date().toISOString();
    const { error: updateRecordsError } = await supabase
      .from("payroll_records")
      .update({ payment_status: "paid", paid_at: now })
      .eq("payroll_run_id", runId);
    if (updateRecordsError) throw updateRecordsError;

    const recordIds = records.map((r) => r.id);
    const { data: existingPayslips, error: existingError } = await supabase
      .from("payslips")
      .select("payroll_record_id")
      .in("payroll_record_id", recordIds);
    if (existingError) throw existingError;
    const existingIds = new Set((existingPayslips ?? []).map((p) => p.payroll_record_id));
    const missing = records.filter((r) => !existingIds.has(r.id));

    const period = periodOf(run.year, run.month);
    for (const r of missing) {
      const name = r.employees ? `${r.employees.first_name ?? ""} ${r.employees.last_name ?? ""}`.trim() : "Employee";
      const totalDeductions = Number(r.total_deductions ?? 0);
      const text = [
        `Payslip - ${period}`,
        `Employee: ${name}`,
        "",
        `Basic: ${r.basic ?? 0}`,
        `HRA: ${r.hra ?? 0}`,
        `Allowances: ${r.allowances ?? 0}`,
        `Bonus: ${r.bonus ?? 0}`,
        `PF: ${r.pf ?? 0}`,
        `Tax: ${r.tax ?? 0}`,
        `Total deductions: ${totalDeductions}`,
        `Net pay: ${r.net_salary ?? 0}`,
      ].join("\n");
      const path = `${r.employee_id}/payslip-${period}.txt`;
      const upload = await supabase.storage
        .from("documents")
        .upload(path, new Blob([text], { type: "text/plain" }), { upsert: true });
      if (upload.error) throw upload.error;
      const { error: insertError } = await supabase
        .from("payslips")
        .insert({ payroll_record_id: r.id, payslip_url: path, generated_at: now });
      if (insertError) throw insertError;
    }

    const { error: approveError } = await supabase
      .from("payroll_runs")
      .update({ status: "approved" })
      .eq("id", runId);
    if (approveError) throw approveError;
  },
  // Sends a processed-but-not-yet-approved run back to draft for correction
  // (e.g. a salary structure needs fixing before payout) -- there is no
  // separate "rejected" terminal state added, since nothing in the existing
  // UI could act on one; "draft" is immediately re-processable with the
  // existing Start/Process actions. Cannot reject an already-approved run.
  async rejectRun(runId: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data: run, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (fetchError) throw fetchError;
    if (run.status !== "processed") {
      throw new Error(run.status === "approved" ? "An approved run cannot be rejected." : "Only a processed run can be rejected.");
    }
    const { error } = await supabase
      .from("payroll_runs")
      .update({ status: "draft", processed_at: null, processed_by: null })
      .eq("id", runId);
    if (error) throw error;
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
    const stored = data?.payslip_url ?? null;
    if (!stored) return { id, url: null };
    // Older/seed rows may hold a plain external URL (never a real private
    // file) -- opened as-is, unchanged from before. New rows hold a private
    // documents-bucket object path, exchanged for a short-lived signed URL
    // exactly like Documents' own View/Open does.
    if (/^https?:\/\//i.test(stored)) return { id, url: stored };
    const signed = await supabase.storage.from("documents").createSignedUrl(stored, 120);
    if (signed.error) throw signed.error;
    return { id, url: signed.data?.signedUrl ?? null };
  },
};
