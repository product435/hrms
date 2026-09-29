import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { requireAuthForPath } from "@/lib/auth-guard";
import { ROLE_LABELS } from "@/hooks/useSession";
import { ALL_ROLES } from "@/lib/roles";
import {
  isRoleDemotion,
  roleService,
  type RoleDirectoryDepartment,
  type RoleDirectoryEmployee,
} from "@/services/roleService";
import type { Role } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export const Route = createFileRoute("/roles")({
  beforeLoad: () => requireAuthForPath("/roles"),
  head: () => ({
    meta: [{ title: "Role management · JeeVijay HRMS" }],
  }),
  component: RolesPage,
});

interface Draft {
  employee: RoleDirectoryEmployee;
  role: Role;
  departmentId: string;
  managerId: string;
  headId: string;
}

function RolesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const directory = useQuery({
    queryKey: ["role-directory"],
    queryFn: () => roleService.directory(),
  });

  const employees = directory.data?.employees ?? [];
  const departments = directory.data?.departments ?? [];
  const filtered = useMemo(() => {
    const list = directory.data?.employees ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((employee) =>
      [
        employee.name,
        employee.email,
        employee.code,
        employee.departmentName,
        ROLE_LABELS[employee.role],
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [directory.data, search]);

  const save = useMutation({
    mutationFn: async (next: Draft) => {
      const employee = next.employee;
      if (next.role !== employee.role) {
        await roleService.setRole(employee.id, next.role);
      }
      const departmentId = next.departmentId === NONE ? null : next.departmentId;
      const managerId = next.managerId === NONE ? null : next.managerId;
      if (departmentId !== employee.departmentId || managerId !== employee.managerId) {
        await roleService.setPlacement(employee.id, departmentId, managerId);
      }
      if (departmentId) {
        const currentHead =
          departments.find((department) => department.id === departmentId)?.managerId ?? null;
        const headId = next.headId === NONE ? null : next.headId;
        if (headId !== currentHead) {
          await roleService.setDepartmentHead(departmentId, headId);
        }
      }
    },
    onSuccess: () => {
      toast.success("Assignment updated");
      setConfirmOpen(false);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["role-directory"] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error) => {
      toast.error("Could not update assignment", {
        description: error instanceof Error ? error.message : "The server rejected the change.",
      });
    },
  });

  const columns: Column<RoleDirectoryEmployee>[] = [
    {
      key: "name",
      header: "Employee",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.code || "No code"} · {row.email}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortable: true,
      sortValue: (row) => ROLE_LABELS[row.role],
      cell: (row) => ROLE_LABELS[row.role],
    },
    {
      key: "department",
      header: "Department",
      sortable: true,
      sortValue: (row) => row.departmentName,
      cell: (row) => row.departmentName,
    },
    {
      key: "lead",
      header: "Reporting lead",
      sortable: true,
      sortValue: (row) => row.managerName,
      cell: (row) => row.managerName,
    },
  ];

  const openEditor = (employee: RoleDirectoryEmployee) => {
    const departmentId = employee.departmentId ?? NONE;
    const head =
      departmentId === NONE
        ? NONE
        : (departments.find((department) => department.id === departmentId)?.managerId ?? NONE);
    setDraft({
      employee,
      role: employee.role,
      departmentId,
      managerId: employee.managerId ?? NONE,
      headId: head || NONE,
    });
  };

  const requestSave = () => {
    if (!draft) return;
    if (isRoleDemotion(draft.employee.role, draft.role)) {
      setConfirmOpen(true);
      return;
    }
    save.mutate(draft);
  };

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Administration"
        title="Role management"
        description="Super Admin changes role, department, reporting lead, and who heads a department. Every change is written to the activity history."
      />

      <div className="mb-4 max-w-sm">
        <Label htmlFor="role-search">Search employees</Label>
        <Input
          id="role-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, email, code, or department"
          className="mt-1.5"
        />
      </div>

      <DataTable
        columns={columns}
        rows={directory.isSuccess ? filtered : undefined}
        rowKey={(row) => row.id}
        isLoading={directory.isLoading}
        isError={directory.isError}
        onRetry={() => void directory.refetch()}
        onRowClick={openEditor}
        emptyTitle="No employees match"
        emptyDescription="Try a different name, email, or department."
        caption="Role assignments visible to you"
      />

      <Dialog
        open={Boolean(draft) && !confirmOpen}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft ? `Update ${draft.employee.name}` : "Update assignment"}
            </DialogTitle>
          </DialogHeader>
          {draft ? (
            <AssignmentFields
              draft={draft}
              employees={employees}
              departments={departments}
              onChange={setDraft}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={requestSave} disabled={!draft || save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm demotion</AlertDialogTitle>
            <AlertDialogDescription>
              {draft
                ? `Change ${draft.employee.name} from ${ROLE_LABELS[draft.employee.role]} to ${ROLE_LABELS[draft.role]}? They will lose the access that role has.`
                : "Confirm this role change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!draft || save.isPending}
              onClick={() => draft && save.mutate(draft)}
            >
              {save.isPending ? "Saving…" : "Demote"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function AssignmentFields({
  draft,
  employees,
  departments,
  onChange,
}: {
  draft: Draft;
  employees: RoleDirectoryEmployee[];
  departments: RoleDirectoryDepartment[];
  onChange: (draft: Draft) => void;
}) {
  const leads = employees.filter((employee) => employee.id !== draft.employee.id);
  const setDepartment = (departmentId: string) => {
    const head =
      departmentId === NONE
        ? NONE
        : (departments.find((department) => department.id === departmentId)?.managerId ?? NONE);
    onChange({ ...draft, departmentId, headId: head || NONE });
  };

  return (
    <div className="grid gap-3">
      <div>
        <Label>Role</Label>
        <Select
          value={draft.role}
          onValueChange={(role) => onChange({ ...draft, role: role as Role })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Department</Label>
        <Select value={draft.departmentId} onValueChange={setDepartment}>
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Reporting lead</Label>
        <Select
          value={draft.managerId}
          onValueChange={(managerId) => onChange({ ...draft, managerId })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Reporting lead" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No lead</SelectItem>
            {leads.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Department head</Label>
        <Select
          value={draft.headId}
          disabled={draft.departmentId === NONE}
          onValueChange={(headId) => onChange({ ...draft, headId })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Department head" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No head</SelectItem>
            {employees.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {draft.departmentId === NONE
            ? "Choose a department before assigning its head."
            : "This sets who heads the selected department."}
        </p>
      </div>
    </div>
  );
}
