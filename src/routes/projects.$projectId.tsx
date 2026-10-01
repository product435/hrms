import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ListTodo, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { requireAuthForPath } from "@/lib/auth-guard";
import { indianDateTime, shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import {
  MESSAGE_PAGE_SIZE,
  addProjectMember,
  createProjectTask,
  getProject,
  getProjectMessage,
  listProjectMemberDirectory,
  listProjectMembers,
  listProjectMessages,
  listProjectTasks,
  postProjectMessage,
  removeProjectMember,
  setProjectTaskStatus,
  subscribeToProjectMessages,
  updateProject,
  updateProjectMemberRole,
} from "@/services/projectService";
import type { ProjectMember, ProjectMessage, ProjectRole, ProjectTask } from "@/types/project";
import type { TaskPriority, TaskStatus } from "@/types/work";

export const Route = createFileRoute("/projects/$projectId")({
  beforeLoad: () => requireAuthForPath("/projects"),
  head: () => ({
    meta: [{ title: "Project · JeeVijay HRMS" }],
  }),
  component: ProjectPage,
});

const ROLES: { value: ProjectRole; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "observer", label: "Observer" },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface TaskDraft {
  title: string;
  description: string;
  assignedTo: string;
  priority: TaskPriority;
  dueDate: string;
  sourceMessageId: string | null;
}

const emptyTask = (): TaskDraft => ({
  title: "",
  description: "",
  assignedTo: "",
  priority: "medium",
  dueDate: "",
  sourceMessageId: null,
});

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function personLabel(person: { fullName: string; departmentName: string }) {
  return person.departmentName ? `${person.fullName} · ${person.departmentName}` : person.fullName;
}

function dedupeMessages(groups: ProjectMessage[][]) {
  const byId = new Map<string, ProjectMessage>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { user, role } = useSession();
  const queryClient = useQueryClient();
  const employeeId = user.employeeId ?? "";
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTask);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberEmployeeId, setMemberEmployeeId] = useState("");
  const [memberRole, setMemberRole] = useState<Exclude<ProjectRole, "owner">>("contributor");
  const [memberQuery, setMemberQuery] = useState("");

  useEffect(() => {
    setTaskOpen(false);
    setMemberOpen(false);
    setTaskDraft(emptyTask());
    setMemberEmployeeId("");
    setMemberRole("contributor");
    setMemberQuery("");
  }, [projectId]);

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembers(projectId),
  });
  const tasks = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => listProjectTasks(projectId),
  });

  const myMembership = (members.data ?? []).find((member) => member.employeeId === employeeId);
  const canManage =
    role === "admin" ||
    role === "hr" ||
    project.data?.ownerId === employeeId ||
    myMembership?.role === "owner" ||
    myMembership?.role === "manager";
  const isMember = Boolean(myMembership);

  const directory = useQuery({
    queryKey: ["project-member-directory"],
    queryFn: () => listProjectMemberDirectory(),
    enabled: memberOpen,
  });

  const candidates = useMemo(() => {
    const taken = new Set((members.data ?? []).map((member) => member.employeeId));
    const needle = memberQuery.trim().toLowerCase();
    return (directory.data ?? [])
      .filter((person) => !taken.has(person.id))
      .filter((person) => !needle || personLabel(person).toLowerCase().includes(needle))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
  }, [directory.data, members.data, memberQuery]);

  function refreshProject() {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  const archive = useMutation({
    mutationFn: (archived: boolean) => updateProject(projectId, { archived }),
    onSuccess: () => {
      toast.success(project.data?.archivedAt ? "Project restored" : "Project archived");
      refreshProject();
    },
    onError: (error) =>
      toast.error("Could not update project", { description: errorText(error, "Request failed.") }),
  });

  const saveTask = useMutation({
    mutationFn: (input: TaskDraft) =>
      createProjectTask({
        projectId,
        assignedTo: input.assignedTo,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate || null,
        sourceMessageId: input.sourceMessageId,
      }),
    onSuccess: () => {
      toast.success("Task created");
      setTaskOpen(false);
      setTaskDraft(emptyTask());
      void queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      refreshProject();
    },
    onError: (error) =>
      toast.error("Could not create task", { description: errorText(error, "Request failed.") }),
  });

  const toggleTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      setProjectTaskStatus(taskId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      refreshProject();
    },
    onError: (error) =>
      toast.error("Could not update task", { description: errorText(error, "Request failed.") }),
  });

  const addMember = useMutation({
    mutationFn: () => addProjectMember(projectId, memberEmployeeId, memberRole),
    onSuccess: () => {
      toast.success("Member added");
      setMemberOpen(false);
      setMemberEmployeeId("");
      setMemberRole("contributor");
      setMemberQuery("");
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      refreshProject();
    },
    onError: (error) =>
      toast.error("Could not add member", { description: errorText(error, "Request failed.") }),
  });

  const changeRole = useMutation({
    mutationFn: ({ memberId, next }: { memberId: string; next: ProjectRole }) =>
      updateProjectMemberRole(memberId, next),
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    },
    onError: (error) =>
      toast.error("Could not change role", { description: errorText(error, "Request failed.") }),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => removeProjectMember(memberId),
    onSuccess: () => {
      toast.success("Member removed");
      void queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      refreshProject();
    },
    onError: (error) =>
      toast.error("Could not remove member", { description: errorText(error, "Request failed.") }),
  });

  function openBlankTask() {
    const fallback = (members.data ?? []).find((member) => member.employeeId === employeeId);
    setTaskDraft({
      ...emptyTask(),
      assignedTo: fallback?.employeeId ?? members.data?.[0]?.employeeId ?? "",
    });
    setTaskOpen(true);
  }

  function openTaskFromMessage(message: ProjectMessage) {
    const firstLine = message.bodyText.split("\n")[0]?.trim() ?? "";
    const fallback = (members.data ?? []).find((member) => member.employeeId === employeeId);
    setTaskDraft({
      title: firstLine.slice(0, 120) || "Task",
      description: message.bodyText,
      assignedTo: fallback?.employeeId ?? members.data?.[0]?.employeeId ?? "",
      priority: "medium",
      dueDate: "",
      sourceMessageId: message.id,
    });
    setTaskOpen(true);
  }

  function canTick(task: ProjectTask) {
    if (task.assignedTo === employeeId) return true;
    return canManage;
  }

  if (project.isLoading) {
    return (
      <AppLayout>
        <p className="text-sm text-muted-foreground">Loading project…</p>
      </AppLayout>
    );
  }

  if (project.isError) {
    return (
      <AppLayout>
        <ErrorState
          message={errorText(project.error, "Could not load this project.")}
          onRetry={() => void project.refetch()}
        />
      </AppLayout>
    );
  }

  if (!project.data) {
    return (
      <AppLayout>
        <EmptyState
          title="Project unavailable"
          description="It may have been removed, or you are not a member."
          action={
            <Button asChild variant="outline">
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </AppLayout>
    );
  }

  const summary = project.data;
  const progress =
    summary.taskCount === 0 ? 0 : Math.round((summary.doneCount / summary.taskCount) * 100);

  return (
    <AppLayout>
      <Button asChild variant="ghost" size="sm" className="w-fit px-0">
        <Link to="/projects">
          <ArrowLeft className="size-4" /> Projects
        </Link>
      </Button>
      <PageHeader
        eyebrow="Workplace"
        title={summary.name}
        description={summary.description || "No description yet."}
        actions={
          <>
            <StatusBadge status={summary.status} />
            <StatusBadge status={summary.priority} />
            {canManage ? (
              <Button
                variant="outline"
                onClick={() => archive.mutate(!summary.archivedAt)}
                disabled={archive.isPending}
              >
                {summary.archivedAt ? "Restore" : "Archive"}
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Progress" description="Tasks marked done">
              <p className="font-display text-3xl font-bold">{progress}%</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {summary.doneCount} of {summary.taskCount} tasks done · {summary.memberCount}{" "}
                members
              </p>
            </SectionCard>
            <SectionCard title="Schedule" description={summary.ownerName}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Start
                  </dt>
                  <dd>{summary.startDate ? shortDate(summary.startDate) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Due</dt>
                  <dd>{summary.dueDate ? shortDate(summary.dueDate) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Owner
                  </dt>
                  <dd>{summary.ownerName}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    State
                  </dt>
                  <dd>{summary.archivedAt ? "Archived" : "Open"}</dd>
                </div>
              </dl>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <SectionCard
            title="Tasks"
            description="Checking a box marks the task done. Observers can only complete their own."
            action={
              canManage ? (
                <Button size="sm" onClick={openBlankTask}>
                  <Plus className="size-4" /> New task
                </Button>
              ) : null
            }
          >
            {tasks.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading tasks…</p>
            ) : tasks.isError ? (
              <ErrorState
                message={errorText(tasks.error, "Could not load tasks.")}
                onRetry={() => void tasks.refetch()}
              />
            ) : (tasks.data ?? []).length === 0 ? (
              <EmptyState icon={ListTodo} title="No tasks yet" description="Tasks show up here." />
            ) : (
              <ul className="space-y-3">
                {(tasks.data ?? []).map((task) => {
                  const allowed = canTick(task);
                  const busy = toggleTask.isPending && toggleTask.variables?.taskId === task.id;
                  return (
                    <li key={task.id} className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={task.status === "done"}
                        disabled={!allowed || busy}
                        aria-label={`Mark ${task.title} done`}
                        title={
                          allowed
                            ? "Mark done"
                            : "Only a project manager, or the assignee, can complete this task."
                        }
                        onCheckedChange={(checked) =>
                          toggleTask.mutate({
                            taskId: task.id,
                            status: checked === true ? "done" : "todo",
                          })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            task.status === "done"
                              ? "text-sm text-muted-foreground line-through"
                              : "text-sm font-medium"
                          }
                        >
                          {task.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {task.assignedToName}
                          {task.dueDate ? ` · due ${shortDate(task.dueDate)}` : ""}
                          {task.sourceMessageId ? " · from an update" : ""}
                        </p>
                      </div>
                      <StatusBadge status={task.priority} />
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="updates" forceMount className="data-[state=inactive]:hidden">
          <UpdatesPanel
            key={projectId}
            projectId={projectId}
            employeeId={employeeId}
            authorName={user.name}
            canPost={isMember}
            canCreateTask={canManage}
            onTurnIntoTask={openTaskFromMessage}
          />
        </TabsContent>

        <TabsContent value="members">
          <SectionCard
            title="Members"
            description="The owner stays on the project. Open tasks block removal."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setMemberOpen(true)}>
                  <Plus className="size-4" /> Add member
                </Button>
              ) : null
            }
          >
            {members.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading members…</p>
            ) : members.isError ? (
              <ErrorState
                message={errorText(members.error, "Could not load members.")}
                onRetry={() => void members.refetch()}
              />
            ) : (
              <ul className="space-y-3">
                {(members.data ?? []).map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isOwner={member.employeeId === summary.ownerId || member.role === "owner"}
                    canManage={canManage}
                    busy={
                      (changeRole.isPending && changeRole.variables?.memberId === member.id) ||
                      (removeMember.isPending && removeMember.variables === member.id)
                    }
                    onRole={(next) => changeRole.mutate({ memberId: member.id, next })}
                    onRemove={() => removeMember.mutate(member.id)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{taskDraft.sourceMessageId ? "Task from update" : "New task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={taskDraft.title}
                onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={taskDraft.description}
                onChange={(event) =>
                  setTaskDraft({ ...taskDraft, description: event.target.value })
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Assignee</Label>
                <Select
                  value={taskDraft.assignedTo}
                  onValueChange={(value) => setTaskDraft({ ...taskDraft, assignedTo: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a member" />
                  </SelectTrigger>
                  <SelectContent>
                    {(members.data ?? []).map((member) => (
                      <SelectItem key={member.employeeId} value={member.employeeId}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={taskDraft.priority}
                  onValueChange={(value) =>
                    setTaskDraft({ ...taskDraft, priority: value as TaskPriority })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={taskDraft.dueDate}
                onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTask.mutate(taskDraft)}
              disabled={
                saveTask.isPending ||
                taskDraft.title.trim().length === 0 ||
                taskDraft.assignedTo.length === 0
              }
            >
              {saveTask.isPending ? "Saving…" : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={memberOpen} onOpenChange={setMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="member-search">Employee</Label>
              <Input
                id="member-search"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="Search the directory"
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {directory.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading directory…</p>
                ) : directory.isError ? (
                  <p className="text-sm text-destructive">Could not load the employee directory.</p>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matching employees.</p>
                ) : (
                  candidates.slice(0, 50).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className={
                        memberEmployeeId === person.id
                          ? "block w-full rounded-md bg-muted px-2 py-1.5 text-left text-sm"
                          : "block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      }
                      onClick={() => setMemberEmployeeId(person.id)}
                    >
                      {personLabel(person)}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={memberRole}
                onValueChange={(value) => setMemberRole(value as Exclude<ProjectRole, "owner">)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addMember.mutate()}
              disabled={addMember.isPending || memberEmployeeId.length === 0}
            >
              {addMember.isPending ? "Saving…" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function MemberRow({
  member,
  isOwner,
  canManage,
  busy,
  onRole,
  onRemove,
}: {
  member: ProjectMember;
  isOwner: boolean;
  canManage: boolean;
  busy: boolean;
  onRole: (role: ProjectRole) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.name}</p>
        <p className="text-xs capitalize text-muted-foreground">{member.role}</p>
      </div>
      {canManage && !isOwner ? (
        <div className="flex items-center gap-2">
          <Select value={member.role} onValueChange={(value) => onRole(value as ProjectRole)}>
            <SelectTrigger className="h-9 w-37.5" disabled={busy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : (
        <StatusBadge status={member.role} />
      )}
    </li>
  );
}

function UpdatesPanel({
  projectId,
  employeeId,
  authorName,
  canPost,
  canCreateTask,
  onTurnIntoTask,
}: {
  projectId: string;
  employeeId: string;
  authorName: string;
  canPost: boolean;
  canCreateTask: boolean;
  onTurnIntoTask: (message: ProjectMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<ProjectMessage[]>([]);
  const [live, setLive] = useState<ProjectMessage[]>([]);
  const [pending, setPending] = useState<ProjectMessage[]>([]);
  const [channelError, setChannelError] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const latest = useQuery({
    queryKey: ["project-messages", projectId],
    queryFn: () => listProjectMessages(projectId),
    refetchInterval: channelError ? 15_000 : false,
  });

  useEffect(() => {
    const unsubscribe = subscribeToProjectMessages(
      projectId,
      (messageId) => {
        void getProjectMessage(messageId).then((message) => {
          if (!message) return;
          setLive((current) => [...current.filter((item) => item.id !== message.id), message]);
          setPending((current) =>
            current.filter(
              (item) => item.authorId !== message.authorId || item.bodyText !== message.bodyText,
            ),
          );
        });
      },
      (status) => {
        if (status === "subscribed") setChannelError(false);
        else if (status === "error") setChannelError(true);
      },
    );
    return unsubscribe;
  }, [projectId]);

  const messages = useMemo(
    () => dedupeMessages([history, latest.data ?? [], live, pending]),
    [history, latest.data, live, pending],
  );
  const showOlder = (latest.data?.length ?? 0) >= MESSAGE_PAGE_SIZE && !exhausted;

  const send = useMutation({
    mutationFn: async (body: string) => postProjectMessage(projectId, body),
    onMutate: (body) => {
      const optimistic: ProjectMessage = {
        id: `optimistic-${crypto.randomUUID()}`,
        projectId,
        authorId: employeeId || null,
        authorName,
        bodyText: body,
        mentions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
      };
      setPending((current) => [...current, optimistic]);
      return { tempId: optimistic.id };
    },
    onSuccess: (saved, _body, context) => {
      setPending((current) => current.filter((item) => item.id !== context?.tempId));
      setLive((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setDraft("");
      endRef.current?.scrollIntoView({ block: "end" });
    },
    onError: (error, _body, context) => {
      setPending((current) => current.filter((item) => item.id !== context?.tempId));
      toast.error("Could not post update", { description: errorText(error, "Request failed.") });
    },
  });

  async function loadOlder() {
    const oldest = messages.find((message) => !message.id.startsWith("optimistic-"));
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await listProjectMessages(projectId, oldest.createdAt);
      setHistory((current) => [...page, ...current]);
      if (page.length < MESSAGE_PAGE_SIZE) setExhausted(true);
    } catch (error) {
      toast.error("Could not load earlier updates", {
        description: errorText(error, "Request failed."),
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <SectionCard
      title="Updates"
      description={
        channelError
          ? "Live updates paused. Refreshing every 15 seconds."
          : "Newest activity stays on this project."
      }
    >
      {showOlder ? (
        <Button
          variant="ghost"
          size="sm"
          className="mb-3"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? "Loading…" : "Load earlier"}
        </Button>
      ) : null}
      {latest.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading updates…</p>
      ) : latest.isError ? (
        <ErrorState
          message={errorText(latest.error, "Could not load updates.")}
          onRetry={() => void latest.refetch()}
        />
      ) : messages.length === 0 ? (
        <EmptyState title="No updates yet" description="Post the first note for this project." />
      ) : (
        <ul className="max-h-112 space-y-4 overflow-y-auto pr-1">
          {messages.map((message) => (
            <li key={message.id} className="border-b border-border pb-3 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{message.authorName}</p>
                <time className="text-xs text-muted-foreground">
                  {indianDateTime(message.createdAt)}
                </time>
              </div>
              {message.deletedAt ? (
                <p className="mt-1 text-sm italic text-muted-foreground">
                  This update was removed.
                </p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm">{message.bodyText}</p>
              )}
              {canCreateTask && !message.deletedAt && !message.id.startsWith("optimistic-") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 px-0"
                  onClick={() => onTurnIntoTask(message)}
                >
                  Turn into a task
                </Button>
              ) : null}
            </li>
          ))}
          <div ref={endRef} />
        </ul>
      )}
      <form
        className="mt-4 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text || send.isPending) return;
          send.mutate(text);
        }}
      >
        <Textarea
          value={draft}
          maxLength={5000}
          placeholder={canPost ? "Write an update" : "Join the project to post updates."}
          disabled={!canPost || send.isPending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{draft.trim().length}/5000</p>
          <Button type="submit" disabled={!canPost || send.isPending || draft.trim().length === 0}>
            <Send className="size-4" /> {send.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
