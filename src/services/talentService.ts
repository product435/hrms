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
      .select("*, employees!inner(first_name,last_name,manager_id)")
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
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase
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
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },
  // RLS is asymmetric by design here (verified live, not assumed): a goal
  // owner has self_select/self_insert but no self_update; a manager has
  // update rights on their direct reports' goals but not their own; admin/hr
  // can update any goal org-wide. So progress is reviewer-updated, not
  // self-reported -- this reuses that existing model rather than adding a
  // new self-update policy. Status auto-resolves only at the two unambiguous
  // ends (100% -> completed, walked back below 100% while previously
  // completed -> on-track); at-risk/delayed stay a manual call, since
  // deriving them would mean inventing a schedule-based rule the existing
  // architecture doesn't define.
  async updateGoalProgress(goalId: string, progress: number) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const clamped = Math.max(0, Math.min(100, progress));
    const { data: existing, error: fetchError } = await supabase
      .from("goals")
      .select("status")
      .eq("id", goalId)
      .single();
    if (fetchError) throw fetchError;
    const nextStatus =
      clamped >= 100 ? "completed" : existing.status === "completed" ? "on-track" : existing.status;
    const { error } = await supabase
      .from("goals")
      .update({ progress: clamped, status: nextStatus })
      .eq("id", goalId);
    if (error) throw error;
  },
  async goalsOf(employeeId: string): Promise<Goal[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureGoals);
    const { data, error } = await supabase
      .from("goals")
      .select("*, employees!inner(first_name,last_name)")
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
  // Admin/HR launches a cycle by tagging a batch of new review rows with a
  // shared cycle label -- there's no separate cycle table, so the label
  // itself (grouped by reviews.reviewCycle) IS the cycle. Reviewer defaults
  // to each employee's manager (resolved via employees.manager_id ->
  // profile_id) when one exists; RLS access for managers is driven by direct
  // -report membership, not by this field, so a missing reviewer never blocks
  // visibility -- it's informational only.
  async createReviewCycle(input: { cycleName: string; employeeIds: string[] }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const cycleName = input.cycleName.trim();
    if (!cycleName) throw new Error("Cycle name is required.");
    if (!input.employeeIds.length) throw new Error("Select at least one employee.");
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, manager:manager_id(profile_id)")
      .in("id", input.employeeIds);
    if (employeesError) throw employeesError;
    const rows = (employees ?? []).map((e: any) => ({
      employee_id: e.id,
      reviewer_id: e.manager?.profile_id ?? null,
      review_cycle: cycleName,
      status: "not-started",
    }));
    const { error } = await supabase.from("performance_reviews").insert(rows);
    if (error) throw error;
    void logAudit("performance_cycle_create", "performance_reviews", null, null, {
      cycle: cycleName,
      employees: rows.length,
    });
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
