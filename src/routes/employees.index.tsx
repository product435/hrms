import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuthForPath } from "@/lib/auth-guard";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { SetEmployeePasswordDialog } from "@/components/auth/SetEmployeePasswordDialog";
import { employeeService } from "@/services/employeeService";
import { usePermissions } from "@/hooks/usePermissions";
import { indiaDateKey, initialsOf, shortDate } from "@/lib/format";
import type { Employee } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMPTY_EMPLOYEE_FORM,
  EmployeeFormFields,
  type EmployeeFormValues,
} from "@/components/employees/EmployeeFormFields";

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
        content:
          "Every employee record, department and reporting line in one searchable directory.",
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
  const { role, user, isLoading, isTeamLead, isSuperAdmin } = usePermissions();
  const canChangeStatus = role === "admin" || role === "hr";
  const [passwordEmployee, setPasswordEmployee] = useState<Employee | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<{
    employee: Employee;
    kind: "suspend" | "terminate" | "reinstate" | "activate";
    exitDate: string;
  } | null>(null);
  const [form, setForm] = useState<EmployeeFormValues>(EMPTY_EMPLOYEE_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => employeeService.departments(),
  });
  const designations = useQuery({
    queryKey: ["designation-options"],
    queryFn: () => employeeService.designationOptions(),
    enabled: addOpen,
  });
  const employees = useQuery({
    queryKey: ["employees", role, search, department, status],
    queryFn: async () => {
      if (isTeamLead && user.employeeId) {
        const team = await employeeService.teamOf(user.employeeId);
        return status === "all" ? team : team.filter((employee) => employee.status === status);
      }
      return employeeService.list({ search, department, status });
    },
    enabled: !isLoading,
  });
  // Next free "JV-<n>" suggestion, from whatever the directory already has
  // loaded -- a convenience default the admin can still freely overwrite,
  // never a reservation (the real uniqueness check is server-side, in
  // employeeService.create()/update()).
  const suggestedCode = useMemo(() => {
    const max = (employees.data ?? []).reduce((best, e) => {
      const match = /^JV-([0-9]+)$/.exec(e.code ?? "");
      return match ? Math.max(best, Number(match[1])) : best;
    }, 0);
    return `JV-${max + 1}`;
  }, [employees.data]);

  function openAdd() {
    setForm({ ...EMPTY_EMPLOYEE_FORM, employeeCode: suggestedCode });
    setFieldErrors({});
    setAddOpen(true);
  }

  function focusFirstInvalid(errors: Record<string, string>) {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    document.getElementById(`add-employee-${firstKey}`)?.focus();
  }

  const addEmployee = useMutation({
    mutationFn: () => {
      const errors: Record<string, string> = {};
      if (!form.firstName.trim()) errors["firstName"] = "First name is required.";
      if (!form.lastName.trim()) errors["lastName"] = "Last name is required.";
      if (!form.email.trim()) errors["email"] = "Work email is required.";
      if (!form.employeeCode.trim()) errors["employeeCode"] = "Employee code is required.";
      if (!form.joiningDate.trim()) errors["joiningDate"] = "Joining date is required.";
      if (!form.departmentId) errors["departmentId"] = "Department is required.";
      if ((designations.data ?? []).length > 0 && !form.designationId) {
        errors["designationId"] = "Designation is required.";
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        focusFirstInvalid(errors);
        throw new Error("Fill in the required fields.");
      }
      return employeeService.create({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        employeeCode: form.employeeCode,
        departmentId: form.departmentId,
        designationId: form.designationId,
        employmentType: form.employmentType,
        joiningDate: form.joiningDate,
        bloodGroup: form.bloodGroup,
        ...(isTeamLead && user.employeeId ? { managerId: user.employeeId } : {}),
      });
    },
    onSuccess: (created) => {
      toast.success("Employee added", {
        description: `${created.email} is active and must sign up with this exact work email before they can log in.`,
      });
      setAddOpen(false);
      setForm(EMPTY_EMPLOYEE_FORM);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Supabase request failed.";
      // The one validation this app can check ahead of the request --
      // employee code uniqueness -- gets its own inline error under the
      // field, matching the rest of the form, instead of only a toast.
      if (/employee code is already in use/i.test(message)) {
        setFieldErrors((current) => ({ ...current, employeeCode: message }));
        focusFirstInvalid({ employeeCode: message });
        return;
      }
      if (message !== "Fill in the required fields.") {
        toast.error("Could not add employee", { description: message });
      }
    },
  });
  const changeStatus = useMutation({
    mutationFn: () => {
      if (!lifecycle) throw new Error("Choose an employment status.");
      if (lifecycle.kind === "terminate" && !lifecycle.exitDate.trim()) {
        throw new Error("Terminated employees need an exit date.");
      }
      const status =
        lifecycle.kind === "reinstate" || lifecycle.kind === "activate"
          ? "active"
          : lifecycle.kind === "suspend"
            ? "suspended"
            : "terminated";
      return employeeService.update(lifecycle.employee.id, {
        status,
        ...(lifecycle.kind === "suspend" || lifecycle.kind === "terminate"
          ? { exitDate: lifecycle.exitDate }
          : {}),
      });
    },
    onSuccess: () => {
      const kind = lifecycle?.kind;
      toast.success(
        kind === "suspend"
          ? "Employee suspended"
          : kind === "terminate"
            ? "Employee terminated"
            : kind === "reinstate"
              ? "Employee reinstated"
              : "Employee set back to active",
      );
      setLifecycle(null);
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e) =>
      toast.error("Could not update employment status", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const exportEmployees = () => {
    const rows = employees.data ?? [];
    const csv = [
      ["Employee code", "First name", "Last name", "Email", "Department", "Designation", "Status"],
      ...rows.map((e) => [
        e.code,
        e.firstName,
        e.lastName,
        e.email,
        e.department,
        e.designation,
        e.status,
      ]),
    ]
      .map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "jeevijay-hrms-employees.csv";
    a.click();
    URL.revokeObjectURL(url);
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
      {
        key: "location",
        header: "Location",
        cell: (row) => <span className="text-sm">{row.location}</span>,
      },
      {
        key: "joined",
        header: "Joined",
        cell: (row) => <span className="text-sm">{shortDate(row.joinedOn)}</span>,
      },
      { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
      {
        key: "actions",
        header: "",
        align: "right",
        className: "pr-5",
        cell: (row) => (
          <div
            className="flex items-center justify-end gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            {canChangeStatus && row.id !== user.employeeId ? (
              <select
                aria-label={`Change employment status for ${row.firstName} ${row.lastName}`}
                className="h-9 max-w-36 rounded-md border bg-background px-2 text-xs"
                value=""
                onChange={(event) => {
                  const kind = event.target.value;
                  if (
                    kind !== "suspend" &&
                    kind !== "terminate" &&
                    kind !== "reinstate" &&
                    kind !== "activate"
                  )
                    return;
                  setLifecycle({
                    employee: row,
                    kind,
                    exitDate: row.exitDate || indiaDateKey(),
                  });
                }}
              >
                <option value="">Change status</option>
                {row.status !== "suspended" ? <option value="suspend">Suspend</option> : null}
                {row.status !== "terminated" ? <option value="terminate">Terminate</option> : null}
                {row.status === "suspended" ? <option value="activate">Set active</option> : null}
                {row.status === "terminated" ? <option value="reinstate">Reinstate</option> : null}
              </select>
            ) : null}
            {isSuperAdmin && row.id !== user.employeeId ? (
              <IconAction
                label={`Set password for ${row.firstName} ${row.lastName}`}
                variant="ghost"
                onClick={() => setPasswordEmployee(row)}
              >
                <KeyRound />
              </IconAction>
            ) : null}
            <IconAction
              label={`View ${row.firstName} ${row.lastName}'s profile`}
              variant="ghost"
              onClick={() =>
                navigate({ to: "/employees/$employeeId", params: { employeeId: row.id } })
              }
            >
              <Eye />
            </IconAction>
          </div>
        ),
      },
    ],
    [canChangeStatus, isSuperAdmin, navigate, setPasswordEmployee, user.employeeId],
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
            <Button onClick={openAdd}>
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
        onRowClick={(row) =>
          navigate({ to: "/employees/$employeeId", params: { employeeId: row.id } })
        }
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
                  { value: "suspended", label: "Suspended" },
                  { value: "terminated", label: "Terminated" },
                  { value: "pending_approval", label: "Awaiting sign-up" },
                ],
              },
            ]}
          />
        }
      />
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This saves the employee record only. They cannot log in until they sign up with this
            exact work email. Suggested next code: {suggestedCode}.
          </p>
          <EmployeeFormFields
            idPrefix="add-employee"
            mode="add"
            values={form}
            onChange={(next) => {
              setForm(next);
              const changedKeys = Object.keys(fieldErrors).filter(
                (key) =>
                  fieldErrors[key] &&
                  next[key as keyof EmployeeFormValues] !== form[key as keyof EmployeeFormValues],
              );
              if (changedKeys.length > 0) {
                const cleared = { ...fieldErrors };
                changedKeys.forEach((key) => (cleared[key] = ""));
                setFieldErrors(cleared);
              }
            }}
            errors={fieldErrors}
            departments={departments.data ?? []}
            designations={designations.data ?? []}
            designationsError={designations.isError}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addEmployee.mutate()}
              disabled={addEmployee.isPending || designations.isLoading || designations.isError}
            >
              {addEmployee.isPending ? "Saving…" : "Save employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={lifecycle !== null}
        onOpenChange={(open) => {
          if (!open) setLifecycle(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lifecycle?.kind === "suspend"
                ? `Suspend ${lifecycle.employee.firstName} ${lifecycle.employee.lastName}?`
                : lifecycle?.kind === "terminate"
                  ? `Terminate ${lifecycle.employee.firstName} ${lifecycle.employee.lastName}?`
                  : lifecycle?.kind === "reinstate"
                    ? `Reinstate ${lifecycle.employee.firstName} ${lifecycle.employee.lastName}?`
                    : `Set ${lifecycle?.employee.firstName ?? ""} ${lifecycle?.employee.lastName ?? ""} back to active?`}
            </DialogTitle>
            <DialogDescription>
              {lifecycle?.kind === "suspend"
                ? "Suspended employees cannot sign in. This does not delete their record. An exit date is saved when one is not already set."
                : lifecycle?.kind === "terminate"
                  ? "Terminated employees cannot sign in. This does not delete their record. An exit date is required."
                  : lifecycle?.kind === "reinstate"
                    ? "They can sign in again. The recorded exit date stays on the file."
                    : "They can sign in again. The exit date recorded while they were suspended will be cleared."}
            </DialogDescription>
          </DialogHeader>
          {lifecycle?.kind === "suspend" || lifecycle?.kind === "terminate" ? (
            <div className="space-y-1">
              <Label>Exit date</Label>
              <Input
                type="date"
                required={lifecycle.kind === "terminate"}
                value={lifecycle.exitDate}
                onChange={(event) => setLifecycle({ ...lifecycle, exitDate: event.target.value })}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLifecycle(null)}>
              Cancel
            </Button>
            <Button
              variant={
                lifecycle?.kind === "reinstate" || lifecycle?.kind === "activate"
                  ? "default"
                  : "destructive"
              }
              onClick={() => changeStatus.mutate()}
              disabled={
                changeStatus.isPending ||
                (lifecycle?.kind === "terminate" && !lifecycle.exitDate.trim())
              }
            >
              {changeStatus.isPending
                ? "Saving…"
                : lifecycle?.kind === "suspend"
                  ? "Suspend"
                  : lifecycle?.kind === "terminate"
                    ? "Terminate"
                    : lifecycle?.kind === "reinstate"
                      ? "Reinstate"
                      : "Set active"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SetEmployeePasswordDialog
        employeeId={passwordEmployee?.id ?? null}
        employeeName={
          passwordEmployee
            ? `${passwordEmployee.firstName} ${passwordEmployee.lastName}`
            : "this employee"
        }
        open={passwordEmployee !== null}
        onOpenChange={(open) => {
          if (!open) setPasswordEmployee(null);
        }}
      />
    </AppLayout>
  );
}
