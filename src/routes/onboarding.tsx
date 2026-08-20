import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, UserPlus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { CardsSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { talentService } from "@/services/talentService";
import { percent, shortDate } from "@/lib/format";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => requireAuthForPath("/onboarding"),
  head: () => ({
    meta: [
      { title: "Onboarding journeys · Kinetix" },
      {
        name: "description",
        content:
          "Track new-hire onboarding checklists, task owners, buddy assignment and completion progress.",
      },
      { property: "og:title", content: "Onboarding · Kinetix" },
      {
        property: "og:description",
        content: "New-hire checklists with owners, buddies and live completion tracking.",
      },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const journeys = useQuery({ queryKey: ["onboarding"], queryFn: () => talentService.onboarding() });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Onboarding journeys"
        description="Every new joiner, their checklist owners and how far along they are."
        actions={
          <Button>
            <UserPlus className="size-4" /> Start onboarding
          </Button>
        }
      />

      {journeys.isLoading ? (
        <CardsSkeleton count={3} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(journeys.data ?? []).map((journey) => (
            <SectionCard
              key={journey.id}
              title={journey.employeeName}
              description={`${journey.designation} · starts ${shortDate(journey.startDate)} · buddy ${journey.buddy}`}
              bodyClassName="space-y-4 p-5"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Checklist progress</span>
                  <span className="font-semibold text-foreground">{percent(journey.progress)}</span>
                </div>
                <Progress value={journey.progress} className="mt-2 h-2" />
              </div>
              <ul className="space-y-2">
                {journey.tasks.map((task) => (
                  <li key={task.label} className="flex items-center gap-2.5 text-sm">
                    {task.done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={task.done ? "truncate text-muted-foreground line-through" : "truncate"}>
                      {task.label}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{task.owner}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
