import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { InfoHint } from "@/components/common/InfoHint";
import { StatCard } from "@/components/common/StatCard";
import { EmptyState, ErrorState } from "@/components/common/States";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requireAuthForPath } from "@/lib/auth-guard";
import { indiaDateKey } from "@/lib/format";
import { buildInsightsPdf, downloadPdf } from "@/lib/insights-pdf";
import { deliveryInsightsService } from "@/services/deliveryInsightsService";
import { workService } from "@/services/workService";

export const Route = createFileRoute("/insights")({
  beforeLoad: () => requireAuthForPath("/insights"),
  head: () => ({ meta: [{ title: "AI Insights · JeeVijay HRMS" }] }),
  component: InsightsPage,
});

// Explicit hex colours: the PDF export rasterises the SVG, where CSS variables do not resolve.
const SCORE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea"];
const DELIVERY_COLORS = {
  onTime: "#16a34a",
  late: "#d97706",
  overdue: "#dc2626",
  upcoming: "#64748b",
};

const pct = (value: number | null) => (value == null ? "n/a" : `${Math.round(value * 100)}%`);

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

function daysAgoKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return indiaDateKey(date.toISOString());
}

function InsightsPage() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState(() => daysAgoKey(29));
  const [to, setTo] = useState(() => indiaDateKey());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cached, setCached] = useState(false);
  const pieRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const directory = useQuery({
    queryKey: ["insights", "directory"],
    queryFn: () => workService.listDirectory(),
  });
  const validPeriod =
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const ready = Boolean(employeeId) && validPeriod;

  const metrics = useQuery({
    queryKey: ["insights", "metrics", employeeId, from, to],
    queryFn: () => deliveryInsightsService.metrics(employeeId, from, to),
    enabled: ready,
  });
  const analysis = useQuery({
    queryKey: ["insights", "analysis", employeeId, from, to],
    queryFn: () => deliveryInsightsService.latestAnalysis(employeeId, from, to),
    enabled: ready,
  });

  const analyze = useMutation({
    mutationFn: () => deliveryInsightsService.analyze(employeeId, from, to),
    onSuccess: (result) => {
      setConfirmOpen(false);
      setCached(result.outcome === "cached");
      if (result.outcome === "failed") {
        toast.error("Analysis failed", { description: result.error ?? "Try again shortly." });
        return;
      }
      toast.success(
        result.outcome === "cached"
          ? "Nothing changed since the last analysis"
          : result.outcome === "insufficient_data"
            ? "Not enough reports for a fair analysis"
            : "Analysis updated",
      );
      void queryClient.invalidateQueries({ queryKey: ["insights", "analysis"] });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.error("Could not run the analysis", { description: messageOf(error) });
    },
  });

  const employeeName = directory.data?.find((e) => e.id === employeeId)?.name ?? "";
  const data = metrics.data;
  const result = analysis.data ?? null;

  const scoreData = useMemo(
    () =>
      result?.scores
        ? [
            { name: "Delivery", value: result.scores.delivery },
            { name: "Consistency", value: result.scores.consistency },
            { name: "Communication", value: result.scores.communication },
            { name: "Blocker resolution", value: result.scores.blockerResolution },
          ]
        : [],
    [result],
  );
  const deliveryData = data
    ? [
        { name: "On time", value: data.tasks.completedOnTime, fill: DELIVERY_COLORS.onTime },
        { name: "Late", value: data.tasks.completedLate, fill: DELIVERY_COLORS.late },
        { name: "Overdue", value: data.tasks.openPastDue, fill: DELIVERY_COLORS.overdue },
        { name: "Upcoming", value: data.tasks.openNotYetDue, fill: DELIVERY_COLORS.upcoming },
      ]
    : [];

  const exportPdf = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Load a period first.");
      const bytes = await buildInsightsPdf({
        employeeName,
        metrics: data,
        analysis: result,
        chartElements: [pieRef.current, barRef.current],
      });
      downloadPdf(
        bytes,
        `insights-${(employeeName || "employee").replace(/\s+/g, "-")}-${from}-${to}.pdf`,
      );
    },
    onError: (error) => toast.error("Could not export the PDF", { description: messageOf(error) }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title="AI Insights"
        description="On-time delivery and work-report compliance are computed from records. The AI only adds the narrative."
      />
      <SectionCard title="Choose employee and period">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto]">
          <div className="grid gap-1.5">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={directory.isLoading ? "Loading…" : "Choose an employee"}
                />
              </SelectTrigger>
              <SelectContent>
                {(directory.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="insights-from">From</Label>
            <Input
              id="insights-from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="insights-to">To</Label>
            <Input
              id="insights-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              disabled={!data || exportPdf.isPending}
              onClick={() => exportPdf.mutate()}
            >
              <Download className="size-4" /> PDF
            </Button>
          </div>
        </div>
        {!validPeriod ? (
          <p className="mt-2 text-sm text-destructive">Choose a valid period (up to 93 days).</p>
        ) : null}
      </SectionCard>

      {!employeeId ? (
        <div className="mt-4">
          <EmptyState
            title="Choose an employee"
            description="Pick someone to see their delivery metrics."
          />
        </div>
      ) : metrics.isError ? (
        <div className="mt-4">
          <ErrorState message={messageOf(metrics.error)} />
        </div>
      ) : data ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Tasks due in period"
              value={String(data.tasks.dueInPeriod)}
              hint={`${data.tasks.completed} completed`}
              info={
                <InfoHint label="About tasks due in period">
                  Tasks whose due date falls in the selected period. This count is computed from
                  task records.
                </InfoHint>
              }
            />
            <StatCard
              label="On-time rate"
              value={pct(data.tasks.onTimeRate)}
              hint={
                data.tasks.completedLate > 0 && data.tasks.medianDaysLate != null
                  ? `Late ones: median ${data.tasks.medianDaysLate} days`
                  : "Of completed tasks"
              }
              tone="success"
              info={
                <InfoHint label="About the on-time rate">
                  Share of completed tasks finished by their due date. Computed from task records,
                  not by the AI.
                </InfoHint>
              }
            />
            <StatCard
              label="Open past due"
              value={String(data.tasks.openPastDue)}
              tone="destructive"
              info={
                <InfoHint label="About open past due">
                  Tasks that are still open after their due date.
                </InfoHint>
              }
            />
            <StatCard
              label="Report submission"
              value={pct(data.dwr.submissionRate)}
              hint={`${data.dwr.submittedOnTime + data.dwr.submittedLate} of ${data.dwr.expectedDays} expected days`}
              tone="info"
              info={
                <InfoHint label="About report submission">
                  Share of expected working days that have a submitted or late work report.
                </InfoHint>
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Task delivery"
              description="Completed on time vs late, and what is still open."
            >
              <div ref={barRef} className="h-64">
                {deliveryData.every((d) => d.value === 0) ? (
                  <p className="pt-8 text-center text-sm text-muted-foreground">
                    No tasks were due in this period.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deliveryData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475569" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#475569" }} />
                      <Bar dataKey="value" isAnimationActive={false}>
                        {deliveryData.map((d) => (
                          <Cell key={d.name} fill={d.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title={
                <span className="inline-flex items-center gap-1.5">
                  AI score breakdown
                  <InfoHint label="About AI insight scores">
                    Each score is 0–100 and advisory. Scores are not written to KPI scores. Delivery
                    is how work was finished against what was due. Consistency is how steadily
                    reports and work showed up. Communication is how clear the written reports are.
                    Blocker resolution is how blockers in the reports were handled. Fewer than 3
                    submitted reports are not scored. Thin evidence is scored near 50.
                  </InfoHint>
                </span>
              }
              description={
                result
                  ? `Model ${result.model ?? "n/a"} · prompt v1`
                  : "Run an analysis to see scores."
              }
              action={
                <div className="flex items-center gap-2">
                  {cached ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                      Cached · unchanged
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!ready || analyze.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Sparkles className="size-4" /> {result ? "Re-analyze" : "Analyze"}
                  </Button>
                </div>
              }
            >
              <div ref={pieRef} className="h-64">
                {scoreData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={scoreData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius="70%"
                        isAnimationActive={false}
                        label={({ name, value }) => `${name} ${value}`}
                      >
                        {scoreData.map((d, i) => (
                          <Cell key={d.name} fill={SCORE_COLORS[i % SCORE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="pt-8 text-center text-sm text-muted-foreground">
                    {result?.status === "insufficient_data"
                      ? "Not enough submitted reports for a fair score."
                      : "No analysis for this period yet."}
                  </p>
                )}
              </div>
            </SectionCard>
          </div>

          {result ? (
            <SectionCard title="Narrative">
              <p className="text-sm">{result.summary}</p>
              {result.strengths.length ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">Strengths</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {result.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.risks.length ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">Risks</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {result.risks.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                Generated {new Date(result.createdAt).toLocaleString()} · {result.tokensUsed} tokens
                . Scores are advisory and are not written to KPI scores.
              </p>
            </SectionCard>
          ) : null}

          {data.byProject.length > 0 ? (
            <SectionCard title="By project">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Project</th>
                      <th className="py-1 pr-4 font-medium">Due</th>
                      <th className="py-1 pr-4 font-medium">On time</th>
                      <th className="py-1 pr-4 font-medium">Late</th>
                      <th className="py-1 font-medium">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProject.map((p) => (
                      <tr key={p.projectId ?? "none"} className="border-t">
                        <td className="py-1 pr-4">{p.projectName}</td>
                        <td className="py-1 pr-4">{p.assigned}</td>
                        <td className="py-1 pr-4">{p.onTime}</td>
                        <td className="py-1 pr-4">{p.late}</td>
                        <td className="py-1">{p.openOverdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : metrics.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading metrics…</p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run AI analysis?</DialogTitle>
            <DialogDescription>
              This sends the work reports of {employeeName || "this employee"} from {from} to {to}{" "}
              to the AI model (one request, billed to your OpenAI account). If nothing changed since
              the last run, the saved result is reused at no cost. Employees with fewer than 3
              submitted reports are not scored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={analyze.isPending} onClick={() => analyze.mutate()}>
              {analyze.isPending ? "Analyzing…" : "Run analysis"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
