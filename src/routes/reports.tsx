import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { CardsSkeleton, ErrorState } from "@/components/common/States";
import { AttendanceAreaChart } from "@/components/charts/AttendanceAreaChart";
import { DistributionDonut } from "@/components/charts/DistributionDonut";
import { HeadcountBarChart } from "@/components/charts/HeadcountBarChart";
import { requireAuthForPath } from "@/lib/auth-guard";
import { compactInr, percent } from "@/lib/format";
import { insightsService } from "@/services/insightsService";

export const Route = createFileRoute("/reports")({
  beforeLoad: () => requireAuthForPath("/reports"),
  head: () => ({
    meta: [{ title: "Reports & analytics · JeeVijay HRMS" }],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const summary = useQuery({ queryKey: ["company-summary"], queryFn: () => insightsService.companySummary() });
  const attendanceTrend = useQuery({
    queryKey: ["attendance-trend"],
    queryFn: () => insightsService.attendanceTrend(),
  });
  const headcountTrend = useQuery({
    queryKey: ["headcount-trend"],
    queryFn: () => insightsService.headcountTrend(),
  });
  const departments = useQuery({
    queryKey: ["department-distribution"],
    queryFn: () => insightsService.departmentDistribution(),
  });
  const leaveMix = useQuery({ queryKey: ["leave-mix"], queryFn: () => insightsService.leaveMix() });

  const loading =
    summary.isLoading ||
    attendanceTrend.isLoading ||
    headcountTrend.isLoading ||
    departments.isLoading ||
    leaveMix.isLoading;

  const failed =
    summary.isError ||
    attendanceTrend.isError ||
    headcountTrend.isError ||
    departments.isError ||
    leaveMix.isError;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Administration"
        title="Reports & analytics"
        description="Workforce trends, department distribution, leave mix and payroll snapshots."
      />

      {loading ? (
        <CardsSkeleton count={4} />
      ) : failed ? (
        <ErrorState
          onRetry={() => {
            summary.refetch();
            attendanceTrend.refetch();
            headcountTrend.refetch();
            departments.refetch();
            leaveMix.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Headcount" value={String(summary.data?.headcount ?? 0)} icon={Users} />
            <StatCard
              label="Attrition"
              value={summary.data?.attritionRate != null ? percent(summary.data.attritionRate) : "N/A"}
              tone="warning"
              {...(summary.data?.attritionRate == null
                ? { hint: "Requires an exit-date field not in the current schema" }
                : {})}
            />
            <StatCard label="Open positions" value={String(summary.data?.openPositions ?? 0)} />
            <StatCard label="Payroll net" value={compactInr(summary.data?.payrollNet ?? 0)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Attendance trend" description="Daily presence over the last two weeks." bodyClassName="p-4">
              <AttendanceAreaChart data={attendanceTrend.data ?? []} />
            </SectionCard>
            <SectionCard title="Headcount movement" description="Joiners vs exits by month." bodyClassName="p-4">
              <HeadcountBarChart data={headcountTrend.data ?? []} />
            </SectionCard>
            <SectionCard title="Department distribution" description="Current headcount by department." bodyClassName="p-4">
              <DistributionDonut data={departments.data ?? []} />
            </SectionCard>
            <SectionCard title="Leave mix" description="Approved leave days by type." bodyClassName="p-4">
              <DistributionDonut data={leaveMix.data ?? []} />
            </SectionCard>
          </div>
        </>
      )}
    </AppLayout>
  );
}
