import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
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
import { requireAuthForPath } from "@/lib/auth-guard";
import { inr, shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";
import type { ExpenseClaim } from "@/types";

const EXPENSE_CATEGORIES: ExpenseClaim["category"][] = ["Travel", "Food", "Internet", "Equipment", "Client", "Other"];

export const Route = createFileRoute("/expenses")({
  beforeLoad: () => requireAuthForPath("/expenses"),
  head: () => ({
    meta: [{ title: "Expense claims · TeamNest" }],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const canManage = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const expenses = useQuery({
    queryKey: ["expenses", isSelfService ? (user.employeeId ?? user.id) : "all", search, status],
    queryFn: () =>
      workplaceService.expenses({
        ...(isSelfService ? { employeeId: user.employeeId ?? user.id } : {}),
        search,
        status,
      }),
  });

  const visible = expenses.data ?? [];

  const pendingTotal = visible
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + row.amount, 0);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "Travel" as ExpenseClaim["category"], amount: "", date: "", note: "" });
  const create = useMutation({
    mutationFn: () => {
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Enter a valid amount.");
      if (!form.date) throw new Error("Select the expense date.");
      return workplaceService.createExpenseClaim({
        category: form.category,
        amount: Number(form.amount),
        date: form.date,
        note: form.note,
      });
    },
    onSuccess: () => {
      toast.success("Expense claim submitted");
      setOpen(false);
      setForm({ category: "Travel", amount: "", date: "", note: "" });
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toast.error("Could not submit claim", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const decide = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected" }) =>
      workplaceService.decideExpenseClaim(vars.id, vars.decision),
    onSuccess: (_data, vars) => {
      toast.success(vars.decision === "approved" ? "Claim approved" : "Claim rejected");
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toast.error("Could not update claim", { description: e instanceof Error ? e.message : "Try again." }),
  });
  const reimburse = useMutation({
    mutationFn: (id: string) => workplaceService.markExpenseReimbursed(id),
    onSuccess: () => {
      toast.success("Claim marked reimbursed");
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toast.error("Could not mark reimbursed", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const columns = useMemo<Column<ExpenseClaim>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => (
          <div>
            <p className="text-sm font-semibold">{row.employeeName}</p>
            <p className="text-xs text-muted-foreground">{row.category}</p>
          </div>
        ),
      },
      {
        key: "amount",
        header: "Amount",
        cell: (row) => <span className="font-medium">{inr(row.amount)}</span>,
      },
      {
        key: "date",
        header: "Date",
        cell: (row) => shortDate(row.date),
      },
      {
        key: "note",
        header: "Note",
        cell: (row) => <span className="line-clamp-1 text-sm text-muted-foreground">{row.note}</span>,
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
      ...(canManage
        ? [
            {
              key: "actions",
              header: "Actions",
              align: "right" as const,
              className: "pr-5",
              cell: (row: ExpenseClaim) =>
                row.status === "pending" ? (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, decision: "approved" })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, decision: "rejected" })}>
                      Reject
                    </Button>
                  </div>
                ) : row.status === "approved" ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={reimburse.isPending} onClick={() => reimburse.mutate(row.id)}>
                      Mark reimbursed
                    </Button>
                  </div>
                ) : null,
            },
          ]
        : []),
    ],
    [canManage, decide, reimburse],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Compensation"
        title={isSelfService ? "My expenses" : "Expense claims"}
        description={
          isSelfService
            ? "Submit and track reimbursement requests."
            : "Review, approve and reimburse employee expense claims."
        }
        actions={
          isSelfService ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New claim
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Claims shown" value={String(visible.length)} icon={Receipt} />
        <StatCard label="Pending amount" value={inr(pendingTotal)} tone="warning" />
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by employee, category or note…"
        status={status}
        onStatusChange={setStatus}
        statusOptions={[
                  { value: "all", label: "All status" },
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "reimbursed", label: "Reimbursed" },
        ]}
      />

      {expenses.isLoading ? (
        <TableSkeleton />
      ) : expenses.isError ? (
        <ErrorState onRetry={() => expenses.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title="No expense claims" description="Submitted claims will appear in this table." icon={Receipt} />
      ) : (
        <DataTable columns={columns} data={visible} rowKey={(row) => row.id} />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New expense claim</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Category</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseClaim["category"] })}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Note</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="What was this for?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
