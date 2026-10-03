import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { InfoHint } from "@/components/common/InfoHint";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
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
import { settingsService } from "@/services/settingsService";

const WIPED = [
  "Attendance records and corrections",
  "Daily work reports, tasks and task comments",
  "Projects, members and project updates",
  "Leave requests and leave ledger",
  "Notifications and announcements",
  "Expenses, helpdesk tickets and complaints",
  "Goals, performance reviews, KPI scores and KRA assignments",
  "Asset assignments, requests and repairs",
  "Employee documents (files too)",
  "Onboarding, recruitment, payslips and unapproved payroll runs",
  "AI work-report analyses",
];

const KEPT = [
  "Organisation, settings, profiles and employees",
  "Departments, designations, roles and permissions",
  "Shifts, holidays and leave types",
  "Salary structures, KRA templates and KPI definitions",
  "Assets and job openings",
  "Audit logs (append-only) and approved payroll runs",
];

function formatWhen(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function BetaTab() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [betaDate, setBetaDate] = useState<string | null>(null);

  const betaUntil = useQuery({
    queryKey: ["beta-until"],
    queryFn: () => settingsService.betaUntil(),
  });
  const dateValue = betaDate ?? betaUntil.data ?? "";

  const health = useQuery({
    queryKey: ["cron-health"],
    queryFn: () => settingsService.cronHealth(),
    refetchInterval: 60_000,
  });

  const saveDate = useMutation({
    mutationFn: () => settingsService.setBetaUntil(dateValue || null),
    onSuccess: () => {
      toast.success("Beta end date saved");
      setBetaDate(null);
      void queryClient.invalidateQueries({ queryKey: ["beta-until"] });
    },
    onError: (e) =>
      toast.error("Could not save beta end date", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  const reset = useMutation({
    mutationFn: () => settingsService.resetBetaData(typed),
    onSuccess: (result) => {
      setOpen(false);
      setTyped("");
      const lines = Object.entries(result.counts)
        .filter(([, n]) => typeof n === "number" && n > 0)
        .map(([table, n]) => `${table}: ${n}`);
      const extra: string[] = [];
      if (result.skippedPayrollRuns.length > 0) {
        extra.push(
          `Kept ${result.skippedPayrollRuns.length} approved payroll run(s): ` +
            result.skippedPayrollRuns.map((r) => `${r.month}/${r.year}`).join(", "),
        );
      }
      if (result.storageRemoved > 0)
        extra.push(`Removed ${result.storageRemoved} document file(s)`);
      if (result.storageFailed > 0)
        extra.push(`${result.storageFailed} document file(s) could not be removed from storage`);
      toast.success("Beta data cleared", {
        description: [...lines, ...extra].join(" · ") || "Nothing to delete.",
        duration: 15000,
      });
      void queryClient.invalidateQueries();
    },
    onError: (e) =>
      toast.error("Reset failed. Nothing was deleted.", {
        description: e instanceof Error ? e.message : "Supabase request failed.",
      }),
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title={
          <span className="inline-flex items-center gap-1.5">
            Beta mode
            <InfoHint label="About beta mode">
              While a beta end date is set, everyone sees a banner that data may be reset. Clearing
              data is only allowed during this window. After the date passes, the banner hides and
              the reset is blocked.
            </InfoHint>
          </span>
        }
        description="While a beta end date is set, a banner tells everyone data may be reset. Clearing data is only allowed during this window."
        bodyClassName="space-y-4 p-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="beta-until">Beta ends on</Label>
            <Input
              id="beta-until"
              type="date"
              value={dateValue}
              onChange={(event) => setBetaDate(event.target.value)}
            />
          </div>
          <Button
            onClick={() => saveDate.mutate()}
            disabled={saveDate.isPending || betaUntil.isLoading}
          >
            {saveDate.isPending ? "Saving…" : "Save"}
          </Button>
          {dateValue && (
            <Button variant="outline" onClick={() => setBetaDate("")}>
              Clear date
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Automation health"
        description="Scheduled attendance and work-report jobs. A job that is missing or failing shows up here."
        bodyClassName="p-0"
      >
        <div className="divide-y divide-border">
          {health.isLoading && <p className="p-5 text-sm text-muted-foreground">Checking…</p>}
          {health.isError && (
            <p className="p-5 text-sm text-destructive">
              {health.error instanceof Error ? health.error.message : "Could not load job health."}
            </p>
          )}
          {health.data?.map((job) => {
            const ok = job.isScheduled && job.isActive && job.lastStatus !== "failed";
            return (
              <div key={job.jobName} className="flex items-start gap-3 p-4 text-sm">
                {ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 size-4 text-destructive" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold">{job.jobName}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.isScheduled ? `Schedule ${job.schedule}` : "Not scheduled"} · Last run{" "}
                    {formatWhen(job.lastRunAt)}
                    {job.lastStatus ? ` · ${job.lastStatus}` : ""}
                  </p>
                  {job.lastStatus === "failed" && job.lastMessage && (
                    <p className="mt-1 text-xs text-destructive">{job.lastMessage}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Danger zone"
        description="Clear beta data. This cannot be undone."
        bodyClassName="space-y-4 p-5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="mb-2 text-sm font-semibold">Will be deleted</p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {WIPED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-4">
            <p className="mb-2 text-sm font-semibold">Will be kept</p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {KEPT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <AlertTriangle className="mr-2 size-4" /> Clear beta data…
          </Button>
          <InfoHint label="About clearing beta data">
            Deletes operational data such as attendance, work reports, leave, and documents.
            Organisation setup, employees, and approved payroll runs are kept. This is only allowed
            while a beta end date is set, and it cannot be undone.
          </InfoHint>
        </div>
      </SectionCard>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (reset.isPending) return;
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all beta data?</DialogTitle>
            <DialogDescription>
              This permanently deletes the operational data listed in the Danger zone, in one step.
              If anything fails, nothing is deleted. Type <strong>RESET</strong> to continue.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="RESET"
            autoComplete="off"
            aria-label="Type RESET to confirm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={reset.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={typed !== "RESET" || reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "Clearing…" : "Delete beta data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
