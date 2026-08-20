import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
      { title: "Payroll & payslips · Kinetix" },
      {
        name: "description",
        content:
          "Monthly payroll runs with gross, deductions and net payouts, plus downloadable payslip breakdowns.",
      },
      { property: "og:title", content: "Payroll · Kinetix" },
      {
        property: "og:description",
        content: "Run payroll, review deductions and share payslips with employees.",
      },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const runs = useQuery({ queryKey: ["payroll-runs"], queryFn: () => payrollService.runs() });
  const payslips = useQuery({
    queryKey: ["payslips", isSelfService ? user.id : "all", search, status],
    queryFn: () =>
      payrollService.payslips({
        ...(isSelfService ? { employeeId: user.id } : {}),
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
            onClick={() =>
              toast.info("Payslip download", {
                description: `PDF generation for ${row.period} will be wired to the backend.`,
              })
            }
          >
            <Download className="size-3.5" /> Download
          </Button>
        ),
      },
    ],
    [isSelfService],
  );

  const current = runs.data?.[0];

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
            <Button>
              <Wallet className="size-4" /> Start payroll run
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current period"
          value={current?.period ?? "—"}
          icon={BadgeIndianRupee}
          tone="primary"
          hint={current ? `Pay date ${shortDate(current.payDate)}` : "No run yet"}
        />
        <StatCard
          label="Gross"
          value={current ? compactInr(current.gross) : "—"}
          icon={BadgeIndianRupee}
          tone="info"
          hint={`${current?.employees ?? 0} employees`}
        />
        <StatCard
          label="Deductions"
          value={current ? compactInr(current.deductions) : "—"}
          icon={BadgeIndianRupee}
          tone="warning"
          hint="PF, tax and other"
        />
        <StatCard
          label="Net payout"
          value={current ? compactInr(current.net) : "—"}
          icon={BadgeIndianRupee}
          tone="success"
          hint={`Status: ${current?.status ?? "draft"}`}
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
