import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { inr, shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";
import type { ExpenseClaim } from "@/types";

export const Route = createFileRoute("/expenses")({
  beforeLoad: () => requireAuthForPath("/expenses"),
  head: () => ({
    meta: [{ title: "Expense claims · Kinetix" }],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const expenses = useQuery({
    queryKey: ["expenses", search, status],
    queryFn: () => workplaceService.expenses({ search, status }),
  });

  const visible = useMemo(() => {
    const rows = expenses.data ?? [];
    return isSelfService ? rows.filter((row) => row.employeeName === user?.name) : rows;
  }, [expenses.data, isSelfService, user?.name]);

  const pendingTotal = visible
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + row.amount, 0);

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
    ],
    [],
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
          <Button>
            <Plus className="size-4" /> New claim
          </Button>
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
    </AppLayout>
  );
}
