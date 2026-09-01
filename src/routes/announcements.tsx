import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pin, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, CardsSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";

const ANNOUNCEMENT_PRIORITIES = ["normal", "urgent"];

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
    queryKey: ["announcements"],
    queryFn: () => workplaceService.announcements(),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", priority: "normal" });
  const create = useMutation({
    mutationFn: () => {
      if (!form.title.trim()) throw new Error("Title is required.");
      if (!form.content.trim()) throw new Error("Content is required.");
      return workplaceService.createAnnouncement(form);
    },
    onSuccess: () => {
      toast.success("Announcement published");
      setOpen(false);
      setForm({ title: "", content: "", priority: "normal" });
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e) => toast.error("Could not publish announcement", { description: e instanceof Error ? e.message : "Try again." }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Overview"
        title="Announcements"
        description="Company-wide updates, policy notices and team broadcasts."
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New announcement
            </Button>
          ) : null
        }
      />

      {announcements.isLoading ? (
        <CardsSkeleton count={3} />
      ) : announcements.isError ? (
        <ErrorState onRetry={() => announcements.refetch()} />
      ) : (announcements.data ?? []).length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description="When HR publishes updates, they will appear here."
          icon={Megaphone}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(announcements.data ?? []).map((item) => (
            <SectionCard
              key={item.id}
              title={
                <span className="flex items-center gap-2">
                  {item.pinned ? <Pin className="size-4 text-primary" /> : null}
                  {item.title}
                </span>
              }
              description={`${item.author} · ${shortDate(item.publishedOn)} · ${item.audience}`}
              bodyClassName="space-y-3 p-5"
            >
              <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              {item.pinned ? <StatusBadge status="Pinned" tone="info" /> : null}
            </SectionCard>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>
            <div>
              <Label>Priority</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {ANNOUNCEMENT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
