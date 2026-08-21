import {
  candidates as fixtureCandidates,
  goals as fixtureGoals,
  jobOpenings as fixtureJobs,
  onboardingJourneys as fixtureOnboarding,
  performanceReviews as fixtureReviews,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Candidate, Goal, JobOpening, OnboardingJourney, PerformanceReview } from "@/types";
import { fromFixture, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";
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
// most recent application.
const mapCandidate = (r: any): Candidate => {
  const application = r.job_applications?.[0];
  return {
    id: r.id,
    name: r.name,
    role: application?.job_openings?.title ?? "",
    stage: application?.stage ?? "applied",
    experience: r.experience_years != null ? `${r.experience_years} yrs` : "",
    source: r.source ?? "",
    rating: 0,
    appliedOn: application?.applied_at ?? "",
  };
};
const mapGoal = (r: any): Goal => ({
  id: r.id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  title: r.title,
  category: r.category,
  progress: r.progress,
  weight: Number(r.weight),
  dueDate: r.due_date ?? "",
  status: r.status,
});
const mapReview = (r: any): PerformanceReview => ({
  id: r.id,
  employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
  cycle: r.review_cycle,
  reviewer: r.reviewer?.full_name ?? "",
  selfScore: Number(r.self_rating ?? 0),
  managerScore: Number(r.manager_rating ?? 0),
  finalRating: Number(r.final_rating ?? 0),
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
    let query = supabase
      .from("candidates")
      .select("*, job_applications(stage, applied_at, job_openings(title))")
      .order("id", { ascending: false });
    if (options.status && options.status !== "all")
      query = query.eq("job_applications.stage", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapCandidate)
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
        "*, employees(first_name,last_name), onboarding_tasks(title,completed_at,assignee:assigned_to(full_name))",
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
          label: t.title,
          owner: t.assignee?.full_name ?? "",
          done: Boolean(t.completed_at),
        })),
      };
    });
  },
  async goals(options: QueryOptions & { managerId?: string } = {}): Promise<Goal[]> {
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
    if (options.managerId) query = query.eq("employees.manager_id", options.managerId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapGoal)
      .filter((g) => matchesSearch([g.employeeName, g.title, g.category], options.search));
  },
  async createGoal(input: { employeeId: string; title: string; category: string; dueDate?: string; weight?: number }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { data, error } = await supabase.from("goals").insert({
      employee_id: input.employeeId,
      title: input.title.trim(),
      category: input.category,
      due_date: input.dueDate || null,
      weight: input.weight ?? 0,
      progress: 0,
      status: "on-track",
    }).select("id").single();
    if (error) throw error;
    return data;
  },
  async goalsOf(employeeId: string): Promise<Goal[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureGoals);
    const { data, error } = await supabase
      .from("goals")
      .select("*, employees!inner(first_name,last_name)")
      .eq("employee_id", employeeId);
    if (error) throw error;
    return (data ?? []).map(mapGoal);
  },
  async reviews(managerId?: string): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureReviews);
    let query = supabase
      .from("performance_reviews")
      .select("*, employees!inner(first_name,last_name,manager_id), reviewer:reviewer_id(full_name)")
      .order("reviewed_at", { ascending: false });
    if (managerId) query = query.eq("employees.manager_id", managerId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
  async reviewsOf(employeeId: string): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureReviews);
    const { data, error } = await supabase
      .from("performance_reviews")
      .select("*, employees!inner(first_name,last_name), reviewer:reviewer_id(full_name)")
      .eq("employee_id", employeeId);
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
};
