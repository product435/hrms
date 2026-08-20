import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AttendanceAreaChart } from "@/components/charts/AttendanceAreaChart";
import { Button } from "@/components/ui/button";
import { attendanceService } from "@/services/attendanceService";
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import type { AttendanceRecord } from "@/types";

export const Route = createFileRoute("/attendance")({
  beforeLoad: () => requireAuthForPath("/attendance"),
  head: () => ({
    meta: [
      { title: "Attendance & time tracking · Kinetix" },
      {
        name: "description",
        content:
          "Daily attendance log with check-in and check-out times, worked hours, overtime, WFH and correction requests.",
      },
      { property: "og:title", content: "Attendance · Kinetix" },
      {
        property: "og:description",
        content: "Track check-ins, worked hours, overtime and attendance corrections.",
      },
    ],
  }),
  component: AttendancePage,
});

function AttendancePage() {
  const { role, user } = useSession();
  const isSelfService = role === "employee";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const scope = isSelfService ? { employeeId: user.id } : {};
  const records = useQuery({
    queryKey: ["attendance", scope, search, status],
    queryFn: () => attendanceService.list({ ...scope, search, status }),
  });
  const trend = useQuery({ queryKey: ["attendance-trend"], queryFn: () => attendanceService.weeklyTrend() });
  const corrections = useQuery({ queryKey: ["corrections"], queryFn: () => attendanceService.corrections() });
  const today = useQuery({
    queryKey: ["attendance-today", user.id],
    queryFn: () => attendanceService.today(user.id),
  });

  const punch = useMutation({
    mutationFn: (kind: "in" | "out") =>
      kind === "in" ? attendanceService.checkIn(user.id) : attendanceService.checkOut(user.id),
    onSuccess: (_data, kind) => {
      toast.success(kind === "in" ? "Checked in" : "Checked out", {
        description: "Recorded through the web client.",
      });
      queryClient.invalidateQueries({ queryKey: ["attendance-today", user.id] });
    },
    onError: (error) => toast.error("Could not record your punch", { description: error instanceof Error ? error.message : "Try again." }),
  });

  const columns = useMemo<Column<AttendanceRecord>[]>(
    () => [
      { key: "date", header: "Date", cell: (row) => <span className="text-sm">{shortDate(row.date)}</span> },
      ...(isSelfService
        ? []
        : [
            {
              key: "employee",
              header: "Employee",
              cell: (row: AttendanceRecord) => (
                <span className="text-sm font-medium">{row.employeeName}</span>
              ),
            },
          ]),
      { key: "in", header: "Check in", cell: (row) => <span className="text-sm">{row.checkIn ?? "—"}</span> },
      { key: "out", header: "Check out", cell: (row) => <span className="text-sm">{row.checkOut ?? "—"}</span> },
      {
        key: "hours",
        header: "Worked",
        align: "right",
        cell: (row) => <span className="text-sm">{row.workedHours}h</span>,
      },
      {
        key: "ot",
        header: "Overtime",
        align: "right",
        cell: (row) => <span className="text-sm">{row.overtimeHours}h</span>,
      },
      { key: "shift", header: "Shift", cell: (row) => <span className="text-sm">{row.shift}</span> },
      { key: "source", header: "Source", cell: (row) => <span className="text-sm capitalize">{row.source}</span> },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    ],
    [isSelfService],
  );

  const present = (records.data ?? []).filter((r) => r.status === "present").length;
  const late = (records.data ?? []).filter((r) => r.status === "late").length;
  const wfh = (records.data ?? []).filter((r) => r.status === "wfh").length;
  const absent = (records.data ?? []).filter((r) => r.status === "absent").length;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time & attendance"
        title={isSelfService ? "My attendance" : "Attendance log"}
        description={
          isSelfService
            ? "Your daily punches, worked hours and correction requests."
            : "Company-wide attendance with shift, source and overtime detail."
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => punch.mutate("in")}
              disabled={punch.isPending}
            >
              <LogIn className="size-4" /> Check in
            </Button>
            <Button onClick={() => punch.mutate("out")} disabled={punch.isPending}>
              <LogOut className="size-4" /> Check out
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Present" value={String(present)} icon={Clock} tone="success" hint="in current view" />
        <StatCard label="Late" value={String(late)} icon={Clock} tone="warning" hint="grace exceeded" />
        <StatCard label="Work from home" value={String(wfh)} icon={Clock} tone="info" hint="remote punches" />
        <StatCard label="Absent" value={String(absent)} icon={Clock} tone="destructive" hint="unapproved" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard title="Weekly pattern" description="Present vs WFH">
          {trend.data ? <AttendanceAreaChart data={trend.data} /> : <div className="h-[260px]" />}
        </SectionCard>
        <SectionCard
          title={isSelfService ? "Today" : "Correction requests"}
          description={isSelfService ? "Your punch status" : "Awaiting review"}
          bodyClassName="p-0"
        >
          {isSelfService ? (
            <div className="space-y-3 p-5 text-sm">
              <p className="text-muted-foreground">Status</p>
              <StatusBadge status={today.data?.status ?? "week-off"} />
              <p className="text-muted-foreground">
                In {today.data?.checkIn ?? "—"} · Out {today.data?.checkOut ?? "—"}
              </p>
              <p className="text-muted-foreground">Shift {today.data?.shift ?? "—"}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(corrections.data ?? []).map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.employeeName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {shortDate(item.date)} · {item.reason}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
              {corrections.data?.length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No correction requests.
                </li>
              ) : null}
            </ul>
          )}
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={records.data}
        rowKey={(row) => row.id}
        isLoading={records.isLoading}
        isError={records.isError}
        onRetry={() => records.refetch()}
        emptyTitle="No attendance records"
        emptyDescription="Punches will appear here once recorded."
        caption={`${records.data?.length ?? 0} records`}
        toolbar={
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by employee or shift…"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { value: "all", label: "All status" },
                  { value: "present", label: "Present" },
                  { value: "late", label: "Late" },
                  { value: "wfh", label: "Work from home" },
                  { value: "half-day", label: "Half day" },
                  { value: "leave", label: "Leave" },
                  { value: "absent", label: "Absent" },
                ],
              },
            ]}
          />
        }
      />
    </AppLayout>
  );
}
