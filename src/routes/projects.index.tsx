import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { FilterBar } from "@/components/common/FilterBar";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, CardsSkeleton, ErrorState } from "@/components/common/States";
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
import { Textarea } from "@/components/ui/textarea";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import {
  addProjectMember,
  createProject,
  listProjectMemberDirectory,
  listProjects,
} from "@/services/projectService";
import type { ProjectStatus } from "@/types/project";
import type { TaskPriority } from "@/types/work";

export const Route = createFileRoute("/projects/")({
  beforeLoad: () => requireAuthForPath("/projects"),
  head: () => ({
    meta: [
      { title: "Projects · JeeVijay HRMS" },
      {
        name: "description",
        content: "Projects you can access, with status, owner, and task progress.",
      },
    ],
  }),
  component: ProjectsPage,
});

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on-hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface ProjectDraft {
  name: string;
  description: string;
  status: ProjectStatus;
  priority: TaskPriority;
  startDate: string;
  dueDate: string;
  memberIds: string[];
}

const emptyDraft = (): ProjectDraft => ({
  name: "",
  description: "",
  status: "planning",
  priority: "medium",
  startDate: "",
  dueDate: "",
  memberIds: [],
});

function personLabel(person: { fullName: string; departmentName: string }) {
  return person.departmentName ? `${person.fullName} · ${person.departmentName}` : person.fullName;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ProjectsPage() {
  const { user, role } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate =
    role === "admin" || role === "hr" || role === "dept_head" || role === "team_lead";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [visibility, setVisibility] = useState("current");

  const projects = useQuery({
    queryKey: ["projects", visibility],
    queryFn: () => listProjects({ includeArchived: visibility === "archived" }),
  });
  const directory = useQuery({
    queryKey: ["project-member-directory"],
    queryFn: () => listProjectMemberDirectory(),
    enabled: open,
  });

  const owners = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of projects.data ?? []) {
      if (project.ownerId) names.set(project.ownerId, project.ownerName);
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects.data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (projects.data ?? []).filter((project) => {
      if (status !== "all" && project.status !== status) return false;
      if (owner === "unassigned" && project.ownerId) return false;
      if (owner !== "all" && owner !== "unassigned" && project.ownerId !== owner) return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.ownerName.toLowerCase().includes(needle)
      );
    });
  }, [projects.data, search, status, owner]);

  const selectable = useMemo(() => {
    const needle = directoryQuery.trim().toLowerCase();
    return (directory.data ?? [])
      .filter((person) => person.id !== user.employeeId)
      .filter((person) => !needle || personLabel(person).toLowerCase().includes(needle))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
  }, [directory.data, directoryQuery, user.employeeId]);

  const create = useMutation({
    mutationFn: async (input: ProjectDraft) => {
      const id = await createProject({
        name: input.name,
        description: input.description,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate || null,
        dueDate: input.dueDate || null,
      });
      const failures: string[] = [];
      for (const employeeId of input.memberIds) {
        try {
          await addProjectMember(id, employeeId, "contributor");
        } catch (error) {
          failures.push(errorText(error, "Could not add a member."));
        }
      }
      return { id, failures };
    },
    onSuccess: ({ id, failures }) => {
      toast.success("Project created");
      if (failures.length > 0) {
        toast.error("Some members were not added", { description: failures.join(" ") });
      }
      setDraft(emptyDraft());
      setDirectoryQuery("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void navigate({ to: "/projects/$projectId", params: { projectId: id } });
    },
    onError: (error) =>
      toast.error("Could not create project", {
        description: errorText(error, "Supabase request failed."),
      }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workplace"
        title="Projects"
        description="Work you can see. Membership decides which projects appear."
        actions={
          canCreate ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New project
            </Button>
          ) : null
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search projects"
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: [{ value: "all", label: "All statuses" }, ...STATUSES],
          },
          {
            id: "owner",
            label: "Owner",
            value: owner,
            onChange: setOwner,
            options: [
              { value: "all", label: "All owners" },
              { value: "unassigned", label: "Unassigned" },
              ...owners.map(([id, name]) => ({ value: id, label: name })),
            ],
          },
          {
            id: "visibility",
            label: "Archive",
            value: visibility,
            onChange: setVisibility,
            options: [
              { value: "current", label: "Current projects" },
              { value: "archived", label: "Include archived" },
            ],
          },
        ]}
      />

      {projects.isLoading ? (
        <CardsSkeleton count={4} />
      ) : projects.isError ? (
        <ErrorState
          message={errorText(projects.error, "Could not load projects.")}
          onRetry={() => void projects.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects"
          description={
            canCreate
              ? "Create a project to start assigning work and posting updates."
              : "Projects appear here when you are a member."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const progress =
              project.taskCount === 0
                ? 0
                : Math.round((project.doneCount / project.taskCount) * 100);
            return (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="surface-card block p-5 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-bold">{project.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Owner · {project.ownerName}
                    </p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>
                {project.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={project.priority} />
                  <span>
                    {project.doneCount}/{project.taskCount} tasks
                  </span>
                  <span>{project.memberCount} members</span>
                  {project.archivedAt ? <span>Archived</span> : null}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {project.startDate ? shortDate(project.startDate) : "No start"} –{" "}
                  {project.dueDate ? shortDate(project.dueDate) : "No due date"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setDraft(emptyDraft());
            setDirectoryQuery("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(value) => setDraft({ ...draft, status: value as ProjectStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={draft.priority}
                  onValueChange={(value) => setDraft({ ...draft, priority: value as TaskPriority })}
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
              <div>
                <Label htmlFor="project-start">Start date</Label>
                <Input
                  id="project-start"
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="project-due">Due date</Label>
                <Input
                  id="project-due"
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="project-member-search">Members</Label>
              <p className="mb-2 text-xs text-muted-foreground">
                You are added as the owner. Choose other people as contributors.
              </p>
              <Input
                id="project-member-search"
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                placeholder="Search the directory"
              />
              <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-2">
                {directory.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading directory…</p>
                ) : directory.isError ? (
                  <p className="text-sm text-destructive">Could not load the employee directory.</p>
                ) : selectable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matching employees.</p>
                ) : (
                  selectable.slice(0, 50).map((person) => (
                    <label key={person.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.memberIds.includes(person.id)}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            memberIds:
                              checked === true
                                ? current.memberIds.includes(person.id)
                                  ? current.memberIds
                                  : [...current.memberIds, person.id]
                                : current.memberIds.filter((id) => id !== person.id),
                          }))
                        }
                      />
                      <span className="min-w-0 truncate">{personLabel(person)}</span>
                    </label>
                  ))
                )}
              </div>
              {selectable.length > 50 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing 50 of {selectable.length}. Search to narrow the list.
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate(draft)}
              disabled={create.isPending || draft.name.trim().length === 0}
            >
              {create.isPending ? "Saving…" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
