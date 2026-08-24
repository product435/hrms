import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Plus, Star, UserX, Users } from "lucide-react";
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
import { employeeService } from "@/services/employeeService";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/recruitment")({
  beforeLoad: () => requireAuthForPath("/recruitment"),
  head: () => ({
    meta: [
      { title: "Recruitment pipeline · TeamNest" },
      {
        name: "description",
        content:
          "Open requisitions, applicant volume and a stage-by-stage candidate pipeline from applied to hired.",
      },
      { property: "og:title", content: "Recruitment · TeamNest" },
      {
        property: "og:description",
        content: "Track requisitions and move candidates through screening, interview and offer.",
      },
    ],
  }),
  component: RecruitmentPage,
});

const STAGES: Candidate["stage"][] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

function RecruitmentPage() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [open, setOpen] = useState(false); const [form, setForm] = useState({ title: "", departmentId: "", location: "", openings: "1" }); const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => employeeService.departments() });

  const openings = useQuery({ queryKey: ["openings"], queryFn: () => talentService.openings() });
  const candidates = useQuery({
    queryKey: ["candidates", search, stage],
    queryFn: () => talentService.candidates({ search, status: stage }),
  });
  const create = useMutation({ mutationFn: () => { if (!form.title.trim()) throw new Error("Title is required."); const input = { title: form.title, location: form.location, openings: Math.max(1, Number(form.openings) || 1), employmentType: "full-time" }; return talentService.createOpening(form.departmentId ? { ...input, departmentId: form.departmentId } : input); }, onSuccess: () => { toast.success("Requisition created"); setOpen(false); setForm({ title: "", departmentId: "", location: "", openings: "1" }); void queryClient.invalidateQueries({ queryKey: ["openings"] }); }, onError: (e) => toast.error("Could not create requisition", { description: e instanceof Error ? e.message : "Supabase request failed." }) });

  const rows = candidates.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Talent acquisition"
        title="Recruitment pipeline"
        description="Requisitions, applicant flow and interview progress across every open role."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New requisition
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
        <StatCard
          label="Rejected"
          value={String(rows.filter((c) => c.stage === "rejected").length)}
          icon={UserX}
          tone="destructive"
          hint="current view"
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
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>New requisition</DialogTitle></DialogHeader><div className="grid gap-3"><div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div><div><Label>Department</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">Unassigned</option>{(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div><div className="grid grid-cols-2 gap-3"><div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div><div><Label>Openings</Label><Input type="number" min="1" value={form.openings} onChange={(e) => setForm({ ...form, openings: e.target.value })} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? "Saving…" : "Create requisition"}</Button></DialogFooter></DialogContent></Dialog>

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
              ],
            },
          ]}
        />
        <div className="scroll-slim grid gap-3 overflow-x-auto lg:grid-cols-6">
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
