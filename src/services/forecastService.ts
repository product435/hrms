/**
 * Sales Forecasting calculations. Pure functions over the SAME CrmDeal[]
 * already fetched by crmService.deals() -- no separate query, no new
 * Supabase table, no duplicate source of truth. RLS on crm_deals already
 * returns every deal in the caller's organisation to any CRM member
 * (confirmed: crm_deals_select requires only organization_id =
 * current_org_id() and has_crm_access(), with no owner restriction --
 * see supabase/migrations/20261102110000_sales_crm.sql); role-based
 * scoping here (a plain salesperson defaulting to their own deals, a
 * manager/admin seeing the whole team) is therefore a UI-level default,
 * exactly like the existing Overview tab's showTeam/ownerFilter pattern
 * in src/routes/crm.tsx, not an additional database restriction.
 *
 * Weighted Forecast uses each deal's own `probability` field (not a
 * fixed table), matching the existing Overview tab's own "Weighted
 * forecast" StatCard calculation exactly. A deal's probability defaults
 * to STAGE_PROBABILITY[stage] when its stage changes (see DealDialog in
 * CrmForms.tsx) but can be manually overridden per deal -- using the
 * live field, not a hardcoded table, means this never contradicts a
 * deal a user has actually edited, and never invents a probability the
 * app doesn't already treat as authoritative.
 */
import { indiaDateKey } from "@/lib/format";
import { isMissingDbObject } from "@/lib/schema-features";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { OPEN_DEAL_STAGES, type CrmDeal } from "@/types/crm";

export type ForecastPeriodKind = "monthly" | "quarterly" | "yearly";

