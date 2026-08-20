import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, UserPlus } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { employeeService } from "@/services/employeeService";
import { initialsOf, shortDate } from "@/lib/format";
import type { Employee } from "@/types";

export const Route = createFileRoute("/employees/")({
  beforeLoad: () => requireAuthForPath("/employees"),
  head: () => ({
    meta: [
      { title: "Employee directory · Kinetix" },
      {
        name: "description",
        content:
          "Search the employee directory by department and status, and open any profile for full employment details.",
      },
      { property: "og:title", content: "Employee directory · Kinetix" },
      {
        property: "og:description",
        content: "Every employee record, department and reporting line in one searchable directory.",
      },
    ],
  }),
  component: EmployeesPage,
});

function EmployeesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");

  const departments = useQuery({ queryKey: ["departments"], queryFn: () => employeeService.departments() });
  const employees = useQuery({
    queryKey: ["employees", search, department, status],
    queryFn: () => employeeService.list({ search, department, status }),
  });

  const columns = useMemo<Column<Employee>[]>(
    () => [
      {
        key: "name",
        header: "Employee",
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-xs font-bold">
              {initialsOf(`${row.firstName} ${row.lastName}`)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {row.firstName} {row.lastName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.email}</p>
            </div>
          </div>
        ),
      },
      { key: "code", header: "Code", cell: (row) => <span className="text-sm">{row.code}</span> },
      {
        key: "role",
        header: "Designation",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.designation}</p>
            <p className="truncate text-xs text-muted-foreground">{row.department}</p>
          </div>
        ),
      },
      {
        key: "manager",
        header: "Reports to",
        cell: (row) => <span className="text-sm">{row.managerName ?? "—"}</span>,
      },
      { key: "location", header: "Location", cell: (row) => <span className="text-sm">{row.location}</span> },
      { key: "joined", header: "Joined", cell: (row) => <span className="text-sm">{shortDate(row.joinedOn)}</span> },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    ],
    [],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Employee directory"
        description="Browse every employee record, filter by department or status, and open a profile for full details."
        actions={
          <>
            <Button variant="outline">
              <Download className="size-4" /> Export
            </Button>
            <Button>
              <UserPlus className="size-4" /> Add employee
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={employees.data}
        rowKey={(row) => row.id}
        isLoading={employees.isLoading}
        isError={employees.isError}
        onRetry={() => employees.refetch()}
        onRowClick={(row) => navigate({ to: "/employees/$employeeId", params: { employeeId: row.id } })}
        emptyTitle="No employees match these filters"
        emptyDescription="Try clearing the search or choosing a different department."
        caption={`${employees.data?.length ?? 0} employees shown`}
        toolbar={
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by name, email or code…"
            filters={[
              {
                id: "department",
                label: "Department",
                value: department,
                onChange: setDepartment,
                options: [
                  { value: "all", label: "All departments" },
                  ...(departments.data ?? []).map((d) => ({ value: d.name, label: d.name })),
                ],
              },
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { value: "all", label: "All status" },
                  { value: "active", label: "Active" },
                  { value: "probation", label: "Probation" },
                  { value: "notice", label: "Notice period" },
                  { value: "on-leave", label: "On leave" },
                  { value: "resigned", label: "Resigned" },
                ],
              },
            ]}
          />
        }
      />
    </AppLayout>
  );
}
