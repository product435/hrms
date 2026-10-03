import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { indianDateTime } from "@/lib/format";
import { notificationTarget } from "@/lib/notification-target";
import { queryKeys } from "@/lib/query-keys";
import { workplaceService } from "@/services/workplaceService";
import type { NotificationItem } from "@/types";

export const Route = createFileRoute("/notifications")({
  beforeLoad: () => requireAuthForPath("/notifications"),
  head: () => ({
    meta: [{ title: "Notifications · JeeVijay HRMS" }],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: queryKeys.notifications.all,
    queryFn: () => workplaceService.notifications(),
  });

  const unread = (notifications.data ?? []).filter((item) => !item.read).length;

  const markRead = useMutation({
    mutationFn: (id: string) => workplaceService.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
    onError: (e) =>
      toast.error("Could not mark as read", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const markAllRead = useMutation({
    mutationFn: () => workplaceService.markAllRead(),
    onSuccess: () => {
      toast.success("All caught up");
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
    onError: (e) =>
      toast.error("Could not mark all as read", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Overview"
        title="Notifications"
        description="Leave decisions, payroll events, asset updates and system alerts in one feed."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={`${unread} unread`} tone={unread > 0 ? "info" : "neutral"} />
            {unread > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                Mark all as read
              </Button>
            ) : null}
          </div>
        }
      />

      {notifications.isLoading ? (
        <SectionCard title="Inbox" bodyClassName="p-0">
          <TableSkeleton rows={6} columns={1} />
        </SectionCard>
      ) : notifications.isError ? (
        <ErrorState onRetry={() => notifications.refetch()} />
      ) : (notifications.data ?? []).length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="New notifications will appear here when something needs your attention."
          icon={Bell}
        />
      ) : (
        <SectionCard title="Inbox" bodyClassName="divide-y divide-border p-0">
          <ul>
            {(notifications.data ?? []).map((item) => {
              const target = notificationTarget(item);
              return (
                <li key={item.id} className={item.read ? "bg-background" : "bg-primary/5"}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <NotificationBody
                      item={item}
                      target={target}
                      onOpen={() => markRead.mutate(item.id)}
                    />
                    <div className="flex items-center gap-2">
                      {!item.read ? (
                        <IconAction
                          label="Mark read"
                          variant="ghost"
                          disabled={markRead.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            markRead.mutate(item.id);
                          }}
                        >
                          <Check />
                        </IconAction>
                      ) : null}
                      <StatusBadge
                        status={item.read ? "Read" : "New"}
                        tone={item.read ? "neutral" : "info"}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </AppLayout>
  );
}

function NotificationBody({
  item,
  target,
  onOpen,
}: {
  item: NotificationItem;
  target: ReturnType<typeof notificationTarget>;
  onOpen: () => void;
}) {
  const content = (
    <>
      <p className="text-sm font-semibold">{item.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      <p className="mt-2 text-xs text-muted-foreground/80">{indianDateTime(item.createdAt)}</p>
      {target ? (
        <span className="mt-2 inline-block text-xs font-semibold text-primary">
          {target.label} →
        </span>
      ) : null}
    </>
  );

  if (!target) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!item.read) onOpen();
        }}
        className="min-w-0 flex-1 px-5 py-4 text-left"
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={target.href}
      onClick={() => {
        if (!item.read) onOpen();
      }}
      className="min-w-0 flex-1 px-5 py-4 text-left transition-colors hover:bg-primary/10"
    >
      {content}
    </a>
  );
}
