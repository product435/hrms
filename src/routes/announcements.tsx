import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, CardsSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { workplaceService } from "@/services/workplaceService";

export const Route = createFileRoute("/announcements")({
  beforeLoad: () => requireAuthForPath("/announcements"),
  head: () => ({
    meta: [{ title: "Announcements · Kinetix" }],
  }),
  component: AnnouncementsPage,
});

function AnnouncementsPage() {
  const announcements = useQuery({
    queryKey: ["announcements"],
    queryFn: () => workplaceService.announcements(),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Overview"
        title="Announcements"
        description="Company-wide updates, policy notices and team broadcasts."
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
    </AppLayout>
  );
}
