import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Circle, X } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, CardsSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthForPath } from "@/lib/auth-guard";
import { istToday } from "@/lib/onboarding-schema";
import { shortDate } from "@/lib/format";
import { ROLE_LABELS, useSession } from "@/hooks/useSession";
import { onboardingService } from "@/services/onboardingService";
import { talentService } from "@/services/talentService";
import { ONBOARDING_STEPS, type OnboardingQueueBucket } from "@/types/onboarding";
import type { Role as AppRole } from "@/types";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => requireAuthForPath("/onboarding"),
  head: () => ({
    meta: [
      { title: "Onboarding · JeeVijay HRMS" },
      {
        name: "description",
        content: "Review new employee profiles, request changes, and approve joining details.",
      },
    ],
  }),
  component: OnboardingPage,
});

const BUCKETS: { id: OnboardingQueueBucket | "changes-panel"; label: string }[] = [
  { id: "incomplete", label: "Incomplete" },
  { id: "pending", label: "Pending review" },
  { id: "changes", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

const REVIEW_SECTIONS = ONBOARDING_STEPS.filter((step) => step.id !== "review");

function OnboardingPage() {
  const { role } = useSession();
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ["onboarding-queue"],
    queryFn: () => onboardingService.queue(),
  });
  const changes = useQuery({
    queryKey: ["profile-change-requests"],
    queryFn: () => onboardingService.changeRequests(),
  });
  const [tab, setTab] = useState("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = (queue.data ?? []).filter((item) => item.bucket === tab);
  const selected = rows.find((item) => item.employeeId === selectedId) ?? rows[0] ?? null;

  return (
    <AppLayout>
      <PageHeader
        eyebrow="People"
        title="Onboarding"
        description="Review self sign-ups, send sections back, and assign department, role and joining details."
      />

      {queue.isLoading ? (
        <CardsSkeleton count={3} className="sm:grid-cols-1 xl:grid-cols-1" />
      ) : queue.isError ? (
        <ErrorState
          message={queue.error instanceof Error ? queue.error.message : undefined}
          onRetry={() => void queue.refetch()}
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap">
            {BUCKETS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
                <span className="ml-1 text-xs text-muted-foreground">
                  {(queue.data ?? []).filter((row) => row.bucket === item.id).length}
                </span>
              </TabsTrigger>
            ))}
            <TabsTrigger value="changes-panel">Change requests</TabsTrigger>
          </TabsList>

          {BUCKETS.map((item) => (
            <TabsContent key={item.id} value={item.id} className="mt-4">
              {rows.length === 0 ? (
                <EmptyState
                  title="Nothing in this queue"
                  description="New sign-ups show up here once they create an account."
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {rows.map((row) => (
                      <button
                        key={row.employeeId}
                        type="button"
                        onClick={() => setSelectedId(row.employeeId)}
                        className={`w-full rounded-xl border px-3 py-3 text-left ${
                          selected?.employeeId === row.employeeId
                            ? "border-primary bg-muted/50"
                            : "bg-card"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          {row.stale ? <StatusBadge status="30+ days" tone="warning" /> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                      </button>
                    ))}
                  </div>
                  {selected ? (
                    <ReviewPane
                      employeeId={selected.employeeId}
                      bucket={item.id as OnboardingQueueBucket}
                      canAssignAdmin={role === "admin"}
                      onChanged={() =>
                        void queryClient.invalidateQueries({ queryKey: ["onboarding-queue"] })
                      }
                    />
                  ) : null}
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value="changes-panel" className="mt-4">
            {changes.isLoading ? (
              <CardsSkeleton count={2} className="sm:grid-cols-1 xl:grid-cols-1" />
            ) : changes.isError ? (
              <ErrorState
                message={changes.error instanceof Error ? changes.error.message : undefined}
                onRetry={() => void changes.refetch()}
              />
            ) : (changes.data ?? []).length === 0 ? (
              <EmptyState
                title="No profile change requests"
                description="Active employees request address, bank and mobile updates here."
              />
            ) : (
              <div className="grid gap-3">
                {(changes.data ?? []).map((request) => (
                  <ChangeRequestCard
                    key={request.id}
                    request={request}
                    onChanged={() =>
                      void queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] })
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </AppLayout>
  );
}

function ReviewPane({
  employeeId,
  bucket,
  canAssignAdmin,
  onChanged,
}: {
  employeeId: string;
  bucket: OnboardingQueueBucket;
  canAssignAdmin: boolean;
  onChanged: () => void;
}) {
  const detail = useQuery({
    queryKey: ["onboarding-draft", employeeId],
    queryFn: () => onboardingService.draft(employeeId),
  });
  const tasks = useQuery({
    queryKey: ["onboarding-tasks", employeeId],
    queryFn: () => onboardingService.tasks(employeeId),
    enabled: bucket === "approved",
  });
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");

  const requestChanges = useMutation({
    mutationFn: () => {
      const chosen = Object.fromEntries(
        Object.entries(flags).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      if (!Object.keys(chosen).length) throw new Error("Choose at least one section to send back.");
      return onboardingService.requestChanges(employeeId, chosen, remarks);
    },
    onSuccess: () => {
      toast.success("Changes requested");
      onChanged();
    },
    onError: (error) =>
      toast.error("Could not request changes", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const reject = useMutation({
    mutationFn: () => onboardingService.reject(employeeId, remarks),
    onSuccess: () => {
      toast.success("Application rejected");
      setRejectOpen(false);
      onChanged();
    },
    onError: (error) =>
      toast.error("Could not reject", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading profile…</p>;
  if (detail.isError) {
    return (
      <ErrorState
        message={detail.error instanceof Error ? detail.error.message : undefined}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data) return null;
  const profile = detail.data;
  const deciding = bucket === "pending" || bucket === "changes" || bucket === "incomplete";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <SectionCard
        title={[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")}
        description={profile.workEmail}
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Item label="Status" value={profile.employmentStatus} />
          <Item label="Submission" value={profile.submissionStatus} />
          <Item label="Mobile" value={profile.phone} />
          <Item label="Personal email" value={profile.personalEmail} />
          <Item label="Date of birth" value={profile.dateOfBirth} />
          <Item label="Father" value={`${profile.fatherName} ${profile.fatherPhone}`.trim()} />
          <Item label="Mother" value={`${profile.motherName} ${profile.motherPhone}`.trim()} />
          <Item label="Current address" value={formatAddress(profile.currentAddress)} />
          <Item
            label="Permanent address"
            value={
              profile.permanentAddress.sameAsCurrent
                ? "Same as current"
                : formatAddress(profile.permanentAddress)
            }
          />
          <Item label="PAN" value={profile.pan} />
          <Item
            label="Aadhaar"
            value={profile.aadhaar || (profile.aadhaarOnFile ? "Last 4 on file" : "")}
          />
          <Item
            label="Qualification"
            value={`${profile.qualification} · ${profile.institute} · ${profile.educationYear}`}
          />
          <Item
            label="Bank"
            value={`${profile.bankName} · ${profile.ifsc} · ${maskAccount(profile.accountNumber)}`}
          />
        </dl>
      </SectionCard>

      <div className="space-y-4">
        {deciding ? (
          <SectionCard
            title="Decision"
            description="Send specific sections back, or approve the joiner."
          >
            <div className="space-y-3">
              {REVIEW_SECTIONS.map((step) => (
                <label
                  key={step.id}
                  className="flex items-start gap-2 text-sm"
                  data-section={step.id}
                >
                  <Checkbox
                    checked={flags[step.id] !== undefined}
                    onCheckedChange={(checked) => {
                      setFlags((current) => {
                        const next = { ...current };
                        if (checked === true) next[step.id] = next[step.id] ?? "";
                        else delete next[step.id];
                        return next;
                      });
                    }}
                  />
                  <span className="grid flex-1 gap-1">
                    <span>{step.label}</span>
                    {flags[step.id] !== undefined ? (
                      <Input
                        value={flags[step.id]}
                        placeholder="What should they correct?"
                        onChange={(event) =>
                          setFlags((current) => ({ ...current, [step.id]: event.target.value }))
                        }
                      />
                    ) : null}
                  </span>
                </label>
              ))}
              <Textarea
                value={remarks}
                placeholder="Overall remarks"
                onChange={(event) => setRemarks(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => requestChanges.mutate()}
                  disabled={requestChanges.isPending}
                >
                  Request changes
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button onClick={() => setApproveOpen(true)}>Approve</Button>
              </div>
            </div>
          </SectionCard>
        ) : null}

        {bucket === "approved" ? (
          <SectionCard title="Joining tasks" description="Checklist for the approved employee.">
            {tasks.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading tasks…</p>
            ) : tasks.isError ? (
              <ErrorState
                message={tasks.error instanceof Error ? tasks.error.message : undefined}
                onRetry={() => void tasks.refetch()}
              />
            ) : (
              <TaskList
                recordId={tasks.data?.recordId ?? null}
                tasks={tasks.data?.tasks ?? []}
                taskTitle={taskTitle}
                onTitle={setTaskTitle}
                onChanged={() => void tasks.refetch()}
              />
            )}
          </SectionCard>
        ) : null}

        {profile.remarks ? (
          <p className="text-sm text-muted-foreground">Last remarks: {profile.remarks}</p>
        ) : null}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
          </DialogHeader>
          <Textarea
            value={remarks}
            placeholder="Reason the applicant will see"
            onChange={(event) => setRemarks(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!remarks.trim()) {
                  toast.error("A rejection reason is required.");
                  return;
                }
                reject.mutate();
              }}
              disabled={reject.isPending}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApproveDialog
        open={approveOpen}
        employeeId={employeeId}
        canAssignAdmin={canAssignAdmin}
        onOpenChange={setApproveOpen}
        onApproved={() => {
          setApproveOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function ApproveDialog({
  open,
  employeeId,
  canAssignAdmin,
  onOpenChange,
  onApproved,
}: {
  open: boolean;
  employeeId: string;
  canAssignAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: () => void;
}) {
  const references = useQuery({
    queryKey: ["onboarding-references"],
    queryFn: () => onboardingService.references(),
    enabled: open,
  });
  const [form, setForm] = useState({
    departmentId: "",
    designationId: "",
    role: "employee",
    managerId: "",
    shiftId: "",
    joiningDate: istToday(),
    employeeCode: "",
    overrideJoiningDateReason: "",
  });
  const past = form.joiningDate < istToday();
  const roles: AppRole[] = canAssignAdmin
    ? ["employee", "team_lead", "dept_head", "hr", "admin"]
    : ["employee", "team_lead", "dept_head", "hr"];
  const approve = useMutation({
    mutationFn: () =>
      onboardingService.approve({
        employeeId,
        ...form,
      }),
    onSuccess: () => {
      toast.success("Employee approved");
      onApproved();
    },
    onError: (error) =>
      toast.error("Could not approve", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve and assign</DialogTitle>
        </DialogHeader>
        {references.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading departments and shifts…</p>
        ) : references.isError ? (
          <ErrorState
            message={references.error instanceof Error ? references.error.message : undefined}
            onRetry={() => void references.refetch()}
          />
        ) : (
          <div className="grid gap-3">
            <Field label="Department">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.departmentId}
                onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
              >
                <option value="">Select</option>
                {(references.data?.departments ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Designation">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.designationId}
                onChange={(event) => setForm({ ...form, designationId: event.target.value })}
              >
                <option value="">Select</option>
                {(references.data?.designations ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              >
                {roles.map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reporting lead">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.managerId}
                onChange={(event) => setForm({ ...form, managerId: event.target.value })}
              >
                <option value="">None yet</option>
                {(references.data?.leads ?? [])
                  .filter((lead) => lead.id !== employeeId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Shift">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.shiftId}
                onChange={(event) => setForm({ ...form, shiftId: event.target.value })}
              >
                <option value="">None yet</option>
                {(references.data?.shifts ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Joining date">
              <Input
                type="date"
                value={form.joiningDate}
                onChange={(event) => setForm({ ...form, joiningDate: event.target.value })}
              />
            </Field>
            {past ? (
              <Field label="Reason for a past joining date">
                <Input
                  value={form.overrideJoiningDateReason}
                  onChange={(event) =>
                    setForm({ ...form, overrideJoiningDateReason: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <Field label="Employee code">
              <Input
                placeholder="Leave blank to generate"
                value={form.employeeCode}
                onChange={(event) => setForm({ ...form, employeeCode: event.target.value })}
              />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={approve.isPending || references.isError}
            onClick={() => {
              if (!form.departmentId || !form.designationId || !form.joiningDate) {
                toast.error("Department, designation and joining date are required.");
                return;
              }
              if (past && !form.overrideJoiningDateReason.trim()) {
                toast.error("Add a reason to use a joining date in the past.");
                return;
              }
              approve.mutate();
            }}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskList({
  recordId,
  tasks,
  taskTitle,
  onTitle,
  onChanged,
}: {
  recordId: string | null;
  tasks: { id: string; title: string; done: boolean }[];
  taskTitle: string;
  onTitle: (value: string) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: () => {
      if (!recordId) throw new Error("No joining checklist exists for this employee yet.");
      if (!taskTitle.trim()) throw new Error("Enter a task title.");
      return talentService.addOnboardingTask(recordId, { title: taskTitle.trim() });
    },
    onSuccess: () => {
      onTitle("");
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (error) =>
      toast.error("Could not add task", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });
  const toggle = useMutation({
    mutationFn: (task: { id: string; done: boolean }) =>
      talentService.toggleOnboardingTask(task.id, !task.done),
    onSuccess: () => onChanged(),
    onError: (error) =>
      toast.error("Could not update task", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  return (
    <div className="space-y-3">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist tasks yet.</p>
      ) : null}
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => toggle.mutate(task)}
              aria-label={task.done ? "Mark incomplete" : "Mark complete"}
            >
              {task.done ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <Circle className="size-4 text-muted-foreground" />
              )}
            </button>
            <span className={task.done ? "text-muted-foreground line-through" : ""}>
              {task.title}
            </span>
          </li>
        ))}
      </ul>
      {recordId ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <Input
            value={taskTitle}
            placeholder="Add a checklist task…"
            onChange={(event) => onTitle(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={add.isPending}>
            Add
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          The joining checklist is created when the profile is approved.
        </p>
      )}
    </div>
  );
}

function ChangeRequestCard({
  request,
  onChanged,
}: {
  request: Awaited<ReturnType<typeof onboardingService.changeRequests>>[number];
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = useState("");
  const review = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      onboardingService.reviewChange(request.id, decision, remarks),
    onSuccess: () => {
      toast.success("Change request updated");
      onChanged();
    },
    onError: (error) =>
      toast.error("Could not review the request", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });
  const summary = useMemo(() => JSON.stringify(request.payload), [request.payload]);
  return (
    <SectionCard
      title={`${request.employeeName || "Employee"} · ${request.section}`}
      {...(request.createdAt ? { description: shortDate(request.createdAt) } : {})}
      action={<StatusBadge status={request.status} />}
    >
      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{summary}</pre>
      {request.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={remarks}
            placeholder="Remarks"
            onChange={(event) => setRemarks(event.target.value)}
          />
          <div className="flex gap-2">
            <IconAction
              label="Approve"
              variant="default"
              onClick={() => review.mutate("approved")}
              disabled={review.isPending}
            >
              <Check />
            </IconAction>
            <IconAction
              label="Reject"
              variant="outline"
              onClick={() => review.mutate("rejected")}
              disabled={review.isPending}
            >
              <X />
            </IconAction>
          </div>
        </div>
      ) : request.remarks ? (
        <p className="mt-2 text-sm">{request.remarks}</p>
      ) : null}
    </SectionCard>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function formatAddress(address: {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}) {
  return [address.addressLine1, address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(", ");
}

function maskAccount(value: string) {
  if (!value) return "";
  return value.length <= 4
    ? value
    : `${"•".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}
