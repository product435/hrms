import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarPlus, Check, ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { InfoHint } from "@/components/common/InfoHint";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { DateRangeFilter, type DateRange } from "@/components/common/DateRangeFilter";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leaveService } from "@/services/leaveService";
import { usePermissions } from "@/hooks/usePermissions";
import { requireAuthForPath } from "@/lib/auth-guard";
import { dayMonth, shortDate } from "@/lib/format";
import { HOW_LEAVE_WORKS, leaveTypeHint } from "@/lib/leave-hints";
import { cn } from "@/lib/utils";
import type { LeaveRequest } from "@/types";

/** Same visual language as StatCard, but with room for three lines
 * (remaining, taken-of-allocation, extra) instead of one hint string --
 * kept local to this page rather than widening the shared StatCard. */
function LeaveBalanceCard({
  typeName,
  remaining,
  taken,
  allocated,
  extra,
  tone,
}: {
  typeName: string;
  remaining: number;
  taken: number;
  allocated: number;
  extra: number;
  tone: "info" | "accent" | "success";
}) {
  const toneClass = {
    info: "bg-info/12 text-info",
    accent: "bg-accent/15 text-accent",
    success: "bg-success/12 text-success",
  }[tone];
  return (
    <article className="surface-card group relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {typeName} balance
            </p>
            <InfoHint label={`About ${typeName} leave`}>{leaveTypeHint(typeName)}</InfoHint>
          </div>
          <p className="mt-2 font-display text-3xl font-bold leading-none tracking-tight">
            {remaining}
          </p>
        </div>
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-105",
            toneClass,
          )}
        >
          <ClipboardList className="size-5" />
        </span>
      </div>
      <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
        <p>
          Taken: {taken} of {allocated}
        </p>
        {extra > 0 ? <p className="font-medium text-warning">Extra: {extra}</p> : null}
      </div>
    </article>
  );
}

function errorDescription(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return "Try again.";
}

export const Route = createFileRoute("/leave")({
  beforeLoad: () => requireAuthForPath("/leave"),
  validateSearch: (search: Record<string, unknown>): { status?: string } =>
    typeof search["status"] === "string" ? { status: search["status"] } : {},
  head: () => ({
    meta: [
      { title: "Leave management · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Apply for leave, track balances and approve or reject requests with a full audit of every decision.",
      },
      { property: "og:title", content: "Leave management · JeeVijay HRMS" },
      {
        property: "og:description",
        content: "Leave balances, applications and multi-level approvals in one workflow.",
      },
    ],
  }),
  component: LeavePage,
});

