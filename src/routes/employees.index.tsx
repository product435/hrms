import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { employeeService } from "@/services/employeeService";
import { useSession } from "@/hooks/useSession";
import { initialsOf, shortDate } from "@/lib/format";
import type { Employee } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/employees/")({
  beforeLoad: () => requireAuthForPath("/employees"),
  head: () => ({
    meta: [
      { title: "Employee directory · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Search the employee directory by department and status, and open any profile for full employment details.",
      },
      { property: "og:title", content: "Employee directory · JeeVijay HRMS" },
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
  const { role, user, isLoading } = useSession();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", employeeCode: "", joiningDate: "", employmentType: "full-time", departmentId: "", bloodGroup: "" });
  const queryClient = useQueryClient();

  const departments = useQuery({ queryKey: ["departments"], queryFn: () => employeeService.departments() });
  const employees = useQuery({
    queryKey: ["employees", role, search, department, status],
    queryFn: () => role === "manager" && user.employeeId ? employeeService.teamOf(user.employeeId) : employeeService.list({ search, department, status }),
    enabled: !isLoading,
  });
  const addEmployee = useMutation({
    mutationFn: () => {
      if (!form.firstName || !form.lastName || !form.email || !form.employeeCode || !form.joiningDate) throw new Error("First name, last name, email, employee code and joining date are required.");
      return employeeService.create(role === "manager" && user.employeeId ? { ...form, managerId: user.employeeId } : form);
    },
    onSuccess: () => { toast.success("Employee added"); setAddOpen(false); setForm({ firstName: "", lastName: "", email: "", employeeCode: "", joiningDate: "", employmentType: "full-time", departmentId: "", bloodGroup: "" }); void queryClient.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e) => toast.error("Could not add employee", { description: e instanceof Error ? e.message : "Supabase request failed." }),
  });
  const exportEmployees = () => {
    const rows = employees.data ?? [];
    const csv = [["Employee code", "First name", "Last name", "Email", "Department", "Designation", "Status"], ...rows.map((e) => [e.code, e.firstName, e.lastName, e.email, e.department, e.designation, e.status])]
      .map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "jeevijay-hrms-employees.csv"; a.click(); URL.revokeObjectURL(url);
  };

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
      {
        key: "actions",
        header: "",
        align: "right",
        className: "pr-5",
        cell: (row) => (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`View ${row.firstName} ${row.lastName}'s profile`}
            onClick={(event) => {
              event.stopPropagation();
              navigate({ to: "/employees/$employeeId", params: { employeeId: row.id } });
            }}
          >
            <Eye className="size-4" />
          </Button>
        ),
      },
    ],
    [navigate],
  );

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Employee directory"
        description="Browse every employee record, filter by department or status, and open a profile for full details."
        actions={
          <>
            <Button variant="outline" onClick={exportEmployees} disabled={employees.isLoading}>
              <Download className="size-4" /> Export
            </Button>
            <Button onClick={() => setAddOpen(true)}>
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
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add employee</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['firstName','First name'],['lastName','Last name'],['email','Email'],['employeeCode','Employee code'],['joiningDate','Joining date'],['bloodGroup','Blood group']] as const).map(([key,label]) => <div key={key} className="space-y-1"><Label>{label}</Label><Input type={key === 'joiningDate' ? 'date' : key === 'email' ? 'email' : 'text'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>)}
            <div className="space-y-1"><Label>Department</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">Unassigned</option>{(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => addEmployee.mutate()} disabled={addEmployee.isPending}>{addEmployee.isPending ? "Saving…" : "Save employee"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
