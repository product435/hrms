import { useRef, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuth } from "@/lib/auth-guard";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/States";
import { AssetsTab } from "@/components/employees/AssetsTab";
import { AttendanceTab } from "@/components/employees/AttendanceTab";
import { ComplaintsTab } from "@/components/employees/ComplaintsTab";
import { DocumentsTab } from "@/components/employees/DocumentsTab";
import { EmploymentTab } from "@/components/employees/EmploymentTab";
import { Field } from "@/components/employees/Field";
import { LeaveTab } from "@/components/employees/LeaveTab";
import { PerformanceTab } from "@/components/employees/PerformanceTab";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { SetEmployeePasswordDialog } from "@/components/auth/SetEmployeePasswordDialog";
import {
  EmployeeFormFields,
  type EmployeeFormValues,
} from "@/components/employees/EmployeeFormFields";
import { PersonalTab } from "@/components/employees/PersonalTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { employeeService } from "@/services/employeeService";
import { assetService } from "@/services/assetService";
import { attendanceService } from "@/services/attendanceService";
import { leaveService } from "@/services/leaveService";
import { talentService } from "@/services/talentService";
import { workplaceService } from "@/services/workplaceService";
import { complaintsService } from "@/services/complaintsService";
import { indiaLocalDateTimeToUtcIso, indianTime, initialsOf, shortDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { ComplaintPriority, ComplaintStatus } from "@/types";

export const Route = createFileRoute("/employees/$employeeId")({
  beforeLoad: async ({ params }) => {
    const session = await requireAuth();
    if (
      session.user.role === "employee" &&
      (session.user.employeeId ?? session.user.id) !== params.employeeId
    ) {
      throw redirect({ to: "/unauthorized" });
    }
  },
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search["tab"] === "string" ? { tab: search["tab"] } : {},
  head: () => ({
    meta: [
      { title: "Employee profile · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "Full employee profile: personal details, employment record, attendance, leave, assets, documents and performance.",
      },
      { property: "og:title", content: "Employee profile · JeeVijay HRMS" },
      {
        property: "og:description",
        content:
          "Personal, employment, attendance, asset and performance records for a single employee.",
      },
    ],
  }),
  component: EmployeeDetailPage,
});

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const { role, user, canManageTeam, isSuperAdmin, isHr } = usePermissions();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab ?? "personal");
  const employee = useQuery({
    queryKey: queryKeys.employees.detail(employeeId),
    queryFn: () => employeeService.getById(employeeId),
  });
  const emp = employee.data;
  const fullName = emp ? `${emp.firstName} ${emp.lastName}` : "";
  const canManage = canManageTeam;
  const isOwnProfile = employeeId === (user.employeeId ?? user.id);
  const canEditHrFields = isSuperAdmin || isHr;
  const canEditProfile = canEditHrFields || isOwnProfile;
  const canChangeEmploymentStatus = canEditHrFields && !isOwnProfile;

  // Fields a plain employee can edit on their own row -- matches exactly
  // what employees_guard_self_assignment() does NOT revert on a self-update
  // (confirmed by reading that function): first_name, last_name, phone,
  // gender, date_of_birth, blood_group, marital_status, work_location.
  // Everything else (email, employeeCode, joiningDate, departmentId,
  // designationId, employmentType, status/exitDate) is reverted server-side
  // regardless of what the UI sends, so it's shown read-only here too.
  const SELF_EDITABLE_FIELDS: readonly (keyof EmployeeFormValues)[] = [
    "firstName",
    "lastName",
    "phone",
    "gender",
    "dateOfBirth",
    "bloodGroup",
    "maritalStatus",
    "location",
  ];
  const editableFields = canEditHrFields ? undefined : SELF_EDITABLE_FIELDS;

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EmployeeFormValues>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    joiningDate: "",
    dateOfBirth: "",
    employeeCode: "",
    gender: "",
    departmentId: "",
    designationId: "",
    employmentType: "full-time",
    status: "active",
    bloodGroup: "",
    maritalStatus: "",
    location: "",
    exitDate: "",
  });
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const editDepartments = useQuery({
    queryKey: ["departments"],
    queryFn: () => employeeService.departments(),
    enabled: editOpen,
  });
  const editDesignations = useQuery({
    queryKey: ["designation-options"],
    queryFn: () => employeeService.designationOptions(),
    enabled: editOpen,
  });
  const openEdit = () => {
    if (!emp) return;
    setEditForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone,
      joiningDate: emp.joinedOn,
      dateOfBirth: emp.dateOfBirth,
      employeeCode: emp.code,
      gender: emp.gender,
      departmentId: emp.departmentId ?? "",
      designationId: emp.designationId ?? "",
      employmentType: emp.employmentType,
      status: emp.status,
      bloodGroup: emp.bloodGroup,
      maritalStatus: emp.maritalStatus,
      location: emp.location,
      exitDate: emp.exitDate ?? "",
    });
    setEditFieldErrors({});
    setEditOpen(true);
  };
  function focusFirstEditInvalid(errors: Record<string, string>) {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    document.getElementById(`edit-profile-${firstKey}`)?.focus();
  }
  const [lifecycle, setLifecycle] = useState<
    null | "suspend" | "terminate" | "activate" | "reinstate"
  >(null);
  const statusToast = useRef<string | null>(null);
  const updateEmployee = useMutation({
    mutationFn: () => {
      // Required fields are only checked for the ones this role can
      // actually edit -- a read-only field left empty on an old record
      // (e.g. no department set yet) must never block a plain employee's
      // own save, since they have no way to fill it in from this dialog.
      const errors: Record<string, string> = {};
      const checkRequired = (key: keyof EmployeeFormValues, message: string) => {
        if (editableFields && !editableFields.includes(key)) return;
        if (!editForm[key].trim()) errors[key] = message;
      };
      checkRequired("firstName", "First name is required.");
      checkRequired("lastName", "Last name is required.");
      checkRequired("employeeCode", "Employee code is required.");
      checkRequired("joiningDate", "Joining date is required.");
      if (!editableFields || editableFields.includes("departmentId")) {
        if (!editForm.departmentId) errors["departmentId"] = "Department is required.";
        if ((editDesignations.data ?? []).length > 0 && !editForm.designationId) {
          errors["designationId"] = "Designation is required.";
        }
      }
      setEditFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        focusFirstEditInvalid(errors);
        throw new Error("Fill in the required fields.");
      }
      if (
        canChangeEmploymentStatus &&
        (editForm.status === "terminated" || editForm.status === "suspended") &&
        !editForm.exitDate.trim()
      ) {
        throw new Error("An exit date is required for this status.");
      }
      return employeeService.update(employeeId, {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        phone: editForm.phone,
        gender: editForm.gender,
        dateOfBirth: editForm.dateOfBirth,
        bloodGroup: editForm.bloodGroup,
        maritalStatus: editForm.maritalStatus,
        workLocation: editForm.location,
        ...(canEditHrFields
          ? {
              email: editForm.email,
              employeeCode: editForm.employeeCode,
              joiningDate: editForm.joiningDate,
              departmentId: editForm.departmentId,
              designationId: editForm.designationId,
              employmentType: editForm.employmentType,
            }
          : {}),
        ...(canChangeEmploymentStatus
          ? { status: editForm.status, exitDate: editForm.exitDate }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success(statusToast.current ?? "Profile updated");
      statusToast.current = null;
      setLifecycle(null);
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Supabase request failed.";
      if (/employee code is already in use/i.test(message)) {
        setEditFieldErrors((current) => ({ ...current, employeeCode: message }));
        focusFirstEditInvalid({ employeeCode: message });
        return;
      }
      if (message !== "Fill in the required fields.") {
        toast.error("Could not update profile", { description: message });
      }
    },
  });
  const reinstateEmployee = useMutation({
    mutationFn: () => employeeService.update(employeeId, { status: "active" }),
    onSuccess: () => {
      toast.success("Employee reinstated");
      setLifecycle(null);
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(employeeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
    },
    onError: (e) =>
      toast.error("Could not reinstate employee", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const beginProfileSave = () => {
    if (!emp) return;
    if (!canChangeEmploymentStatus) {
      updateEmployee.mutate();
      return;
    }
    if (editForm.status === "terminated" && !editForm.exitDate.trim()) {
      toast.error("Terminated employees need an exit date.");
      return;
    }
    if (editForm.status === "suspended" && editForm.status !== emp.status) {
      setLifecycle("suspend");
      return;
    }
    if (editForm.status === "terminated" && editForm.status !== emp.status) {
      setLifecycle("terminate");
      return;
    }
    if (editForm.status === "active" && emp.status === "terminated") {
      setLifecycle("reinstate");
      return;
    }
    if (editForm.status === "active" && emp.status === "suspended") {
      setLifecycle("activate");
      return;
    }
    updateEmployee.mutate();
  };

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({
    attendanceId: "",
    requestedCheckIn: "",
    requestedCheckOut: "",
    reason: "",
  });
  const requestCorrection = useMutation({
    mutationFn: () => {
      const targetDate = attendance.data?.find((r) => r.id === correctionForm.attendanceId)?.date;
      if (!targetDate) throw new Error("Select a valid attendance record to correct.");
      return attendanceService.requestCorrection({
        employeeId,
        attendanceId: correctionForm.attendanceId,
        reason: correctionForm.reason,
        ...(correctionForm.requestedCheckIn
          ? {
              requestedCheckIn: indiaLocalDateTimeToUtcIso(
                targetDate,
                correctionForm.requestedCheckIn,
              ),
            }
          : {}),
        ...(correctionForm.requestedCheckOut
          ? {
              requestedCheckOut: indiaLocalDateTimeToUtcIso(
                targetDate,
                correctionForm.requestedCheckOut,
              ),
            }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success("Correction request submitted");
      setCorrectionOpen(false);
      setCorrectionForm({
        attendanceId: "",
        requestedCheckIn: "",
        requestedCheckOut: "",
        reason: "",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.corrections.all });
    },
    onError: (e) =>
      toast.error("Could not submit correction", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const attendance = useQuery({
    queryKey: queryKeys.attendance.byEmployee(employeeId),
    queryFn: () => attendanceService.list({ employeeId }),
    enabled: Boolean(emp),
  });
  const leave = useQuery({
    queryKey: queryKeys.leave.byEmployee(employeeId),
    queryFn: () => leaveService.list({ employeeId }),
    enabled: Boolean(emp),
  });
  const leaveBalance = useQuery({
    queryKey: queryKeys.leave.balance(employeeId),
    queryFn: () => leaveService.balance(employeeId),
    enabled: Boolean(emp),
  });
  const assets = useQuery({
    queryKey: queryKeys.assets.byEmployee(employeeId),
    queryFn: () => assetService.assignedTo(employeeId),
    enabled: Boolean(emp),
  });
  const documents = useQuery({
    queryKey: queryKeys.documents.byEmployee(employeeId),
    queryFn: () => workplaceService.documentsOf(employeeId),
    enabled: Boolean(emp),
  });
  const goals = useQuery({
    queryKey: queryKeys.goals.byEmployee(employeeId),
    queryFn: () => talentService.goalsOf(employeeId),
    enabled: Boolean(emp),
  });
  const reviews = useQuery({
    queryKey: queryKeys.reviews.byEmployee(employeeId),
    queryFn: () => talentService.reviewsOf(employeeId),
    enabled: Boolean(emp),
  });

  // Only admin/hr can view or manage another employee's complaints (RLS
  // enforces this regardless); a manager only ever sees this list on their
  // own profile, via the self-select policy, same as an employee.
  const canManageComplaints = role === "admin" || role === "hr";
  const complaints = useQuery({
    queryKey: queryKeys.complaints.byEmployee(employeeId),
    queryFn: () => complaintsService.listForEmployee(employeeId),
    enabled: Boolean(emp) && (isOwnProfile || canManageComplaints),
  });

  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintForm, setComplaintForm] = useState<{
    subject: string;
    category: string;
    description: string;
    priority: ComplaintPriority;
  }>({ subject: "", category: "", description: "", priority: "medium" });
  const raiseComplaint = useMutation({
    mutationFn: () => complaintsService.create(complaintForm),
    onSuccess: () => {
      toast.success("Complaint submitted", { description: "HR and admin have been notified." });
      setComplaintOpen(false);
      setComplaintForm({ subject: "", category: "", description: "", priority: "medium" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.complaints.byEmployee(employeeId) });
    },
    onError: (e) =>
      toast.error("Could not submit complaint", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const updateComplaintStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ComplaintStatus }) =>
      complaintsService.updateStatus(id, status),
    onSuccess: () => {
      toast.success("Complaint status updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.complaints.byEmployee(employeeId) });
    },
    onError: (e) =>
      toast.error("Could not update status", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const updateComplaintAssignee = useMutation({
    mutationFn: ({ id, assignedTo }: { id: string; assignedTo: string | null }) =>
      complaintsService.updateAssignee(id, assignedTo),
    onSuccess: () => {
      toast.success("Complaint assignment updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.complaints.byEmployee(employeeId) });
    },
    onError: (e) =>
      toast.error("Could not update assignment", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const assignableEmployees = useQuery({
    queryKey: queryKeys.employees.assignable,
    queryFn: () => employeeService.list(),
    enabled: canManageComplaints,
  });

  if (employee.isLoading) {
    return (
      <AppLayout>
        <div className="surface-card h-64 animate-pulse" />
      </AppLayout>
    );
  }

  const passwordForm = role === "employee" && isOwnProfile ? <ChangePasswordForm /> : null;

  if (!emp) {
    return (
      <AppLayout>
        {passwordForm}
        <EmptyState
          title="Employee not found"
          description="This record may have been removed or the link is incorrect."
          action={
            <Button asChild variant="outline">
              <Link to="/employees">Back to directory</Link>
            </Button>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to={role === "employee" ? "/" : "/employees"}>
          <ArrowLeft className="size-4" /> Back to directory
        </Link>
      </Button>

      <PageHeader
        eyebrow={emp.code}
        title={fullName}
        description={`${emp.designation} · ${emp.department} · reports to ${emp.managerName ?? "—"}`}
        actions={
          <>
            <StatusBadge status={emp.status} />
            {canChangeEmploymentStatus && emp.status === "terminated" ? (
              <Button variant="outline" onClick={() => setLifecycle("reinstate")}>
                Reinstate
              </Button>
            ) : null}
            {isSuperAdmin && !isOwnProfile ? (
              <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                Set password
              </Button>
            ) : null}
            {canEditProfile ? (
              <Button variant="outline" onClick={openEdit}>
                Edit profile
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="Contact" description="Primary details" bodyClassName="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="gradient-hero grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-bold text-primary-foreground">
              {initialsOf(fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{emp.employmentType}</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 truncate">
              <Mail className="size-4 shrink-0 text-muted-foreground" /> {emp.email}
            </p>
            <p className="flex items-center gap-2 truncate">
              <Phone className="size-4 shrink-0 text-muted-foreground" /> {emp.phone}
            </p>
            <p className="flex items-center gap-2 truncate">
              <MapPin className="size-4 shrink-0 text-muted-foreground" /> {emp.location}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <Field label="Shift" value={emp.shift} />
            <Field label="Joined" value={shortDate(emp.joinedOn)} />
            <Field label="Blood group" value={emp.bloodGroup} />
            <Field label="Gender" value={emp.gender} />
          </div>
        </SectionCard>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="complaints">Complaints</TabsTrigger>
          </TabsList>

          <PersonalTab employee={emp} footer={passwordForm} isOwnProfile={isOwnProfile} />
          <EmploymentTab employee={emp} isOwnProfile={isOwnProfile} />
          <AttendanceTab
            records={attendance.data}
            canRequestCorrection={canManage || isOwnProfile}
            onRequestCorrection={() => {
              setCorrectionForm({
                attendanceId: attendance.data?.[0]?.id ?? "",
                requestedCheckIn: "",
                requestedCheckOut: "",
                reason: "",
              });
              setCorrectionOpen(true);
            }}
          />
          <LeaveTab balance={leaveBalance.data} requests={leave.data} />
          <AssetsTab assets={assets.data} />
          <DocumentsTab documents={documents.data} />
          <PerformanceTab employeeId={employeeId} goals={goals.data} reviews={reviews.data} />
          <ComplaintsTab
            complaints={complaints.data}
            canManageComplaints={canManageComplaints}
            isOwnProfile={isOwnProfile}
            assignees={assignableEmployees.data}
            onRaise={() => setComplaintOpen(true)}
            onStatusChange={(id, status) => updateComplaintStatus.mutate({ id, status })}
            onAssigneeChange={(id, assignedTo) =>
              updateComplaintAssignee.mutate({ id, assignedTo })
            }
          />
        </Tabs>
      </div>

      <SetEmployeePasswordDialog
        employeeId={employeeId}
        employeeName={fullName}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <EmployeeFormFields
            idPrefix="edit-profile"
            mode="edit"
            values={editForm}
            onChange={(next) => {
              setEditForm(next);
              const changedKeys = Object.keys(editFieldErrors).filter(
                (key) =>
                  editFieldErrors[key] &&
                  next[key as keyof EmployeeFormValues] !==
                    editForm[key as keyof EmployeeFormValues],
              );
              if (changedKeys.length > 0) {
                const cleared = { ...editFieldErrors };
                changedKeys.forEach((key) => (cleared[key] = ""));
                setEditFieldErrors(cleared);
              }
            }}
            errors={editFieldErrors}
            departments={editDepartments.data ?? []}
            designations={editDesignations.data ?? []}
            designationsError={editDesignations.isError}
            {...(editableFields ? { editableFields } : {})}
          />
          {!canChangeEmploymentStatus && canEditHrFields ? (
            <p className="text-xs text-muted-foreground">
              Another administrator or HR must change your own employment status.
            </p>
          ) : null}
          {emp.status === "terminated" && canChangeEmploymentStatus ? (
            <p className="text-xs text-muted-foreground">
              Active is not listed for a terminated employee. Use Reinstate to set them back to
              active. That keeps the exit date.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={beginProfileSave} disabled={updateEmployee.isPending}>
              {updateEmployee.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={lifecycle !== null}
        onOpenChange={(open) => {
          if (!open && !updateEmployee.isPending && !reinstateEmployee.isPending)
            setLifecycle(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycle === "suspend"
                ? `Suspend ${fullName}?`
                : lifecycle === "terminate"
                  ? `Terminate ${fullName}?`
                  : lifecycle === "reinstate"
                    ? `Reinstate ${fullName}?`
                    : lifecycle === "activate"
                      ? `Set ${fullName} back to active?`
                      : "Update employment status?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycle === "suspend"
                ? "Suspended employees cannot sign in. This does not delete their record. An exit date is saved when one is not already set."
                : lifecycle === "terminate"
                  ? "Terminated employees cannot sign in. This does not delete their record. An exit date is required."
                  : lifecycle === "reinstate"
                    ? "They can sign in again. The recorded exit date stays on the file."
                    : lifecycle === "activate"
                      ? "They can sign in again. The exit date recorded while they were suspended will be cleared."
                      : "Confirm this employment status change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateEmployee.isPending || reinstateEmployee.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant={
                lifecycle === "reinstate" || lifecycle === "activate" ? "default" : "destructive"
              }
              disabled={
                updateEmployee.isPending ||
                reinstateEmployee.isPending ||
                (lifecycle === "terminate" && !editForm.exitDate.trim())
              }
              onClick={() => {
                statusToast.current =
                  lifecycle === "suspend"
                    ? "Employee suspended"
                    : lifecycle === "terminate"
                      ? "Employee terminated"
                      : lifecycle === "activate"
                        ? "Employee set back to active"
                        : null;
                if (lifecycle === "reinstate") reinstateEmployee.mutate();
                else updateEmployee.mutate();
              }}
            >
              {updateEmployee.isPending || reinstateEmployee.isPending
                ? "Saving…"
                : lifecycle === "suspend"
                  ? "Suspend"
                  : lifecycle === "terminate"
                    ? "Terminate"
                    : lifecycle === "reinstate"
                      ? "Reinstate"
                      : "Set active"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request attendance correction</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Attendance record</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={correctionForm.attendanceId}
                onChange={(event) =>
                  setCorrectionForm({ ...correctionForm, attendanceId: event.target.value })
                }
              >
                {(attendance.data ?? []).map((record) => (
                  <option key={record.id} value={record.id}>
                    {shortDate(record.date)} · in {indianTime(record.checkIn)} · out{" "}
                    {indianTime(record.checkOut)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Requested check-in</Label>
                <Input
                  type="time"
                  value={correctionForm.requestedCheckIn}
                  onChange={(event) =>
                    setCorrectionForm({ ...correctionForm, requestedCheckIn: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Requested check-out</Label>
                <Input
                  type="time"
                  value={correctionForm.requestedCheckOut}
                  onChange={(event) =>
                    setCorrectionForm({ ...correctionForm, requestedCheckOut: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                value={correctionForm.reason}
                placeholder="Explain what needs correcting"
                onChange={(event) =>
                  setCorrectionForm({ ...correctionForm, reason: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => requestCorrection.mutate()}
              disabled={
                requestCorrection.isPending ||
                !correctionForm.attendanceId ||
                !correctionForm.reason.trim() ||
                (!correctionForm.requestedCheckIn && !correctionForm.requestedCheckOut)
              }
            >
              {requestCorrection.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={complaintOpen} onOpenChange={setComplaintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a complaint</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input
                value={complaintForm.subject}
                onChange={(event) =>
                  setComplaintForm({ ...complaintForm, subject: event.target.value })
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Category</Label>
                <Input
                  placeholder="e.g. Workplace, Payroll, Harassment"
                  value={complaintForm.category}
                  onChange={(event) =>
                    setComplaintForm({ ...complaintForm, category: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <Select
                  value={complaintForm.priority}
                  onValueChange={(value) =>
                    setComplaintForm({ ...complaintForm, priority: value as ComplaintPriority })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={complaintForm.description}
                placeholder="Describe the issue in detail"
                onChange={(event) =>
                  setComplaintForm({ ...complaintForm, description: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComplaintOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => raiseComplaint.mutate()}
              disabled={
                raiseComplaint.isPending ||
                !complaintForm.subject.trim() ||
                !complaintForm.description.trim()
              }
            >
              {raiseComplaint.isPending ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
