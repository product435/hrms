import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LaptopMinimal, Plus, RotateCcw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { assetService } from "@/services/assetService";
import { useSession } from "@/hooks/useSession";
import { requireAuthForPath } from "@/lib/auth-guard";
import { inr, shortDate } from "@/lib/format";
import type { Asset, AssetCategory } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const REQUESTABLE_CATEGORIES: AssetCategory[] = ["Laptop", "Desktop", "Monitor", "Mobile", "ID Card", "Other"];

export const Route = createFileRoute("/assets")({
  beforeLoad: () => requireAuthForPath("/assets"),
  head: () => ({
    meta: [
      { title: "Asset management · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Track company assets by tag and serial, assign or return devices, and log repairs with a full history trail.",
      },
      { property: "og:title", content: "Asset management · JeeVijay HRMS" },
      {
        property: "og:description",
        content: "Assign, return and repair company devices with a complete audit trail.",
      },
    ],
  }),
  component: AssetsPage,
});

function AssetsPage() {
  const { role, user, isLoading } = useSession();
  const isSelfService = role === "employee";
  const canManage = role === "admin" || role === "hr";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [addOpen, setAddOpen] = useState(false); const [form, setForm] = useState({ code: "", name: "", category: "Laptop", condition: "new", status: "available", serialNumber: "", location: "", purchaseCost: "" });

  const assets = useQuery({
    queryKey: ["assets", isSelfService ? (user.employeeId ?? user.id) : "all", search, status, category],
    queryFn: () =>
      isSelfService
        ? assetService.assignedTo(user.employeeId ?? user.id)
        : assetService.list({ search, status, category }),
    enabled: !isLoading,
  });
  const history = useQuery({ queryKey: ["asset-history", isSelfService ? user.employeeId : "all"], queryFn: () => assetService.history(undefined, isSelfService ? user.employeeId : undefined) });

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState<{ category: AssetCategory; details: string }>({
    category: "Laptop",
    details: "",
  });
  const myRequests = useQuery({
    queryKey: ["asset-requests", "mine", user.employeeId ?? user.id],
    queryFn: () => assetService.myAssetRequests(user.employeeId ?? user.id),
    enabled: !isLoading && isSelfService,
  });
  const requestAsset = useMutation({
    mutationFn: () => assetService.requestAsset(requestForm),
    onSuccess: () => {
      toast.success("Asset request submitted");
      setRequestOpen(false);
      setRequestForm({ category: "Laptop", details: "" });
      void queryClient.invalidateQueries({ queryKey: ["asset-requests", "mine"] });
    },
    onError: (e) =>
      toast.error("Could not submit request", { description: e instanceof Error ? e.message : "Try again." }),
  });

  // Admin/HR review queue -- RLS restricts this to whoever is actually
  // allowed to see it, so it's simplest to just always fetch it when
  // canManage and let the section render nothing if there's nothing pending.
  const assetRequests = useQuery({
    queryKey: ["asset-requests", "all"],
    queryFn: () => assetService.listAssetRequests(),
    enabled: !isLoading && canManage,
  });
  const decideAssetRequest = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected" }) =>
      assetService.decideAssetRequest(vars.id, vars.decision),
    onSuccess: (_data, vars) => {
      toast.success(vars.decision === "approved" ? "Request approved" : "Request rejected");
      void queryClient.invalidateQueries({ queryKey: ["asset-requests", "all"] });
    },
    onError: (e) =>
      toast.error("Could not update request", { description: e instanceof Error ? e.message : "Try again." }),
  });

  const returnAsset = useMutation({
    mutationFn: (tag: string) => assetService.markReturned(tag),
    onSuccess: () => {
      toast.success("Asset marked as returned");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (error) => toast.error("Could not update the asset", { description: error instanceof Error ? error.message : "Try again." }),
  });

  const repairAsset = useMutation({
    mutationFn: (tag: string) => assetService.sendForRepair(tag, "Reported from asset console"),
    onSuccess: () => {
      toast.success("Repair request logged");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (error) => toast.error("Could not log the repair request", { description: error instanceof Error ? error.message : "Try again." }),
  });
  const addAsset = useMutation({ mutationFn: () => { if (!form.code.trim() || !form.name.trim()) throw new Error("Asset code and name are required."); return assetService.create({ ...form, purchaseCost: Number(form.purchaseCost) || 0 }); }, onSuccess: () => { toast.success("Asset added"); setAddOpen(false); setForm({ code: "", name: "", category: "Laptop", condition: "new", status: "available", serialNumber: "", location: "", purchaseCost: "" }); void queryClient.invalidateQueries({ queryKey: ["assets"] }); }, onError: (e) => toast.error("Could not add asset", { description: e instanceof Error ? e.message : "Supabase request failed." }) });

  const columns = useMemo<Column<Asset>[]>(
    () => [
      {
        key: "asset",
        header: "Asset",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.tag} · {row.serial}
            </p>
          </div>
        ),
      },
      { key: "category", header: "Category", cell: (row) => <span className="text-sm">{row.category}</span> },
      {
        key: "assignedTo",
        header: "Assigned to",
        cell: (row) => <span className="text-sm">{row.assignedTo ?? "Unassigned"}</span>,
      },
      {
        key: "assignedOn",
        header: "Issued",
        cell: (row) => <span className="text-sm">{shortDate(row.assignedOn)}</span>,
      },
      { key: "condition", header: "Condition", cell: (row) => <StatusBadge status={row.condition} /> },
      { key: "value", header: "Value", align: "right", cell: (row) => <span className="text-sm">{inr(row.value)}</span> },
      {
        key: "warranty",
        header: "Warranty till",
        cell: (row) => <span className="text-sm">{shortDate(row.warrantyTill)}</span>,
      },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
      {
        key: "actions",
        header: "Actions",
        align: "right",
        className: "pr-5",
        cell: (row) => (
          <div className="flex justify-end gap-1.5">
            {canManage ? (
              <Button
                size="sm"
                variant="outline"
                disabled={returnAsset.isPending || row.status !== "assigned"}
                onClick={() => returnAsset.mutate(row.tag)}
              >
                <RotateCcw className="size-3.5" /> Return
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={repairAsset.isPending}
              onClick={() => repairAsset.mutate(row.tag)}
            >
              <Wrench className="size-3.5" /> Repair
            </Button>
          </div>
        ),
      },
    ],
    [canManage, repairAsset, returnAsset],
  );

  const rows = assets.data ?? [];

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workplace"
        title={isSelfService ? "My assets" : "Asset management"}
        description={
          isSelfService
            ? "Devices issued to you, their condition and how to report an issue."
            : "Inventory, assignment and repair lifecycle for every company asset."
        }
        actions={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add asset
            </Button>
          ) : isSelfService ? (
            <Button onClick={() => setRequestOpen(true)}>
              <Plus className="size-4" /> Request asset
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total tracked" value={String(rows.length)} icon={LaptopMinimal} tone="primary" hint="in current view" />
        <StatCard
          label="Assigned"
          value={String(rows.filter((a) => a.status === "assigned").length)}
          icon={LaptopMinimal}
          tone="info"
          hint="with employees"
        />
        <StatCard
          label="Available"
          value={String(rows.filter((a) => a.status === "available").length)}
          icon={LaptopMinimal}
          tone="success"
          hint="ready to issue"
        />
        <StatCard
          label="In repair"
          value={String(rows.filter((a) => a.status === "in-repair").length)}
          icon={Wrench}
          tone="warning"
          hint="with vendor"
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={assets.isLoading}
        isError={assets.isError}
        onRetry={() => assets.refetch()}
        emptyTitle="No assets found"
        emptyDescription="Add inventory or adjust the filters to see assets."
        caption={`${rows.length} assets`}
        toolbar={
          isSelfService ? undefined : (
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search by name, tag, serial or holder…"
              filters={[
                {
                  id: "status",
                  label: "Status",
                  value: status,
                  onChange: setStatus,
                  options: [
                  { value: "all", label: "All status" },
                    { value: "assigned", label: "Assigned" },
                    { value: "available", label: "Available" },
                    { value: "in-repair", label: "In repair" },
                    { value: "retired", label: "Retired" },
                    { value: "lost", label: "Lost" },
                  ],
                },
                {
                  id: "category",
                  label: "Category",
                  value: category,
                  onChange: setCategory,
                  options: [
                    { value: "all", label: "All categories" },
                    { value: "Laptop", label: "Laptop" },
                    { value: "Desktop", label: "Desktop" },
                    { value: "Monitor", label: "Monitor" },
                    { value: "Mobile", label: "Mobile" },
                    { value: "ID Card", label: "ID card" },
                    { value: "Other", label: "Other" },
                  ],
                },
              ]}
            />
          )
        }
      />

      <SectionCard title="Asset history" description="Assignment, return and repair events" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(history.data ?? []).slice(0, 8).map((event) => (
            <li key={event.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {event.assetTag} · {event.type}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {event.actor} · {event.note}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{shortDate(event.date)}</span>
            </li>
          ))}
          {history.data?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">No history yet.</li>
          ) : null}
        </ul>
      </SectionCard>

      {isSelfService ? (
        <SectionCard title="My asset requests" description="Status of assets you've requested" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(myRequests.data ?? []).map((request) => (
              <li key={request.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.category}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {request.details || "No details provided"} · requested {shortDate(request.requestedAt)}
                  </p>
                  {request.status === "rejected" && request.rejectionReason ? (
                    <p className="truncate text-xs text-destructive">Reason: {request.rejectionReason}</p>
                  ) : null}
                </div>
                <StatusBadge status={request.status} />
              </li>
            ))}
            {myRequests.data?.length === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No asset requests yet.
              </li>
            ) : null}
          </ul>
        </SectionCard>
      ) : null}

      {canManage ? (
        <SectionCard title="Asset requests" description="Employee requests awaiting review" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(assetRequests.data ?? [])
              .filter((r) => r.status === "pending")
              .map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{request.employeeName || "Unknown employee"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {request.category} · {request.details || "No details provided"} · requested{" "}
                      {shortDate(request.requestedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decideAssetRequest.isPending}
                      onClick={() => decideAssetRequest.mutate({ id: request.id, decision: "approved" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decideAssetRequest.isPending}
                      onClick={() => decideAssetRequest.mutate({ id: request.id, decision: "rejected" })}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            {(assetRequests.data ?? []).filter((r) => r.status === "pending").length === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No asset requests pending review.
              </li>
            ) : null}
          </ul>
        </SectionCard>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent><DialogHeader><DialogTitle>Add asset</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{([['code','Asset code'],['name','Name'],['serialNumber','Serial number'],['location','Location'],['purchaseCost','Purchase cost']] as const).map(([key,label]) => <div key={key}><Label>{label}</Label><Input type={key === 'purchaseCost' ? 'number' : 'text'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>)}<div><Label>Category</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Laptop</option><option>Desktop</option><option>Monitor</option><option>Mobile</option><option>ID Card</option><option>Other</option></select></div></div><DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => addAsset.mutate()} disabled={addAsset.isPending}>{addAsset.isPending ? "Saving…" : "Add asset"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request an asset</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={requestForm.category}
                onChange={(e) => setRequestForm({ ...requestForm, category: e.target.value as AssetCategory })}
              >
                {REQUESTABLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Details</Label>
              <Textarea
                value={requestForm.details}
                placeholder="Why do you need this, and any specifics (e.g. spec, urgency)"
                onChange={(e) => setRequestForm({ ...requestForm, details: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => requestAsset.mutate()} disabled={requestAsset.isPending}>
              {requestAsset.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
