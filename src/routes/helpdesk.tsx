import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { workplaceService } from "@/services/workplaceService";
import type { HelpdeskTicket } from "@/types";

export const Route = createFileRoute("/helpdesk")({
  beforeLoad: () => requireAuthForPath("/helpdesk"),
  head: () => ({
    meta: [{ title: "HR Helpdesk · TeamNest" }],
  }),
  component: HelpdeskPage,
});

function HelpdeskPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const tickets = useQuery({
    queryKey: ["helpdesk", search, status],
    queryFn: () => workplaceService.tickets({ search, status }),
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
        cell: (row) => row.assignee,
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
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workplace"
        title="HR Helpdesk"
        description="Raise and track HR, payroll, attendance and facilities support tickets."
        actions={
          <Button>
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
    </AppLayout>
  );
}
