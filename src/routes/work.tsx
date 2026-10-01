import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, ListChecks, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { IconAction } from "@/components/common/IconAction";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor, SafeHtml } from "@/components/rich-text";
import { usePermissions } from "@/hooks/usePermissions";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shiftBounds, submitPhase, type SubmitPhase } from "@/lib/dwr-window";
import { indiaDateKey, indianTime, shortDate } from "@/lib/format";
import { workService } from "@/services/workService";
import type {
  DailyWorkReport,
  DwrItemStatus,
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

const reviewSchema = z
  .object({
    decision: z.enum(["approved", "needs-revision"]),
    rating: z.string(),
    remarks: z.string().max(2000),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "approved" && !["1", "2", "3", "4", "5"].includes(value.rating)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a rating from 1 to 5.",
        path: ["rating"],
      });
    }
    if (value.decision === "needs-revision" && value.remarks.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remarks are required.",
        path: ["remarks"],
      });
    }
  });

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

function phaseCopy(phase: SubmitPhase, opensAt: Date, closesAt: Date) {
  if (phase === "before-window") {
    return `Drafts can be saved now. Submit opens at ${indianTime(opensAt)} IST, 30 minutes before your shift ends.`;
  }
  if (phase === "on-time")
    return "The submission window is open. A report submitted now is on time.";
  if (phase === "late")
    return `This submission will be marked late. The window closes at ${indianTime(closesAt)} IST.`;
  return "The window closed at 10:00 IST. A missing report is marked missed.";
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
  const shift = context.data?.shift;
  const bounds = shift ? shiftBounds(reportDate || today, shift) : null;
  const phase = shift && reportDate ? submitPhase(new Date(), reportDate, shift) : "before-window";
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
  const gate = useQuery({
    queryKey: ["work", "checkout", me, reportDate],
    queryFn: () => workService.checkoutAllowed(me, reportDate),
    enabled: Boolean(me && /^\d{4}-\d{2}-\d{2}$/.test(reportDate)),
  });

  useEffect(() => {
    form.setValue("linkTasks", openTasks.length > 0);
  }, [form, openTasks.length]);

  useEffect(() => {
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
      toast.success("Draft saved");
      invalidate();
    },
    onError: (error) => toast.error("Could not save the draft", { description: messageOf(error) }),
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

  const canSubmit =
    !locked &&
    (phase === "on-time" || phase === "late" || existing?.reviewStatus === "needs-revision");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <SectionCard
        title="End-of-day report"
        description={
          context.isError
            ? messageOf(context.error)
            : bounds
              ? phaseCopy(phase, bounds.windowOpensAt, bounds.lateClosesAt)
              : "Loading your shift."
        }
        action={existing ? <StatusBadge status={existing.status} /> : null}
      >
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="report-date">Report date</Label>
              <Input id="report-date" type="date" {...form.register("reportDate")} />
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">Check-out</p>
              <p className="text-muted-foreground">
                {gate.isLoading
                  ? "Checking today's report…"
                  : gate.data?.allowed
                    ? "Check-out is allowed for this date."
                    : (gate.data?.reason ?? "Submit the report before check-out.")}
              </p>
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
                  <Label>What you did</Label>
                  <Input {...form.register(`items.${index}.description`)} disabled={locked} />
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
                  disabled={locked || items.fields.length === 1}
                  onClick={() => items.remove(index)}
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
            <Label>Day summary (optional)</Label>
            <RichTextEditor
              value={form.watch("summaryHtml")}
              onChange={(html) => form.setValue("summaryHtml", html, { shouldDirty: true })}
              disabled={locked}
              placeholder="Summary of the day"
            />
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
              disabled={locked || save.isPending}
              onClick={() => void form.handleSubmit((values) => save.mutate(values))()}
            >
              Save draft
            </Button>
            <Button type="submit" disabled={!canSubmit || submit.isPending}>
              Submit report
            </Button>
          </div>
        </form>
      </SectionCard>
      <SectionCard title="My reports" description="Submitted, late, and missed days.">
        <div className="space-y-2">
          {(reports.data ?? [])
            .filter((report) => report.employeeId === me)
            .map((report) => (
              <button
                key={report.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left"
                onClick={() => form.setValue("reportDate", report.reportDate)}
              >
                <span className="text-sm">{shortDate(report.reportDate)}</span>
                <span className="flex items-center gap-2">
                  {report.escalated ? <StatusBadge status="escalated" tone="warning" /> : null}
                  <StatusBadge status={report.reviewStatus} />
                  <StatusBadge status={report.status} />
                </span>
              </button>
            ))}
          {(reports.data ?? []).filter((report) => report.employeeId === me).length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          ) : null}
        </div>
      </SectionCard>
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
  const { user, isLead, isHr, isSuperAdmin, isDeptHead } = usePermissions();
  const me = user.employeeId ?? "";
  const queryClient = useQueryClient();
  const canReview = isLead || isHr || isSuperAdmin || isDeptHead;
  const reports = useQuery({
    queryKey: ["work", "reports"],
    queryFn: () => workService.listReports(),
    enabled: canReview,
  });
  const summaries = useQuery({
    queryKey: ["work", "summaries"],
    queryFn: () => workService.listSummaries(),
    enabled: canReview,
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
      { key: "status", header: "Report", cell: (row) => <StatusBadge status={row.status} /> },
      {
        key: "review",
        header: "Review",
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
          row.status === "submitted" || row.status === "late" ? (
            <IconAction
              label={row.reviewStatus === "approved" ? "Reopen" : "Review"}
              variant="outline"
              onClick={() => setReviewing(row)}
            >
              {row.reviewStatus === "approved" ? <RotateCcw /> : <Eye />}
            </IconAction>
          ) : row.status === "missed" && (isHr || isSuperAdmin) ? (
            <IconAction label="Waive" variant="outline" onClick={() => setReviewing(row)}>
              <Check />
            </IconAction>
          ) : null,
      },
    ],
    [isHr, isSuperAdmin],
  );

  return (
    <div className="space-y-4">
      {canReview ? (
        <DataTable
          columns={columns}
          data={teamRows}
          rowKey={(row) => row.id}
          isLoading={reports.isLoading}
          isError={reports.isError}
          onRetry={() => void reports.refetch()}
          emptyTitle="No team reports"
          emptyDescription="Reports from people in your scope appear here after they submit."
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
      {canReview ? (
        <SectionCard
          title="Team conclusions"
          description="Department heads see their department. Super Admin and HR see the organisation."
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
      <ReviewDialog
        report={reviewing}
        canWaive={isHr || isSuperAdmin}
        onClose={() => setReviewing(null)}
        onDone={() => {
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

function ReviewDialog({
  report,
  canWaive,
  onClose,
  onDone,
}: {
  report: DailyWorkReport | null;
  canWaive: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { decision: "approved", rating: "5", remarks: "" },
  });
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: (values: z.infer<typeof reviewSchema>) => {
      if (!report) throw new Error("Choose a report.");
      return workService.reviewReport(
        report.id,
        values.decision,
        values.decision === "approved" ? Number(values.rating) : null,
        values.remarks,
      );
    },
    onSuccess: () => {
      toast.success("Review saved");
      onDone();
    },
    onError: (error) => toast.error("Could not save the review", { description: messageOf(error) }),
  });
  const reopen = useMutation({
    mutationFn: () => {
      if (!report) throw new Error("Choose a report.");
      if (!reason.trim()) throw new Error("A reason is required.");
      return workService.reopenReport(report.id, reason);
    },
    onSuccess: () => {
      toast.success("Report reopened");
      onDone();
    },
    onError: (error) =>
      toast.error("Could not reopen the report", { description: messageOf(error) }),
  });
  const waive = useMutation({
    mutationFn: () => {
      if (!report) throw new Error("Choose a report.");
      if (!reason.trim()) throw new Error("A reason is required.");
      return workService.waiveMissed(report.id, reason);
    },
    onSuccess: () => {
      toast.success("Missed report waived");
      onDone();
    },
    onError: (error) =>
      toast.error("Could not waive the report", { description: messageOf(error) }),
  });

  const approved = report?.reviewStatus === "approved";
  const missed = report?.status === "missed";

  return (
    <Dialog open={Boolean(report)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {report?.employeeName || "Report"} · {report ? shortDate(report.reportDate) : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {(report?.items ?? []).map((item) => (
            <p key={item.id}>
              {item.description} · {item.hours}h · {item.itemStatus}
            </p>
          ))}
          {report?.summaryHtml ? <SafeHtml html={report.summaryHtml} /> : null}
          {report?.blockers ? <p>Blockers: {report.blockers}</p> : null}
          {report?.planForTomorrow ? <p>Tomorrow: {report.planForTomorrow}</p> : null}
        </div>
        {missed && canWaive ? (
          <div className="grid gap-2">
            <Label>Waiver reason</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button onClick={() => waive.mutate()} disabled={waive.isPending}>
              Waive missed report
            </Button>
          </div>
        ) : approved ? (
          <div className="grid gap-2">
            <Label>Reason to reopen</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={form.handleSubmit((values) => review.mutate(values))}
          >
            <div className="grid gap-1.5">
              <Label>Decision</Label>
              <Select
                value={form.watch("decision")}
                onValueChange={(value) =>
                  form.setValue("decision", value as "approved" | "needs-revision")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approve</SelectItem>
                  <SelectItem value="needs-revision">Needs revision</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Rating</Label>
              <Select
                value={form.watch("rating")}
                onValueChange={(value) => form.setValue("rating", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.rating ? (
                <p className="text-xs text-destructive">{form.formState.errors.rating.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>Remarks</Label>
              <Textarea {...form.register("remarks")} />
              {form.formState.errors.remarks ? (
                <p className="text-xs text-destructive">{form.formState.errors.remarks.message}</p>
              ) : null}
            </div>
            <Button type="submit" disabled={review.isPending}>
              Save review
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
