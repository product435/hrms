import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { requireAuth } from "@/lib/auth-guard";
import { useSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { employeeService } from "@/services/employeeService";
import { assetService } from "@/services/assetService";
import { attendanceService } from "@/services/attendanceService";
import { leaveService } from "@/services/leaveService";
import { talentService } from "@/services/talentService";
import { workplaceService } from "@/services/workplaceService";
import { dayMonth, initialsOf, inr, percent, shortDate } from "@/lib/format";

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
  const { role } = useSession();
  const employee = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => employeeService.getById(employeeId),
  });
  const emp = employee.data;
  const fullName = emp ? `${emp.firstName} ${emp.lastName}` : "";

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
  const assets = useQuery({
    queryKey: ["assets", fullName],
    queryFn: () => assetService.assignedTo(employeeId),
    enabled: Boolean(emp),
  });
  const documents = useQuery({
    queryKey: ["documents", fullName],
    queryFn: () => workplaceService.documentsOf(employeeId),
    enabled: Boolean(emp),
  });
  const goals = useQuery({
    queryKey: ["goals", fullName],
    queryFn: () => talentService.goalsOf(employeeId),
    enabled: Boolean(emp),
  });
  const reviews = useQuery({
    queryKey: ["reviews", fullName],
    queryFn: () => talentService.reviewsOf(employeeId),
    enabled: Boolean(emp),
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
            <Button variant="outline">Edit profile</Button>
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

        <Tabs defaultValue="personal" className="min-w-0">
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
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
            <SectionCard title="Recent attendance" bodyClassName="p-0">
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
              {(
                [
                  ["Casual", emp.leaveBalance.casual],
                  ["Sick", emp.leaveBalance.sick],
                  ["Earned", emp.leaveBalance.earned],
                  ["Unpaid", emp.leaveBalance.unpaid],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="surface-card p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                  <p className="mt-1 font-display text-2xl font-bold">{value}</p>
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
        </Tabs>
      </div>
    </AppLayout>
  );
}
