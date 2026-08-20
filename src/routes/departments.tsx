import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { CardsSkeleton } from "@/components/common/States";
import { DistributionDonut } from "@/components/charts/DistributionDonut";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { employeeService } from "@/services/employeeService";

export const Route = createFileRoute("/departments")({
  beforeLoad: () => requireAuthForPath("/departments"),
  head: () => ({
    meta: [
      { title: "Departments & structure · Kinetix" },
      {
        name: "description",
        content:
          "Department headcount, cost centers, open roles and designation ladders across the organisation.",
      },
      { property: "og:title", content: "Departments · Kinetix" },
      {
        property: "og:description",
        content: "Org structure with headcount, department heads, cost centers and open roles.",
      },
    ],
  }),
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => employeeService.departments() });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Departments & structure"
        description="Headcount, ownership and hiring demand for every department and cost center."
        actions={
          <Button>
            <Plus className="size-4" /> New department
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {departments.isLoading ? (
            <CardsSkeleton count={4} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(departments.data ?? []).map((dept) => (
                <article key={dept.id} className="surface-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-bold">{dept.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Head · {dept.head} · {dept.costCenter}
                      </p>
                    </div>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Building2 className="size-5" />
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        Headcount
                      </p>
                      <p className="font-display text-2xl font-bold">{dept.headcount}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        Open roles
                      </p>
                      <p className="font-display text-2xl font-bold">{dept.openRoles}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {dept.designations.slice(0, 4).map((title) => (
                      <Badge key={title} variant="secondary" className="font-normal">
                        {title}
                      </Badge>
                    ))}
                  </div>
                  <Button asChild variant="ghost" size="sm" className="mt-4 w-full">
                    <Link to="/employees" search={{}}>
                      View team
                    </Link>
                  </Button>
                </article>
              ))}
            </div>
          )}
        </div>

        <SectionCard title="Headcount split" description="Share by department">
          {departments.data ? (
            <DistributionDonut
              height={300}
              data={departments.data.map((d) => ({ name: d.name, value: d.headcount }))}
            />
          ) : (
            <div className="h-[300px]" />
          )}
        </SectionCard>
      </div>
    </AppLayout>
  );
}
