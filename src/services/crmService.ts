import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  DEAL_STAGES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type AccountInput,
  type ActivityInput,
  type ActivityStatus,
  type ActivityType,
  type ContactInput,
  type CrmAccount,
  type CrmActivity,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type CrmOwner,
  type DealInput,
  type DealStage,
  type LeadInput,
  type LeadRating,
  type LeadSource,
  type LeadStatus,
} from "@/types/crm";

/**
 * Sales CRM data access. Every read and write goes through RLS
 * (see supabase/migrations/20261102110000_sales_crm.sql): the sales team and
 * Super Admin read and write, the General Manager reads, everyone else gets
 * nothing. Organisation, created_by and timestamps are set by the database.
 */

type LooseRow = Record<string, unknown>;
interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}
/* eslint-disable @typescript-eslint/no-explicit-any -- CRM tables are newer than the generated Database types */
type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<QueryResult>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function db(): Db {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.");
  }
  return supabase as unknown as Db;
}

function fail(error: { message?: string } | null | undefined) {
  if (error) throw new Error(error.message || "The CRM request failed.");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function one(value: unknown): LooseRow | null {
  if (Array.isArray(value)) return (value[0] as LooseRow | undefined) ?? null;
  return value && typeof value === "object" ? (value as LooseRow) : null;
}

function personName(value: unknown): string {
  const row = one(value);
  if (!row) return "";
  return `${text(row["first_name"])} ${text(row["last_name"])}`.trim();
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Empty strings become null so optional columns stay clean. */
function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

const OWNER = (table: string) => `owner:employees!${table}_owner_id_fkey(first_name, last_name)`;

function owned(row: LooseRow) {
  return {
    id: text(row["id"]),
    ownerId: text(row["owner_id"]),
    ownerName: personName(row["owner"]) || "Unassigned",
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  };
}

function mapAccount(row: LooseRow): CrmAccount {
  return {
    ...owned(row),
    name: text(row["name"], "Account"),
    industry: text(row["industry"]),
    website: text(row["website"]),
    email: text(row["email"]),
    phone: text(row["phone"]),
    city: text(row["city"]),
    country: text(row["country"]),
    annualRevenue: num(row["annual_revenue"]),
    employeeCount: num(row["employee_count"]),
    notes: text(row["notes"]),
  };
}

function mapContact(row: LooseRow): CrmContact {
  return {
    ...owned(row),
    accountId: textOrNull(row["account_id"]),
    accountName: text(one(row["account"])?.["name"]),
    firstName: text(row["first_name"]),
    lastName: text(row["last_name"]),
    email: text(row["email"]),
    phone: text(row["phone"]),
    jobTitle: text(row["job_title"]),
    notes: text(row["notes"]),
  };
}

function mapLead(row: LooseRow): CrmLead {
  return {
    ...owned(row),
    firstName: text(row["first_name"]),
    lastName: text(row["last_name"]),
    company: text(row["company"]),
    email: text(row["email"]),
    phone: text(row["phone"]),
    jobTitle: text(row["job_title"]),
    source: pick<LeadSource>(row["source"], LEAD_SOURCES, "other"),
    status: pick<LeadStatus>(row["status"], LEAD_STATUSES, "new"),
    rating: pick<LeadRating>(row["rating"], LEAD_RATINGS, "warm"),
    estimatedValue: num(row["estimated_value"]),
    notes: text(row["notes"]),
    convertedAt: textOrNull(row["converted_at"]),
    convertedDealId: textOrNull(row["converted_deal_id"]),
  };
}

function mapDeal(row: LooseRow): CrmDeal {
  return {
    ...owned(row),
    name: text(row["name"], "Deal"),
    accountId: textOrNull(row["account_id"]),
    accountName: text(one(row["account"])?.["name"]),
    contactId: textOrNull(row["contact_id"]),
    contactName: personName(row["contact"]),
    amount: num(row["amount"]) ?? 0,
    currency: text(row["currency"], "INR"),
    stage: pick<DealStage>(row["stage"], DEAL_STAGES, "prospecting"),
    probability: num(row["probability"]) ?? 0,
    expectedCloseDate: textOrNull(row["expected_close_date"]),
    closedAt: textOrNull(row["closed_at"]),
    lostReason: text(row["lost_reason"]),
    notes: text(row["notes"]),
  };
}

function mapActivity(row: LooseRow): CrmActivity {
  const lead = one(row["lead"]);
  const deal = one(row["deal"]);
  const account = one(row["account"]);
  const contact = personName(row["contact"]);
  const leadName = lead
    ? [`${text(lead["first_name"])} ${text(lead["last_name"])}`.trim(), text(lead["company"])]
        .filter(Boolean)
        .join(" · ")
    : "";
  const relatedTo =
    (deal ? `Deal: ${text(deal["name"])}` : "") ||
    (leadName ? `Lead: ${leadName}` : "") ||
    (account ? `Account: ${text(account["name"])}` : "") ||
    (contact ? `Contact: ${contact}` : "");
  return {
    ...owned(row),
    type: pick<ActivityType>(row["activity_type"], ACTIVITY_TYPES, "call"),
    subject: text(row["subject"]),
    description: text(row["description"]),
    status: pick<ActivityStatus>(row["status"], ACTIVITY_STATUSES, "planned"),
    dueAt: textOrNull(row["due_at"]),
    completedAt: textOrNull(row["completed_at"]),
    leadId: textOrNull(row["lead_id"]),
    dealId: textOrNull(row["deal_id"]),
    accountId: textOrNull(row["account_id"]),
    contactId: textOrNull(row["contact_id"]),
    relatedTo,
  };
}

function ownerPatch(ownerId: string | undefined) {
  return ownerId ? { owner_id: ownerId } : {};
}

async function rows(query: PromiseLike<QueryResult>): Promise<LooseRow[]> {
  const { data, error } = await query;
  fail(error);
  return Array.isArray(data) ? (data as LooseRow[]) : [];
}

async function save(table: string, id: string | null, payload: LooseRow) {
  const query = id
    ? db().from(table).update(payload).eq("id", id).select("id")
    : db().from(table).insert(payload).select("id");
  const { data, error } = (await query) as QueryResult;
  fail(error);
  // RLS hides rows the caller may not change: an update that matched nothing.
  if (id && (!Array.isArray(data) || data.length === 0)) {
    throw new Error("You can only change CRM records you own.");
  }
}

async function remove(table: string, id: string) {
  const { data, error } = (await db()
    .from(table)
    .delete()
    .eq("id", id)
    .select("id")) as QueryResult;
  fail(error);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("You can only delete CRM records you own.");
  }
}

export const crmService = {
  async owners(): Promise<CrmOwner[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await db().rpc("crm_owner_directory");
    fail(error);
    return (Array.isArray(data) ? (data as LooseRow[]) : []).map((row) => ({
      id: text(row["id"]),
      name: text(row["full_name"], "Employee"),
      department: text(row["department_name"]),
    }));
  },

  // ---------------------------------------------------------------- accounts
  async accounts(): Promise<CrmAccount[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_accounts")
          .select(`*, ${OWNER("crm_accounts")}`)
          .order("name"),
      )
    ).map(mapAccount);
  },
  async saveAccount(id: string | null, input: AccountInput) {
    await save("crm_accounts", id, {
      name: input.name.trim(),
      industry: blank(input.industry),
      website: blank(input.website),
      email: blank(input.email),
      phone: blank(input.phone),
      city: blank(input.city),
      country: blank(input.country),
      annual_revenue: input.annualRevenue,
      employee_count: input.employeeCount,
      notes: blank(input.notes),
      ...ownerPatch(input.ownerId),
    });
  },
  deleteAccount: (id: string) => remove("crm_accounts", id),

  // ---------------------------------------------------------------- contacts
  async contacts(): Promise<CrmContact[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_contacts")
          .select(
            `*, ${OWNER("crm_contacts")}, account:crm_accounts!crm_contacts_account_id_fkey(name)`,
          )
          .order("first_name"),
      )
    ).map(mapContact);
  },
  async saveContact(id: string | null, input: ContactInput) {
    await save("crm_contacts", id, {
      account_id: input.accountId || null,
      first_name: input.firstName.trim(),
      last_name: blank(input.lastName),
      email: blank(input.email),
      phone: blank(input.phone),
      job_title: blank(input.jobTitle),
      notes: blank(input.notes),
      ...ownerPatch(input.ownerId),
    });
  },
  deleteContact: (id: string) => remove("crm_contacts", id),

  // ------------------------------------------------------------------- leads
  async leads(): Promise<CrmLead[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_leads")
          .select(`*, ${OWNER("crm_leads")}`)
          .order("created_at", { ascending: false }),
      )
    ).map(mapLead);
  },
  async saveLead(id: string | null, input: LeadInput) {
    await save("crm_leads", id, {
      first_name: input.firstName.trim(),
      last_name: blank(input.lastName),
      company: blank(input.company),
      email: blank(input.email),
      phone: blank(input.phone),
      job_title: blank(input.jobTitle),
      source: input.source,
      status: input.status,
      rating: input.rating,
      estimated_value: input.estimatedValue,
      notes: blank(input.notes),
      ...ownerPatch(input.ownerId),
    });
  },
  async setLeadStatus(id: string, status: LeadStatus) {
    await save("crm_leads", id, { status });
  },
  async convertLead(
    id: string,
    options: { createDeal: boolean; dealName?: string; dealAmount?: number | null },
  ): Promise<{ accountId: string; contactId: string; dealId: string | null }> {
    const { data, error } = await db().rpc("convert_crm_lead", {
      p_lead_id: id,
      p_create_deal: options.createDeal,
      p_deal_name: blank(options.dealName),
      p_deal_amount: options.dealAmount ?? null,
      p_existing_account_id: null,
    });
    fail(error);
    const row = (data ?? {}) as LooseRow;
    return {
      accountId: text(row["account_id"]),
      contactId: text(row["contact_id"]),
      dealId: textOrNull(row["deal_id"]),
    };
  },
  deleteLead: (id: string) => remove("crm_leads", id),

  // ------------------------------------------------------------------- deals
  async deals(): Promise<CrmDeal[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_deals")
          .select(
            `*, ${OWNER("crm_deals")}, account:crm_accounts!crm_deals_account_id_fkey(name), contact:crm_contacts!crm_deals_contact_id_fkey(first_name, last_name)`,
          )
          .order("updated_at", { ascending: false }),
      )
    ).map(mapDeal);
  },
  async saveDeal(id: string | null, input: DealInput) {
    await save("crm_deals", id, {
      name: input.name.trim(),
      account_id: input.accountId || null,
      contact_id: input.contactId || null,
      amount: input.amount,
      currency: input.currency || "INR",
      stage: input.stage,
      probability: Math.max(0, Math.min(100, Math.round(input.probability))),
      expected_close_date: input.expectedCloseDate || null,
      lost_reason: input.stage === "lost" ? blank(input.lostReason) : null,
      notes: blank(input.notes),
      ...ownerPatch(input.ownerId),
    });
  },
  async moveDeal(id: string, stage: DealStage, probability: number, lostReason?: string) {
    await save("crm_deals", id, {
      stage,
      probability,
      lost_reason: stage === "lost" ? blank(lostReason) : null,
    });
  },
  deleteDeal: (id: string) => remove("crm_deals", id),

  // -------------------------------------------------------------- activities
  async activities(): Promise<CrmActivity[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_activities")
          .select(
            `*, ${OWNER("crm_activities")}, lead:crm_leads!crm_activities_lead_id_fkey(first_name, last_name, company), deal:crm_deals!crm_activities_deal_id_fkey(name), account:crm_accounts!crm_activities_account_id_fkey(name), contact:crm_contacts!crm_activities_contact_id_fkey(first_name, last_name)`,
          )
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(500),
      )
    ).map(mapActivity);
  },
  async saveActivity(id: string | null, input: ActivityInput) {
    await save("crm_activities", id, {
      activity_type: input.type,
      subject: input.subject.trim(),
      description: blank(input.description),
      status: input.status,
      due_at: input.dueAt || null,
      lead_id: input.leadId || null,
      deal_id: input.dealId || null,
      account_id: input.accountId || null,
      contact_id: input.contactId || null,
      ...ownerPatch(input.ownerId),
    });
  },
  async setActivityStatus(id: string, status: ActivityStatus) {
    await save("crm_activities", id, { status });
  },
  deleteActivity: (id: string) => remove("crm_activities", id),

  /** Admin/HR: mark a department as a sales team (gives its members the CRM). */
  async setDepartmentSalesFlag(departmentId: string, isSales: boolean) {
    const { error } = await db().rpc("set_department_sales_flag", {
      p_department_id: departmentId,
      p_is_sales: isSales,
    });
    fail(error);
  },
};
