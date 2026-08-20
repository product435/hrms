import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireAuthForPath } from "@/lib/auth-guard";
import { percent, shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { talentService } from "@/services/talentService";
import type { Goal } from "@/types";

export const Route = createFileRoute("/goals")({
  beforeLoad: () => requireAuthForPath("/goals"),
  head: () => ({
    meta: [{ title: "Goals · Kinetix" }],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const goals = useQuery({
    queryKey: ["goals", isSelfService ? user?.name : "all", search, status],
    queryFn: () =>
      isSelfService && user?.name
        ? talentService.goalsOf(user.name)
        : talentService.goals({ search, status }),
  });

  const atRisk = (goals.data ?? []).filter((goal) => goal.status === "at-risk" || goal.status === "delayed").length;

  const columns = useMemo<Column<Goal>[]>(
    () => [
      {
        key: "goal",
        header: "Goal",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.employeeName} · {row.category}
            </p>
          </div>
        ),
      },
      {
        key: "progress",
        header: "Progress",
        cell: (row) => (
          <div className="min-w-[140px] space-y-1">
            <div className="flex justify-between text-xs">
              <span>{percent(row.progress)}</span>
              <span className="text-muted-foreground">Weight {row.weight}%</span>
            </div>
            <Progress value={row.progress} className="h-1.5" />
          </div>
        ),
      },
      {
        key: "due",
        header: "Due",
        cell: (row) => shortDate(row.dueDate),
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  const visible = goals.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isSelfService ? "My goals" : "Goals & OKRs"}
        description="Track objectives, weights and completion across the organisation."
        actions={
          <Button>
            <Plus className="size-4" /> Add goal
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active goals" value={String(visible.length)} icon={Target} />
        <StatCard label="At risk / delayed" value={String(atRisk)} tone={atRisk > 0 ? "warning" : "neutral"} />
      </div>

      {!isSelfService ? (
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search goals by title, employee or category…"
          status={status}
          onStatusChange={setStatus}
          statusOptions={[
                  { value: "all", label: "All status" },
            { value: "on-track", label: "On track" },
            { value: "at-risk", label: "At risk" },
            { value: "delayed", label: "Delayed" },
            { value: "completed", label: "Completed" },
          ]}
        />
      ) : null}

      {goals.isLoading ? (
        <TableSkeleton />
      ) : goals.isError ? (
        <ErrorState onRetry={() => goals.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title="No goals yet" description="Goals assigned to you will show up here." icon={Target} />
      ) : (
        <DataTable columns={columns} data={visible} rowKey={(row) => row.id} />
      )}
    </AppLayout>
  );
}
