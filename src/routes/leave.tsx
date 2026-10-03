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
import type { LeaveRequest } from "@/types";

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
        cell: (row) => <span className="text-sm">{row.days}</span>,
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
    [canDecide, cancel.isPending, decide, isSelfService, user],
  );

  const pendingCount = (requests.data ?? []).filter((r) => r.status === "pending").length;

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
          return (
            <StatCard
              key={entry.id}
              label={`${entry.name} balance`}
              value={String(entry.remaining)}
              icon={ClipboardList}
              tone={tones[index % tones.length] ?? "info"}
              hint={`${entry.used} used of ${entry.allocated}`}
              info={
                <InfoHint label={`About ${entry.name} leave`}>{leaveTypeHint(entry.name)}</InfoHint>
              }
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
        >
          <ul>
            {ledger.data!.slice(0, 8).map((entry) => (
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
        </SectionCard>
      ) : null}

      <DataTable
        columns={columns}
        rows={requests.data}
        rowKey={(row) => row.id}
        isLoading={requests.isLoading}
        isError={requests.isError}
        onRetry={() => requests.refetch()}
        emptyTitle="No leave requests"
        emptyDescription="Applications will show up here once submitted."
        caption={`${requests.data?.length ?? 0} requests`}
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
