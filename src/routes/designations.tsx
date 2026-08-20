import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, CardsSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { employeeService } from "@/services/employeeService";

export const Route = createFileRoute("/designations")({
  beforeLoad: () => requireAuthForPath("/designations"),
  head: () => ({ meta: [{ title: "Designations · Kinetix" }] }),
  component: DesignationsPage,
});

function DesignationsPage() {
  const designations = useQuery({
    queryKey: ["designations"],
    queryFn: () => employeeService.designations(),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Designations"
        description="Maintain the role and career-title catalogue used across the organisation."
        actions={
          <Button>
            <Plus className="size-4" /> New designation
          </Button>
        }
      />

      {designations.isLoading ? (
        <CardsSkeleton count={6} />
      ) : designations.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {designations.data.map((designation) => (
            <article key={designation} className="surface-card flex items-center gap-3 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <BriefcaseBusiness className="size-5" />
              </span>
              <p className="text-sm font-semibold">{designation}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No designations yet"
          description="Create a designation when your organisation is ready to configure its role catalogue."
          icon={BriefcaseBusiness}
        />
      )}
    </AppLayout>
  );
}
