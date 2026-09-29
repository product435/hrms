import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, Megaphone, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, CardsSkeleton } from "@/components/common/States";
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
import { Textarea } from "@/components/ui/textarea";
import { requireAuthForPath } from "@/lib/auth-guard";
import { indianDateTime, shortDate } from "@/lib/format";
import { ALL_ROLES } from "@/lib/roles";
import { useSession } from "@/hooks/useSession";
import { workplaceService, type AnnouncementDraft } from "@/services/workplaceService";
import type { Announcement, AnnouncementTargetScope, Role } from "@/types";

const ANNOUNCEMENT_PRIORITIES = ["normal", "urgent"] as const;
const TARGET_OPTIONS: { value: AnnouncementTargetScope; label: string }[] = [
  { value: "organization", label: "Everyone in the organization" },
  { value: "department", label: "One department" },
  { value: "role", label: "One role" },
];
const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  hr: "HR",
  dept_head: "Department head",
  team_lead: "Team lead",
  employee: "Employee",
};
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

const emptyForm = (): AnnouncementDraft => ({
  title: "",
  content: "",
  priority: "normal",
  targetScope: "organization",
  targetDepartmentId: "",
  targetRole: "employee",
  expiresAt: "",
});

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromAnnouncement(item: Announcement): AnnouncementDraft {
  return {
    title: item.title,
    content: item.body,
    priority: item.priority,
    targetScope: item.targetScope,
    targetDepartmentId: item.targetDepartmentId ?? "",
    targetRole: item.targetRole ?? "employee",
    expiresAt: toDateTimeLocal(item.expiresAt),
  };
}

export const Route = createFileRoute("/announcements")({
  beforeLoad: () => requireAuthForPath("/announcements"),
  head: () => ({
    meta: [{ title: "Announcements · JeeVijay HRMS" }],
  }),
  component: AnnouncementsPage,
});

function AnnouncementsPage() {
  const { role } = useSession();
  const canManage = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const announcements = useQuery({
    queryKey: ["announcements", canManage ? "manage" : "feed"],
    queryFn: () => workplaceService.announcements({ includeClosed: canManage }),
  });
  const departments = useQuery({
    queryKey: ["announcement-departments"],
    queryFn: () => workplaceService.announcementDepartments(),
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementDraft>(emptyForm);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
  };

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const save = useMutation({
    mutationFn: async (id: string | null) => {
      if (id) await workplaceService.updateAnnouncement(id, form);
      else await workplaceService.createAnnouncement(form);
    },
    onSuccess: (_data, id) => {
      toast.success(id ? "Announcement updated" : "Announcement published");
      closeDialog();
      refresh();
    },
    onError: (e, id) =>
      toast.error(id ? "Could not update announcement" : "Could not publish announcement", {
        description: e instanceof Error ? e.message : "Try again.",
      }),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      workplaceService.setAnnouncementActive(id, isActive),
    onSuccess: (_data, variables) => {
      toast.success(variables.isActive ? "Announcement published" : "Announcement unpublished");
      refresh();
    },
    onError: (e) =>
      toast.error("Could not change announcement status", {
        description: e instanceof Error ? e.message : "Try again.",
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => workplaceService.deleteAnnouncement(id),
    onSuccess: () => {
      toast.success("Announcement deleted");
      refresh();
    },
    onError: (e) =>
      toast.error("Could not delete announcement", {
        description: e instanceof Error ? e.message : "Try again.",
      }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => workplaceService.markAnnouncementRead(id),
    onSuccess: () => {
      toast.success("Marked as read");
      refresh();
    },
    onError: (e) =>
      toast.error("Could not mark as read", {
        description: e instanceof Error ? e.message : "Try again.",
      }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (item: Announcement) => {
    setEditingId(item.id);
    setForm(formFromAnnouncement(item));
    setOpen(true);
  };

  const items = announcements.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Overview"
        title="Announcements"
        description="Updates for the whole organization, one department, or one role. Expired and unpublished notices stay with Admin and HR."
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" /> New announcement
            </Button>
          ) : null
        }
      />

      {announcements.isLoading ? (
        <CardsSkeleton count={3} />
      ) : announcements.isError ? (
        <ErrorState onRetry={() => announcements.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description="When HR publishes updates for you, they will appear here."
          icon={Megaphone}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <SectionCard
              key={item.id}
              title={
                <span className="flex items-center gap-2">
                  {item.pinned ? <Pin className="size-4 text-primary" /> : null}
                  {item.title}
                </span>
              }
              description={`${item.author || "HR"} · ${shortDate(item.publishedOn)} · ${item.audience}`}
              bodyClassName="space-y-3 p-5"
            >
              <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  status={item.read ? "read" : "unread"}
                  tone={item.read ? "success" : "warning"}
                />
                {item.priority === "urgent" ? <StatusBadge status="urgent" /> : null}
                {canManage && !item.isActive ? (
                  <StatusBadge status="unpublished" tone="neutral" />
                ) : null}
                {canManage && item.expired ? <StatusBadge status="expired" tone="danger" /> : null}
              </div>
              {item.expiresAt ? (
                <p className="text-xs text-muted-foreground">
                  Expires {indianDateTime(item.expiresAt)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!item.read && item.isActive && !item.expired ? (
                  <IconAction
                    label="Mark as read"
                    variant="outline"
                    disabled={markRead.isPending && markRead.variables === item.id}
                    onClick={() => markRead.mutate(item.id)}
                  >
                    <Check />
                  </IconAction>
                ) : null}
                {canManage ? (
                  <>
                    <IconAction label="Edit" variant="outline" onClick={() => openEdit(item)}>
                      <Pencil />
                    </IconAction>
                    <IconAction
                      label={item.isActive ? "Unpublish" : "Publish"}
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: item.id, isActive: !item.isActive })}
                    >
                      {item.isActive ? <EyeOff /> : <Eye />}
                    </IconAction>
                    <IconAction
                      label="Delete"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (!window.confirm(`Delete "${item.title}"?`)) return;
                        remove.mutate(item.id);
                      }}
                    >
                      <Trash2 />
                    </IconAction>
                  </>
                ) : null}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit announcement" : "New announcement"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div>
              <Label>Priority</Label>
              <select
                className={selectClass}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {ANNOUNCEMENT_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Audience</Label>
              <select
                className={selectClass}
                value={form.targetScope}
                onChange={(e) =>
                  setForm({
                    ...form,
                    targetScope: e.target.value as AnnouncementTargetScope,
                  })
                }
              >
                {TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {form.targetScope === "department" ? (
              <div>
                <Label>Department</Label>
                <select
                  className={selectClass}
                  value={form.targetDepartmentId ?? ""}
                  onChange={(e) => setForm({ ...form, targetDepartmentId: e.target.value })}
                >
                  <option value="">Select a department</option>
                  {(departments.data ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {form.targetScope === "role" ? (
              <div>
                <Label>Role</Label>
                <select
                  className={selectClass}
                  value={form.targetRole ?? ""}
                  onChange={(e) => setForm({ ...form, targetRole: e.target.value })}
                >
                  {ALL_ROLES.map((entry) => (
                    <option key={entry} value={entry}>
                      {ROLE_LABELS[entry]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <Label>Expires</Label>
              <Input
                type="datetime-local"
                value={form.expiresAt ?? ""}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank if this notice should not expire.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(editingId)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : editingId ? "Save" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
