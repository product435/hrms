import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Download, Home, LogIn, LogOut, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { InfoHint } from "@/components/common/InfoHint";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AttendanceAreaChart } from "@/components/charts/AttendanceAreaChart";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attendanceService } from "@/services/attendanceService";
import { usePermissions } from "@/hooks/usePermissions";
import { requireAuthForPath } from "@/lib/auth-guard";
import { indiaDateKey, indiaLocalDateTimeToUtcIso, indianTime, shortDate } from "@/lib/format";
import type { AttendanceRecord } from "@/types";
import type { TeamAttendanceRow } from "@/types/attendance";

const ATTENDANCE_STATUS_HELP = (
  <div className="space-y-1">
    <p>Present: checked in within the shift grace period.</p>
    <p>Late: check-in after that grace period.</p>
    <p>
      Half-day: worked hours are below the half-day threshold (4 hours, unless the organisation
      changed it).
    </p>
    <p>Work from home: the day is remote. Check-in and check-out are still required.</p>
    <p>Leave, holiday, and week-off: you are not expected to punch in.</p>
    <p>Absent: no approved attendance on a working day.</p>
    <p>
      Comp-off-eligible: you worked a week-off or a mandatory holiday, so the day is flagged for
      compensatory off.
    </p>
  </div>
);

const REGULARIZATION_HELP =
  "If a check-in or check-out is wrong or missing, request the correct time and a reason. A team lead, department head, HR, or an admin approves it. On approval the attendance row is updated and the hours are recalculated. The limit is 3 requests a month. HR and admin can go beyond that limit.";

function AttendanceStatusHint() {
  return <InfoHint label="About attendance statuses">{ATTENDANCE_STATUS_HELP}</InfoHint>;
}

export const Route = createFileRoute("/attendance")({
  beforeLoad: () => requireAuthForPath("/attendance"),
  head: () => ({
    meta: [
      { title: "Attendance & time tracking · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Daily attendance log with check-in and check-out times, worked hours, overtime, WFH and correction requests.",
      },
      { property: "og:title", content: "Attendance · JeeVijay HRMS" },
      {
        property: "og:description",
        content: "Track check-ins, worked hours, overtime and attendance corrections.",
      },
    ],
  }),
  component: AttendancePage,
});

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Try again.";
}

