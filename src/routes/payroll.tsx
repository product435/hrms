import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeIndianRupee, Check, Download, Pencil, Play, Plus, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { IconAction } from "@/components/common/IconAction";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  payrollService,
  readSalaryAmount,
  readSalaryDate,
  salaryGross,
  type CurrentSalaryStructure,
} from "@/services/payrollService";
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
  const startRun = useMutation({
    mutationFn: () => {
      const now = new Date();
      return payrollService.startRun({ year: now.getFullYear(), month: now.getMonth() + 1 });
    },
    onSuccess: () => {
      toast.success("Payroll run created");
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["payslips"] });
    },
    onError: (e) =>
      toast.error("Could not start payroll run", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const processRun = useMutation({
    mutationFn: (runId: string) => payrollService.processRun(runId),
    onSuccess: () => {
      toast.success("Payroll run processed", { description: "Ready for approval." });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (e) =>
      toast.error("Could not process payroll run", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const approveRun = useMutation({
    mutationFn: (runId: string) => payrollService.approveRun(runId),
    onSuccess: () => {
      toast.success("Payroll run approved", {
        description: "Payslips generated for all employees in this run.",
      });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["payslips"] });
    },
    onError: (e) =>
      toast.error("Could not approve payroll run", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const rejectRun = useMutation({
    mutationFn: (runId: string) => payrollService.rejectRun(runId),
    onSuccess: () => {
      toast.success("Payroll run rejected", { description: "Sent back to draft for correction." });
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (e) =>
      toast.error("Could not reject payroll run", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const canEditSalary = role === "admin" || role === "hr";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const runs = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => payrollService.runs(),
    enabled: !isSelfService,
  });
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
              cell: (row: Payslip) => (
                <span className="text-sm font-medium">{row.employeeName}</span>
              ),
            },
          ]),
      {
        key: "period",
        header: "Period",
        cell: (row) => <span className="text-sm">{row.period}</span>,
      },
      {
        key: "basic",
        header: "Basic",
        align: "right",
        cell: (row) => <span className="text-sm">{inr(row.basic)}</span>,
      },
      {
        key: "hra",
        header: "HRA",
        align: "right",
        cell: (row) => <span className="text-sm">{inr(row.hra)}</span>,
      },
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
          <IconAction
            label="Download"
            variant="outline"
            onClick={async () => {
              try {
                const result = await payrollService.downloadPayslip(row.id);
                if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
                else
                  toast.info("No payslip file available", {
                    description: `There is no PDF attached for ${row.period}.`,
                  });
              } catch (error) {
                toast.error("Could not download payslip", {
                  description: error instanceof Error ? error.message : "Supabase request failed.",
                });
              }
            }}
          >
            <Download />
          </IconAction>
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
                ? compactInr(
                    latestPayslip.basic +
                      latestPayslip.hra +
                      latestPayslip.allowances +
                      latestPayslip.bonus,
                  )
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
          hint="Salary deductions. PF and tax are not configured."
        />
        <StatCard
          label="Net payout"
          value={
            (isSelfService
              ? latestPayslip && compactInr(latestPayslip.net)
              : current && compactInr(current.net)) ?? "—"
          }
          icon={BadgeIndianRupee}
          tone="success"
          hint={`Status: ${(isSelfService ? latestPayslip?.status : current?.status) ?? "draft"}`}
        />
      </div>

      {canEditSalary ? <SalaryStructuresCard /> : null}

      {isSelfService ? null : (
        <SectionCard title="Payroll runs" description="Last six cycles" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(runs.data ?? []).map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 sm:flex sm:justify-between"
              >
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
                    <IconAction
                      label={processRun.isPending ? "Processing…" : "Process"}
                      variant="outline"
                      disabled={processRun.isPending}
                      onClick={() => processRun.mutate(run.id)}
                    >
                      <Play />
                    </IconAction>
                  ) : run.status === "processed" ? (
                    <div className="flex items-center gap-2">
                      <IconAction
                        label={approveRun.isPending ? "Approving…" : "Approve"}
                        variant="default"
                        disabled={approveRun.isPending || rejectRun.isPending}
                        onClick={() => approveRun.mutate(run.id)}
                      >
                        <Check />
                      </IconAction>
                      <IconAction
                        label={rejectRun.isPending ? "Rejecting…" : "Reject"}
                        variant="ghost"
                        disabled={approveRun.isPending || rejectRun.isPending}
                        onClick={() => rejectRun.mutate(run.id)}
                      >
                        <X />
                      </IconAction>
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

const blankStructure = {
  id: null as string | null,
  employeeId: "",
  effectiveFrom: "",
  basic: "",
  hra: "",
  allowances: "",
  bonus: "",
  deductions: "",
};

function inrExact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function moneyInput(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function previewGross(basic: string, hra: string, allowances: string, bonus: string) {
  try {
    return salaryGross({
      basic: readSalaryAmount(basic, "Basic"),
      hra: readSalaryAmount(hra, "HRA"),
      allowances: readSalaryAmount(allowances, "Allowances"),
      bonus: readSalaryAmount(bonus, "Bonus"),
    });
  } catch {
    return null;
  }
}

function SalaryStructuresCard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blankStructure);

  const structures = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => payrollService.currentStructures(),
  });

  const save = useMutation({
    mutationFn: () =>
      payrollService.saveStructure({
        id: draft.id,
        employeeId: draft.employeeId,
        effectiveFrom: readSalaryDate(draft.effectiveFrom),
        basic: readSalaryAmount(draft.basic, "Basic"),
        hra: readSalaryAmount(draft.hra, "HRA"),
        allowances: readSalaryAmount(draft.allowances, "Allowances"),
        bonus: readSalaryAmount(draft.bonus, "Bonus"),
        deductions: readSalaryAmount(draft.deductions, "Deductions"),
      }),
    onSuccess: () => {
      toast.success(draft.id ? "Salary structure updated" : "Salary structure saved", {
        description:
          "This period uses the structure in effect then. Approved and processed payslips stay unchanged.",
      });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
    onError: (error) =>
      toast.error("Could not save salary structure", {
        description: error instanceof Error ? error.message : "Supabase request failed.",
      }),
  });

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (structures.data ?? []).filter(
      (row) =>
        !query ||
        row.employeeName.toLowerCase().includes(query) ||
        row.employeeCode.toLowerCase().includes(query),
    );
  }, [search, structures.data]);

  const columns = useMemo<Column<CurrentSalaryStructure>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.employeeName}</p>
            {row.employeeCode ? (
              <p className="truncate text-xs text-muted-foreground">{row.employeeCode}</p>
            ) : null}
          </div>
        ),
      },
      {
        key: "effective",
        header: "Effective from",
        cell: (row) => (
          <span className="text-sm">
            {row.structure ? shortDate(row.structure.effectiveFrom) : "—"}
          </span>
        ),
      },
      {
        key: "basic",
        header: "Basic",
        align: "right",
        cell: (row) => (
          <span className="text-sm">{row.structure ? inrExact(row.structure.basic) : "—"}</span>
        ),
      },
      {
        key: "hra",
        header: "HRA",
        align: "right",
        cell: (row) => (
          <span className="text-sm">{row.structure ? inrExact(row.structure.hra) : "—"}</span>
        ),
      },
      {
        key: "allowances",
        header: "Allowances",
        align: "right",
        cell: (row) => (
          <span className="text-sm">
            {row.structure ? inrExact(row.structure.allowances) : "—"}
          </span>
        ),
      },
      {
        key: "bonus",
        header: "Bonus",
        align: "right",
        cell: (row) => (
          <span className="text-sm">{row.structure ? inrExact(row.structure.bonus) : "—"}</span>
        ),
      },
      {
        key: "deductions",
        header: "Deductions",
        align: "right",
        cell: (row) => (
          <span className="text-sm text-destructive">
            {row.structure ? `−${inrExact(row.structure.deductions)}` : "—"}
          </span>
        ),
      },
      {
        key: "gross",
        header: "Gross",
        align: "right",
        cell: (row) => (
          <span className="text-sm font-semibold">
            {row.structure ? inrExact(row.structure.gross) : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        className: "pr-5",
        cell: (row) => (
          <IconAction
            label={row.structure ? "Edit salary" : "Set salary"}
            variant="outline"
            onClick={() => {
              setDraft(
                row.structure
                  ? {
                      id: row.structure.id,
                      employeeId: row.employeeId,
                      effectiveFrom: row.structure.effectiveFrom.slice(0, 10),
                      basic: moneyInput(row.structure.basic),
                      hra: moneyInput(row.structure.hra),
                      allowances: moneyInput(row.structure.allowances),
                      bonus: moneyInput(row.structure.bonus),
                      deductions: moneyInput(row.structure.deductions),
                    }
                  : { ...blankStructure, employeeId: row.employeeId },
              );
              setOpen(true);
            }}
          >
            {row.structure ? <Pencil /> : <Plus />}
          </IconAction>
        ),
      },
    ],
    [],
  );

  const gross = previewGross(draft.basic, draft.hra, draft.allowances, draft.bonus);
  const field = (key: "basic" | "hra" | "allowances" | "bonus" | "deductions", label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`salary-${key}`}>{label}</Label>
      <Input
        id={`salary-${key}`}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Salary structures</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Current structure for this payroll period. Gross is basic + HRA + allowances + bonus.
            Earlier runs keep their own snapshot.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => {
            setDraft(blankStructure);
            setOpen(true);
          }}
        >
          <Plus className="size-3.5" /> Add structure
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.employeeId}
        isLoading={structures.isLoading}
        isError={structures.isError}
        onRetry={() => structures.refetch()}
        emptyTitle={search.trim() ? "No matching employees" : "No active employees"}
        emptyDescription={
          search.trim()
            ? "Try a different name or employee code."
            : "Salary structures appear for active employees."
        }
        caption={`${rows.length} employees`}
        toolbar={
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by employee or code…"
          />
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft.id ? "Update salary structure" : "Add salary structure"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Employee</Label>
              {draft.id ? (
                <Input
                  value={
                    structures.data?.find((row) => row.employeeId === draft.employeeId)
                      ?.employeeName ?? "Employee"
                  }
                  disabled
                />
              ) : (
                <Select
                  value={draft.employeeId || "unset"}
                  onValueChange={(employeeId) => {
                    if (employeeId === "unset") return;
                    setDraft((current) => ({ ...current, employeeId }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an employee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset" disabled>
                      Choose an employee
                    </SelectItem>
                    {(structures.data ?? []).map((row) => (
                      <SelectItem key={row.employeeId} value={row.employeeId}>
                        {row.employeeCode
                          ? `${row.employeeName} · ${row.employeeCode}`
                          : row.employeeName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="salary-effective-from">Effective from</Label>
              <Input
                id="salary-effective-from"
                type="date"
                value={draft.effectiveFrom}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("basic", "Basic")}
              {field("hra", "HRA")}
              {field("allowances", "Allowances")}
              {field("bonus", "Bonus")}
              {field("deductions", "Deductions")}
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Gross</p>
              <p className="text-sm font-semibold">{gross === null ? "—" : inrExact(gross)}</p>
              <p className="text-xs text-muted-foreground">Basic + HRA + allowances + bonus</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : draft.id ? "Update structure" : "Save structure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
