import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { requireAuthForPath } from "@/lib/auth-guard";
import { workplaceService } from "@/services/workplaceService";
import type { AuditEntry } from "@/types";

export const Route = createFileRoute("/audit")({
  beforeLoad: () => requireAuthForPath("/audit"),
  head: () => ({
    meta: [{ title: "Activity history · Kinetix" }],
  }),
  component: AuditPage,
});

function AuditPage() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");

  const audit = useQuery({
    queryKey: ["audit", search, severity],
    queryFn: () => workplaceService.auditTrail({ search, status: severity }),
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
      {
        key: "severity",
        header: "Severity",
        cell: (row) => (
          <StatusBadge
            status={row.severity}
            tone={row.severity === "critical" ? "danger" : row.severity === "warning" ? "warning" : "neutral"}
          />
        ),
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
        status={severity}
        onStatusChange={setSeverity}
        statusLabel="Severity"
        statusOptions={[
          { value: "all", label: "All severities" },
          { value: "info", label: "Info" },
          { value: "warning", label: "Warning" },
          { value: "critical", label: "Critical" },
        ]}
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
