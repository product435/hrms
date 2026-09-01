import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { requireAuthForPath } from "@/lib/auth-guard";
import { workplaceService } from "@/services/workplaceService";
import type { AuditEntry } from "@/types";

export const Route = createFileRoute("/audit")({
  beforeLoad: () => requireAuthForPath("/audit"),
  head: () => ({
    meta: [{ title: "Activity history · JeeVijay HRMS" }],
  }),
  component: AuditPage,
});

function AuditPage() {
  const [search, setSearch] = useState("");

  const audit = useQuery({
    queryKey: ["audit", search],
    queryFn: () => workplaceService.auditTrail({ search }),
  });

  const columns = useMemo<Column<AuditEntry>[]>(
    () => [
      {
        key: "timestamp",
        header: "When",
        cell: (row) => <span className="whitespace-nowrap text-sm">{row.timestamp}</span>,
      },
      {
        key: "actor",
        header: "Actor",
        cell: (row) => row.actor,
      },
      {
        key: "action",
        header: "Action",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.action}</p>
            <p className="truncate text-xs text-muted-foreground">{row.entity}</p>
          </div>
        ),
      },
      {
        key: "ip",
        header: "IP",
        cell: (row) => row.ip,
      },
    ],
    [],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Administration"
        title="Activity history"
        description="Immutable audit trail of sensitive HR actions across the platform."
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by actor, action or entity…"
      />

      {audit.isLoading ? (
        <TableSkeleton />
      ) : audit.isError ? (
        <ErrorState onRetry={() => audit.refetch()} />
      ) : (audit.data ?? []).length === 0 ? (
        <EmptyState title="No audit entries" description="Activity will be logged here once actions occur." icon={Activity} />
      ) : (
        <DataTable columns={columns} data={audit.data ?? []} rowKey={(row) => row.id} />
      )}
    </AppLayout>
  );
}
