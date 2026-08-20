import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { requireAuthForPath } from "@/lib/auth-guard";
import { workplaceService } from "@/services/workplaceService";

export const Route = createFileRoute("/notifications")({
  beforeLoad: () => requireAuthForPath("/notifications"),
  head: () => ({
    meta: [{ title: "Notifications · Kinetix" }],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => workplaceService.notifications(),
  });

  const unread = (notifications.data ?? []).filter((item) => !item.read).length;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Overview"
        title="Notifications"
        description="Leave decisions, payroll events, asset updates and system alerts in one feed."
        actions={<StatusBadge status={`${unread} unread`} tone={unread > 0 ? "info" : "neutral"} />}
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
            {(notifications.data ?? []).map((item) => (
              <li
                key={item.id}
                className={`px-5 py-4 ${item.read ? "bg-background" : "bg-primary/5"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground/80">{item.createdAt}</p>
                  </div>
                  <StatusBadge status={item.read ? "Read" : "New"} tone={item.read ? "neutral" : "info"} />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </AppLayout>
  );
}
