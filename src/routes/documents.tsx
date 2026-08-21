import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { requireAuthForPath } from "@/lib/auth-guard";
import { shortDate } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { workplaceService } from "@/services/workplaceService";
import type { DocumentItem } from "@/types";

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
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const documents = useQuery({
    queryKey: ["documents", isSelfService ? user?.name : "all", search, category],
    queryFn: () =>
      isSelfService
        ? workplaceService.documentsOf(user.employeeId ?? user.id)
        : workplaceService.documents({ search, category }),
    enabled: !isLoading,
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
          <Button>
            <Upload className="size-4" /> Upload
          </Button>
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
    </AppLayout>
  );
}