function nextDateKey(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const next = new Date(
    Date.UTC(
      Number.isFinite(year) ? year : 1970,
      (Number.isFinite(month) ? month : 1) - 1,
      (Number.isFinite(day) ? day : 1) + 1,
      12,
    ),
  );
  return next.toISOString().slice(0, 10);
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function AttendancePage() {
  const { role, user, isEmployee, isLead, isHr, isSuperAdmin } = usePermissions();
  const isSelfService = role === "employee";
  const canReview = (isLead || isHr || isSuperAdmin) && !isEmployee;
  const canExport = isHr || isSuperAdmin;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [month, setMonth] = useState(() => indiaDateKey().slice(0, 7));
  const [boardDate, setBoardDate] = useState(() => indiaDateKey());
  const [wfhOpen, setWfhOpen] = useState(false);
  const [wfhReason, setWfhReason] = useState("");
  const [regularizeOpen, setRegularizeOpen] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayOptional, setHolidayOptional] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({
    attendanceId: "",
    checkIn: "",
    checkOut: "",
    reason: "",
  });

  const employeeKey = user.employeeId ?? user.id;
  const scope = isSelfService ? { employeeId: employeeKey } : {};
  const records = useQuery({
    queryKey: ["attendance", scope, search, status],
    queryFn: () => attendanceService.list({ ...scope, search, status }),
  });
  const trend = useQuery({
    queryKey: ["attendance-trend", isSelfService ? employeeKey : "all"],
    queryFn: () => attendanceService.weeklyTrend(isSelfService ? employeeKey : undefined),
  });
  const corrections = useQuery({
    queryKey: ["corrections"],
    queryFn: () => attendanceService.corrections(),
  });
  const today = useQuery({
    queryKey: ["attendance-today", employeeKey],
    queryFn: () => attendanceService.today(employeeKey),
  });
  const calendar = useQuery({
    queryKey: ["attendance-calendar", employeeKey, month],
    queryFn: () => attendanceService.calendar(employeeKey, month),
  });
  const policy = useQuery({
    queryKey: ["attendance-policy"],
    queryFn: () => attendanceService.policy(),
  });
  const ownRecords = useQuery({
    queryKey: ["attendance-own", employeeKey],
    queryFn: () => attendanceService.list({ employeeId: employeeKey }),
    enabled: !isSelfService,
  });
  const team = useQuery({
    queryKey: ["attendance-team", boardDate],
    queryFn: () => attendanceService.teamBoard(boardDate),
    enabled: canReview,
  });
  const holidays = useQuery({
    queryKey: ["holidays"],
    queryFn: () => attendanceService.holidays(),
    enabled: canExport,
  });

  const refreshAttendance = () => {
    void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["attendance-today", employeeKey] });
    void queryClient.invalidateQueries({ queryKey: ["attendance-calendar", employeeKey] });
    void queryClient.invalidateQueries({ queryKey: ["attendance-team"] });
    void queryClient.invalidateQueries({ queryKey: ["attendance-own", employeeKey] });
  };

  const punch = useMutation({
    mutationFn: (kind: "in" | "out") =>
      kind === "in"
        ? attendanceService.checkIn(employeeKey)
        : attendanceService.checkOut(employeeKey),
    onSuccess: (_data, kind) => {
      toast.success(kind === "in" ? "Checked in" : "Checked out", {
        description: "Recorded through the web client.",
      });
      refreshAttendance();
    },
    onError: (error) =>
      toast.error("Could not record your punch", { description: messageOf(error) }),
  });

  const wfh = useMutation({
    mutationFn: () => attendanceService.requestWfh(employeeKey, wfhReason),
    onSuccess: () => {
      toast.success("Work from home recorded", {
        description: "You still need to check in and check out.",
      });
      setWfhOpen(false);
      setWfhReason("");
      refreshAttendance();
    },
    onError: (error) =>
      toast.error("Could not record work from home", { description: messageOf(error) }),
  });

  const regularize = useMutation({
    mutationFn: () => {
      const rows = isSelfService ? (records.data ?? []) : (ownRecords.data ?? []);
      const row = rows.find((item) => item.id === correctionForm.attendanceId);
      if (!row) throw new Error("Select the attendance day to regularize.");
      const checkOutDate =
        correctionForm.checkOut &&
        correctionForm.checkIn &&
        correctionForm.checkOut <= correctionForm.checkIn
          ? nextDateKey(row.date)
          : row.date;
      return attendanceService.requestCorrection({
        employeeId: employeeKey,
        attendanceId: row.id,
        ...(correctionForm.checkIn
          ? { requestedCheckIn: indiaLocalDateTimeToUtcIso(row.date, correctionForm.checkIn) }
          : {}),
        ...(correctionForm.checkOut
          ? {
              requestedCheckOut: indiaLocalDateTimeToUtcIso(checkOutDate, correctionForm.checkOut),
            }
          : {}),
        reason: correctionForm.reason,
      });
    },
    onSuccess: () => {
      toast.success("Regularization requested");
      setRegularizeOpen(false);
      setCorrectionForm({ attendanceId: "", checkIn: "", checkOut: "", reason: "" });
      void queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (error) =>
      toast.error("Could not submit regularization", { description: messageOf(error) }),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected" }) =>
      attendanceService.decideCorrection(input.id, input.decision),
    onSuccess: (_data, input) => {
      toast.success(
        input.decision === "approved" ? "Regularization approved" : "Regularization rejected",
      );
      void queryClient.invalidateQueries({ queryKey: ["corrections"] });
      refreshAttendance();
    },
    onError: (error) =>
      toast.error("Could not update the request", { description: messageOf(error) }),
  });

  const exportMuster = useMutation({
    mutationFn: () => attendanceService.musterCsv(month),
    onSuccess: (csv) => downloadCsv(`attendance-muster-${month}.csv`, csv),
    onError: (error) =>
      toast.error("Could not export the muster", { description: messageOf(error) }),
  });

  const saveHoliday = useMutation({
    mutationFn: () =>
      attendanceService.saveHoliday({
        date: holidayDate,
        name: holidayName,
        isOptional: holidayOptional,
      }),
    onSuccess: () => {
      toast.success("Holiday saved");
      setHolidayName("");
      setHolidayDate("");
      setHolidayOptional(false);
      void queryClient.invalidateQueries({ queryKey: ["holidays"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance-calendar"] });
    },
    onError: (error) =>
      toast.error("Could not save the holiday", { description: messageOf(error) }),
  });

  const removeHoliday = useMutation({
    mutationFn: (id: string) => attendanceService.deleteHoliday(id),
    onSuccess: () => {
      toast.success("Holiday removed");
      void queryClient.invalidateQueries({ queryKey: ["holidays"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance-calendar"] });
    },
    onError: (error) =>
      toast.error("Could not remove the holiday", { description: messageOf(error) }),
  });

  const pickerRows = isSelfService ? (records.data ?? []) : (ownRecords.data ?? []);

  const columns = useMemo<Column<AttendanceRecord>[]>(
    () => [
      {
        key: "date",
        header: "Date",
        cell: (row) => <span className="text-sm">{shortDate(row.date)}</span>,
      },
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
      {
        key: "in",
        header: "Check in",
        cell: (row) => <span className="text-sm">{indianTime(row.checkIn)}</span>,
      },
      {
        key: "out",
        header: "Check out",
        cell: (row) => <span className="text-sm">{indianTime(row.checkOut)}</span>,
      },
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
      {
        key: "shift",
        header: "Shift",
        cell: (row) => <span className="text-sm">{row.shift}</span>,
      },
      {
        key: "source",
        header: "Source",
        cell: (row) => <span className="text-sm capitalize">{row.source}</span>,
      },
      {
        key: "status",
        header: (
          <span className="inline-flex items-center gap-1">
            Status
            <AttendanceStatusHint />
          </span>
        ),
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            <StatusBadge status={row.status} />
            {row.note?.toLowerCase().includes("missed-checkout") ? (
              <StatusBadge status="missed-checkout" tone="warning" />
            ) : null}
            {row.note?.toLowerCase().includes("comp-off-eligible") ? (
              <StatusBadge status="comp-off" tone="info" />
            ) : null}
          </span>
        ),
      },
    ],
    [isSelfService],
  );

  const teamColumns = useMemo<Column<TeamAttendanceRow>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => <span className="text-sm font-medium">{row.employeeName}</span>,
      },
      {
        key: "code",
        header: "Code",
        cell: (row) => <span className="text-sm">{row.employeeCode || "—"}</span>,
      },
      {
        key: "shift",
        header: "Shift",
        cell: (row) => <span className="text-sm">{row.shift || "—"}</span>,
      },
      {
        key: "in",
        header: "Check in",
        cell: (row) => <span className="text-sm">{indianTime(row.checkIn)}</span>,
      },
      {
        key: "out",
        header: "Check out",
        cell: (row) => <span className="text-sm">{indianTime(row.checkOut)}</span>,
      },
      {
        key: "status",
        header: (
          <span className="inline-flex items-center gap-1">
            Status
            <AttendanceStatusHint />
          </span>
        ),
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  const present = (records.data ?? []).filter((row) => row.status === "present").length;
  const late = (records.data ?? []).filter((row) => row.status === "late").length;
  const wfhCount = (records.data ?? []).filter((row) => row.status === "wfh").length;
  const absent = (records.data ?? []).filter((row) => row.status === "absent").length;

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
            <Button variant="outline" onClick={() => setWfhOpen(true)}>
              <Home className="size-4" /> Work from home
            </Button>
            <span className="inline-flex items-center gap-1">
              <Button variant="outline" onClick={() => setRegularizeOpen(true)}>
                Request regularization
              </Button>
              <InfoHint label="About request regularization">{REGULARIZATION_HELP}</InfoHint>
            </span>
            {canExport ? (
              <Button
                variant="outline"
                onClick={() => exportMuster.mutate()}
                disabled={exportMuster.isPending}
              >
                <Download className="size-4" /> Muster CSV
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => punch.mutate("in")}
              disabled={punch.isPending || Boolean(today.data?.checkIn)}
            >
              <LogIn className="size-4" /> Check in
            </Button>
            <Button
              onClick={() => punch.mutate("out")}
              disabled={punch.isPending || !today.data?.checkIn || Boolean(today.data?.checkOut)}
            >
              <LogOut className="size-4" /> Check out
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present"
          value={String(present)}
          icon={Clock}
          tone="success"
          hint="in current view"
        />
        <StatCard
          label="Late"
          value={String(late)}
          icon={Clock}
          tone="warning"
          hint="grace exceeded"
        />
        <StatCard
          label="Work from home"
          value={String(wfhCount)}
          icon={Clock}
          tone="info"
          hint="remote punches"
        />
        <StatCard
          label="Absent"
          value={String(absent)}
          icon={Clock}
          tone="destructive"
          hint="unapproved"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard title="Weekly pattern" description="Present vs WFH">
          {trend.data ? <AttendanceAreaChart data={trend.data} /> : <div className="h-65" />}
        </SectionCard>
        <SectionCard
          title={isSelfService ? "Today" : "Correction requests"}
          description={isSelfService ? "Your punch status" : "Awaiting review"}
          bodyClassName="p-0"
        >
          {isSelfService ? (
            <div className="space-y-3 p-5 text-sm">
              <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                Status
                <AttendanceStatusHint />
              </p>
              <StatusBadge status={today.data?.status ?? "week-off"} />
              <p className="text-muted-foreground">
                {today.data?.date
                  ? shortDate(today.data.date)
                  : "No punch for the current shift yet."}
              </p>
              <p className="text-muted-foreground">
                In {indianTime(today.data?.checkIn)} · Out {indianTime(today.data?.checkOut)}
              </p>
              <p className="text-muted-foreground">Shift {today.data?.shift || "—"}</p>
            </div>
          ) : (
            <CorrectionList
              items={corrections.data ?? []}
              canReview={canReview}
              selfId={employeeKey}
              pending={decide.isPending}
              onDecide={(id, decision) => decide.mutate({ id, decision })}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={
          <span className="inline-flex items-center gap-1.5">
            Month
            <AttendanceStatusHint />
          </span>
        }
        description="Present, late, half-day, leave, holiday, week-off and absent."
      >
        {calendar.isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : (
          <AttendanceCalendar month={month} days={calendar.data ?? []} onMonthChange={setMonth} />
        )}
      </SectionCard>

      {isSelfService ? (
        <SectionCard
          title="My regularization"
          description="Pending and past requests"
          bodyClassName="p-0"
        >
          <CorrectionList
            items={corrections.data ?? []}
            canReview={false}
            selfId={employeeKey}
            pending={false}
            onDecide={() => undefined}
          />
        </SectionCard>
      ) : null}

      {canReview ? (
        <SectionCard
          title="Team attendance"
          description="People you can view, for the selected day."
          action={
            <Input
              type="date"
              value={boardDate}
              onChange={(event) => setBoardDate(event.target.value)}
              className="w-40"
            />
          }
        >
          <DataTable
            columns={teamColumns}
            rows={team.data}
            rowKey={(row) => row.employeeId}
            isLoading={team.isLoading}
            isError={team.isError}
            onRetry={() => team.refetch()}
            emptyTitle="No team attendance"
            emptyDescription="People in your scope will appear here."
            caption={`${team.data?.length ?? 0} people`}
          />
        </SectionCard>
      ) : null}

      {canExport ? (
        <SectionCard
          title="Holidays"
          description="Mandatory holidays skip absent marking. Optional holidays do not."
        >
          <form
            className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              saveHoliday.mutate();
            }}
          >
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={holidayDate}
                onChange={(event) => setHolidayDate(event.target.value)}
                required
              />
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={holidayName}
                onChange={(event) => setHolidayName(event.target.value)}
                required
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={holidayOptional}
                onChange={(event) => setHolidayOptional(event.target.checked)}
              />
              Optional
            </label>
            <Button type="submit" disabled={saveHoliday.isPending}>
              {saveHoliday.isPending ? "Saving…" : "Add holiday"}
            </Button>
          </form>
          <ul className="divide-y divide-border">
            {(holidays.data ?? []).map((holiday) => (
              <li key={holiday.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-28 text-muted-foreground">{shortDate(holiday.date)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{holiday.name}</span>
                {holiday.isOptional ? <StatusBadge status="optional" /> : null}
                <IconAction
                  label="Remove"
                  variant="ghost"
                  onClick={() => removeHoliday.mutate(holiday.id)}
                >
                  <Trash2 />
                </IconAction>
              </li>
            ))}
            {holidays.data?.length === 0 ? (
              <li className="py-4 text-sm text-muted-foreground">No holidays yet.</li>
            ) : null}
          </ul>
        </SectionCard>
      ) : null}

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

      <Dialog open={wfhOpen} onOpenChange={setWfhOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Work from home</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This marks the shift day as WFH. Check in and check out are still required.
          </p>
          <div>
            <Label>Reason</Label>
            <Textarea value={wfhReason} onChange={(event) => setWfhReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWfhOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => wfh.mutate()} disabled={wfh.isPending}>
              {wfh.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regularizeOpen} onOpenChange={setRegularizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request regularization</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Up to {policy.data?.regularizationMonthlyLimit ?? 3} requests per month. HR or an admin
            can approve beyond that limit.
          </p>
          <div className="grid gap-3">
            <div>
              <Label>Day</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={correctionForm.attendanceId}
                onChange={(event) =>
                  setCorrectionForm({ ...correctionForm, attendanceId: event.target.value })
                }
              >
                <option value="">Select a punch day</option>
                {pickerRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {shortDate(row.date)} · {row.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Requested check in</Label>
                <Input
                  type="time"
                  value={correctionForm.checkIn}
                  onChange={(event) =>
                    setCorrectionForm({ ...correctionForm, checkIn: event.target.value })
                  }
                />
              </div>
              <div>
                <Label>Requested check out</Label>
                <Input
                  type="time"
                  value={correctionForm.checkOut}
                  onChange={(event) =>
                    setCorrectionForm({ ...correctionForm, checkOut: event.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea
                value={correctionForm.reason}
                onChange={(event) =>
                  setCorrectionForm({ ...correctionForm, reason: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegularizeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => regularize.mutate()} disabled={regularize.isPending}>
              {regularize.isPending ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function CorrectionList({
  items,
  canReview,
  selfId,
  pending,
  onDecide,
}: {
  items: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    date: string;
    reason: string;
    status: string;
  }>;
  canReview: boolean;
  selfId: string;
  pending: boolean;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{item.employeeName || "You"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {shortDate(item.date)} · {item.reason}
            </p>
          </div>
          {canReview && item.status === "pending" && item.employeeId !== selfId ? (
            <span className="flex gap-1">
              <IconAction
                label="Reject"
                variant="outline"
                disabled={pending}
                onClick={() => onDecide(item.id, "rejected")}
              >
                <X />
              </IconAction>
              <IconAction
                label="Approve"
                variant="default"
                disabled={pending}
                onClick={() => onDecide(item.id, "approved")}
              >
                <Check />
              </IconAction>
            </span>
          ) : (
            <StatusBadge status={item.status} />
          )}
        </li>
      ))}
      {items.length === 0 ? (
        <li className="px-5 py-8 text-center text-sm text-muted-foreground">
          No correction requests.
        </li>
      ) : null}
    </ul>
  );
}
