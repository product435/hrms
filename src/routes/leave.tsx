import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
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
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { dayMonth, shortDate } from "@/lib/format";
import type { LeaveRequest } from "@/types";

export const Route = createFileRoute("/leave")({
  beforeLoad: () => requireAuthForPath("/leave"),
  head: () => ({
    meta: [
      { title: "Leave management · TeamNest" },
      {
        name: "description",
        content:
          "Apply for leave, track balances and approve or reject requests with a full audit of every decision.",
      },
      { property: "og:title", content: "Leave management · TeamNest" },
      {
        property: "og:description",
        content: "Leave balances, applications and multi-level approvals in one workflow.",
      },
    ],
  }),
  component: LeavePage,
});

const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid", "Comp-off"];

function LeavePage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const canDecide = role === "admin" || role === "hr" || role === "manager";
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "Casual", from: "", to: "", reason: "" });

  const scope = isSelfService ? { employeeId: user.employeeId ?? user.id } : {};
  const requests = useQuery({
    queryKey: ["leave", scope, search, status],
    queryFn: () =>
      role === "manager"
        ? leaveService.pendingApprovals(user.id).then((rows) => rows.filter((row) => (!status || status === "all" || row.status === status) && (!search || `${row.employeeName} ${row.type} ${row.reason}`.toLowerCase().includes(search.toLowerCase()))))
        : leaveService.list({ ...scope, search, status }),
  });
  const balance = useQuery({
    queryKey: ["leave-balance", user.id],
    queryFn: () => leaveService.balance(user.employeeId ?? user.id),
  });

  const apply = useMutation({
    mutationFn: () => leaveService.apply(form),
    onSuccess: () => {
      toast.success("Leave request submitted", { description: "Your approver has been notified." });
      setOpen(false);
      setForm({ type: "Casual", from: "", to: "", reason: "" });
      queryClient.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (error) => toast.error("Could not submit the request", { description: error instanceof Error ? error.message : "Try again." }),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      leaveService.decide(id, decision),
    onSuccess: (_data, variables) => {
      toast.success(`Request ${variables.decision}`);
      queryClient.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (error) => toast.error("Could not record the decision", { description: error instanceof Error ? error.message : "Try again." }),
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
      { key: "days", header: "Days", align: "right", cell: (row) => <span className="text-sm">{row.days}</span> },
      {
        key: "reason",
        header: "Reason",
        cell: (row) => <span className="line-clamp-1 text-sm text-muted-foreground">{row.reason}</span>,
      },
      { key: "applied", header: "Applied", cell: (row) => <span className="text-sm">{shortDate(row.appliedOn)}</span> },
      { key: "approver", header: "Approver", cell: (row) => <span className="text-sm">{row.approver}</span> },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
      ...(canDecide
        ? [
            {
              key: "actions",
              header: "Decision",
              align: "right" as const,
              className: "pr-5",
              cell: (row: LeaveRequest) =>
                row.status === "pending" ? (
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: row.id, decision: "approved" })}
                    >
                      <Check className="size-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: row.id, decision: "rejected" })}
                    >
                      <X className="size-3.5" /> Reject
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Closed</span>
                ),
            },
          ]
        : []),
    ],
    [canDecide, decide, isSelfService],
  );

  const b = balance.data;
  const pendingCount = (requests.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time off"
        title={isSelfService ? "My leave" : "Leave management"}
        description={
          isSelfService
            ? "Track your balance, apply for time off and follow approval status."
            : "Review, approve or reject leave requests and monitor team availability."
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
                      {LEAVE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
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
                      onChange={(event) => setForm((prev) => ({ ...prev, from: event.target.value }))}
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
                    onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Casual balance" value={String(b?.casual ?? 0)} icon={ClipboardList} tone="info" hint="days left" />
        <StatCard label="Sick balance" value={String(b?.sick ?? 0)} icon={ClipboardList} tone="accent" hint="days left" />
        <StatCard label="Earned balance" value={String(b?.earned ?? 0)} icon={ClipboardList} tone="success" hint="days left" />
        <StatCard label="Pending" value={String(pendingCount)} icon={ClipboardList} tone="warning" hint="in current view" />
      </div>

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
    </AppLayout>
  );
}
