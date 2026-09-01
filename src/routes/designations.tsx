import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, CardsSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { employeeService } from "@/services/employeeService";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/designations")({
  beforeLoad: () => requireAuthForPath("/designations"),
  head: () => ({ meta: [{ title: "Designations · JeeVijay HRMS" }] }),
  component: DesignationsPage,
});

function DesignationsPage() {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const queryClient = useQueryClient();
  const designations = useQuery({
    queryKey: ["designations"],
    queryFn: () => employeeService.designations(),
  });
  const create = useMutation({ mutationFn: () => { if (!name.trim()) throw new Error("Designation name is required."); return employeeService.createDesignation({ name }); }, onSuccess: () => { toast.success("Designation created"); setName(""); setOpen(false); void queryClient.invalidateQueries({ queryKey: ["designations"] }); }, onError: (e) => toast.error("Could not create designation", { description: e instanceof Error ? e.message : "Supabase request failed." }) });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Designations"
        description="Maintain the role and career-title catalogue used across the organisation."
        actions={
          <Button onClick={() => setOpen(true)}>
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
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>New designation</DialogTitle></DialogHeader><div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? "Saving…" : "Create designation"}</Button></DialogFooter></DialogContent></Dialog>
    </AppLayout>
  );
}