export interface ForecastPeriod {
  kind: ForecastPeriodKind;
  /** IST date-key (YYYY-MM-DD) for the first day of the period. */
  start: string;
  /** IST date-key (YYYY-MM-DD) for the last day of the period, inclusive. */
  end: string;
  label: string;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Builds the forecast period containing `reference` (defaults to today, IST). */
export function currentForecastPeriod(
  kind: ForecastPeriodKind,
  reference: string = indiaDateKey(),
): ForecastPeriod {
  const year = Number(reference.slice(0, 4));
  const month = Number(reference.slice(5, 7)); // 1-12

  if (kind === "yearly") {
    return {
      kind,
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      label: String(year),
    };
  }

  if (kind === "quarterly") {
    const quarter = Math.floor((month - 1) / 3); // 0-3
    const startMonth = quarter * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = new Date(year, endMonth, 0).getDate();
    return {
      kind,
      start: `${year}-${pad2(startMonth)}-01`,
      end: `${year}-${pad2(endMonth)}-${pad2(endDay)}`,
      label: `Q${quarter + 1} ${year}`,
    };
  }

  const endDay = new Date(year, month, 0).getDate();
  return {
    kind,
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(endDay)}`,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
  };
}

/** Shifts a period forward (positive) or backward (negative) by one unit of its own kind. */
export function shiftForecastPeriod(period: ForecastPeriod, steps: number): ForecastPeriod {
  const startDate = new Date(`${period.start}T00:00:00`);
  if (period.kind === "yearly") {
    startDate.setFullYear(startDate.getFullYear() + steps);
  } else if (period.kind === "quarterly") {
    startDate.setMonth(startDate.getMonth() + steps * 3);
  } else {
    startDate.setMonth(startDate.getMonth() + steps);
  }
  return currentForecastPeriod(period.kind, indiaDateKey(startDate));
}

/** A deal's expected-close date (fallback to its own createdAt only if truly absent) falls in a period. */
function expectedCloseInPeriod(deal: CrmDeal, period: ForecastPeriod): boolean {
  const key = deal.expectedCloseDate ? indiaDateKey(deal.expectedCloseDate) : null;
  if (!key) return false;
  return key >= period.start && key <= period.end;
}

/** A deal's actual close (closedAt) falls in a period -- used for Closed Won / Forecast vs Actual. */
function closedInPeriod(deal: CrmDeal, period: ForecastPeriod): boolean {
  if (!deal.closedAt) return false;
  const key = indiaDateKey(deal.closedAt);
  return key >= period.start && key <= period.end;
}

export interface ForecastTotals {
  /** Sum of amount for open deals (not won, not lost) expected to close in the period. */
  openPipeline: number;
  openCount: number;
  /** Sum of amount * probability / 100 for the same open deals. */
  expectedRevenue: number;
  /** Sum of amount for deals actually won (stage = 'won') and closed within the period. */
  closedWon: number;
  closedWonCount: number;
  /** Sum of amount for deals actually lost (stage = 'lost') and closed within the period -- reporting only, never added to expected revenue. */
  closedLost: number;
  closedLostCount: number;
}

/**
 * Deals relevant to a forecast period: open deals expected to close in it,
 * plus won/lost deals that actually closed in it. A deal can appear in at
 * most one bucket -- won/lost deals are never also counted as open
 * pipeline, even if their expected_close_date also happens to fall in the
 * same period (task rule: "Won deals must not be counted again as open
 * forecast").
 */
export function computeForecastTotals(deals: CrmDeal[], period: ForecastPeriod): ForecastTotals {
  let openPipeline = 0;
  let openCount = 0;
  let expectedRevenue = 0;
  let closedWon = 0;
  let closedWonCount = 0;
  let closedLost = 0;
  let closedLostCount = 0;

  for (const deal of deals) {
    if (deal.stage === "won") {
      if (closedInPeriod(deal, period)) {
        closedWon += deal.amount;
        closedWonCount += 1;
      }
      continue;
    }
    if (deal.stage === "lost") {
      if (closedInPeriod(deal, period)) {
        closedLost += deal.amount;
        closedLostCount += 1;
      }
      continue;
    }
    // Open stage: counted by EXPECTED close date, per task rule ("Assign
    // deals to forecast periods using their expected closing dates").
    if (OPEN_DEAL_STAGES.includes(deal.stage) && expectedCloseInPeriod(deal, period)) {
      openPipeline += deal.amount;
      openCount += 1;
      expectedRevenue += (deal.amount * deal.probability) / 100;
    }
  }

  return { openPipeline, openCount, expectedRevenue, closedWon, closedWonCount, closedLost, closedLostCount };
}

export interface SalespersonForecastRow {
  ownerId: string;
  ownerName: string;
  openPipeline: number;
  expectedRevenue: number;
  closedWon: number;
  dealCount: number;
}

/**
 * Per-salesperson breakdown for the period. Company totals are the exact
 * sum of these rows (task rule: "Company totals must aggregate
 * salesperson records without duplication") -- computeForecastTotals()
 * and this function both iterate the SAME filtered deal set by
 * construction, so summing this table's columns always equals the
 * company-level totals; there is no separate aggregation path that could
 * drift from it.
 */
export function salespersonForecastRows(
  deals: CrmDeal[],
  period: ForecastPeriod,
): SalespersonForecastRow[] {
  const byOwner = new Map<string, SalespersonForecastRow>();
  const get = (id: string, name: string) =>
    byOwner.get(id) ?? { ownerId: id, ownerName: name, openPipeline: 0, expectedRevenue: 0, closedWon: 0, dealCount: 0 };

  for (const deal of deals) {
    if (deal.stage === "won") {
      if (!closedInPeriod(deal, period)) continue;
      const row = get(deal.ownerId, deal.ownerName);
      row.closedWon += deal.amount;
      row.dealCount += 1;
      byOwner.set(deal.ownerId, row);
      continue;
    }
    if (deal.stage === "lost") continue;
    if (!OPEN_DEAL_STAGES.includes(deal.stage) || !expectedCloseInPeriod(deal, period)) continue;
    const row = get(deal.ownerId, deal.ownerName);
    row.openPipeline += deal.amount;
    row.expectedRevenue += (deal.amount * deal.probability) / 100;
    row.dealCount += 1;
    byOwner.set(deal.ownerId, row);
  }

  return [...byOwner.values()].sort((a, b) => b.expectedRevenue - a.expectedRevenue);
}

export interface StageForecastRow {
  stage: CrmDeal["stage"];
  count: number;
  amount: number;
  weightedAmount: number;
}

/** Open-pipeline deals (expected to close in the period) grouped by stage, in pipeline order. */
export function pipelineByStage(deals: CrmDeal[], period: ForecastPeriod): StageForecastRow[] {
  return OPEN_DEAL_STAGES.map((stage) => {
    const inStage = deals.filter(
      (deal) => deal.stage === stage && expectedCloseInPeriod(deal, period),
    );
    return {
      stage,
      count: inStage.length,
      amount: inStage.reduce((sum, deal) => sum + deal.amount, 0),
      weightedAmount: inStage.reduce((sum, deal) => sum + (deal.amount * deal.probability) / 100, 0),
    };
  });
}

export interface ForecastVsActualRow {
  period: ForecastPeriod;
  expectedRevenue: number;
  closedWon: number;
}

/**
 * Trailing series of periods (oldest first), ending at `anchor`, for the
 * "Forecast vs Actual" chart: each point's expectedRevenue is what was
 * forecast to close in that period (open-deal weighted amount, computed
 * the same way as computeForecastTotals -- so a past period's "expected"
 * reflects deals that were open with that expected date, not a
 * retroactively-updated number), and closedWon is what actually closed
 * won in it. `anchor` is the currently-selected period (not necessarily
 * "now"), so the trend stays consistent with whatever period the rest of
 * the forecast UI is showing.
 */
export function forecastVsActualSeries(
  deals: CrmDeal[],
  anchor: ForecastPeriod,
  periods: number,
): ForecastVsActualRow[] {
  const series: ForecastVsActualRow[] = [];
  for (let i = periods - 1; i >= 0; i -= 1) {
    const period = shiftForecastPeriod(anchor, -i);
    const totals = computeForecastTotals(deals, period);
    series.push({ period, expectedRevenue: totals.expectedRevenue, closedWon: totals.closedWon });
  }
  return series;
}

/**
 * Structured, data-only insight: the component formats `amount` with its
 * own currency formatter and interpolates it into one of the fixed
 * templates below by `kind` -- the service never formats currency itself,
 * so there is exactly one place (the UI) that decides how a number looks.
 */
export type ForecastInsight =
  | { kind: "overdue"; tone: "warning"; count: number; amount: number }
  | { kind: "stalled"; tone: "info"; count: number }
  | { kind: "win-rate"; tone: "success" | "warning"; winRate: number; won: number; lost: number }
  | { kind: "no-activity"; tone: "info" };

/**
 * Clearly data-derived insights only -- every entry is a direct readout
 * of a calculation already performed above (overdue deals, stalled
 * pipeline, actual win rate), never a prediction. No external AI model
 * is called anywhere in this function.
 */
export function forecastInsights(deals: CrmDeal[], period: ForecastPeriod): ForecastInsight[] {
  const insights: ForecastInsight[] = [];
  const totals = computeForecastTotals(deals, period);
  const today = indiaDateKey();

  const overdue = deals.filter(
    (deal) =>
      OPEN_DEAL_STAGES.includes(deal.stage) &&
      deal.expectedCloseDate &&
      indiaDateKey(deal.expectedCloseDate) < today &&
      indiaDateKey(deal.expectedCloseDate) >= period.start,
  );
  if (overdue.length > 0) {
    insights.push({
      kind: "overdue",
      tone: "warning",
      count: overdue.length,
      amount: overdue.reduce((sum, deal) => sum + deal.amount, 0),
    });
  }

  const stalled = deals.filter(
    (deal) => deal.stage === "prospecting" && expectedCloseInPeriod(deal, period),
  );
  if (stalled.length >= 3) {
    insights.push({ kind: "stalled", tone: "info", count: stalled.length });
  }

  const winRateDenominator = totals.closedWonCount + totals.closedLostCount;
  if (winRateDenominator > 0) {
    const winRate = (totals.closedWonCount / winRateDenominator) * 100;
    insights.push({
      kind: "win-rate",
      tone: winRate >= 50 ? "success" : "warning",
      winRate,
      won: totals.closedWonCount,
      lost: totals.closedLostCount,
    });
  }

  if (totals.openCount === 0 && totals.closedWonCount === 0 && totals.closedLostCount === 0) {
    insights.push({ kind: "no-activity", tone: "info" });
  }

  return insights;
}

export interface AiForecastNotes {
  risks: string[];
  opportunities: string[];
  recommendations: string[];
}

function database() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  /* eslint-disable @typescript-eslint/no-explicit-any -- generated Database types do not know crm_sales_targets, and Edge Function invoke has no generated type either */
  return supabase as unknown as {
    from: (table: string) => any;
    functions: {
      invoke: (name: string, options: { body: unknown }) => Promise<{ data: any; error: any }>;
    };
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface SalesTarget {
  ownerId: string | null;
  targetAmount: number;
}

/**
 * Reads the sales target row(s) for one period, if the crm_sales_targets
 * table exists (see migration 20261123090000_crm_sales_targets.sql,
 * NOT yet applied to the live database -- this returns `unavailable`
 * until it is). Never fabricates a target: "unavailable" means "no
 * target source configured yet", which the UI must show as
 * "Not configured", never as a zero or invented number.
 */
export async function fetchSalesTargets(
  period: ForecastPeriod,
): Promise<{ status: "ok"; targets: SalesTarget[] } | { status: "unavailable" }> {
  if (!isSupabaseConfigured || !supabase) return { status: "unavailable" };
  const { data, error } = await database()
    .from("crm_sales_targets")
    .select("owner_id, target_amount")
    .eq("period_kind", period.kind)
    .eq("period_start", period.start);
  if (error) {
    if (isMissingDbObject(error)) return { status: "unavailable" };
    throw new Error(error.message || "Could not load sales targets.");
  }
  const targets: SalesTarget[] = (data ?? []).map((row: { owner_id: string | null; target_amount: number }) => ({
    ownerId: row.owner_id,
    targetAmount: Number(row.target_amount ?? 0),
  }));
  return { status: "ok", targets };
}

const AI_NOT_SET_UP_MESSAGE =
  "AI Forecast Insights is not set up on the server yet. Showing data-based insights instead.";

/**
 * Turns a supabase-js Functions error into a short, user-safe message --
 * never the raw platform/HTTP error text. `context`, when present, is the
 * actual Response: our own function reports `{ error }` (see
 * forecast-ai-insights/index.ts), but a 404 from Supabase's own platform
 * (the function has never been deployed) reports `{ message, code }`
 * instead -- both are handled so an undeployed function shows a clear
 * "not set up yet" message rather than a raw NOT_FOUND/other technical
 * error leaking to a CRM user.
 */
async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    if (context.status === 404) return AI_NOT_SET_UP_MESSAGE;
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string };
      if (body?.error) return body.error;
      if (context.status === 503) return AI_NOT_SET_UP_MESSAGE;
      if (body?.message) return "AI Forecast Insights is temporarily unavailable.";
    } catch {
      /* fall through */
    }
    return "AI Forecast Insights is temporarily unavailable.";
  }
  return "AI Forecast Insights could not be reached. Check your connection and try again.";
}

/**
 * Calls the forecast-ai-insights Edge Function with ONLY the already
 * computed, already-authorized forecast summary below -- never raw deal
 * rows, never unrestricted database access. The Gemini key lives solely
 * in that function's server-side secrets. Throws with a clear message
 * (e.g. "not configured") rather than ever returning a fabricated result;
 * callers must keep showing the existing data-only insights as a fallback
 * on any error.
 */
export async function requestAiForecastNotes(
  period: ForecastPeriod,
  totals: ForecastTotals,
  byStage: StageForecastRow[],
  byOwner: SalespersonForecastRow[],
): Promise<AiForecastNotes> {
  const db = database();
  const { data, error } = await db.functions.invoke("forecast-ai-insights", {
    body: {
      summary: {
        periodLabel: period.label,
        periodKind: period.kind,
        totals,
        byStage,
        byOwner,
      },
    },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data?.notes) throw new Error("AI Forecast Insights returned no result.");
  return data.notes as AiForecastNotes;
}
