/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import {
  candidates as fixtureCandidates,
  goals as fixtureGoals,
  jobOpenings as fixtureJobs,
  onboardingJourneys as fixtureOnboarding,
  performanceReviews as fixtureReviews,
} from "@/lib/mock-data";
import { emailHasDomain, isIndianMobile } from "@/lib/onboarding-schema";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Candidate, Goal, JobOpening, OnboardingJourney, PerformanceReview } from "@/types";
import {
  fromFixture,
  logAudit,
  matchesSearch,
  requireOrganizationId,
  type QueryOptions,
} from "./api";
// goals.kra_id/progress_remarks/manager_review_reason and the
// submit_goal_progress/review_goal/create_review_cycle RPCs (growth module
// fix) are not in the generated Database types yet. Same pattern already
// used in kraService.ts for the same reason.
const untypedDb = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase as unknown as {
    from: (t: string) => any;

    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
};

/**
 * PostgREST errors are plain structured objects, not necessarily instances
 * of Error. Preserve the safe server diagnostic fields so the UI can show
 * the actionable database/RPC failure instead of replacing it with a generic
 * message. Neither request headers nor auth/session values are included.
 */
export function toActionableSupabaseError(error: unknown, fallback = "Supabase request failed.") {
  if (error instanceof Error) return error;
  if (!error || typeof error !== "object") return new Error(fallback);

  const failure = error as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const message = typeof failure.message === "string" && failure.message.trim()
    ? failure.message.trim()
    : fallback;
  const metadata = [
    typeof failure.code === "string" && failure.code ? `Code: ${failure.code}` : null,
    typeof failure.details === "string" && failure.details ? `Details: ${failure.details}` : null,
    typeof failure.hint === "string" && failure.hint ? `Hint: ${failure.hint}` : null,
  ].filter((value): value is string => Boolean(value));
  return new Error(metadata.length ? `${message} (${metadata.join(" · ")})` : message);
}
const mapJob = (r: any): JobOpening => ({
  id: r.id,
  title: r.title,
  department: r.departments?.name ?? "",
  location: r.location ?? "",
  type: r.employment_type,
  openings: r.openings,
  applicants: r.job_applications?.[0]?.count ?? 0,
  stage: r.status,
  postedOn: r.opened_at ?? "",
  // job_openings has no hiring-manager column in this schema; recruiter is
  // tracked per application (job_applications.recruiter_id), not per job.
  hiringManager: "",
});
// candidates has no per-application stage/role; those live on job_applications
// (one candidate can apply to several jobs), so this reads the candidate's
// most recent application by applied_at.
const mapCandidate = (r: any): Candidate => {
  const applications = [...(r.job_applications ?? [])].sort(
    (a: any, b: any) =>
      new Date(b.applied_at ?? 0).getTime() - new Date(a.applied_at ?? 0).getTime(),
  );
  const application = applications[0];
  return {
    id: r.id,
    applicationId: application?.id ?? null,
    name: r.name,
    role: application?.job_openings?.title ?? "",
    stage: application?.stage ?? "applied",
    experience: r.experience_years != null ? `${r.experience_years} yrs` : "",
    source: r.source ?? "",
    rating: null,
    appliedOn: application?.applied_at ?? "",
  };
};
const mapGoal = (r: any): Goal => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  title: r.title,
  description: r.description ?? "",
  target: r.target ?? "",
  category: r.category,
  progress: r.progress,
  weight: Number(r.weight),
  dueDate: r.due_date ?? "",
  status: r.status,
  kraId: r.kra_id ?? null,
  kraName: r.kra_templates?.name ?? null,
  progressRemarks: r.progress_remarks ?? "",
  managerReviewReason: r.manager_review_reason ?? "",
  reviewedAt: r.reviewed_at ?? null,
});
const mapReview = (r: any): PerformanceReview => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  cycle: r.review_cycle,
  reviewer: r.reviewer?.full_name ?? "",
  selfScore: r.self_rating != null ? Number(r.self_rating) : null,
  managerScore: r.manager_rating != null ? Number(r.manager_rating) : null,
  finalRating: r.final_rating != null ? Number(r.final_rating) : null,
  status: r.status,
  selfFeedback: r.self_feedback ?? "",
  managerFeedback: r.manager_feedback ?? "",
  periodStart: r.period_start ?? null,
  periodEnd: r.period_end ?? null,
});
export const talentService = {
  async createOpening(input: {
    title: string;
    departmentId?: string;
    designationId?: string;
    location?: string;
    employmentType: string;
    openings: number;
    description?: string;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("job_openings")
      .insert({
        organization_id: organizationId,
        title: input.title.trim(),
        department_id: input.departmentId || null,
        designation_id: input.designationId || null,
        location: input.location?.trim() || null,
        employment_type: input.employmentType,
        openings: input.openings,
        description: input.description?.trim() || null,
        status: "open",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  async openings(options: QueryOptions = {}): Promise<JobOpening[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureJobs.filter(
          (j) =>
            matchesSearch([j.title, j.department, j.location], options.search) &&
            (!options.status || options.status === "all" || j.stage === options.status),
        ),
      );
    let query = supabase
      .from("job_openings")
      .select("*, departments(name), job_applications(count)")
      .order("opened_at", { ascending: false });
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapJob)
      .filter((j) => matchesSearch([j.title, j.department, j.location], options.search));
  },
  async candidates(options: QueryOptions = {}): Promise<Candidate[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureCandidates.filter(
          (c) =>
            matchesSearch([c.name, c.role, c.source], options.search) &&
            (!options.status || options.status === "all" || c.stage === options.status),
        ),
      );
    // Filtering by stage can't be pushed onto the `job_applications` embed
    // here: PostgREST only turns an embed filter into a row-excluding INNER
    // JOIN with `!inner`, and a candidate can have several applications at
    // different stages. So every candidate is fetched with all of its
    // applications, the current stage is computed client-side from the most
    // recent one, and the stage filter is then applied to that computed
    // value -- never to the raw (and possibly non-matching) first embed row.
    const { data, error } = await supabase
      .from("candidates")
      .select("*, job_applications(id, stage, applied_at, job_openings(title))")
      .order("id", { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .map(mapCandidate)
      .filter((c) => !options.status || options.status === "all" || c.stage === options.status)
      .filter((c) => matchesSearch([c.name, c.role, c.source], options.search));
  },
  // The schema has no "buddy" or numeric progress column for onboarding;
  // progress is derived from completed vs. total tasks, and buddy is left
  // blank rather than invented.
  async onboarding(): Promise<OnboardingJourney[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureOnboarding);
    const { data, error } = await supabase
      .from("onboarding_records")
      .select(
        "*, employees(first_name,last_name), onboarding_tasks(id,title,completed_at,assignee:assigned_to(full_name))",
      )
      .order("joining_date");
    if (error) throw error;
    return (data ?? []).map((r: any) => {
      const tasks = r.onboarding_tasks ?? [];
      const done = tasks.filter((t: any) => t.completed_at).length;
      return {
        id: r.id,
        employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
        designation: "",
        startDate: r.joining_date ?? "",
        buddy: "",
        progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        tasks: tasks.map((t: any) => ({
          id: t.id,
          label: t.title,
          owner: t.assignee?.full_name ?? "",
          done: Boolean(t.completed_at),
        })),
      };
    });
  },
  async addOnboardingTask(onboardingId: string, input: { title: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("onboarding_tasks")
      .insert({ onboarding_id: onboardingId, title: input.title.trim(), status: "pending" });
    if (error) throw error;
  },
  // The task's "done" state is driven by completed_at (see onboarding()'s
  // mapping above) -- status is kept in sync alongside it since the one
  // pre-existing seeded task pair also carries a matching status value.
  async toggleOnboardingTask(taskId: string, done: boolean) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("onboarding_tasks")
      .update({
        completed_at: done ? new Date().toISOString() : null,
        status: done ? "completed" : "pending",
      })
      .eq("id", taskId);
    if (error) throw error;
  },
  async startOnboarding(input: { employeeId: string; joiningDate: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase
      .from("onboarding_records")
      .insert({
        employee_id: input.employeeId,
        joining_date: input.joiningDate,
        status: "in-progress",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  // No manager-id filter here: RLS (goals_self_select OR
  // goals_manager_view_team via can_view_employee) already returns the
  // caller's own goals plus their department or direct reports. A manager_id
  // filter would hide the caller's own goals and a department head's wider team.
  async goals(options: QueryOptions = {}): Promise<Goal[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureGoals.filter(
          (g) =>
            matchesSearch([g.employeeName, g.title, g.category], options.search) &&
            (!options.status || options.status === "all" || g.status === options.status),
        ),
      );
    let query = supabase
      .from("goals")
      .select("*, employees!inner(first_name,last_name,manager_id), kra_templates(name)")
      .order("due_date");
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapGoal)
      .filter((g) => matchesSearch([g.employeeName, g.title, g.category], options.search));
  },
  async createGoal(input: {
    employeeId: string;
    title: string;
    category: string;
    description?: string;
    target?: string;
    dueDate?: string;
    weight?: number;
    kraId?: string | null;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await untypedDb()
      .from("goals")
      .insert({
        employee_id: input.employeeId,
        title: input.title.trim(),
        category: input.category,
        description: input.description?.trim() || null,
        target: input.target?.trim() || null,
        due_date: input.dueDate || null,
        weight: input.weight ?? 0,
        progress: 0,
        status: "on-track",
        kra_id: input.kraId || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  /**
   * Employee's own update to their own goal: progress and remarks ONLY.
   * description/target/due_date are deliberately not editable here -- an
   * employee who needs one of those changed records the request in
   * remarks and a reviewer applies it via reviewGoal() below. Calls
   * submit_goal_progress (growth_module_fix.sql), which enforces "own
   * goal only" itself; RLS has no self-update policy for goals by
   * design, so this RPC is the only path.
   */
  async submitGoalProgress(
    goalId: string,
    input: {
      progress?: number | null;
      remarks?: string | null;
    },
  ) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await untypedDb().rpc("submit_goal_progress", {
      p_goal_id: goalId,
      p_progress: input.progress ?? null,
      p_remarks: input.remarks?.trim() || null,
    });
    if (error) throw toActionableSupabaseError(error);
  },
  /**
   * Reviewer (manager/dept head/admin/hr) action: approve/override a
   * goal's status with a required reason, verify completion (which also
   * sets progress to 100 so the two can never disagree), or apply a
   * description/target/due_date change on the employee's behalf. Never
   * touches weight or the KRA link. Calls review_goal
   * (growth_module_fix.sql), which checks can_manage_employee() itself.
   */
  async reviewGoal(
    goalId: string,
    input: {
      status?: Goal["status"];
      reason?: string;
      description?: string | null;
      target?: string | null;
      dueDate?: string | null;
      /**
       * Optional explicit progress override, mainly for reopening a
       * completed goal with a corrected progress value. When omitted,
       * review_goal() preserves the goal's existing progress as-is
       * (except when completing it, which always forces 100) -- see
       * growth_module_fix.sql's "REOPENING BEHAVIOR" note.
       */
      progress?: number | null;
    },
  ) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await untypedDb().rpc("review_goal", {
      p_goal_id: goalId,
      p_status: input.status ?? null,
      p_reason: input.reason?.trim() || null,
      p_description: input.description?.trim() || null,
      p_target: input.target?.trim() || null,
      p_due_date: input.dueDate || null,
      p_progress: input.progress ?? null,
    });
    if (error) throw error;
  },
  async goalsOf(employeeId: string): Promise<Goal[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureGoals);
    const { data, error } = await supabase
      .from("goals")
      .select("*, employees!inner(first_name,last_name), kra_templates(name)")
      .eq("employee_id", employeeId);
    if (error) throw error;
    return (data ?? []).map(mapGoal);
  },
  // Same reasoning as goals(): RLS already unions own reviews with the
  // department (department head) or direct reports (team lead).
  async reviews(): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureReviews);
    const { data, error } = await supabase
      .from("performance_reviews")
      .select(
        "*, employees!inner(first_name,last_name,manager_id), reviewer:reviewer_id(full_name)",
      )
      .order("reviewed_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
  async reviewsOf(employeeId: string): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureReviews);
    const { data, error } = await supabase
      .from("performance_reviews")
      .select("*, employees!inner(first_name,last_name), reviewer:reviewer_id(full_name)")
      .eq("employee_id", employeeId);
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
  /**
   * Admin/HR launches a cycle for an explicit employee list and/or a whole
   * designation, with an optional period. Calls create_review_cycle
   * (growth_module_fix.sql, a SECURITY DEFINER RPC), which resolves each
   * employee's manager as the reviewer itself and validates the caller is
   * admin/hr -- there's still no separate cycle table; the shared cycle
   * name (grouped by reviews.review_cycle) IS the cycle, same as before.
   */
  async createReviewCycle(input: {
    cycleName: string;
    employeeIds?: string[];
    designationId?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const cycleName = input.cycleName.trim();
    if (!cycleName) throw new Error("Cycle name is required.");
    if (!input.employeeIds?.length && !input.designationId) {
      throw new Error("Select at least one employee or a designation.");
    }
    const { data, error } = await untypedDb().rpc("create_review_cycle", {
      p_cycle_name: cycleName,
      p_employee_ids: input.employeeIds?.length ? input.employeeIds : null,
      p_designation_id: input.designationId || null,
      p_period_start: input.periodStart || null,
      p_period_end: input.periodEnd || null,
    });
    if (error) throw error;
    void logAudit("performance_cycle_create", "performance_reviews", null, null, {
      cycle: cycleName,
      employees: data,
    });
    return data as number;
  },
  async submitSelfReview(reviewId: string, input: { selfRating: number; feedback?: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.rpc("submit_self_review", {
      p_review_id: reviewId,
      p_self_rating: input.selfRating,
      ...(input.feedback ? { p_feedback: input.feedback } : {}),
    });
    if (error) throw error;
  },
  async submitManagerReview(reviewId: string, input: { managerRating: number; feedback?: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.rpc("submit_manager_review", {
      p_review_id: reviewId,
      p_manager_rating: input.managerRating,
      ...(input.feedback ? { p_feedback: input.feedback } : {}),
    });
    if (error) throw error;
  },
  async closeOpening(id: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("job_openings")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
  async addCandidateApplication(input: {
    jobId: string;
    name: string;
    email?: string;
    phone?: string;
    source?: string;
    experienceYears?: number;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const email = input.email?.trim() ?? "";
    const phone = input.phone?.trim() ?? "";
    if (email && !emailHasDomain(email)) throw new Error("Enter a valid email.");
    if (!isIndianMobile(phone)) throw new Error("Enter a 10-digit mobile number.");
    const { error } = await supabase.rpc("add_candidate_application", {
      p_job_id: input.jobId,
      p_name: input.name,
      ...(email ? { p_email: email } : {}),
      p_phone: phone,
      ...(input.source ? { p_source: input.source } : {}),
      ...(input.experienceYears != null ? { p_experience_years: input.experienceYears } : {}),
    });
    if (error) throw error;
  },
  async moveCandidateStage(applicationId: string, stage: Candidate["stage"]) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("job_applications")
      .update({ stage })
      .eq("id", applicationId);
    if (error) throw error;
  },
};