function LeavePage() {
  const { role, user, canDecideApprovals } = usePermissions();
  const { status: initialStatus } = Route.useSearch();
  const isSelfService = role === "employee";
  const canDecide = canDecideApprovals;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "", from: "", to: "", reason: "" });
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [ledgerRange, setLedgerRange] = useState<DateRange>({ from: "", to: "" });
  const [recordsRange, setRecordsRange] = useState<DateRange>({ from: "", to: "" });
  const leaveTypes = useQuery({ queryKey: ["leave-types"], queryFn: () => leaveService.types() });
  useEffect(() => {
    const firstType = leaveTypes.data?.[0]?.name;
    if (!form.type && firstType) setForm((prev) => ({ ...prev, type: firstType }));
  }, [form.type, leaveTypes.data]);

  // Managers aren't scoped to a fixed employeeId filter here -- RLS
  // (leave_requests_manager_view_team) already restricts the rows Supabase
  // returns to the manager's own request plus their direct reports', so the
  // same list() call as admin/hr correctly shows every status, not just
  // pending ones.
  const scope = isSelfService ? { employeeId: user.employeeId ?? user.id } : {};
  const requests = useQuery({
    queryKey: ["leave", scope, search, status],
    queryFn: () => leaveService.list({ ...scope, search, status }),
  });
  const balance = useQuery({
    queryKey: ["leave-balance", user.employeeId ?? user.id],
    queryFn: () => leaveService.balance(user.employeeId ?? user.id),
  });
  const ledger = useQuery({
    queryKey: ["leave-ledger", user.employeeId ?? user.id],
    queryFn: () => leaveService.ledger(user.employeeId ?? user.id),
  });

  // Pre-submit preview only -- the server (enforce_leave_request_integrity)
  // is the real source of truth for the deducted/excess split; this just
  // mirrors that same math client-side so the note appears before
  // submission, per the requirement that exceeding the balance must never
  // block the request.
  const requestedDays = useMemo(() => {
    if (!form.from || !form.to) return 0;
    const span =
      Math.round((new Date(form.to).getTime() - new Date(form.from).getTime()) / 86400000) + 1;
    return span > 0 ? span : 0;
  }, [form.from, form.to]);
  const selectedTypeRemaining = useMemo(() => {
    const entry = (balance.data ?? []).find((b) => b.name === form.type);
    return entry?.remaining ?? null;
  }, [balance.data, form.type]);
  const submitPreview = useMemo(() => {
    if (requestedDays <= 0 || selectedTypeRemaining == null) return null;
    const fromBalance = Math.min(requestedDays, Math.max(selectedTypeRemaining, 0));
    const extra = requestedDays - fromBalance;
    return { fromBalance, extra };
  }, [requestedDays, selectedTypeRemaining]);

  // Informational only -- the monthly cap no longer blocks submission.
  // Live, server-computed (not derived from balance.data), since it
  // depends on OTHER requests this month, not this leave type's balance.
  const monthlyCapPreview = useQuery({
    queryKey: ["leave-monthly-cap-preview", form.from, form.to, requestedDays],
    queryFn: () => leaveService.monthlyCapPreview(form.from, form.to, requestedDays),
    enabled: open && requestedDays > 0,
  });
  const monthlyCapExceeded = (monthlyCapPreview.data ?? []).find((m) => m.exceeds) ?? null;

  // Same flag, batched for every request currently in view, so the
  // approver (and the requester's own table) sees it without one RPC call
  // per row.
  const requestIds = useMemo(() => (requests.data ?? []).map((r) => r.id), [requests.data]);
  const monthlyCapFlags = useQuery({
    queryKey: ["leave-monthly-cap-flags", requestIds],
    queryFn: () => leaveService.monthlyCapFlags(requestIds),
    enabled: requestIds.length > 0,
  });

  const apply = useMutation({
    mutationFn: () => leaveService.apply(form),
    onSuccess: () => {
      toast.success("Leave request submitted", { description: "Your approver has been notified." });
      setOpen(false);
      setForm({ type: leaveTypes.data?.[0]?.name ?? "", from: "", to: "", reason: "" });
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] });
      queryClient.invalidateQueries({ queryKey: ["leave-ledger"] });
    },
    onError: (error) =>
      toast.error("Could not submit the request", { description: errorDescription(error) }),
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
      rejectionReason: reason,
    }: {
      id: string;
      decision: "approved" | "rejected";
      rejectionReason?: string;
    }) => leaveService.decide(id, decision, reason),
    onSuccess: (_data, variables) => {
      toast.success(`Request ${variables.decision}`);
      setRejectTarget(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] });
      queryClient.invalidateQueries({ queryKey: ["leave-ledger"] });
    },
    onError: (error) =>
      toast.error("Could not record the decision", { description: errorDescription(error) }),
  });

  const cancel = useMutation({
    mutationFn: ({ id }: { id: string; withdrew: boolean }) => leaveService.cancel(id),
    onSuccess: (_data, variables) => {
      toast.success(variables.withdrew ? "Leave request withdrawn" : "Leave request cancelled");
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] });
      queryClient.invalidateQueries({ queryKey: ["leave-ledger"] });
    },
    onError: (error) =>
      toast.error("Could not cancel the request", { description: errorDescription(error) }),
  });

  const columns = useMemo<Column<LeaveRequest>[]>(
    () => [
      ...(isSelfService
        ? []
        : [
            {
              key: "employee",
              header: "Employee",
              cell: (row: LeaveRequest) => (
                <span className="text-sm font-medium">{row.employeeName}</span>
              ),
            },
          ]),
      { key: "type", header: "Type", cell: (row) => <span className="text-sm">{row.type}</span> },
      {
        key: "dates",
        header: "Dates",
        cell: (row) => (
          <span className="text-sm">
            {dayMonth(row.from)} – {dayMonth(row.to)}
          </span>
        ),
      },
      {
        key: "days",
        header: "Days",
        align: "right",
        cell: (row) => (
          <span className="text-sm">
            {row.days}
            {row.excessDays > 0 ? (
              <span className="ml-1.5 text-xs font-medium text-warning">
                ({row.excessDays} extra)
              </span>
            ) : null}
            {monthlyCapFlags.data?.has(row.id) ? (
              <span className="ml-1.5 text-xs font-medium text-warning">
                (over monthly limit)
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        cell: (row) => (
          <span className="line-clamp-1 text-sm text-muted-foreground">{row.reason}</span>
        ),
      },
      {
        key: "applied",
        header: "Applied",
        cell: (row) => <span className="text-sm">{shortDate(row.appliedOn)}</span>,
      },
      {
        key: "approver",
        header: "Approver",
        cell: (row) => <span className="text-sm">{row.approver}</span>,
      },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
      ...(isSelfService || canDecide
        ? [
            {
              key: "actions",
              header: "Actions",
              align: "right" as const,
              className: "pr-5",
              cell: (row: LeaveRequest) => {
                // A manager's own request stays in this list, but deciding it
                // is refused server-side. The owner withdraws or cancels on
                // the self path. Approve and reject stay on someone else's
                // pending request only.
                const isOwnRequest = row.employeeId === (user.employeeId ?? user.id);
                const canDecideThis = canDecide && !isOwnRequest && row.status === "pending";
                const canCancelThis =
                  (row.status === "pending" || row.status === "approved") &&
                  (isOwnRequest || canDecide);
                const withdrawing = isOwnRequest && row.status === "pending";
                if (!canDecideThis && !canCancelThis) {
                  return <span className="text-xs text-muted-foreground">Closed</span>;
                }
                return (
                  <div className="flex justify-end gap-1.5">
                    {canDecideThis ? (
                      <>
                        <IconAction
                          label="Approve"
                          variant="outline"
                          disabled={decide.isPending || cancel.isPending}
                          onClick={() => decide.mutate({ id: row.id, decision: "approved" })}
                        >
                          <Check />
                        </IconAction>
                        <IconAction
                          label="Reject"
                          variant="ghost"
                          disabled={decide.isPending || cancel.isPending}
                          onClick={() => {
                            setRejectionReason("");
                            setRejectTarget(row);
                          }}
                        >
                          <X />
                        </IconAction>
                      </>
                    ) : null}
                    {canCancelThis ? (
                      <IconAction
                        label={withdrawing ? "Withdraw" : "Cancel"}
                        variant="ghost"
                        disabled={decide.isPending || cancel.isPending}
                        onClick={() => setCancelTarget(row)}
                      >
                        <Ban />
                      </IconAction>
                    ) : null}
                  </div>
                );
              },
            },
          ]
        : []),
    ],
    [canDecide, cancel.isPending, decide, isSelfService, user, monthlyCapFlags.data],
  );

  const pendingCount = (requests.data ?? []).filter((r) => r.status === "pending").length;

  // Date range filters are applied client-side on top of the existing
  // search/status query so they combine with both without a refetch, and
  // only change what's shown once "Apply" has set ledgerRange/recordsRange
  // -- picking a date alone never re-filters. From/To are independent: only
  // From = that date onwards, only To = up to that date, both inclusive.
  // "Falls in the selection" for records = the request's own date range
  // overlaps the picked range, not just its start date.
  const visibleRequests = useMemo(() => {
    return (requests.data ?? []).filter((row) => {
      if (recordsRange.from && row.to < recordsRange.from) return false;
      if (recordsRange.to && row.from > recordsRange.to) return false;
      return true;
    });
  }, [requests.data, recordsRange]);

  const visibleLedger = useMemo(() => {
    return (ledger.data ?? []).filter((entry) => {
      const day = entry.createdAt.slice(0, 10);
      if (ledgerRange.from && day < ledgerRange.from) return false;
      if (ledgerRange.to && day > ledgerRange.to) return false;
      return true;
    });
  }, [ledger.data, ledgerRange]);

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time off"
        title={isSelfService ? "My leave" : "Leave management"}
        description={
          isSelfService
            ? "Track your balance, apply for time off, and withdraw or cancel a request."
            : "Review, approve, reject, or cancel leave requests and monitor team availability."
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <CalendarPlus className="size-4" /> Apply for leave
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply for leave</DialogTitle>
                <DialogDescription>
                  Requests route to your approver based on the reporting hierarchy.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="leave-type">Leave type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}
                  >
                    <SelectTrigger id="leave-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(leaveTypes.data ?? []).map((type) => (
                        <SelectItem key={type.id} value={type.name}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="leave-from">From</Label>
                    <Input
                      id="leave-from"
                      type="date"
                      value={form.from}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, from: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="leave-to">To</Label>
                    <Input
                      id="leave-to"
                      type="date"
                      value={form.to}
                      onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
                    />
                  </div>
                </div>
                {submitPreview && submitPreview.extra > 0 ? (
                  <p
                    role="status"
                    className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                  >
                    {submitPreview.fromBalance} day{submitPreview.fromBalance === 1 ? "" : "s"} from
                    balance, {submitPreview.extra} day{submitPreview.extra === 1 ? "" : "s"} extra.
                    This request will still be submitted.
                  </p>
                ) : null}
                {monthlyCapExceeded ? (
                  <p
                    role="status"
                    className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                  >
                    Monthly limit is {monthlyCapExceeded.limitDays} day
                    {monthlyCapExceeded.limitDays === 1 ? "" : "s"} for{" "}
                    {monthlyCapExceeded.monthLabel} (you already have{" "}
                    {monthlyCapExceeded.alreadyUsed} this month). This request exceeds it but will
                    still be submitted.
                  </p>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="leave-reason">Reason</Label>
                  <Textarea
                    id="leave-reason"
                    value={form.reason}
                    placeholder="Add context for your approver"
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, reason: event.target.value }))
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => apply.mutate()}
                  disabled={apply.isPending || !form.from || !form.to || !form.reason}
                >
                  Submit request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <SectionCard title="How leave works">
        <p className="text-sm text-muted-foreground">{HOW_LEAVE_WORKS}</p>
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(balance.data ?? []).map((entry, index) => {
          const tones = ["info", "accent", "success"] as const;
          const tone = tones[index % tones.length] ?? "info";
          // Taken includes extra days (days taken beyond the balance);
          // the allocation (Y) never changes, so Taken can visibly exceed
          // it -- that's what makes a separate Extra line meaningful.
          const taken = entry.used + entry.extra;
          return (
            <LeaveBalanceCard
              key={entry.id}
              typeName={entry.name}
              remaining={entry.remaining}
              taken={taken}
              allocated={entry.allocated}
              extra={entry.extra}
              tone={tone}
            />
          );
        })}
        <StatCard
          label="Pending"
          value={String(pendingCount)}
          icon={ClipboardList}
          tone="warning"
          hint="in current view"
        />
      </div>

      {(ledger.data ?? []).length > 0 ? (
        <SectionCard
          title="Leave ledger"
          description="Your balance transaction history"
          bodyClassName="divide-y divide-border p-0"
          action={
            <DateRangeFilter
              from={ledgerRange.from}
              to={ledgerRange.to}
              onApply={(from, to) => setLedgerRange({ from, to })}
              onClear={() => setLedgerRange({ from: "", to: "" })}
            />
          }
        >
          {visibleLedger.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              No ledger entries in this range.
            </p>
          ) : (
          <ul>
            {visibleLedger.slice(0, 8).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{entry.typeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.reason} · {shortDate(entry.createdAt)}
                  </p>
                </div>
                <span
                  className={
                    entry.changeDays < 0
                      ? "font-semibold text-destructive"
                      : "font-semibold text-emerald-600"
                  }
                >
                  {entry.changeDays > 0 ? "+" : ""}
                  {entry.changeDays}
                </span>
              </li>
            ))}
          </ul>
          )}
        </SectionCard>
      ) : null}

      <DataTable
        columns={columns}
        rows={visibleRequests}
        rowKey={(row) => row.id}
        isLoading={requests.isLoading}
        isError={requests.isError}
        onRetry={() => requests.refetch()}
        emptyTitle="No leave requests"
        emptyDescription="Applications will show up here once submitted."
        caption={`${visibleRequests.length} requests`}
        toolbar={
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by employee, type or reason…"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { value: "all", label: "All status" },
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "rejected", label: "Rejected" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              },
            ]}
            actions={
              <DateRangeFilter
                from={recordsRange.from}
                to={recordsRange.to}
                onApply={(from, to) => setRecordsRange({ from, to })}
                onClear={() => setRecordsRange({ from: "", to: "" })}
              />
            }
          />
        }
      />

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(next) => {
          if (!next && !decide.isPending) {
            setRejectTarget(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${rejectTarget.employeeName || "This employee"} · ${dayMonth(rejectTarget.from)} – ${dayMonth(rejectTarget.to)}`
                : "A reason is required."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="leave-rejection-reason">Rejection reason</Label>
            <Textarea
              id="leave-rejection-reason"
              value={rejectionReason}
              placeholder="Tell the employee why this request is rejected"
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectTarget(null);
                setRejectionReason("");
              }}
              disabled={decide.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rejectTarget || !rejectionReason.trim()) return;
                decide.mutate({
                  id: rejectTarget.id,
                  decision: "rejected",
                  rejectionReason: rejectionReason.trim(),
                });
              }}
              disabled={decide.isPending || !rejectionReason.trim()}
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(next) => {
          if (!next && !cancel.isPending) setCancelTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelTarget?.employeeId === (user.employeeId ?? user.id) &&
              cancelTarget?.status === "pending"
                ? "Withdraw leave request"
                : "Cancel leave request"}
            </DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `${cancelTarget.employeeName || "This request"} · ${dayMonth(cancelTarget.from)} – ${dayMonth(cancelTarget.to)}. The days go back to the leave balance.`
                : "The days go back to the leave balance."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCancelTarget(null)}
              disabled={cancel.isPending}
            >
              Keep request
            </Button>
            <Button
              onClick={() => {
                if (!cancelTarget) return;
                const isOwnRequest = cancelTarget.employeeId === (user.employeeId ?? user.id);
                cancel.mutate({
                  id: cancelTarget.id,
                  withdrew: isOwnRequest && cancelTarget.status === "pending",
                });
              }}
              disabled={cancel.isPending}
            >
              {cancelTarget?.employeeId === (user.employeeId ?? user.id) &&
              cancelTarget?.status === "pending"
                ? "Withdraw request"
                : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
