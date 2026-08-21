import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartBar } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { requireAuthForPath } from "@/lib/auth-guard";
import { talentService } from "@/services/talentService";
import { useSession } from "@/hooks/useSession";
import type { PerformanceReview } from "@/types";

export const Route = createFileRoute("/performance")({
  beforeLoad: () => requireAuthForPath("/performance"),
  head: () => ({
    meta: [{ title: "Performance reviews · TeamNest" }],
  }),
  component: PerformancePage,
});

function PerformancePage() {
  const { role, user } = useSession();
  const reviews = useQuery({
    queryKey: ["performance-reviews", role, user.employeeId],
    queryFn: () => talentService.reviews(role === "manager" ? user.employeeId : undefined),
  });

  const inProgress = (reviews.data ?? []).filter((row) => row.status === "in-progress").length;
  const closed = (reviews.data ?? []).filter((row) => row.status === "closed").length;

  const columns = useMemo<Column<PerformanceReview>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => (
          <div>
            <p className="text-sm font-semibold">{row.employeeName}</p>
            <p className="text-xs text-muted-foreground">{row.cycle}</p>
          </div>
        ),
      },
      {
        key: "reviewer",
        header: "Reviewer",
        cell: (row) => row.reviewer,
      },
      {
        key: "scores",
        header: "Scores",
        cell: (row) => (
          <div className="text-sm">
            <span className="font-medium">{row.finalRating.toFixed(1)}</span>
            <span className="text-muted-foreground">
              {" "}
              · self {row.selfScore} · mgr {row.managerScore}
            </span>
          </div>
        ),
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
        eyebrow="Growth"
        title="Performance reviews"
        description="Review cycles, calibration scores and submission status across teams."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active cycles" value={String((reviews.data ?? []).length)} icon={ChartBar} />
        <StatCard label="In progress" value={String(inProgress)} tone="info" />
        <StatCard label="Closed" value={String(closed)} tone="success" />
      </div>

      {reviews.isLoading ? (
        <TableSkeleton />
      ) : reviews.isError ? (
        <ErrorState onRetry={() => reviews.refetch()} />
      ) : (reviews.data ?? []).length === 0 ? (
        <EmptyState
          title="No review cycles"
          description="Performance cycles will appear once HR launches a review period."
          icon={ChartBar}
        />
      ) : (
        <DataTable columns={columns} data={reviews.data ?? []} rowKey={(row) => row.id} />
      )}
    </AppLayout>
  );
}
