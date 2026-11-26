import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Check, Eye, ListChecks, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { IconAction } from "@/components/common/IconAction";
import { InfoHint } from "@/components/common/InfoHint";
import { AppLayout } from "@/components/layout/AppLayout";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text";
import { WorkReportDetailDialog } from "@/components/work/WorkReportDetail";
import { usePermissions } from "@/hooks/usePermissions";
import { requireAuthForPath } from "@/lib/auth-guard";
import {
  claimPasteBlockNotice,
  descriptionsLookAi,
  DWR_AI_DESCRIPTION_MESSAGE,
  DWR_PASTE_BLOCKED_MESSAGE,
  isBlockedDescriptionInputType,
} from "@/lib/dwr-ai-guard";
import { indiaDateKey, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workService } from "@/services/workService";
import type {
  DailyWorkReport,
  DwrItemStatus,
  DwrStatus,
  TaskPriority,
  TaskStatus,
  WorkTask,
} from "@/types/work";

export const Route = createFileRoute("/work")({
  beforeLoad: () => requireAuthForPath("/work"),
  head: () => ({ meta: [{ title: "Work · JeeVijay HRMS" }] }),
  component: WorkPage,
});

const itemStatuses = ["todo", "in-progress", "blocked", "done"] as const;
const priorities = ["low", "medium", "high", "urgent"] as const;

/** Strips tags for an emptiness check only -- never used to store or render content. */
function stripHtmlForEmptinessCheck(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

const reportSchema = z
  .object({
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    blockers: z.string().max(2000),
    planForTomorrow: z.string().max(2000),
    summaryHtml: z.string().max(20000),
    linkTasks: z.boolean(),
    items: z
      .array(
        z.object({
          taskId: z.string(),
          description: z.string().trim().min(1, "Describe the work."),
          hours: z.coerce
            .number()
            .finite("Enter hours as a number.")
            .min(0, "Hours cannot be negative.")
            .max(24, "Hours cannot exceed 24."),
          itemStatus: z.enum(itemStatuses),
          isUnplanned: z.boolean(),
        }),
      )
      .min(1, "Add at least one line."),
  })
  .superRefine((value, ctx) => {
    if (stripHtmlForEmptinessCheck(value.summaryHtml) === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Day summary is required.",
        path: ["summaryHtml"],
      });
    }
    if (!value.linkTasks) return;
    value.items.forEach((item, index) => {
      if (!item.taskId && !item.isUnplanned) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose an assigned task, or mark the line as unplanned work.",
          path: ["items", index, "taskId"],
        });
      }
    });
  });

type ReportFormValues = z.infer<typeof reportSchema>;

const summarySchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  departmentId: z.string(),
  summary: z.string().trim().min(1, "Write the team conclusion."),
  highlights: z.string().max(2000),
  risks: z.string().max(2000),
});

type SummaryFormValues = z.infer<typeof summarySchema>;

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Request failed.";
}

function emptyItem(): ReportFormValues["items"][number] {
  return { taskId: "", description: "", hours: 1, itemStatus: "done", isUnplanned: false };
}

const DWR_STATUS_DOT: Record<DwrStatus, string> = {
  draft: "bg-muted-foreground",
  submitted: "bg-success",
  late: "bg-warning",
  missed: "bg-destructive",
};

const DWR_STATUS_MODIFIER_CLASSNAMES: Record<DwrStatus, string> = {
  draft:
    "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-muted-foreground after:content-['']",
  submitted:
    "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-success after:content-['']",
  late:
    "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-warning after:content-['']",
  missed:
    "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-destructive after:content-['']",
};

/** Shared by both the left-side date picker and the right-side calendar. */
function useReportStatusByDate(reports: DailyWorkReport[], me: string) {
  return useMemo(() => {
    const map = new Map<string, DwrStatus>();
    for (const report of reports) {
      if (report.employeeId === me) map.set(report.reportDate, report.status);
    }
    return map;
  }, [reports, me]);
}

function reportStatusModifiers(byDate: Map<string, DwrStatus>) {
  return {
    draft: (date: Date) => byDate.get(indiaDateKey(date)) === "draft",
    submitted: (date: Date) => byDate.get(indiaDateKey(date)) === "submitted",
    late: (date: Date) => byDate.get(indiaDateKey(date)) === "late",
    missed: (date: Date) => byDate.get(indiaDateKey(date)) === "missed",
  };
}

function ReportStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" /> Submitted
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-warning" /> Late
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-destructive" /> Missed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-muted-foreground" /> Draft
      </span>
    </div>
  );
}

