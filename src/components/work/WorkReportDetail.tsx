import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SafeHtml } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { shortDate } from "@/lib/format";
import { workService } from "@/services/workService";
import type { DailyWorkReport } from "@/types/work";

const reviewSchema = z
  .object({
    decision: z.enum(["approved", "needs-revision"]),
    rating: z.string(),
    remarks: z.string().max(2000),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "approved" && !["1", "2", "3", "4", "5"].includes(value.rating)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a rating from 1 to 5.",
        path: ["rating"],
      });
    }
    if (value.decision === "needs-revision" && value.remarks.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remarks are required.",
        path: ["remarks"],
      });
    }
  });

type ReviewValues = z.infer<typeof reviewSchema>;

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Request failed.";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function WorkReportDetail({
  report,
  readOnly = false,
  canWaive = false,
  onReviewed,
}: {
  report: DailyWorkReport;
  readOnly?: boolean;
  canWaive?: boolean;
  onReviewed?: () => void;
}) {
  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { decision: "approved", rating: "5", remarks: "" },
  });
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: (values: ReviewValues) =>
      workService.reviewReport(
        report.id,
        values.decision,
        values.decision === "approved" ? Number(values.rating) : null,
        values.remarks,
      ),
    onSuccess: () => {
      toast.success("Review saved");
      onReviewed?.();
    },
    onError: (error) => toast.error("Could not save the review", { description: messageOf(error) }),
  });
  const reopen = useMutation({
    mutationFn: () => {
      if (!reason.trim()) throw new Error("A reason is required.");
      return workService.reopenReport(report.id, reason);
    },
    onSuccess: () => {
      toast.success("Report reopened");
      onReviewed?.();
    },
    onError: (error) =>
      toast.error("Could not reopen the report", { description: messageOf(error) }),
  });
  const waive = useMutation({
    mutationFn: () => {
      if (!reason.trim()) throw new Error("A reason is required.");
      return workService.waiveMissed(report.id, reason);
    },
    onSuccess: () => {
      toast.success("Missed report waived");
      onReviewed?.();
    },
    onError: (error) =>
      toast.error("Could not waive the report", { description: messageOf(error) }),
  });

  const approved = report.reviewStatus === "approved";
  const missed = report.status === "missed";
  const showActions = !readOnly;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={report.status} />
        <StatusBadge status={report.reviewStatus} />
        {report.escalated ? <StatusBadge status="escalated" tone="warning" /> : null}
        <span className="text-sm text-muted-foreground">{report.totalHours}h</span>
      </div>

      <Section title="Line items">
        {report.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border">
            {report.items.map((item) => (
              <li key={item.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">
                    {item.description || "Work item"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">{item.hours}h</span>
                    <StatusBadge status={item.itemStatus} />
                    {item.isUnplanned ? <StatusBadge status="unplanned" tone="warning" /> : null}
                  </div>
                </div>
                {item.descriptionHtml ? <SafeHtml html={item.descriptionHtml} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Day summary">
        {report.summaryHtml ? (
          <SafeHtml html={report.summaryHtml} />
        ) : (
          <p className="text-sm text-muted-foreground">No summary.</p>
        )}
      </Section>

      <Section title="Blockers">
        <p className="whitespace-pre-wrap text-sm">
          {report.blockers || <span className="text-muted-foreground">None</span>}
        </p>
      </Section>

      <Section title="Plan for tomorrow">
        <p className="whitespace-pre-wrap text-sm">
          {report.planForTomorrow || <span className="text-muted-foreground">None</span>}
        </p>
      </Section>

      {report.leadRating != null || report.leadRemarks ? (
        <Section title="Lead review">
          {report.leadRating != null ? (
            <p className="text-sm font-medium">Rating {report.leadRating} / 5</p>
          ) : null}
          {report.leadRemarks ? (
            <p className="whitespace-pre-wrap text-sm">{report.leadRemarks}</p>
          ) : null}
        </Section>
      ) : null}

      {report.reopenReason ? (
        <Section title="Reopen reason">
          <p className="whitespace-pre-wrap text-sm">{report.reopenReason}</p>
        </Section>
      ) : null}
      {report.waiverReason ? (
        <Section title="Waiver reason">
          <p className="whitespace-pre-wrap text-sm">{report.waiverReason}</p>
        </Section>
      ) : null}

      {showActions ? (
        missed && canWaive ? (
          <div className="grid gap-2">
            <Label htmlFor="waiver-reason">Waiver reason</Label>
            <Textarea
              id="waiver-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button onClick={() => waive.mutate()} disabled={waive.isPending}>
              Waive missed report
            </Button>
          </div>
        ) : approved ? (
          <div className="grid gap-2">
            <Label htmlFor="reopen-reason">Reason to reopen</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Reopen
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={form.handleSubmit((values) => review.mutate(values))}
          >
            <div className="grid gap-1.5">
              <Label>Decision</Label>
              <Select
                value={form.watch("decision")}
                onValueChange={(value) =>
                  form.setValue("decision", value as ReviewValues["decision"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approve</SelectItem>
                  <SelectItem value="needs-revision">Needs revision</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Rating</Label>
              <Select
                value={form.watch("rating")}
                onValueChange={(value) => form.setValue("rating", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.rating ? (
                <p className="text-xs text-destructive">{form.formState.errors.rating.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>Remarks</Label>
              <Textarea {...form.register("remarks")} />
              {form.formState.errors.remarks ? (
                <p className="text-xs text-destructive">{form.formState.errors.remarks.message}</p>
              ) : null}
            </div>
            <Button type="submit" disabled={review.isPending}>
              Save review
            </Button>
          </form>
        )
      ) : null}
    </div>
  );
}

export function WorkReportDetailDialog({
  report,
  onClose,
  readOnly = false,
  canWaive = false,
  onReviewed,
}: {
  report: DailyWorkReport | null;
  onClose: () => void;
  readOnly?: boolean;
  canWaive?: boolean;
  onReviewed?: () => void;
}) {
  return (
    <Dialog open={report != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {report ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {report.employeeName || "Work report"} · {shortDate(report.reportDate)}
              </DialogTitle>
            </DialogHeader>
            <WorkReportDetail
              key={report.id}
              report={report}
              readOnly={readOnly}
              canWaive={canWaive}
              {...(onReviewed ? { onReviewed } : {})}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
