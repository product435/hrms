import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";
import type { HelpdeskTicket } from "@/types";

const TICKET_STATUSES: HelpdeskTicket["status"][] = ["open", "in-progress", "resolved", "closed"];

const TICKET_CATEGORIES: HelpdeskTicket["category"][] = ["Payroll", "IT", "Attendance", "Policy", "Facilities", "Other"];
const TICKET_PRIORITIES: HelpdeskTicket["priority"][] = ["low", "medium", "high", "urgent"];

export const Route = createFileRoute("/helpdesk")({
  beforeLoad: () => requireAuthForPath("/helpdesk"),
  head: () => ({
    meta: [{ title: "HR Helpdesk · JeeVijay HRMS" }],
  }),
  component: HelpdeskPage,
});

function HelpdeskPage() {
  const { role } = useSession();
  const canManage = role === "admin" || role === "hr";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const queryClient = useQueryClient();

  const tickets = useQuery({
    queryKey: ["helpdesk", search, status],
    queryFn: () => workplaceService.tickets({ search, status }),
  });
  const staff = useQuery({
    queryKey: ["helpdesk", "support-staff"],
    queryFn: () => workplaceService.supportStaff(),
    enabled: canManage,
  });
  const updateStatus = useMutation({
    mutationFn: (vars: { id: string; status: HelpdeskTicket["status"] }) => workplaceService.updateTicketStatus(vars.id, vars.status),
    onSuccess: () => {
      toast.success("Ticket status updated");
      void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error("Could not update status", { description: e instanceof Error ? e.message : "Try again." }),
  });
  const updateAssignee = useMutation({
    mutationFn: (vars: { id: string; assignedTo: string | null }) => workplaceService.updateTicketAssignee(vars.id, vars.assignedTo),
    onSuccess: () => {
      toast.success("Ticket assignment updated");
      void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error("Could not update assignment", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    category: "IT" as HelpdeskTicket["category"],
    priority: "medium" as HelpdeskTicket["priority"],
    description: "",
  });
  const create = useMutation({
    mutationFn: () => {
      if (!form.subject.trim()) throw new Error("Subject is required.");
      return workplaceService.createTicket(form);
    },
    onSuccess: () => {
      toast.success("Request submitted");
      setOpen(false);
      setForm({ subject: "", category: "IT", priority: "medium", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error("Could not submit request", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const openCount = (tickets.data ?? []).filter(
    (ticket) => ticket.status === "open" || ticket.status === "in-progress",
  ).length;

  const columns = useMemo<Column<HelpdeskTicket>[]>(
    () => [
      {
        key: "subject",
        header: "Subject",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.subject}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.raisedBy} · {row.category}
            </p>
          </div>
        ),
      },
      {
        key: "assignee",
        header: "Assignee",
        cell: (row) =>
          canManage ? (
            <Select
              value={row.assignedTo ?? "unassigned"}
              onValueChange={(value) => updateAssignee.mutate({ id: row.id, assignedTo: value === "unassigned" ? null : value })}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(staff.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            row.assignee
          ),
      },
      {
        key: "priority",
        header: "Priority",
        cell: (row) => <StatusBadge status={row.priority} tone={row.priority === "urgent" ? "danger" : "neutral"} />,
      },
      {
        key: "created",
        header: "Created",
        cell: (row) => shortDate(row.createdOn),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) =>
          canManage ? (
            <Select
              value={row.status}
              onValueChange={(value) => updateStatus.mutate({ id: row.id, status: value as HelpdeskTicket["status"] })}
            >
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge status={row.status} />
          ),
      },
    ],
    [canManage, staff.data, updateAssignee, updateStatus],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workplace"
        title="HR Helpdesk"
        description="Raise and track HR, payroll, attendance and facilities support tickets."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New request
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open tickets" value={String(openCount)} icon={LifeBuoy} tone={openCount > 0 ? "warning" : "neutral"} />
        <StatCard label="Total shown" value={String((tickets.data ?? []).length)} />
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tickets by subject, requester or category…"
        status={status}
        onStatusChange={setStatus}
        statusOptions={[
                  { value: "all", label: "All status" },
          { value: "open", label: "Open" },
          { value: "in-progress", label: "In progress" },
          { value: "resolved", label: "Resolved" },
          { value: "closed", label: "Closed" },
        ]}
      />

      {tickets.isLoading ? (
        <TableSkeleton />
      ) : tickets.isError ? (
        <ErrorState onRetry={() => tickets.refetch()} />
      ) : (tickets.data ?? []).length === 0 ? (
        <EmptyState title="No tickets" description="Support requests will appear here once raised." icon={LifeBuoy} />
      ) : (
        <DataTable columns={columns} data={tickets.data ?? []} rowKey={(row) => row.id} />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support request</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as HelpdeskTicket["category"] })}
                >
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Priority</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as HelpdeskTicket["priority"] })}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