/**
 * Calendar-based date selector for the end-of-day report (requirement 4),
 * replacing the long vertical "My reports" list. Also the only way the
 * report date changes now (requirement 1's fix): a calendar day click
 * always commits one complete, valid date, unlike a free-typed
 * <input type="date">, whose browser-cleared "" on an out-of-range manual
 * entry was wiping the whole form through the load effect in
 * ReportsPanel. Future dates are disabled outright; a past date with no
 * existing report is selectable (so its "no report yet" state is visible
 * before deciding to look elsewhere) but ReportsPanel's own date-based
 * restriction still prevents creating a NEW report there -- this
 * component only controls which date is selected, not what you can save
 * for it.
 */
function ReportDatePicker({
  value,
  today,
  onSelect,
  reports,
  me,
}: {
  value: string;
  today: string;
  onSelect: (date: string) => void;
  reports: DailyWorkReport[];
  me: string;
}) {
  const [open, setOpen] = useState(false);
  const byDate = useMemo(() => {
    const map = new Map<string, DwrStatus>();
    for (const report of reports) {
      if (report.employeeId === me) map.set(report.reportDate, report.status);
    }
    return map;
  }, [reports, me]);

  const selectedDate = new Date(`${value}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id="report-date"
          className="w-fit justify-start gap-2 font-normal"
        >
          <CalendarIcon className="size-4" />
          {shortDate(value)}
          {byDate.has(value) ? (
            <span className={cn("ml-auto size-2 rounded-full", DWR_STATUS_DOT[byDate.get(value)!])} />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-xl p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selectedDate}
          defaultMonth={selectedDate}
          // Only today is writable/selectable here -- a new report can
          // only be created/submitted for today, and an existing past
          // report opens read-only from the right-side list instead, not
          // through this picker.
          disabled={(date) => indiaDateKey(date) !== today}
          onSelect={(date) => {
            if (!date) return;
            onSelect(indiaDateKey(date));
            setOpen(false);
          }}
          modifiers={{
            draft: (date) => byDate.get(indiaDateKey(date)) === "draft",
            submitted: (date) => byDate.get(indiaDateKey(date)) === "submitted",
            late: (date) => byDate.get(indiaDateKey(date)) === "late",
            missed: (date) => byDate.get(indiaDateKey(date)) === "missed",
          }}
          modifiersClassNames={{
            draft: "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-muted-foreground after:content-['']",
            submitted: "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-success after:content-['']",
            late: "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-warning after:content-['']",
            missed: "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-destructive after:content-['']",
          }}
          classNames={{
            day: "p-0.5",
            // Only today is enabled here, so "disabled" below means every
            // other, non-today date -- keep it clearly readable (not
            // faded/low-contrast) rather than the base calendar's default
            // opacity-50, while today and the selected day stay visibly
            // highlighted via the base component's own today/selected styles.
            disabled: "text-foreground/70 opacity-100",
          }}
        />
        <div className="flex items-center gap-3 rounded-b-xl border-t bg-muted/40 px-3 py-2.5 text-xs text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" /> Submitted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" /> Late
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" /> Missed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground" /> Draft
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Always-visible month/year calendar for the RIGHT-SIDE "Recent reports"
 * section, shown above its existing list -- separate from, and does not
 * touch, the left-side ReportDatePicker (which stays exactly as it is,
 * inside its own popover, driving the form). Selecting a date here sets
 * the same reportDate, which the existing load-into-form effect already
 * resolves into the left-side form.
 */
function RecentReportsCalendar({
  value,
  today,
  onSelectDate,
  reports,
  me,
}: {
  value: string;
  today: string;
  /** Today's date -> load into the editable form; a past date -> open read-only. */
  onSelectDate: (date: string) => void;
  reports: DailyWorkReport[];
  me: string;
}) {
  const [open, setOpen] = useState(false);
  const byDate = useReportStatusByDate(reports, me);
  const selectedDate = new Date(`${value}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-fit justify-start gap-2 font-normal">
          <CalendarIcon className="size-4" />
          {shortDate(value)}
          {byDate.has(value) ? (
            <span className={cn("ml-auto size-2 rounded-full", DWR_STATUS_DOT[byDate.get(value)!])} />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-xl p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={selectedDate}
          defaultMonth={selectedDate}
          disabled={{ after: todayDate }}
          onSelect={(date) => {
            if (!date) return;
            onSelectDate(indiaDateKey(date));
            setOpen(false);
          }}
          modifiers={reportStatusModifiers(byDate)}
          modifiersClassNames={DWR_STATUS_MODIFIER_CLASSNAMES}
          classNames={{
            day: "p-0.5",
            // Only future dates are disabled here -- every past date stays
            // clickable (opens read-only) and must read clearly, not faded.
            disabled: "text-foreground/40",
          }}
        />
        <div className="rounded-b-xl border-t bg-muted/40 px-3 py-2.5">
          <ReportStatusLegend />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function rejectDescriptionInsert(event: { preventDefault: () => void }) {
  event.preventDefault();
  if (claimPasteBlockNotice()) toast.error(DWR_PASTE_BLOCKED_MESSAGE);
}

function rejectDescriptionBeforeInput(event: FormEvent<HTMLTextAreaElement>) {
  const native = event.nativeEvent;
  if (!(native instanceof InputEvent) || !isBlockedDescriptionInputType(native.inputType)) return;
  rejectDescriptionInsert(event);
}

function rejectDescriptionDrop(event: DragEvent<HTMLTextAreaElement>) {
  rejectDescriptionInsert(event);
}

/** IST hour/minute "now," for the simple fixed-time submission-status subtitle below. */
function nowIstMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Submitted up to 8:00 PM IST, Late from 8:01 PM to 11:59 PM, Missed once
 * the report date itself is over -- a fixed, time-of-day rule, no longer
 * tied to each employee's own shift end (the old "window opens 30
 * minutes before your shift ends" model this replaces).
 */
function submissionTimingCopy(): string {
  const minutes = nowIstMinutes();
  if (minutes <= 20 * 60) return "Submit now and it will show as Submitted (by 8:00 PM IST).";
  return "It's past 8:00 PM IST -- submitting now will show as Late, not Missed.";
}

const REPORT_STATUS_HELP = (
  <div className="space-y-1">
    <p>Draft: saved, not submitted yet.</p>
    <p>Submitted: sent by 8:00 PM IST on the report date.</p>
    <p>Late: sent after 8:00 PM and by 11:59 PM IST on the report date.</p>
    <p>Missed: nothing was submitted by the end of the report date, including an unsubmitted draft.</p>
  </div>
);

const REVIEW_STATUS_HELP = (
  <div className="space-y-1">
    <p>Pending: waiting for a team lead, department head, HR, or an admin.</p>
    <p>Approved: accepted. An approved report can be reopened.</p>
    <p>Needs revision: sent back with remarks so it can be submitted again.</p>
    <p>
      Escalated: still unreviewed after 48 hours, or there is no manager, so it is with the
      department head. It is not a rejection.
    </p>
  </div>
);

function ReportStatusHint() {
  return <InfoHint label="About work report statuses">{REPORT_STATUS_HELP}</InfoHint>;
}

function ReviewStatusHint() {
  return <InfoHint label="About work report review statuses">{REVIEW_STATUS_HELP}</InfoHint>;
}

function WorkPage() {
  return (
    <AppLayout>
      <PageHeader
        eyebrow="Time & Attendance"
        title="Work"
        description="Assigned tasks, the end-of-day report, and the lead's review of the team."
      />
      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">My Tasks</TabsTrigger>
          <TabsTrigger value="reports">My Reports</TabsTrigger>
          <TabsTrigger value="team">Team Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="mt-4">
          <TasksPanel />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsPanel />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamPanel />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

function TasksPanel() {
  const { isLead, isHr, isSuperAdmin, user } = usePermissions();
  const canAssign = isLead || isHr || isSuperAdmin;
  const me = user.employeeId ?? "";
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["work", "tasks"], queryFn: () => workService.listTasks() });
  const [assignOpen, setAssignOpen] = useState(false);
  const [detail, setDetail] = useState<WorkTask | null>(null);

  const mine = (tasks.data ?? []).filter((task) => task.assignedTo === me);
  const assignedByMe = (tasks.data ?? []).filter(
    (task) => task.assignedBy === me && task.assignedTo !== me,
  );
  const rows = canAssign
    ? [...mine, ...assignedByMe.filter((task) => !mine.some((own) => own.id === task.id))]
    : mine;

  const status = useMutation({
    mutationFn: (vars: { id: string; status: TaskStatus }) =>
      workService.updateTaskStatus(vars.id, vars.status),
    onSuccess: () => {
      toast.success("Task status updated");
      void queryClient.invalidateQueries({ queryKey: ["work", "tasks"] });
    },
    onError: (error) => toast.error("Could not update the task", { description: messageOf(error) }),
  });

  const columns = useMemo<Column<WorkTask>[]>(
    () => [
      {
        key: "title",
        header: "Task",
        cell: (row) => (
          <button type="button" className="text-left" onClick={() => setDetail(row)}>
            <p className="text-sm font-semibold">{row.title}</p>
            <p className="text-xs text-muted-foreground">
              {row.projectName || "No project"} ·{" "}
              {row.assignedTo === me ? "Assigned to you" : row.assignedToName}
            </p>
          </button>
        ),
      },
      { key: "priority", header: "Priority", cell: (row) => <StatusBadge status={row.priority} /> },
      { key: "due", header: "Due", cell: (row) => shortDate(row.dueDate) },
      {
        key: "status",
        header: "Status",
        cell: (row) =>
          row.assignedTo === me ? (
            <Select
              value={row.status}
              onValueChange={(value) => status.mutate({ id: row.id, status: value as TaskStatus })}
            >
              <SelectTrigger className="h-8 w-35">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itemStatuses.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge status={row.status} />
          ),
      },
    ],
    [me, status],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canAssign ? (
          <Button onClick={() => setAssignOpen(true)}>
            <Plus className="size-4" /> Assign task
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading={tasks.isLoading}
        isError={tasks.isError}
        onRetry={() => void tasks.refetch()}
        emptyTitle="No tasks yet"
        emptyDescription={
          canAssign ? "Assign work to your team." : "Tasks assigned to you will show up here."
        }
      />
      <AssignTaskDialog open={assignOpen} onOpenChange={setAssignOpen} />
      <TaskDetailDialog task={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function AssignTaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = usePermissions();
  const people = useQuery({
    queryKey: ["work", "directory"],
    queryFn: () => workService.listDirectory(),
    enabled: open,
  });
  const projects = useQuery({
    queryKey: ["work", "projects"],
    queryFn: () => workService.listProjects(),
    enabled: open,
  });
  const [assignedTo, setAssignedTo] = useState("");
  const [projectId, setProjectId] = useState("");
  const [newProject, setNewProject] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [hours, setHours] = useState("");

  const assign = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("A title is required.");
      if (!assignedTo) throw new Error("Choose who will do this task.");
      let nextProject = projectId;
      if (newProject.trim()) {
        const created = await workService.createProject(newProject.trim());
        nextProject = created.id;
      }
      const rawHours = hours.trim();
      let estimatedHours: number | null = null;
      if (rawHours) {
        estimatedHours = Number(rawHours);
        if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
          throw new Error("Hours cannot be negative.");
        }
      }
      await workService.assignTask({
        assignedTo,
        ...(nextProject ? { projectId: nextProject } : {}),
        title,
        description,
        priority,
        dueDate,
        estimatedHours,
      });
    },
    onSuccess: () => {
      toast.success("Task assigned");
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setNewProject("");
      void queryClient.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (error) => toast.error("Could not assign the task", { description: messageOf(error) }),
  });

  const teammates = (people.data ?? []).filter((person) => person.id !== user.employeeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Teammate</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                {teammates.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select
                value={projectId || "none"}
                onValueChange={(value) => setProjectId(value === "none" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {(projects.data ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Or new project</Label>
              <Input
                value={newProject}
                onChange={(event) => setNewProject(event.target.value)}
                placeholder="Project name"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Estimated hours</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => assign.mutate()} disabled={assign.isPending}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailDialog({ task, onClose }: { task: WorkTask | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const comments = useQuery({
    queryKey: ["work", "comments", task?.id],
    queryFn: () => workService.listComments(task?.id ?? ""),
    enabled: Boolean(task?.id),
  });
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => {
      if (!task) throw new Error("Choose a task.");
      if (!body.trim()) throw new Error("Write a comment.");
      return workService.addComment(task.id, body);
    },
    onSuccess: () => {
      setBody("");
      toast.success("Comment added");
      void queryClient.invalidateQueries({ queryKey: ["work", "comments", task?.id] });
    },
    onError: (error) => toast.error("Could not add the comment", { description: messageOf(error) }),
  });

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task?.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{task?.description || "No description."}</p>
        <div className="space-y-2">
          {(comments.data ?? []).map((comment) => (
            <div key={comment.id} className="rounded-md border px-3 py-2">
              <p className="text-sm">{comment.body}</p>
              <p className="text-xs text-muted-foreground">{comment.authorName || "Teammate"}</p>
            </div>
          ))}
          {(comments.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : null}
        </div>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment"
        />
        <DialogFooter>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            Comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportsPanel() {
  const { user } = usePermissions();
  const me = user.employeeId ?? "";
  const queryClient = useQueryClient();
  const context = useQuery({
    queryKey: ["work", "context"],
    queryFn: () => workService.myContext(),
  });
  const tasks = useQuery({ queryKey: ["work", "tasks"], queryFn: () => workService.listTasks() });
  const reports = useQuery({
    queryKey: ["work", "reports"],
    queryFn: () => workService.listReports(),
  });
  const [viewing, setViewing] = useState<DailyWorkReport | null>(null);
  const [deleting, setDeleting] = useState<DailyWorkReport | null>(null);
  const today = indiaDateKey();
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      reportDate: today,
      blockers: "",
      planForTomorrow: "",
      summaryHtml: "",
      linkTasks: false,
      items: [emptyItem()],
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const reportDate = form.watch("reportDate");
  const openTasks = (tasks.data ?? []).filter(
    (task) =>
      task.assignedTo === me &&
      (task.status !== "done" ||
        (task.completedAt != null && indiaDateKey(task.completedAt) === reportDate)),
  );
  const existing = (reports.data ?? []).find(
    (report) => report.employeeId === me && report.reportDate === reportDate,
  );
  const locked = existing?.reviewStatus === "approved" || existing?.status === "missed";
  // A new report can only be created for today -- this blocks only the
  // Save/Submit actions for that specific dead-end case (no existing
  // report, a date that isn't today), never any input field. Editing an
  // existing report, at any date, is never affected.
  const invalidNewReportDate = !existing && reportDate !== today;
  useEffect(() => {
    form.setValue("linkTasks", openTasks.length > 0);
  }, [form, openTasks.length]);

  useEffect(() => {
    // Defensive: never reset the whole form over an incomplete/invalid
    // date. The calendar picker only ever commits one complete date, so
    // this should not fire in practice, but it keeps this effect from
    // ever wiping other fields if reportDate is transiently "" or malformed.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return;
    const saved = (reports.data ?? []).find(
      (report) => report.employeeId === me && report.reportDate === reportDate,
    );
    if (saved) {
      form.reset({
        reportDate: saved.reportDate,
        blockers: saved.blockers,
        planForTomorrow: saved.planForTomorrow,
        summaryHtml: saved.summaryHtml,
        linkTasks: openTasks.length > 0,
        items: saved.items.length
          ? saved.items.map((item) => ({
              taskId: item.taskId ?? "",
              description: item.description,
              hours: item.hours,
              itemStatus: item.itemStatus,
              isUnplanned: item.isUnplanned,
            }))
          : [emptyItem()],
      });
      return;
    }
    form.reset({
      reportDate,
      blockers: "",
      planForTomorrow: "",
      summaryHtml: "",
      linkTasks: openTasks.length > 0,
      items: [emptyItem()],
    });
    // Reset only when the selected day or its saved row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, reportDate]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["work", "reports"] });
    void queryClient.invalidateQueries({ queryKey: ["work", "checkout"] });
  };

  const save = useMutation({
    mutationFn: (values: ReportFormValues) => workService.saveDraft(toPayload(values)),
    onSuccess: () => {
      toast.success(
        existing && (existing.status === "submitted" || existing.status === "late")
          ? "Changes saved"
          : "Draft saved",
      );
      invalidate();
    },
    onError: (error) => toast.error("Could not save", { description: messageOf(error) }),
  });
  const deleteReport = useMutation({
    mutationFn: (reportId: string) => workService.deleteReport(reportId),
    onSuccess: () => {
      toast.success("Report deleted");
      setDeleting(null);
      invalidate();
    },
    onError: (error) =>
      toast.error("Could not delete the report", { description: messageOf(error) }),
  });
  const submit = useMutation({
    mutationFn: (values: ReportFormValues) => workService.submitReport(toPayload(values)),
    onSuccess: (result) => {
      toast.success(result.status === "late" ? "Report submitted late" : "Report submitted");
      invalidate();
    },
    onError: (error) =>
      toast.error("Could not submit the report", { description: messageOf(error) }),
  });

  const canSubmit = !locked;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <SectionCard
        title="End-of-day report"
        description={context.isError ? messageOf(context.error) : submissionTimingCopy()}
        action={
          existing ? (
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge status={existing.status} />
              <ReportStatusHint />
            </span>
          ) : null
        }
      >
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => {
            if (descriptionsLookAi(values.items.map((item) => item.description))) {
              toast.error(DWR_AI_DESCRIPTION_MESSAGE);
              return;
            }
            submit.mutate(values);
          })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="report-date">Report date</Label>
              {/* A calendar picker, not a free-typed date input: typing an
                  out-of-range value into a native <input type="date">
                  makes the browser silently clear it to "", which was
                  wiping the whole form via the load-effect below. Picking
                  a day from the calendar always yields one complete,
                  valid date, so that failure mode can't happen here. */}
              <ReportDatePicker
                value={reportDate || today}
                today={today}
                onSelect={(date) => form.setValue("reportDate", date)}
                reports={reports.data ?? []}
                me={me}
              />
              {invalidNewReportDate ? (
                <p className="text-xs text-warning">
                  No report exists for this date, and new reports can only be created for today
                  ({shortDate(today)}). Pick today, or a date that already has a report, to
                  continue.
                </p>
              ) : !existing ? (
                <p className="text-xs text-muted-foreground">
                  New reports can only be created for today.
                </p>
              ) : null}
            </div>
          </div>
          {openTasks.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.setValue("linkTasks", true);
                form.setValue(
                  "items",
                  openTasks.map((task) => ({
                    taskId: task.id,
                    description: task.title,
                    hours: task.estimatedHours && task.estimatedHours > 0 ? task.estimatedHours : 1,
                    itemStatus: task.status,
                    isUnplanned: false,
                  })),
                );
              }}
            >
              <ListChecks className="size-4" /> Pull assigned tasks
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tasks are assigned, so you can write free-text lines. With tasks assigned, extra
              work can be added as unplanned lines (up to 3).
            </p>
          )}
          <div className="space-y-3">
            {items.fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1.2fr)_120px_140px_auto]"
              >
                {openTasks.length > 0 ? (
                  <div className="grid gap-1.5 sm:col-span-4">
                    <Label>Task</Label>
                    <Select
                      value={form.watch(`items.${index}.taskId`) || "none"}
                      onValueChange={(value) => {
                        const taskId = value === "none" ? "" : value;
                        form.setValue(`items.${index}.taskId`, taskId, { shouldValidate: true });
                        const task = openTasks.find((item) => item.id === taskId);
                        if (task && !form.getValues(`items.${index}.description`)) {
                          form.setValue(`items.${index}.description`, task.title);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a task" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose a task</SelectItem>
                        {openTasks.map((task) => (
                          <SelectItem key={task.id} value={task.id}>
                            {task.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!form.watch(`items.${index}.taskId`) ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={form.watch(`items.${index}.isUnplanned`)}
                          onChange={(event) =>
                            form.setValue(`items.${index}.isUnplanned`, event.target.checked, {
                              shouldValidate: true,
                            })
                          }
                        />
                        Unplanned work (not linked to a task)
                      </label>
                    ) : null}
                    {form.formState.errors.items?.[index]?.taskId ? (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.items[index]?.taskId?.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-1.5 sm:col-span-1">
                  <div className="flex items-center gap-1.5">
                    <Label>What you did</Label>
                    <InfoHint label="About describing your work">
                      Type in your own words. Pasting or AI-generated text is blocked.
                    </InfoHint>
                  </div>
                  <Textarea
                    rows={3}
                    {...form.register(`items.${index}.description`)}
                    disabled={locked}
                    onBeforeInput={rejectDescriptionBeforeInput}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={rejectDescriptionDrop}
                    onPaste={rejectDescriptionInsert}
                  />
                  {form.formState.errors.items?.[index]?.description ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.items[index]?.description?.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label>Hours</Label>
                  <Input
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    disabled={locked}
                    {...form.register(`items.${index}.hours`, { valueAsNumber: true })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Status</Label>
                  <Select
                    value={form.watch(`items.${index}.itemStatus`)}
                    onValueChange={(value) =>
                      form.setValue(`items.${index}.itemStatus`, value as DwrItemStatus)
                    }
                    disabled={locked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {itemStatuses.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  disabled={locked}
                  onClick={() => {
                    // The delete icon is enabled on the very first/only
                    // row too, immediately -- but the form must never end
                    // up with zero lines, so removing the last one
                    // replaces it with a fresh empty line instead of
                    // leaving none.
                    if (items.fields.length === 1) {
                      items.replace([emptyItem()]);
                    } else {
                      items.remove(index);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          {openTasks.length === 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => items.append(emptyItem())}
              disabled={locked}
            >
              <Plus className="size-4" /> Add line
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => items.append({ ...emptyItem(), taskId: openTasks[0]?.id ?? "" })}
            >
              <Plus className="size-4" /> Add task line
            </Button>
          )}
          {form.formState.errors.items?.message ? (
            <p className="text-sm text-destructive">{form.formState.errors.items.message}</p>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Day summary</Label>
            <RichTextEditor
              value={form.watch("summaryHtml")}
              onChange={(html) => {
                form.setValue("summaryHtml", html, { shouldDirty: true });
                if (form.formState.errors.summaryHtml) void form.trigger("summaryHtml");
              }}
              disabled={locked}
              placeholder="Summary of the day"
            />
            {form.formState.errors.summaryHtml ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.summaryHtml.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Blockers</Label>
              <Textarea {...form.register("blockers")} disabled={locked} />
            </div>
            <div className="grid gap-1.5">
              <Label>Plan for tomorrow</Label>
              <Textarea {...form.register("planForTomorrow")} disabled={locked} />
            </div>
          </div>
          {existing?.leadRemarks ? (
            <p className="text-sm">
              Lead remarks: {existing.leadRemarks}
              {existing.leadRating ? ` · Rating ${existing.leadRating}/5` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={locked || invalidNewReportDate || save.isPending}
              onClick={() => void form.handleSubmit((values) => save.mutate(values))()}
            >
              {/* Already submitted/late: this call still goes through
                  saveDraft() (p_submit = false), which preserves that
                  status instead of resetting it to "draft" -- editing an
                  existing report never requires resubmitting it. Only the
                  label changes to say what's actually happening. */}
              {existing && (existing.status === "submitted" || existing.status === "late")
                ? "Save changes"
                : "Save draft"}
            </Button>
            <Button type="submit" disabled={!canSubmit || invalidNewReportDate || submit.isPending}>
              Submit report
            </Button>
            {existing ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={locked || deleteReport.isPending}
                onClick={() => setDeleting(existing)}
              >
                <Trash2 className="size-4" /> Delete report
              </Button>
            ) : null}
          </div>
        </form>
      </SectionCard>
      <SectionCard
        title={
          <span className="inline-flex items-center gap-1.5">
            Recent reports
            <ReportStatusHint />
            <ReviewStatusHint />
          </span>
        }
        description="Pick a date below, or use the list for your 10 most recent days."
      >
        <RecentReportsCalendar
          value={reportDate || today}
          today={today}
          onSelectDate={(date) => {
            // Today -> load into the editable form to continue/submit.
            // A past date -> open it read-only instead (the editable form
            // is reserved for today only); the existing viewer dialog
            // already shows a past report's full saved data.
            if (date === today) {
              form.setValue("reportDate", date);
              return;
            }
            const past = (reports.data ?? []).find(
              (report) => report.employeeId === me && report.reportDate === date,
            );
            if (past) setViewing(past);
          }}
          reports={reports.data ?? []}
          me={me}
        />
        <div className="mt-4 space-y-2">
          {(reports.data ?? [])
            .filter((report) => report.employeeId === me)
            .slice(0, 10)
            .map((report) => (
              <div
                key={report.id}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    // Today's own report (including a same-day draft) ->
                    // load into the editable form above to continue and
                    // submit later the same day. A past report opens
                    // read-only instead -- see RecentReportsCalendar's
                    // onSelectDate for the same rule.
                    if (report.reportDate === today) {
                      form.setValue("reportDate", report.reportDate);
                    } else {
                      setViewing(report);
                    }
                  }}
                >
                  <span className="text-sm">{shortDate(report.reportDate)}</span>
                </button>
                <span className="flex items-center gap-2">
                  {report.escalated ? <StatusBadge status="escalated" tone="warning" /> : null}
                  <StatusBadge status={report.reviewStatus} />
                  <StatusBadge status={report.status} />
                  <IconAction
                    label={`View ${shortDate(report.reportDate)} details`}
                    variant="ghost"
                    onClick={() => setViewing(report)}
                  >
                    <Eye />
                  </IconAction>
                </span>
              </div>
            ))}
          {(reports.data ?? []).filter((report) => report.employeeId === me).length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          ) : null}
        </div>
      </SectionCard>
      <WorkReportDetailDialog report={viewing} readOnly onClose={() => setViewing(null)} />
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this report?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleting
              ? `This permanently deletes your ${shortDate(deleting.reportDate)} report and its line items. This cannot be undone.`
              : ""}
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteReport.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteReport.isPending}
              onClick={() => {
                if (deleting) deleteReport.mutate(deleting.id);
              }}
            >
              {deleteReport.isPending ? "Deleting…" : "Delete report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toPayload(values: ReportFormValues) {
  return {
    reportDate: values.reportDate,
    blockers: values.blockers,
    planForTomorrow: values.planForTomorrow,
    summaryHtml: values.summaryHtml,
    items: values.items.map((item) => ({
      taskId: item.taskId || null,
      description: item.description,
      hours: Number(item.hours),
      itemStatus: item.itemStatus,
      isUnplanned: item.isUnplanned && !item.taskId,
    })),
  };
}

function TeamPanel() {
  const { user, isLead, isHr, isSuperAdmin, isDeptHead, isGeneralManager } = usePermissions();
  const me = user.employeeId ?? "";
  const queryClient = useQueryClient();
  const canReview = isLead || isHr || isSuperAdmin || isDeptHead;
  // A General Manager reads every report in the organisation but does not review them.
  const canSeeTeam = canReview || isGeneralManager;
  const reports = useQuery({
    queryKey: ["work", "reports"],
    queryFn: () => workService.listReports(),
    enabled: canSeeTeam,
  });
  const summaries = useQuery({
    queryKey: ["work", "summaries"],
    queryFn: () => workService.listSummaries(),
    enabled: canSeeTeam,
  });
  const departments = useQuery({
    queryKey: ["work", "departments"],
    queryFn: () => workService.listDepartments(),
    enabled: isLead,
  });
  const context = useQuery({
    queryKey: ["work", "context"],
    queryFn: () => workService.myContext(),
    enabled: isLead,
  });
  const [reviewing, setReviewing] = useState<DailyWorkReport | null>(null);
  const teamRows = (reports.data ?? []).filter((report) => report.employeeId !== me);

  const columns = useMemo<Column<DailyWorkReport>[]>(
    () => [
      {
        key: "employee",
        header: "Employee",
        cell: (row) => (
          <div>
            <p className="text-sm font-semibold">{row.employeeName || "Employee"}</p>
            <p className="text-xs text-muted-foreground">
              {shortDate(row.reportDate)} · {row.totalHours}h
            </p>
          </div>
        ),
      },
      {
        key: "status",
        header: (
          <span className="inline-flex items-center gap-1">
            Report
            <ReportStatusHint />
          </span>
        ),
        cell: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: "review",
        header: (
          <span className="inline-flex items-center gap-1">
            Review
            <ReviewStatusHint />
          </span>
        ),
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row.reviewStatus} />
            {row.escalated ? <StatusBadge status="escalated" tone="warning" /> : null}
          </div>
        ),
      },
      {
        key: "action",
        header: "",
        cell: (row) =>
          !canReview ? (
            <IconAction
              label="View"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                setReviewing(row);
              }}
            >
              <Eye />
            </IconAction>
          ) : row.status === "submitted" || row.status === "late" ? (
            <IconAction
              label={row.reviewStatus === "approved" ? "Reopen" : "Review"}
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                setReviewing(row);
              }}
            >
              {row.reviewStatus === "approved" ? <RotateCcw /> : <Eye />}
            </IconAction>
          ) : row.status === "missed" && (isHr || isSuperAdmin) ? (
            <IconAction
              label="Waive"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                setReviewing(row);
              }}
            >
              <Check />
            </IconAction>
          ) : null,
      },
    ],
    [canReview, isHr, isSuperAdmin],
  );

  return (
    <div className="space-y-4">
      {canSeeTeam ? (
        <DataTable
          columns={columns}
          data={teamRows}
          rowKey={(row) => row.id}
          isLoading={reports.isLoading}
          isError={reports.isError}
          onRetry={() => void reports.refetch()}
          onRowClick={(row) => setReviewing(row)}
          emptyTitle="No team reports"
          emptyDescription={
            isGeneralManager
              ? "Reports from everyone in the organisation appear here after they submit."
              : "Reports from people in your scope appear here after they submit."
          }
        />
      ) : (
        <SectionCard title="Team reports" description="Employees see only their own work.">
          <p className="text-sm text-muted-foreground">
            Your lead reviews the report on the My Reports tab.
          </p>
        </SectionCard>
      )}
      {isLead ? (
        <TeamConclusionForm
          departmentId={context.data?.departmentId ?? ""}
          departments={departments.data ?? []}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["work", "summaries"] })}
        />
      ) : null}
      {canSeeTeam ? (
        <SectionCard
          title="Team conclusions"
          description="Department heads see their department. Super Admin, General Manager and HR see the organisation."
        >
          <div className="space-y-3">
            {(summaries.data ?? []).map((summary) => (
              <article key={summary.id} className="rounded-md border p-3">
                <p className="text-sm font-semibold">
                  {shortDate(summary.reportDate)} · {summary.departmentName || "Team"} ·{" "}
                  {summary.leadName || "Lead"}
                </p>
                <p className="mt-1 text-sm">{summary.summary}</p>
                {summary.highlights ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Highlights: {summary.highlights}
                  </p>
                ) : null}
                {summary.risks ? (
                  <p className="text-sm text-muted-foreground">Risks: {summary.risks}</p>
                ) : null}
              </article>
            ))}
            {(summaries.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No team conclusions yet.</p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
      <WorkReportDetailDialog
        report={reviewing}
        readOnly={!canReview}
        canWaive={isHr || isSuperAdmin}
        onClose={() => setReviewing(null)}
        onReviewed={() => {
          setReviewing(null);
          void queryClient.invalidateQueries({ queryKey: ["work", "reports"] });
        }}
      />
    </div>
  );
}

function TeamConclusionForm({
  departmentId,
  departments,
  onSaved,
}: {
  departmentId: string;
  departments: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const form = useForm<SummaryFormValues>({
    resolver: zodResolver(summarySchema),
    defaultValues: {
      reportDate: indiaDateKey(),
      departmentId,
      summary: "",
      highlights: "",
      risks: "",
    },
  });

  useEffect(() => {
    if (departmentId) form.setValue("departmentId", departmentId);
  }, [departmentId, form]);

  const save = useMutation({
    mutationFn: (values: SummaryFormValues) =>
      workService.saveSummary({
        reportDate: values.reportDate,
        departmentId: values.departmentId || null,
        summary: values.summary,
        highlights: values.highlights,
        risks: values.risks,
      }),
    onSuccess: () => {
      toast.success("Team conclusion saved");
      onSaved();
    },
    onError: (error) =>
      toast.error("Could not save the conclusion", { description: messageOf(error) }),
  });

  return (
    <SectionCard
      title="Team daily conclusion"
      description="Summarise what the team finished, what stood out, and what is at risk."
    >
      <form className="grid gap-3" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Date</Label>
            <Input type="date" {...form.register("reportDate")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Department</Label>
            <Select
              value={form.watch("departmentId") || "none"}
              onValueChange={(value) =>
                form.setValue("departmentId", value === "none" ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Your department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No department</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Summary</Label>
          <Textarea {...form.register("summary")} />
          {form.formState.errors.summary ? (
            <p className="text-xs text-destructive">{form.formState.errors.summary.message}</p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Highlights</Label>
            <Textarea {...form.register("highlights")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Risks</Label>
            <Textarea {...form.register("risks")} />
          </div>
        </div>
        <div>
          <Button type="submit" disabled={save.isPending}>
            Save conclusion
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
