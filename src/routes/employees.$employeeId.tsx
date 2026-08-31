import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuth } from "@/lib/auth-guard";
import { useSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { employeeService } from "@/services/employeeService";
import { assetService } from "@/services/assetService";
import { attendanceService } from "@/services/attendanceService";
import { leaveService } from "@/services/leaveService";
import { talentService } from "@/services/talentService";
import { workplaceService } from "@/services/workplaceService";
import { complaintsService } from "@/services/complaintsService";
import { dayMonth, initialsOf, inr, percent, shortDate } from "@/lib/format";
import type { ComplaintPriority, ComplaintStatus } from "@/types";

const COMPLAINT_STATUSES: ComplaintStatus[] = ["open", "in-progress", "resolved", "closed"];

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
      { title: "Employee profile · TeamNest" },
      {
        name: "description",
        content:
          "Full employee profile: personal details, employment record, attendance, leave, assets, documents and performance.",
      },
      { property: "og:title", content: "Employee profile · TeamNest" },
      {
        property: "og:description",
        content: "Personal, employment, attendance, asset and performance records for a single employee.",
      },
    ],
  }),
  component: EmployeeDetailPage,
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function EmployeeDetailPage() {
  const { employeeId } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const { role, user } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab ?? "personal");
  const employee = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => employeeService.getById(employeeId),
  });
  const emp = employee.data;
  const fullName = emp ? `${emp.firstName} ${emp.lastName}` : "";
  const canManage = role === "admin" || role === "hr" || role === "manager";
  const isOwnProfile = employeeId === (user.employeeId ?? user.id);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    gender: "",
    dateOfBirth: "",
    bloodGroup: "",
    maritalStatus: "",
    workLocation: "",
    employmentType: "full-time",
    status: "active",
    exitDate: "",
  });
  const openEdit = () => {
    if (!emp) return;
    setEditForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      phone: emp.phone,
      gender: emp.gender,
      dateOfBirth: emp.dateOfBirth,
      bloodGroup: emp.bloodGroup,
      maritalStatus: emp.maritalStatus,
      workLocation: emp.location,
      employmentType: emp.employmentType,
      status: emp.status,
      exitDate: emp.exitDate ?? "",
    });
    setEditOpen(true);
  };
  const updateEmployee = useMutation({
    mutationFn: () => employeeService.update(employeeId, editForm),
    onSuccess: () => {
      toast.success("Profile updated");
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e) =>
      toast.error("Could not update profile", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

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
      return attendanceService.requestCorrection({
        employeeId,
        attendanceId: correctionForm.attendanceId,
        reason: correctionForm.reason,
        ...(correctionForm.requestedCheckIn
          ? { requestedCheckIn: `${targetDate}T${correctionForm.requestedCheckIn}:00` }
          : {}),
        ...(correctionForm.requestedCheckOut
          ? { requestedCheckOut: `${targetDate}T${correctionForm.requestedCheckOut}:00` }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success("Correction request submitted");
      setCorrectionOpen(false);
      setCorrectionForm({ attendanceId: "", requestedCheckIn: "", requestedCheckOut: "", reason: "" });
      void queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (e) =>
      toast.error("Could not submit correction", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const attendance = useQuery({
    queryKey: ["attendance", employeeId],
    queryFn: () => attendanceService.list({ employeeId }),
    enabled: Boolean(emp),
  });
  const leave = useQuery({
    queryKey: ["leave", employeeId],
    queryFn: () => leaveService.list({ employeeId }),
    enabled: Boolean(emp),
  });
  const leaveBalance = useQuery({
    queryKey: ["leave-balance", employeeId],
    queryFn: () => leaveService.balance(employeeId),
    enabled: Boolean(emp),
  });
  const assets = useQuery({
    queryKey: ["assets", employeeId],
    queryFn: () => assetService.assignedTo(employeeId),
    enabled: Boolean(emp),
  });
  const documents = useQuery({
    queryKey: ["documents", employeeId],
    queryFn: () => workplaceService.documentsOf(employeeId),
    enabled: Boolean(emp),
  });
  const goals = useQuery({
    queryKey: ["goals", employeeId],
    queryFn: () => talentService.goalsOf(employeeId),
    enabled: Boolean(emp),
  });
  const reviews = useQuery({
    queryKey: ["reviews", employeeId],
    queryFn: () => talentService.reviewsOf(employeeId),
    enabled: Boolean(emp),
  });

  // Only admin/hr can view or manage another employee's complaints (RLS
  // enforces this regardless); a manager only ever sees this list on their
  // own profile, via the self-select policy, same as an employee.
  const canManageComplaints = role === "admin" || role === "hr";
  const complaints = useQuery({
    queryKey: ["complaints", employeeId],
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
      void queryClient.invalidateQueries({ queryKey: ["complaints", employeeId] });
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
      void queryClient.invalidateQueries({ queryKey: ["complaints", employeeId] });
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
      void queryClient.invalidateQueries({ queryKey: ["complaints", employeeId] });
    },
    onError: (e) =>
      toast.error("Could not update assignment", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const assignableEmployees = useQuery({
    queryKey: ["employees", "assignable"],
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

  if (!emp) {
    return (
      <AppLayout>
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
            {canManage || isOwnProfile ? (
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

          <TabsContent value="personal" className="mt-4">
            <SectionCard title="Personal information" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Date of birth" value={shortDate(emp.dateOfBirth)} />
              <Field label="Marital status" value={emp.maritalStatus} />
              <Field label="Address" value={emp.address} />
              <Field label="Emergency contact" value={`${emp.emergencyContact.name} (${emp.emergencyContact.relation})`} />
              <Field label="Emergency phone" value={emp.emergencyContact.phone} />
            </SectionCard>
          </TabsContent>

          <TabsContent value="employment" className="mt-4 space-y-4">
            <SectionCard title="Employment" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Department" value={emp.department} />
              <Field label="Designation" value={emp.designation} />
              <Field label="Employment type" value={emp.employmentType} />
              <Field label="Manager" value={emp.managerName ?? "—"} />
              <Field label="Annual CTC" value={inr(emp.ctcAnnual)} />
              <Field label="Access role" value={emp.role} />
            </SectionCard>
            <SectionCard title="Bank details" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Account name" value={emp.bank.accountName} />
              <Field label="Bank" value={emp.bank.bankName} />
              <Field label="Account number" value={emp.bank.accountNumber} />
              <Field label="IFSC" value={emp.bank.ifsc} />
            </SectionCard>
          </TabsContent>

          <TabsContent value="attendance" className="mt-4">
            <SectionCard
              title="Recent attendance"
              bodyClassName="p-0"
              action={
                canManage || isOwnProfile ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!attendance.data?.length}
                    onClick={() => {
                      setCorrectionForm({
                        attendanceId: attendance.data?.[0]?.id ?? "",
                        requestedCheckIn: "",
                        requestedCheckOut: "",
                        reason: "",
                      });
                      setCorrectionOpen(true);
                    }}
                  >
                    Request correction
                  </Button>
                ) : null
              }
            >
              <ul className="divide-y divide-border">
                {(attendance.data ?? []).map((record) => (
                  <li key={record.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{shortDate(record.date)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        In {record.checkIn ?? "—"} · Out {record.checkOut ?? "—"} ·{" "}
                        {record.workedHours}h · {record.source}
                      </p>
                    </div>
                    <StatusBadge status={record.status} />
                  </li>
                ))}
                {attendance.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No attendance records yet.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>

          <TabsContent value="leave" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {(leaveBalance.data ?? []).map((entry) => (
                <div key={entry.id} className="surface-card p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{entry.name}</p>
                  <p className="mt-1 font-display text-2xl font-bold">{entry.remaining}</p>
                  <p className="text-xs text-muted-foreground">{entry.used} used of {entry.allocated}</p>
                </div>
              ))}
            </div>
            <SectionCard title="Leave history" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {(leave.data ?? []).map((request) => (
                  <li key={request.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{request.type} leave</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {dayMonth(request.from)} – {dayMonth(request.to)} · {request.days}d ·{" "}
                        {request.reason}
                      </p>
                    </div>
                    <StatusBadge status={request.status} />
                  </li>
                ))}
                {leave.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No leave history.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>

          <TabsContent value="assets" className="mt-4">
            <SectionCard title="Assigned assets" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {(assets.data ?? []).map((asset) => (
                  <li key={asset.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{asset.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {asset.tag} · {asset.serial} · issued {shortDate(asset.assignedOn)}
                      </p>
                    </div>
                    <StatusBadge status={asset.status} />
                  </li>
                ))}
                {assets.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No assets assigned.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <SectionCard title="Documents" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {(documents.data ?? []).map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{doc.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {doc.category} · {doc.size} · uploaded {shortDate(doc.uploadedOn)}
                      </p>
                    </div>
                    <StatusBadge status={doc.verified ? "verified" : "pending"} />
                  </li>
                ))}
                {documents.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No documents on file.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>

          <TabsContent value="performance" className="mt-4 space-y-4">
            <SectionCard title="Goals" bodyClassName="space-y-4 p-5">
              {(goals.data ?? []).map((goal) => (
                <div key={goal.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{goal.title}</p>
                    <StatusBadge status={goal.status} />
                  </div>
                  <Progress value={goal.progress} className="mt-2 h-2" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {percent(goal.progress)} · weight {goal.weight}% · due {shortDate(goal.dueDate)}
                  </p>
                </div>
              ))}
              {goals.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No goals for this cycle.</p>
              ) : null}
            </SectionCard>
            <SectionCard title="Review cycles" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {(reviews.data ?? []).map((review) => (
                  <li key={review.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{review.cycle}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Reviewer {review.reviewer} · self {review.selfScore} · manager{" "}
                        {review.managerScore}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">{review.finalRating}</span>
                    <StatusBadge status={review.status} />
                  </li>
                ))}
                {reviews.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No reviews recorded.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>

          <TabsContent value="complaints" className="mt-4">
            <SectionCard
              title="Complaints"
              description={
                canManageComplaints
                  ? "Raised complaints for this employee, within your organization."
                  : "Complaints you've raised and their current status."
              }
              bodyClassName="p-0"
              action={
                isOwnProfile ? (
                  <Button size="sm" onClick={() => setComplaintOpen(true)}>
                    Raise complaint
                  </Button>
                ) : undefined
              }
            >
              <ul className="divide-y divide-border">
                {(complaints.data ?? []).map((complaint) => (
                  <li key={complaint.id} className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{complaint.subject}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {complaint.category || "Uncategorized"} · {complaint.priority} priority · raised{" "}
                          {shortDate(complaint.createdAt)}
                        </p>
                        {complaint.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                            {complaint.description}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge status={complaint.status} />
                    </div>
                    {canManageComplaints ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground">Status</Label>
                          <Select
                            value={complaint.status}
                            onValueChange={(value) =>
                              updateComplaintStatus.mutate({ id: complaint.id, status: value as ComplaintStatus })
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {COMPLAINT_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground">Assigned to</Label>
                          <Select
                            value={complaint.assignedTo ?? "unassigned"}
                            onValueChange={(value) =>
                              updateComplaintAssignee.mutate({
                                id: complaint.id,
                                assignedTo: value === "unassigned" ? null : value,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-[180px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {(assignableEmployees.data ?? []).map((e) => (
                                <SelectItem key={e.id} value={e.id}>
                                  {e.firstName} {e.lastName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
                {complaints.data?.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No complaints raised.
                  </li>
                ) : null}
                {!isOwnProfile && !canManageComplaints ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                    You don't have access to manage complaints.
                  </li>
                ) : null}
              </ul>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["firstName", "First name", "text"],
                ["lastName", "Last name", "text"],
                ["phone", "Phone", "text"],
                ["gender", "Gender", "text"],
                ["dateOfBirth", "Date of birth", "date"],
                ["bloodGroup", "Blood group", "text"],
                ["maritalStatus", "Marital status", "text"],
                ["workLocation", "Location", "text"],
              ] as const
            ).map(([key, label, type]) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input
                  type={type}
                  value={editForm[key]}
                  onChange={(event) => setEditForm({ ...editForm, [key]: event.target.value })}
                />
              </div>
            ))}
            {canManage ? (
              <>
                <div className="space-y-1">
                  <Label>Employment type</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={editForm.employmentType}
                    onChange={(event) => setEditForm({ ...editForm, employmentType: event.target.value })}
                  >
                    <option value="full-time">Full-time</option>
                    <option value="part-time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={editForm.status}
                    onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="probation">Probation</option>
                    <option value="notice">Notice period</option>
                    <option value="on-leave">On leave</option>
                    <option value="resigned">Resigned</option>
                  </select>
                </div>
                {editForm.status === "resigned" ? (
                  <div className="space-y-1">
                    <Label>Exit date</Label>
                    <Input
                      type="date"
                      value={editForm.exitDate}
                      onChange={(event) => setEditForm({ ...editForm, exitDate: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used for Joiners vs exits and attrition reporting on the Dashboard.
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {!canManage ? (
            <p className="text-xs text-muted-foreground">
              Employment type and status are managed by HR/Admin.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => updateEmployee.mutate()} disabled={updateEmployee.isPending}>
              {updateEmployee.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    {shortDate(record.date)} · in {record.checkIn ?? "—"} · out {record.checkOut ?? "—"}
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
                onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })}
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
                onChange={(event) => setComplaintForm({ ...complaintForm, subject: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Category</Label>
                <Input
                  placeholder="e.g. Workplace, Payroll, Harassment"
                  value={complaintForm.category}
                  onChange={(event) => setComplaintForm({ ...complaintForm, category: event.target.value })}
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
                onChange={(event) => setComplaintForm({ ...complaintForm, description: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComplaintOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => raiseComplaint.mutate()}
              disabled={raiseComplaint.isPending || !complaintForm.subject.trim() || !complaintForm.description.trim()}
            >
              {raiseComplaint.isPending ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
