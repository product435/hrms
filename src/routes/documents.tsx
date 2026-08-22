import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";
import { employeeService } from "@/services/employeeService";
import type { DocumentItem } from "@/types";

const DOCUMENT_CATEGORIES = ["Identity", "Education", "Contract", "Policy", "Payroll", "Other"];

export const Route = createFileRoute("/documents")({
  beforeLoad: () => requireAuthForPath("/documents"),
  head: () => ({
    meta: [{ title: "Documents · TeamNest" }],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { role, user, isLoading } = useSession();
  const isSelfService = role === "employee";
  const canManage = role === "admin" || role === "hr";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({ employeeId: "", category: "Other" });
  const managedFileInput = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => employeeService.list(),
    enabled: canManage,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      if (!user.employeeId) throw new Error("Your employee profile is not linked.");
      return workplaceService.uploadDocument(file, user.employeeId);
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error("Could not upload document", { description: error instanceof Error ? error.message : "Supabase request failed." }),
  });

  const uploadForEmployee = useMutation({
    mutationFn: () => {
      if (!pendingFile) throw new Error("Choose a file to upload.");
      if (!uploadForm.employeeId) throw new Error("Select the employee this document belongs to.");
      return workplaceService.uploadDocument(pendingFile, uploadForm.employeeId, uploadForm.category);
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setUploadOpen(false);
      setPendingFile(null);
      setUploadForm({ employeeId: "", category: "Other" });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error("Could not upload document", { description: error instanceof Error ? error.message : "Supabase request failed." }),
  });

  const documents = useQuery({
    queryKey: ["documents", isSelfService ? (user.employeeId ?? user.id) : "all", search, category],
    queryFn: () =>
      isSelfService
        ? workplaceService.documentsOf(user.employeeId ?? user.id)
        : workplaceService.documents({ search, category }),
    enabled: !isLoading,
    retry: false,
  });

  const columns = useMemo<Column<DocumentItem>[]>(
    () => [
      {
        key: "name",
        header: "Document",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.owner} · {row.size}
            </p>
          </div>
        ),
      },
      {
        key: "category",
        header: "Category",
        cell: (row) => row.category,
      },
      {
        key: "uploaded",
        header: "Uploaded",
        cell: (row) => shortDate(row.uploadedOn),
      },
      {
        key: "expires",
        header: "Expires",
        cell: (row) => (row.expiresOn ? shortDate(row.expiresOn) : "—"),
      },
      {
        key: "verified",
        header: "Status",
        cell: (row) => (
          <StatusBadge status={row.verified ? "verified" : "pending"} tone={row.verified ? "success" : "warning"} />
        ),
      },
    ],
    [],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workplace"
        title={isSelfService ? "My documents" : "Document library"}
        description="Identity proofs, contracts, policies and payroll documents with verification status."
        actions={
          isSelfService ? (
            <>
              <input ref={fileInput} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload.mutate(file); }} />
              <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                <Upload className="size-4" /> {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            </>
          ) : canManage ? (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload
            </Button>
          ) : null
        }
      />

      {!isSelfService ? (
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search documents by name, owner or category…"
          status={category}
          onStatusChange={setCategory}
          statusLabel="Category"
          statusOptions={[
            { value: "all", label: "All categories" },
            { value: "Identity", label: "Identity" },
            { value: "Education", label: "Education" },
            { value: "Contract", label: "Contract" },
            { value: "Policy", label: "Policy" },
            { value: "Payroll", label: "Payroll" },
            { value: "Other", label: "Other" },
          ]}
        />
      ) : null}

      {documents.isLoading ? (
        <TableSkeleton />
      ) : documents.isError ? (
        <ErrorState onRetry={() => documents.refetch()} />
      ) : (documents.data ?? []).length === 0 ? (
        <EmptyState title="No documents" description="Uploaded files will be listed here." icon={FileText} />
      ) : (
        <DataTable columns={columns} data={documents.data ?? []} rowKey={(row) => row.id} />
      )}

      <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) setPendingFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Employee</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={uploadForm.employeeId}
                onChange={(e) => setUploadForm((prev) => ({ ...prev, employeeId: e.target.value }))}
              >
                <option value="">Select employee</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} ({e.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={uploadForm.category}
                onChange={(e) => setUploadForm((prev) => ({ ...prev, category: e.target.value }))}
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>File</Label>
              <input
                ref={managedFileInput}
                type="file"
                className="block w-full text-sm"
                onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => uploadForEmployee.mutate()}
              disabled={uploadForEmployee.isPending || !pendingFile || !uploadForm.employeeId}
            >
              {uploadForEmployee.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
