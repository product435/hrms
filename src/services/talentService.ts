import {
  candidates as fixtureCandidates,
  goals as fixtureGoals,
  jobOpenings as fixtureJobs,
  onboardingJourneys as fixtureOnboarding,
  performanceReviews as fixtureReviews,
} from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Candidate, Goal, JobOpening, OnboardingJourney, PerformanceReview } from "@/types";
import { fromFixture, matchesSearch, type QueryOptions } from "./api";
const mapJob = (r: any): JobOpening => ({
  id: r.id,
  title: r.title,
  department: r.departments?.name ?? "",
  location: r.location ?? "",
  type: r.employment_type,
  openings: r.openings,
  applicants: r.applicants ?? 0,
  stage: r.stage,
  postedOn: r.posted_on ?? "",
  hiringManager: r.hiring_manager?.full_name ?? "",
});
const mapCandidate = (r: any): Candidate => ({
  id: r.id,
  name: r.name,
  role: r.role,
  stage: r.stage,
  experience: r.experience ?? "",
  source: r.source ?? "",
  rating: Number(r.rating ?? 0),
  appliedOn: r.applied_on,
});
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
  cycle: r.cycle,
  reviewer: r.reviewer?.full_name ?? "",
  selfScore: Number(r.self_score ?? 0),
  managerScore: Number(r.manager_score ?? 0),
  finalRating: Number(r.final_rating ?? 0),
  status: r.status,
});
export const talentService = {
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
      .from("jobs")
      .select("*, departments(name), hiring_manager:hiring_manager_id(full_name)")
      .order("created_at", { ascending: false });
    if (options.status && options.status !== "all") query = query.eq("stage", options.status);
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
    let query = supabase.from("candidates").select("*").order("applied_on", { ascending: false });
    if (options.status && options.status !== "all") query = query.eq("stage", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapCandidate)
      .filter((c) => matchesSearch([c.name, c.role, c.source], options.search));
  },
  async onboarding(): Promise<OnboardingJourney[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureOnboarding);
    const { data, error } = await supabase
      .from("onboarding")
      .select(
        "*, employees(first_name,last_name), buddy:buddy_id(full_name), onboarding_tasks(label,is_done,owner:owner_id(full_name))",
      )
      .order("start_date");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
      designation: "",
      startDate: r.start_date,
      buddy: r.buddy?.full_name ?? "",
      progress: r.progress,
      tasks: (r.onboarding_tasks ?? []).map((t: any) => ({
        label: t.label,
        owner: t.owner?.full_name ?? "",
        done: t.is_done,
      })),
    }));
  },
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
      .select("*, employees(first_name,last_name)")
      .order("due_date");
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapGoal)
      .filter((g) => matchesSearch([g.employeeName, g.title, g.category], options.search));
  },
  async goalsOf(employeeName: string): Promise<Goal[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureGoals.filter((g) => g.employeeName === employeeName));
    const { data, error } = await supabase
      .from("goals")
      .select("*, employees!inner(first_name,last_name)")
      .eq("employees.first_name", employeeName.split(" ")[0]);
    if (error) throw error;
    return (data ?? []).map(mapGoal);
  },
  async reviews(): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureReviews);
    const { data, error } = await supabase
      .from("performance_reviews")
      .select("*, employees(first_name,last_name), reviewer:reviewer_id(full_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
  async reviewsOf(employeeName: string): Promise<PerformanceReview[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureReviews.filter((r) => r.employeeName === employeeName));
    const { data, error } = await supabase
      .from("performance_reviews")
      .select("*, employees!inner(first_name,last_name), reviewer:reviewer_id(full_name)")
      .eq("employees.first_name", employeeName.split(" ")[0]);
    if (error) throw error;
    return (data ?? []).map(mapReview);
  },
};
