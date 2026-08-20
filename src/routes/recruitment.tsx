import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Plus, Star, Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CardsSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { talentService } from "@/services/talentService";
import { shortDate } from "@/lib/format";
import type { Candidate } from "@/types";

export const Route = createFileRoute("/recruitment")({
  beforeLoad: () => requireAuthForPath("/recruitment"),
  head: () => ({
    meta: [
      { title: "Recruitment pipeline · Kinetix" },
      {
        name: "description",
        content:
          "Open requisitions, applicant volume and a stage-by-stage candidate pipeline from applied to hired.",
      },
      { property: "og:title", content: "Recruitment · Kinetix" },
      {
        property: "og:description",
        content: "Track requisitions and move candidates through screening, interview and offer.",
      },
    ],
  }),
  component: RecruitmentPage,
});

const STAGES: Candidate["stage"][] = ["applied", "screening", "interview", "offer", "hired"];

function RecruitmentPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");

  const openings = useQuery({ queryKey: ["openings"], queryFn: () => talentService.openings() });
  const candidates = useQuery({
    queryKey: ["candidates", search, stage],
    queryFn: () => talentService.candidates({ search, status: stage }),
  });

  const rows = candidates.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Talent acquisition"
        title="Recruitment pipeline"
        description="Requisitions, applicant flow and interview progress across every open role."
        actions={
          <Button>
            <Plus className="size-4" /> New requisition
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open roles"
          value={String((openings.data ?? []).filter((j) => j.stage === "open").length)}
          icon={Briefcase}
          tone="primary"
          hint="actively hiring"
        />
        <StatCard
          label="Applicants"
          value={String((openings.data ?? []).reduce((sum, j) => sum + j.applicants, 0))}
          icon={Users}
          tone="info"
          hint="all requisitions"
        />
        <StatCard
          label="In interview"
          value={String(rows.filter((c) => c.stage === "interview").length)}
          icon={Users}
          tone="accent"
          hint="current view"
        />
        <StatCard
          label="Offers out"
          value={String(rows.filter((c) => c.stage === "offer").length)}
          icon={Star}
          tone="warning"
          hint="awaiting acceptance"
        />
      </div>

      <SectionCard title="Open requisitions" description="Hiring manager and applicant volume" bodyClassName="p-0">
        {openings.isLoading ? (
          <div className="p-5">
            <CardsSkeleton count={2} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(openings.data ?? []).map((job) => (
              <li key={job.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{job.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {job.department} · {job.location} · {job.type} · {job.openings} openings ·{" "}
                    {job.hiringManager}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold">{job.applicants}</span>
                  <StatusBadge status={job.stage} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Candidate pipeline" description="Drag-free kanban view by stage" bodyClassName="space-y-4 p-5">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search candidates by name, role or source…"
          filters={[
            {
              id: "stage",
              label: "Stage",
              value: stage,
              onChange: setStage,
              options: [
                { value: "all", label: "All stages" },
                ...STAGES.map((value) => ({ value, label: value })),
                { value: "rejected", label: "rejected" },
              ],
            },
          ]}
        />
        <div className="scroll-slim grid gap-3 overflow-x-auto lg:grid-cols-5">
          {STAGES.map((column) => {
            const items = rows.filter((c) => c.stage === column);
            return (
              <div key={column} className="min-w-[200px] rounded-2xl border border-border bg-surface-2/40 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {column}
                  </p>
                  <span className="text-xs font-semibold">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((candidate) => (
                    <article key={candidate.id} className="rounded-xl border border-border bg-card p-3">
                      <p className="truncate text-sm font-semibold">{candidate.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{candidate.role}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {candidate.experience} · {candidate.source}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-foreground">
                          <Star className="size-3 text-warning" /> {candidate.rating}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground/80">
                        Applied {shortDate(candidate.appliedOn)}
                      </p>
                    </article>
                  ))}
                  {items.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Empty</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </AppLayout>
  );
}
