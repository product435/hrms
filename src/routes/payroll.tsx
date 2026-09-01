import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeIndianRupee, Download, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { payrollService } from "@/services/payrollService";
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { compactInr, inr, shortDate } from "@/lib/format";
import type { Payslip } from "@/types";

export const Route = createFileRoute("/payroll")({
  beforeLoad: () => requireAuthForPath("/payroll"),
  head: () => ({
    meta: [
      { title: "Payroll & payslips · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Monthly payroll runs with gross, deductions and net payouts, plus downloadable payslip breakdowns.",
      },
      { property: "og:title", content: "Payroll · JeeVijay HRMS" },
      {
        property: "og:description",
        content: "Run payroll, review deductions and share payslips with employees.",
      },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  const queryClient = useQueryClient();
  const startRun = useMutation({ mutationFn: () => { const now = new Date(); return payrollService.startRun({ year: now.getFullYear(), month: now.getMonth() + 1 }); }, onSuccess: () => { toast.success("Payroll run created"); void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] }); void queryClient.invalidateQueries({ queryKey: ["payslips"] }); }, onError: (e) => toast.error("Could not start payroll run", { description: e instanceof Error ? e.message : "Supabase request failed." }) });
  const processRun = useMutation({
    mutationFn: (runId: string) => payrollService.processRun(runId),
    onSuccess: () => {
      toast.success("Payroll run processed", { description: "Ready for approval." });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (e) => toast.error("Could not process payroll run", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const approveRun = useMutation({
    mutationFn: (runId: string) => payrollService.approveRun(runId),
    onSuccess: () => {
      toast.success("Payroll run approved", { description: "Payslips generated for all employees in this run." });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["payslips"] });
    },
    onError: (e) => toast.error("Could not approve payroll run", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const rejectRun = useMutation({
    mutationFn: (runId: string) => payrollService.rejectRun(runId),
    onSuccess: () => {
      toast.success("Payroll run rejected", { description: "Sent back to draft for correction." });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (e) => toast.error("Could not reject payroll run", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const runs = useQuery({ queryKey: ["payroll-runs"], queryFn: () => payrollService.runs(), enabled: !isSelfService });
  const payslips = useQuery({
    queryKey: ["payslips", isSelfService ? (user.employeeId ?? user.id) : "all", search, status],
    queryFn: () =>
      payrollService.payslips({
        ...(isSelfService ? { employeeId: user.employeeId ?? user.id } : {}),
        search,
        status,
      }),
  });

  const columns = useMemo<Column<Payslip>[]>(
    () => [
      ...(isSelfService
        ? []
        : [
            {
              key: "employee",
              header: "Employee",
              cell: (row: Payslip) => <span className="text-sm font-medium">{row.employeeName}</span>,
            },
          ]),
      { key: "period", header: "Period", cell: (row) => <span className="text-sm">{row.period}</span> },
      { key: "basic", header: "Basic", align: "right", cell: (row) => <span className="text-sm">{inr(row.basic)}</span> },
      { key: "hra", header: "HRA", align: "right", cell: (row) => <span className="text-sm">{inr(row.hra)}</span> },
      {
        key: "allowances",
        header: "Allowances",
        align: "right",
        cell: (row) => <span className="text-sm">{inr(row.allowances + row.bonus)}</span>,
      },
      {
        key: "deductions",
        header: "Deductions",
        align: "right",
        cell: (row) => (
          <span className="text-sm text-destructive">
            −{inr(row.pf + row.tax + row.otherDeductions)}
          </span>
        ),
      },
      {
        key: "net",
        header: "Net pay",
        align: "right",
        cell: (row) => <span className="text-sm font-semibold">{inr(row.net)}</span>,
      },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
      {
        key: "actions",
        header: "Payslip",
        align: "right",
        className: "pr-5",
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const result = await payrollService.downloadPayslip(row.id);
                if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
                else toast.info("No payslip file available", { description: `There is no PDF attached for ${row.period}.` });
              } catch (error) {
                toast.error("Could not download payslip", { description: error instanceof Error ? error.message : "Supabase request failed." });
              }
            }}
          >
            <Download className="size-3.5" /> Download
          </Button>
        ),
      },
    ],
    [isSelfService],
  );

  const current = runs.data?.[0];
  // Self-service has no access to org-wide payroll_runs (by design -- runs()
  // is disabled for them entirely), so the summary cards are built from
  // their own most recent payslip instead of a run. period is "YYYY-MM", so
  // the lexicographically largest one is the latest.
  const latestPayslip = isSelfService
    ? (payslips.data ?? []).reduce<Payslip | undefined>(
        (latest, row) => (!latest || row.period > latest.period ? row : latest),
        undefined,
      )
    : undefined;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Compensation"
        title={isSelfService ? "My payroll" : "Payroll & payslips"}
        description={
          isSelfService
            ? "Your salary breakdown, deductions and payslip history."
            : "Monthly payroll runs, payout status and per-employee payslip detail."
        }
        actions={
          isSelfService ? null : (
            <Button onClick={() => startRun.mutate()} disabled={startRun.isPending}>
              <Wallet className="size-4" /> {startRun.isPending ? "Starting…" : "Start payroll run"}
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current period"
          value={(isSelfService ? latestPayslip?.period : current?.period) ?? "—"}
          icon={BadgeIndianRupee}
          tone="primary"
          hint={
            isSelfService
              ? latestPayslip
                ? `Status: ${latestPayslip.status}`
                : "No payslip yet"
              : current
                ? `Pay date ${shortDate(current.payDate)}`
                : "No run yet"
          }
        />
        <StatCard
          label="Gross"
          value={
            isSelfService
              ? latestPayslip
                ? compactInr(latestPayslip.basic + latestPayslip.hra + latestPayslip.allowances + latestPayslip.bonus)
                : "—"
              : current
                ? compactInr(current.gross)
                : "—"
          }
          icon={BadgeIndianRupee}
          tone="info"
          hint={isSelfService ? "Basic + HRA + allowances" : `${current?.employees ?? 0} employees`}
        />
        <StatCard
          label="Deductions"
          value={
            isSelfService
              ? latestPayslip
                ? compactInr(latestPayslip.pf + latestPayslip.tax + latestPayslip.otherDeductions)
                : "—"
              : current
                ? compactInr(current.deductions)
                : "—"
          }
          icon={BadgeIndianRupee}
          tone="warning"
          hint="PF, tax and other"
        />
        <StatCard
          label="Net payout"
          value={(isSelfService ? latestPayslip && compactInr(latestPayslip.net) : current && compactInr(current.net)) ?? "—"}
          icon={BadgeIndianRupee}
          tone="success"
          hint={`Status: ${(isSelfService ? latestPayslip?.status : current?.status) ?? "draft"}`}
        />
      </div>

      {isSelfService ? null : (
        <SectionCard title="Payroll runs" description="Last six cycles" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(runs.data ?? []).map((run) => (
              <li key={run.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 sm:flex sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{run.period}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {run.employees} employees · gross {compactInr(run.gross)} · net{" "}
                    {compactInr(run.net)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {shortDate(run.payDate)}
                  </span>
                  <StatusBadge status={run.status} />
                  {run.status === "draft" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={processRun.isPending}
                      onClick={() => processRun.mutate(run.id)}
                    >
                      {processRun.isPending ? "Processing…" : "Process"}
                    </Button>
                  ) : run.status === "processed" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={approveRun.isPending || rejectRun.isPending}
                        onClick={() => approveRun.mutate(run.id)}
                      >
                        {approveRun.isPending ? "Approving…" : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={approveRun.isPending || rejectRun.isPending}
                        onClick={() => rejectRun.mutate(run.id)}
                      >
                        {rejectRun.isPending ? "Rejecting…" : "Reject"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <DataTable
        columns={columns}
        rows={payslips.data}
        rowKey={(row) => row.id}
        isLoading={payslips.isLoading}
        isError={payslips.isError}
        onRetry={() => payslips.refetch()}
        emptyTitle="No payslips yet"
        emptyDescription="Payslips appear once a payroll run is processed."
        caption={`${payslips.data?.length ?? 0} payslips`}
        toolbar={
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by employee or period…"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { value: "all", label: "All status" },
                  { value: "paid", label: "Paid" },
                  { value: "pending", label: "Pending" },
                ],
              },
            ]}
          />
        }
      />
    </AppLayout>
  );
}
