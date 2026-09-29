import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { IconAction } from "@/components/common/IconAction";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthForPath } from "@/lib/auth-guard";
import { usePermissions } from "@/hooks/usePermissions";
import { kraService } from "@/services/kraService";
import {
  KPI_SOURCE_LABELS,
  STANDARD_KRA_SET,
  currentKraPeriod,
  formatKraScore,
  templateSetKey,
  type KraCatalog,
  type KraTemplate,
  type KraTemplateDraft,
  type KpiDirection,
  type KpiSource,
  type PerformanceBand,
} from "@/types/kra";

export const Route = createFileRoute("/kra")({
  beforeLoad: () => requireAuthForPath("/kra"),
  head: () => ({
    meta: [{ title: "KRA & KPI · JeeVijay HRMS" }],
  }),
  component: KraPage,
});

const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Try again.";
}

function bandClass(band: PerformanceBand) {
  if (band === "Outstanding") return "bg-success/15 text-success";
  if (band === "Exceeds") return "bg-info/15 text-info";
  if (band === "Meets") return "bg-primary/10 text-primary";
  if (band === "Needs Improvement") return "bg-warning/20 text-warning";
  return "bg-muted text-muted-foreground";
}

function BandLabel({ band }: { band: PerformanceBand }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${bandClass(band)}`}>
      {band}
    </span>
  );
}

function blankKpi(): KraTemplateDraft["kpis"][number] {
  return { metric: "", unit: "%", target: null, direction: "higher", source: "manual" };
}

function draftsForSet(
  templates: KraTemplate[],
  departmentId: string | null,
  designationId: string | null,
): KraTemplateDraft[] {
  const rows = templates.filter(
    (template) =>
      template.departmentId === departmentId && template.designationId === designationId,
  );
  if (rows.length === 0) {
    return [{ name: "", weightage: 0, kpis: [blankKpi()] }];
  }
  return rows.map((template) => ({
    id: template.id,
    name: template.name,
    weightage: template.weightage,
    kpis: template.kpis.map((kpi) => ({ ...kpi })),
  }));
}

function KraPage() {
  const { role, user, isEmployee, isDeptHead } = usePermissions();
  const canAuthor = role === "admin" || role === "hr";
  const canAssign = canAuthor || isDeptHead;
  const [period, setPeriod] = useState(currentKraPeriod);
  const [tab, setTab] = useState(canAuthor ? "templates" : isDeptHead ? "targets" : "scores");

  const catalog = useQuery({ queryKey: ["kra-catalog"], queryFn: () => kraService.catalog() });
  const templates = useQuery({
    queryKey: ["kra-templates"],
    queryFn: () => kraService.templates(),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Growth"
        title={isEmployee ? "My KRA & KPI" : "KRA & KPI"}
        description="Weighted KRAs, monthly KPI scores, and the performance index used as the manager reference on reviews."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="kra-period" className="sr-only">
              Month
            </Label>
            <div className="w-full max-w-54">
              <Input
                id="kra-period"
                type="month"
                className="w-full min-w-0"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </div>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {canAuthor ? <TabsTrigger value="templates">Templates</TabsTrigger> : null}
          {isDeptHead && !canAuthor ? (
            <TabsTrigger value="targets">Department targets</TabsTrigger>
          ) : null}
          {canAssign ? <TabsTrigger value="assignments">Assignments</TabsTrigger> : null}
          <TabsTrigger value="scores">Scores</TabsTrigger>
        </TabsList>

        {canAuthor ? (
          <TabsContent value="templates" className="mt-4">
            <TemplateEditor
              {...(catalog.data ? { catalog: catalog.data } : {})}
              templates={templates.data ?? []}
              templatesError={templates.error}
              loading={templates.isLoading}
            />
          </TabsContent>
        ) : null}

        {isDeptHead && !canAuthor ? (
          <TabsContent value="targets" className="mt-4">
            <TargetEditor
              {...(catalog.data ? { catalog: catalog.data } : {})}
              templates={templates.data ?? []}
              {...(user.employeeId != null ? { employeeId: user.employeeId } : {})}
              loading={templates.isLoading || catalog.isLoading}
            />
          </TabsContent>
        ) : null}

        {canAssign ? (
          <TabsContent value="assignments" className="mt-4">
            <AssignmentEditor
              period={period}
              {...(catalog.data ? { catalog: catalog.data } : {})}
              templates={templates.data ?? []}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="scores" className="mt-4">
          <ScoresPanel
            period={period}
            canCalculate={canAssign || role === "team_lead"}
            canEnterManual={!isEmployee}
            {...(user.employeeId != null ? { selfEmployeeId: user.employeeId } : {})}
          />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

function TemplateEditor({
  catalog,
  templates,
  templatesError,
  loading,
}: {
  catalog?: KraCatalog;
  templates: KraTemplate[];
  templatesError: unknown;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [drafts, setDrafts] = useState<KraTemplateDraft[]>([
    { name: "", weightage: 0, kpis: [blankKpi()] },
  ]);
  const loadedKey = useRef<string | null>(null);
  const setKey = templateSetKey(departmentId || null, designationId || null);
  const total = drafts.reduce((sum, draft) => sum + (Number(draft.weightage) || 0), 0);

  useEffect(() => {
    if (loading) return;
    if (loadedKey.current === setKey) return;
    loadedKey.current = setKey;
    setDrafts(draftsForSet(templates, departmentId || null, designationId || null));
  }, [loading, setKey, templates, departmentId, designationId]);

  const save = useMutation({
    mutationFn: () =>
      kraService.saveTemplateSet({
        departmentId: departmentId || null,
        designationId: designationId || null,
        templates: drafts.map((draft) => ({
          ...draft,
          name: draft.name.trim(),
          weightage: Number(draft.weightage),
          kpis: draft.kpis.map((kpi) => ({
            ...kpi,
            metric: kpi.metric.trim(),
            target:
              kpi.target == null || Number.isNaN(Number(kpi.target)) ? null : Number(kpi.target),
          })),
        })),
      }),
    onSuccess: () => {
      toast.success("KRA set saved");
      loadedKey.current = null;
      void queryClient.invalidateQueries({ queryKey: ["kra-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["kra-grid"] });
    },
    onError: (error) => toast.error("Could not save KRA set", { description: errorText(error) }),
  });

  if (loading) return <TableSkeleton />;
  if (templatesError)
    return (
      <ErrorState
        onRetry={() => void queryClient.invalidateQueries({ queryKey: ["kra-templates"] })}
      />
    );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Template set"
        description="One set for a designation (and optional department) must total 100. Saving updates this set in one step."
        action={
          <Button
            variant="outline"
            onClick={() => {
              loadedKey.current = setKey;
              setDrafts(
                STANDARD_KRA_SET.map((template) => ({
                  ...template,
                  kpis: template.kpis.map((kpi) => ({ ...kpi })),
                })),
              );
            }}
          >
            Use standard set
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="kra-department">Department</Label>
            <select
              id="kra-department"
              className={fieldClass}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">All departments</option>
              {(catalog?.departments ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="kra-designation">Designation</Label>
            <select
              id="kra-designation"
              className={fieldClass}
              value={designationId}
              onChange={(event) => setDesignationId(event.target.value)}
            >
              <option value="">All designations</option>
              {(catalog?.designations ?? []).map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className={`mt-3 text-sm ${total === 100 ? "text-success" : "text-warning"}`}>
          Weight total {total}. Sets can be saved only when this is 100.
        </p>
      </SectionCard>

      {drafts.map((draft, index) => (
        <SectionCard
          key={draft.id ?? `new-${index}`}
          title={`KRA ${index + 1}`}
          action={
            drafts.length > 1 ? (
              <IconAction
                label="Remove"
                variant="outline"
                onClick={() => setDrafts((current) => current.filter((_, item) => item !== index))}
              >
                <Trash2 />
              </IconAction>
            ) : null
          }
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <div>
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <div>
              <Label>Weight</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={draft.weightage || ""}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, weightage: Number(event.target.value) }
                        : item,
                    ),
                  )
                }
              />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {draft.kpis.map((kpi, kpiIndex) => (
              <div
                key={kpi.id ?? `${index}-${kpiIndex}`}
                className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-6"
              >
                <div className="md:col-span-2">
                  <Label>Metric</Label>
                  <Input
                    value={kpi.metric}
                    onChange={(event) =>
                      updateKpi(setDrafts, index, kpiIndex, { metric: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Input
                    value={kpi.unit}
                    onChange={(event) =>
                      updateKpi(setDrafts, index, kpiIndex, { unit: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Target</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={kpi.target ?? ""}
                    onChange={(event) =>
                      updateKpi(setDrafts, index, kpiIndex, {
                        target: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Direction</Label>
                  <select
                    className={fieldClass}
                    value={kpi.direction}
                    onChange={(event) =>
                      updateKpi(setDrafts, index, kpiIndex, {
                        direction: event.target.value as KpiDirection,
                      })
                    }
                  >
                    <option value="higher">Higher is better</option>
                    <option value="lower">Lower is better</option>
                  </select>
                </div>
                <div>
                  <Label>Source</Label>
                  <select
                    className={fieldClass}
                    value={kpi.source}
                    onChange={(event) =>
                      updateKpi(setDrafts, index, kpiIndex, {
                        source: event.target.value as KpiSource,
                      })
                    }
                  >
                    {(Object.keys(KPI_SOURCE_LABELS) as KpiSource[]).map((source) => (
                      <option key={source} value={source}>
                        {KPI_SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-6">
                  <IconAction
                    label="Remove KPI"
                    variant="outline"
                    disabled={draft.kpis.length === 1}
                    onClick={() =>
                      setDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                kpis: item.kpis.filter(
                                  (_, currentIndex) => currentIndex !== kpiIndex,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <Trash2 />
                  </IconAction>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDrafts((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, kpis: [...item.kpis, blankKpi()] } : item,
                  ),
                )
              }
            >
              <Plus className="size-4" /> Add KPI
            </Button>
          </div>
        </SectionCard>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            setDrafts((current) => [...current, { name: "", weightage: 0, kpis: [blankKpi()] }])
          }
        >
          <Plus className="size-4" /> Add KRA
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || total !== 100}>
          {save.isPending ? "Saving…" : "Save set"}
        </Button>
      </div>
    </div>
  );
}

function updateKpi(
  setDrafts: Dispatch<SetStateAction<KraTemplateDraft[]>>,
  templateIndex: number,
  kpiIndex: number,
  patch: Partial<KraTemplateDraft["kpis"][number]>,
) {
  setDrafts((current) =>
    current.map((template, index) =>
      index === templateIndex
        ? {
            ...template,
            kpis: template.kpis.map((kpi, currentIndex) =>
              currentIndex === kpiIndex ? { ...kpi, ...patch } : kpi,
            ),
          }
        : template,
    ),
  );
}

function TargetEditor({
  catalog,
  templates,
  employeeId,
  loading,
}: {
  catalog?: KraCatalog;
  templates: KraTemplate[];
  employeeId?: string | null;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const headed = (catalog?.departments ?? []).filter(
    (department) => department.managerId && department.managerId === employeeId,
  );
  const [departmentId, setDepartmentId] = useState(headed[0]?.id ?? "");
  const rows = templates.filter(
    (template) => template.departmentId === (departmentId || headed[0]?.id),
  );
  const [targets, setTargets] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const updates = rows.flatMap((template) =>
        template.kpis
          .filter(
            (kpi) =>
              targets[kpi.id] != null &&
              targets[kpi.id] !== "" &&
              Number(targets[kpi.id]) !== kpi.target,
          )
          .map((kpi) => ({ kpiDefinitionId: kpi.id, target: Number(targets[kpi.id]) })),
      );
      if (updates.length === 0) throw new Error("Change a target before saving.");
      return kraService.adjustTargets(departmentId || headed[0]?.id || "", updates);
    },
    onSuccess: () => {
      toast.success("Targets updated");
      setTargets({});
      void queryClient.invalidateQueries({ queryKey: ["kra-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["kra-grid"] });
    },
    onError: (error) => toast.error("Could not update targets", { description: errorText(error) }),
  });

  if (loading) return <TableSkeleton />;
  if (headed.length === 0) {
    return (
      <EmptyState
        title="No department to adjust"
        description="Targets can be changed for departments you head."
        icon={LineChart}
      />
    );
  }

  return (
    <SectionCard
      title="Department targets"
      description="These updates apply only to KRA templates scoped to a department you head."
      action={
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save targets"}
        </Button>
      }
    >
      {headed.length > 1 ? (
        <select
          className={`${fieldClass} mb-4 max-w-sm`}
          value={departmentId || headed[0]?.id || ""}
          onChange={(event) => setDepartmentId(event.target.value)}
        >
          {headed.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          HR has not published a template set for this department yet.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((template) => (
            <div key={template.id}>
              <p className="text-sm font-semibold">
                {template.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · weight {template.weightage}
                </span>
              </p>
              <div className="mt-2 space-y-2">
                {template.kpis.map((kpi) => (
                  <label
                    key={kpi.id}
                    className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_140px] text-sm"
                  >
                    <span>
                      {kpi.metric}
                      <span className="ml-2 text-xs text-muted-foreground">
                        current target {kpi.target ?? "—"} {kpi.unit}
                      </span>
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="New target"
                      value={targets[kpi.id] ?? ""}
                      onChange={(event) =>
                        setTargets((current) => ({ ...current, [kpi.id]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AssignmentEditor({
  period,
  catalog,
  templates,
}: {
  period: string;
  catalog?: KraCatalog;
  templates: KraTemplate[];
}) {
  const queryClient = useQueryClient();
  const assignments = useQuery({
    queryKey: ["kra-assignments", period],
    queryFn: () => kraService.assignments(period),
  });
  const sets = useMemo(() => groupSets(templates, catalog), [templates, catalog]);
  const [employeeId, setEmployeeId] = useState("");
  const [setId, setSetId] = useState("");
  const activeSetId = setId || sets[0]?.key || "";

  const save = useMutation({
    mutationFn: () => {
      const selected = sets.find((set) => set.key === activeSetId);
      if (!employeeId || !selected) throw new Error("Choose an employee and a KRA set.");
      return kraService.assign({ employeeId, cycle: period, templateIds: selected.templateIds });
    },
    onSuccess: () => {
      toast.success("KRAs assigned");
      void queryClient.invalidateQueries({ queryKey: ["kra-assignments", period] });
      void queryClient.invalidateQueries({ queryKey: ["kra-grid", period] });
    },
    onError: (error) => toast.error("Could not assign KRAs", { description: errorText(error) }),
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title={`Assign for ${period}`}
        description="Assign a complete set. Its weights must already total 100."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="assign-employee">Employee</Label>
            <select
              id="assign-employee"
              className={fieldClass}
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">Select employee</option>
              {(catalog?.employees ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="assign-set">KRA set</Label>
            <select
              id="assign-set"
              className={fieldClass}
              value={activeSetId}
              onChange={(event) => setSetId(event.target.value)}
            >
              {sets.map((set) => (
                <option key={set.key} value={set.key}>
                  {set.label} · {set.weight}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button
          className="mt-3"
          onClick={() => save.mutate()}
          disabled={save.isPending || sets.length === 0}
        >
          {save.isPending ? "Assigning…" : "Assign set"}
        </Button>
      </SectionCard>

      {assignments.isLoading ? (
        <TableSkeleton />
      ) : assignments.isError ? (
        <ErrorState onRetry={() => void assignments.refetch()} />
      ) : (assignments.data ?? []).length === 0 ? (
        <EmptyState
          title="No assignments this month"
          description="People without an assignment use the closest designation or department set."
          icon={LineChart}
        />
      ) : (
        <SectionCard title="Assigned this month" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(assignments.data ?? []).map((assignment) => {
              const employee = catalog?.employees.find((item) => item.id === assignment.employeeId);
              return (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <span className="font-medium">{employee?.name ?? "Employee"}</span>
                  <span className="text-muted-foreground">
                    {assignment.templateIds.length} KRAs
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function groupSets(templates: KraTemplate[], catalog?: KraCatalog) {
  const groups = new Map<string, KraTemplate[]>();
  templates.forEach((template) => {
    const key = templateSetKey(template.departmentId, template.designationId);
    groups.set(key, [...(groups.get(key) ?? []), template]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const department =
      catalog?.departments.find((item) => item.id === rows[0]?.departmentId)?.name ??
      "All departments";
    const designation =
      catalog?.designations.find((item) => item.id === rows[0]?.designationId)?.name ??
      "All designations";
    return {
      key,
      label: `${designation} · ${department}`,
      weight: rows.reduce((sum, row) => sum + row.weightage, 0),
      templateIds: rows.map((row) => row.id),
    };
  });
}

function ScoresPanel({
  period,
  canCalculate,
  canEnterManual,
  selfEmployeeId,
}: {
  period: string;
  canCalculate: boolean;
  canEnterManual: boolean;
  selfEmployeeId?: string | null;
}) {
  const queryClient = useQueryClient();
  const grid = useQuery({
    queryKey: ["kra-grid", period],
    queryFn: () => kraService.scoreGrid(period),
  });
  const people = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        index: number | null;
        band: PerformanceBand;
        prorated: boolean;
        measuredFrom: string | null;
      }
    >();
    (grid.data ?? []).forEach((row) => {
      if (!map.has(row.employeeId)) {
        map.set(row.employeeId, {
          id: row.employeeId,
          name: row.employeeName,
          index: row.performanceIndex,
          band: row.band,
          prorated: row.prorated,
          measuredFrom: row.measuredFrom,
        });
      }
    });
    return [...map.values()];
  }, [grid.data]);
  const [employeeId, setEmployeeId] = useState("");
  const selectedId =
    employeeId ||
    (people.some((person) => person.id === selfEmployeeId) ? selfEmployeeId : people[0]?.id) ||
    "";
  const selected = people.find((person) => person.id === selectedId);
  const rows = (grid.data ?? []).filter((row) => row.employeeId === selectedId);
  const trend = useQuery({
    queryKey: ["kra-trend", selectedId, period],
    queryFn: () => kraService.trend(selectedId, period, 6),
    enabled: Boolean(selectedId),
  });

  const calculate = useMutation({
    mutationFn: () => kraService.compute(period),
    onSuccess: (count) => {
      toast.success("Auto scores updated", { description: `${count} score rows written.` });
      void queryClient.invalidateQueries({ queryKey: ["kra-grid", period] });
      void queryClient.invalidateQueries({ queryKey: ["kra-trend"] });
      void queryClient.invalidateQueries({ queryKey: ["kra-performance-index"] });
    },
    onError: (error) =>
      toast.error("Could not calculate scores", { description: errorText(error) }),
  });

  const enterActual = useMutation({
    mutationFn: (input: { kpiDefinitionId: string; actual: number | null }) =>
      kraService.enterManualActual({
        employeeId: selectedId,
        kpiDefinitionId: input.kpiDefinitionId,
        period,
        actual: input.actual,
      }),
    onSuccess: () => {
      toast.success("Manual actual saved");
      void queryClient.invalidateQueries({ queryKey: ["kra-grid", period] });
      void queryClient.invalidateQueries({ queryKey: ["kra-trend"] });
      void queryClient.invalidateQueries({ queryKey: ["kra-performance-index"] });
    },
    onError: (error) => toast.error("Could not save actual", { description: errorText(error) }),
  });

  if (grid.isLoading) return <TableSkeleton />;
  if (grid.isError) return <ErrorState onRetry={() => void grid.refetch()} />;
  if (people.length === 0) {
    return (
      <EmptyState
        title="No KRAs for this month"
        description="Save a template set and assign it, or publish a designation set. Auto scores stay blank until then."
        icon={LineChart}
        action={
          canCalculate ? (
            <Button onClick={() => calculate.mutate()} disabled={calculate.isPending}>
              {calculate.isPending ? "Calculating…" : "Calculate auto scores"}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-55">
          <Label htmlFor="score-employee">Employee</Label>
          <select
            id="score-employee"
            className={fieldClass}
            value={selectedId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        {canCalculate ? (
          <Button onClick={() => calculate.mutate()} disabled={calculate.isPending}>
            {calculate.isPending ? "Calculating…" : "Calculate auto scores"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Performance index"
          value={formatKraScore(selected?.index)}
          hint={selected ? `${period} · ${selected.band}` : period}
          icon={LineChart}
        />
        <StatCard
          label="Measurement"
          value={selected?.prorated ? "Pro-rated" : "Full month"}
          hint={
            selected?.prorated && selected.measuredFrom
              ? `Scores start ${selected.measuredFrom}`
              : "Joined before this month, or no joining date"
          }
        />
      </div>

      <SectionCard
        title="Six-month trend"
        description="A null month stays Not rated. It is not counted as zero."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(trend.data ?? []).map((point) => (
            <div key={point.period} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{point.period}</span>
                <span className="text-muted-foreground">
                  {formatKraScore(point.performanceIndex)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, point.performanceIndex ?? 0))}%` }}
                />
              </div>
              <BandLabel band={point.band} />
            </div>
          ))}
          {trend.isLoading ? <p className="text-xs text-muted-foreground">Loading trend…</p> : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Monthly score grid"
        description="Missing manual scores stay Not rated."
        bodyClassName="overflow-x-auto p-0"
      >
        <table className="w-full min-w-180 text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">KRA</th>
              <th className="px-4 py-3 font-medium">KPI</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Actual</th>
              <th className="px-4 py-3 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const editable =
                canEnterManual && row.source === "manual" && row.employeeId !== selfEmployeeId;
              return (
                <tr key={row.kpiDefinitionId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.kraName}</p>
                    <p className="text-xs text-muted-foreground">Weight {row.weightage}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{row.metric}</p>
                    <p className="text-xs text-muted-foreground">
                      {KPI_SOURCE_LABELS[row.source]} ·{" "}
                      {row.direction === "lower" ? "Lower is better" : "Higher is better"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {row.target ?? "—"} {row.unit}
                  </td>
                  <td className="px-4 py-3">
                    {editable ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const raw = String(form.get("actual") ?? "").trim();
                          if (raw !== "" && !Number.isFinite(Number(raw))) {
                            toast.error(
                              "Enter a number. Leave the field empty to keep it Not rated.",
                            );
                            return;
                          }
                          enterActual.mutate({
                            kpiDefinitionId: row.kpiDefinitionId,
                            actual: raw === "" ? null : Number(raw),
                          });
                        }}
                      >
                        <Input
                          name="actual"
                          type="number"
                          step="0.01"
                          className="h-8 w-24"
                          defaultValue={row.actual ?? ""}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={enterActual.isPending}
                        >
                          Save
                        </Button>
                      </form>
                    ) : row.actual == null ? (
                      <span className="italic text-muted-foreground">Not rated</span>
                    ) : (
                      row.actual
                    )}
                  </td>
                  <td className="px-4 py-3">{formatKraScore(row.score)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
