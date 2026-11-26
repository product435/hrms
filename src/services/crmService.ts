import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { isMissingDbObject } from "@/lib/schema-features";
import { whatsappProvider } from "@/lib/whatsapp-provider";
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  CALL_OUTCOMES,
  DEAL_STAGES,
  DEMO_STATUSES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type AccountInput,
  type ActivityInput,
  type ActivityStatus,
  type ActivityType,
  type CallLogInput,
  type CallOutcome,
  type ContactInput,
  type CrmAccount,
  type CrmActivity,
  type CrmCallLog,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type CrmOwner,
  type CrmWhatsappConversation,
  type CrmWhatsappMessage,
  type DealInput,
  type DealStage,
  type DemoStatus,
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
type DbError = { message?: string; code?: string } | null;
interface QueryResult {
  data: unknown;
  error: DbError;
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

function fail(error: DbError | undefined) {
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
    listingRating: num(row["listing_rating"]),
    estimatedValue: num(row["estimated_value"]),
    notes: text(row["notes"]),
    convertedAt: textOrNull(row["converted_at"]),
    convertedAccountId: textOrNull(row["converted_account_id"]),
    convertedContactId: textOrNull(row["converted_contact_id"]),
    convertedDealId: textOrNull(row["converted_deal_id"]),
    demoStatus: pick<DemoStatus>(row["demo_status"], DEMO_STATUSES, "none"),
    demoAt: textOrNull(row["demo_at"]),
    demoOutcome: text(row["demo_outcome"]),
    demoNotes: text(row["demo_notes"]),
    nextFollowUpAt: textOrNull(row["next_follow_up_at"]),
    importBatchId: textOrNull(row["import_batch_id"]),
    importSequence: num(row["import_sequence"]),
  };
}

function mapCallLog(row: LooseRow): CrmCallLog {
  return {
    id: text(row["id"]),
    activityId: text(row["activity_id"]),
    leadId: textOrNull(row["lead_id"]),
    dealId: textOrNull(row["deal_id"]),
    accountId: textOrNull(row["account_id"]),
    contactId: textOrNull(row["contact_id"]),
    direction: row["direction"] === "inbound" ? "inbound" : "outbound",
    outcome: CALL_OUTCOMES.includes(row["outcome"] as CallOutcome)
      ? (row["outcome"] as CallOutcome)
      : null,
    durationSeconds: num(row["duration_seconds"]),
    recordingUrl: textOrNull(row["recording_url"]),
    provider: textOrNull(row["provider"]),
    remarks: text(row["remarks"]),
    ownerId: text(row["owner_id"]),
    ownerName: personName(row["owner"]) || "Unassigned",
    createdAt: text(row["created_at"]),
  };
}

function mapWhatsappConversation(row: LooseRow): CrmWhatsappConversation {
  return {
    id: text(row["id"]),
    leadId: textOrNull(row["lead_id"]),
    contactId: textOrNull(row["contact_id"]),
    customerPhone: text(row["customer_phone"]),
    status: row["status"] === "closed" ? "closed" : "open",
    ownerId: text(row["owner_id"]),
    ownerName: personName(row["owner"]) || "Unassigned",
    createdAt: text(row["created_at"]),
    updatedAt: text(row["updated_at"]),
  };
}

function mapWhatsappMessage(row: LooseRow): CrmWhatsappMessage {
  return {
    id: text(row["id"]),
    conversationId: text(row["conversation_id"]),
    direction: row["direction"] === "inbound" ? "inbound" : "outbound",
    body: text(row["body"]),
    status:
      typeof row["status"] === "string" &&
      ["queued", "sent", "delivered", "read", "failed"].includes(row["status"])
        ? (row["status"] as CrmWhatsappMessage["status"])
        : "queued",
    createdAt: text(row["created_at"]),
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

async function runSave(table: string, id: string | null, payload: LooseRow): Promise<QueryResult> {
  const query = id
    ? db().from(table).update(payload).eq("id", id).select("id")
    : db().from(table).insert(payload).select("id");
  return (await query) as QueryResult;
}

function checkSaveResult(id: string | null, data: unknown) {
  // RLS hides rows the caller may not change: an update that matched nothing.
  if (id && (!Array.isArray(data) || data.length === 0)) {
    throw new Error("You can only change CRM records you own.");
  }
}

async function save(table: string, id: string | null, payload: LooseRow) {
  const { data, error } = await runSave(table, id, payload);
  fail(error);
  checkSaveResult(id, data);
}

/**
 * Runs one save() per lead (not a single multi-row update), so the
 * existing per-row RLS check in checkSaveResult still applies to each lead
 * individually -- a lead outside the caller's own/managed scope fails for
 * that row specifically instead of silently succeeding or blocking the
 * whole batch. Settled in parallel; failures are reported back by lead id
 * so the caller can tell the user exactly which rows did not update and why.
 */
async function bulkSaveLeads(
  ids: string[],
  payload: LooseRow,
): Promise<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }> {
  const results = await Promise.allSettled(ids.map((id) => save("crm_leads", id, payload)));
  const failed: Array<{ id: string; error: string }> = [];
  const succeeded: string[] = [];
  ids.forEach((id, i) => {
    const result = results[i];
    if (result?.status === "fulfilled") {
      succeeded.push(id);
    } else if (result?.status === "rejected") {
      failed.push({ id, error: result.reason instanceof Error ? result.reason.message : "Failed." });
    }
  });
  return { succeeded, failed };
}

/**
 * Like save(), but for columns that may not exist yet on a database where a
 * newer migration has not been applied. If the full payload is rejected for
 * missing column(s), retries once without `optionalKeys` so the rest of the
 * save still goes through -- never silently: the caller gets `fellBack: true`
 * and is expected to tell the user those specific fields were not saved.
 */
async function saveWithOptionalColumns(
  table: string,
  id: string | null,
  payload: LooseRow,
  optionalKeys: string[],
): Promise<{ fellBack: boolean }> {
  const { data, error } = await runSave(table, id, payload);
  if (!error) {
    checkSaveResult(id, data);
    return { fellBack: false };
  }
  if (!isMissingDbObject(error)) {
    fail(error);
    return { fellBack: false };
  }
  const fallbackPayload = { ...payload };
  for (const key of optionalKeys) delete fallbackPayload[key];
  const retry = await runSave(table, id, fallbackPayload);
  fail(retry.error);
  checkSaveResult(id, retry.data);
  return { fellBack: true };
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
  /**
   * import_sequence is null for every hand-added lead (demo scheduling,
   * "+ New lead", anything not from a sheet) and non-null for an imported
   * one, so ordering by it ascending with nulls first puts every manual
   * lead above every imported lead, no matter which is newer -- manual
   * leads are never pushed down by an import. created_at descending then
   * ranks manual leads newest-first among themselves (a fresh "+ New
   * lead" lands at the very top). import_crm_leads always deletes the
   * entire previous import batch before inserting a new one, so only one
   * batch's rows exist at a time in normal use; within that one batch,
   * created_at is too close for Postgres to order reliably, so
   * import_sequence (ascending, set once at import time in sheet order)
   * is what actually keeps it in sheet order. id is a final stable
   * tiebreak.
   */
  async leads(): Promise<CrmLead[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_leads")
          .select(`*, ${OWNER("crm_leads")}`)
          .order("import_sequence", { ascending: true, nullsFirst: true })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      )
    ).map(mapLead);
  },
  /**
   * If this database does not have the demo-tracking columns yet (migration
   * 20261112130740 not applied), the demo fields are dropped and the rest of
   * the lead still saves -- `demoFieldsSaved: false` tells the caller to warn
   * the user those fields were not persisted, rather than staying silent.
   */
  async saveLead(id: string | null, input: LeadInput): Promise<{ demoFieldsSaved: boolean }> {
    const { fellBack } = await saveWithOptionalColumns(
      "crm_leads",
      id,
      {
        first_name: input.firstName.trim(),
        last_name: blank(input.lastName),
        company: blank(input.company),
        email: blank(input.email),
        phone: blank(input.phone),
        job_title: blank(input.jobTitle),
        source: input.source,
        status: input.status,
        rating: input.rating,
        listing_rating: input.listingRating,
        estimated_value: input.estimatedValue,
        notes: blank(input.notes),
        demo_status: input.demoStatus,
        demo_at: input.demoAt || null,
        demo_outcome: blank(input.demoOutcome),
        demo_notes: blank(input.demoNotes),
        next_follow_up_at: input.nextFollowUpAt || null,
        ...ownerPatch(input.ownerId),
      },
      [
        "demo_status",
        "demo_at",
        "demo_outcome",
        "demo_notes",
        "next_follow_up_at",
        "listing_rating",
      ],
    );
    return { demoFieldsSaved: !fellBack };
  },
  async setLeadStatus(id: string, status: LeadStatus) {
    await save("crm_leads", id, { status });
  },
  async bulkSetLeadOwner(ids: string[], ownerId: string) {
    return bulkSaveLeads(ids, { owner_id: ownerId });
  },
  async bulkSetLeadRating(ids: string[], rating: LeadRating) {
    return bulkSaveLeads(ids, { rating });
  },
  async bulkSetLeadStatus(ids: string[], status: LeadStatus) {
    return bulkSaveLeads(ids, { status });
  },
  async bulkSetLeadFollowUp(ids: string[], nextFollowUpAt: string) {
    return bulkSaveLeads(ids, { next_follow_up_at: nextFollowUpAt });
  },
  /**
   * Demo tracking only exists once migration 20261112130740 is applied.
   * Unlike saveLead(), there is nothing else useful to save here if those
   * columns are missing, so this fails loudly rather than pretending to
   * have recorded a demo status that was not actually written.
   */
  async setLeadDemo(
    id: string,
    demo: {
      demoStatus: DemoStatus;
      demoAt?: string | null;
      demoOutcome?: string | null;
      demoNotes?: string | null;
      nextFollowUpAt?: string | null;
    },
  ) {
    await save("crm_leads", id, {
      demo_status: demo.demoStatus,
      demo_at: demo.demoAt || null,
      demo_outcome: blank(demo.demoOutcome ?? null),
      demo_notes: blank(demo.demoNotes ?? null),
      next_follow_up_at: demo.nextFollowUpAt || null,
    });
  },
  async convertLead(
    id: string,
    options: {
      createDeal: boolean;
      dealName?: string;
      dealAmount?: number | null;
      existingAccountId?: string | null;
      existingContactId?: string | null;
    },
  ): Promise<{ accountId: string; contactId: string; dealId: string | null }> {
    const { data, error } = await db().rpc("convert_crm_lead", {
      p_lead_id: id,
      p_create_deal: options.createDeal,
      p_deal_name: blank(options.dealName),
      p_deal_amount: options.dealAmount ?? null,
      p_existing_account_id: options.existingAccountId ?? null,
      p_existing_contact_id: options.existingContactId ?? null,
    });
    fail(error);
    const row = (data ?? {}) as LooseRow;
    return {
      accountId: text(row["account_id"]),
      contactId: text(row["contact_id"]),
      dealId: textOrNull(row["deal_id"]),
    };
  },
  /**
   * Candidate accounts a lead might already belong to, matched on
   * normalized company name (case/whitespace-insensitive) within the same
   * organisation -- a suggestion only, never applied automatically. The
   * caller (ConvertLeadDialog) shows these to the user, who picks "use
   * existing" or "create new". crm_accounts_select is already org-wide
   * for has_crm_access(), so this is a plain filtered read, no new RPC.
   */
  async findMatchingAccounts(companyName: string): Promise<CrmAccount[]> {
    const needle = companyName.trim();
    if (!needle || !isSupabaseConfigured || !supabase) return [];
    return (
      await rows(db().from("crm_accounts").select(`*, ${OWNER("crm_accounts")}`).ilike("name", needle))
    ).map(mapAccount);
  },
  /** Same idea as findMatchingAccounts(), matched on email or phone. */
  async findMatchingContacts(email: string, phone: string): Promise<CrmContact[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const filters: string[] = [];
    if (email.trim()) filters.push(`email.ilike.${email.trim()}`);
    if (phone.trim()) filters.push(`phone.ilike.${phone.trim()}`);
    if (filters.length === 0) return [];
    return (
      await rows(
        db()
          .from("crm_contacts")
          .select(`*, ${OWNER("crm_contacts")}`)
          .or(filters.join(",")),
      )
    ).map(mapContact);
  },
  /**
   * Calls delete_crm_lead (see final_fix_4.sql), not a plain delete: removing
   * a lead must also remove what "Convert to deal" created from it (its
   * account/contact/deal) and everything that points to any of those, with
   * everything archived first. A plain `delete from crm_leads` would only
   * clear the lead's own converted_account_id/converted_contact_id/
   * converted_deal_id columns and leave those rows (and anything pointing at
   * them) behind untouched.
   */
  async deleteLead(id: string) {
    const { error } = await db().rpc("delete_crm_lead", { p_lead_id: id });
    fail(error);
  },
  /**
   * One universal import workflow that REPLACES the caller's own previous
   * import batch (see import_crm_leads in
   * supabase/migrations/20261126140000_crm_import_replace_previous_batch.sql):
   * a row matching a lead that survives this import (anyone else's lead, a
   * hand-added lead, or a different one of the caller's own past batches)
   * is a duplicate and is skipped, never enriched; a row with no match is
   * inserted; the caller's own previous batch (still owned by the caller)
   * is then archived and removed -- hand-added leads are never touched,
   * by construction, since they have no import_batch_id to match. Nothing
   * is removed unless at least one new row was actually imported, and the
   * whole call is one transaction: a failed import leaves the previous
   * batch intact.
   */
  async previewImportLeads(
    leadRows: Array<{ firstName: string; company?: string; email?: string; phone?: string }>,
  ): Promise<{
    newCount: number;
    duplicateCount: number;
    ambiguousCount: number;
    invalidCount: number;
    replaceCount: number;
  }> {
    const { data, error } = await db().rpc("preview_import_crm_leads", {
      p_rows: leadRows.map((row) => ({
        first_name: row.firstName,
        company: row.company ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
      })),
    });
    fail(error);
    const result = (data ?? {}) as LooseRow;
    return {
      newCount: num(result["new_count"]) ?? 0,
      duplicateCount: num(result["duplicate_count"]) ?? 0,
      ambiguousCount: num(result["ambiguous_count"]) ?? 0,
      invalidCount: num(result["invalid_count"]) ?? 0,
      replaceCount: num(result["replace_count"]) ?? 0,
    };
  },
  async importLeads(
    fileName: string,
    leadRows: Array<{
      firstName: string;
      lastName?: string;
      company?: string;
      email?: string;
      phone?: string;
      jobTitle?: string;
      estimatedValue?: number | null;
      listingRating?: number | null;
      rating?: "hot" | "warm" | "cold" | null;
      notes?: string;
    }>,
  ): Promise<{
    newCount: number;
    duplicateCount: number;
    ambiguousCount: number;
    invalidCount: number;
    failedCount: number;
    replacedCount: number;
    restoredCount: number;
    failedRows: Array<{ row: number; firstName: string; reason: string; error?: string }>;
  }> {
    const { data, error } = await db().rpc("import_crm_leads", {
      p_file_name: fileName,
      p_rows: leadRows.map((row) => ({
        first_name: row.firstName,
        last_name: row.lastName ?? null,
        company: row.company ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        job_title: row.jobTitle ?? null,
        estimated_value: row.estimatedValue ?? null,
        listing_rating: row.listingRating ?? null,
        rating: row.rating ?? null,
        notes: row.notes ?? null,
      })),
    });
    fail(error);
    const result = (data ?? {}) as LooseRow;
    const errors = Array.isArray(result["errors"]) ? (result["errors"] as LooseRow[]) : [];
    return {
      newCount: num(result["new_count"]) ?? 0,
      duplicateCount: num(result["duplicate_count"]) ?? 0,
      ambiguousCount: num(result["ambiguous_count"]) ?? 0,
      invalidCount: num(result["invalid_count"]) ?? 0,
      failedCount: num(result["failed_count"]) ?? 0,
      replacedCount: num(result["replaced_count"]) ?? 0,
      restoredCount: num(result["restored_count"]) ?? 0,
      failedRows: errors.map((e) => ({
        row: num(e["row"]) ?? 0,
        firstName: String(e["first_name"] ?? ""),
        reason: String(e["reason"] ?? ""),
        ...(e["error"] ? { error: String(e["error"]) } : {}),
      })),
    };
  },

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

  // -------------------------------------------------------------- call logs
  async callLogsForActivity(activityId: string): Promise<CrmCallLog[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_call_logs")
          .select(`*, ${OWNER("crm_call_logs")}`)
          .eq("activity_id", activityId)
          .order("created_at", { ascending: false }),
      )
    ).map(mapCallLog);
  },
  /**
   * Logs the call, then applies the lead-level side effect its outcome
   * implies: "wrong_number" disqualifies the lead (status -> unqualified);
   * "no_answer" / "busy" / "call_back_required" schedule a follow-up. Both
   * only run when the call is linked to a lead and a follow-up date was
   * given where required -- neither is forced, since the UI decides whether
   * to ask for one.
   */
  /** Latest call log per activity, for the activities export (avoids one query per row). */
  async callLogsForActivities(activityIds: string[]): Promise<Map<string, CrmCallLog>> {
    if (!isSupabaseConfigured || !supabase || activityIds.length === 0) return new Map();
    const logs = (
      await rows(
        db()
          .from("crm_call_logs")
          .select(`*, ${OWNER("crm_call_logs")}`)
          .in("activity_id", activityIds)
          .order("created_at", { ascending: false }),
      )
    ).map(mapCallLog);
    const byActivity = new Map<string, CrmCallLog>();
    for (const log of logs) {
      if (!byActivity.has(log.activityId)) byActivity.set(log.activityId, log);
    }
    return byActivity;
  },
  async logCall(
    input: CallLogInput & { leadId?: string | null; followUpAt?: string | null },
  ): Promise<CrmCallLog> {
    const payload = {
      activity_id: input.activityId,
      direction: input.direction,
      outcome: input.outcome,
      duration_seconds: input.durationSeconds ?? null,
      recording_url: blank(input.recordingUrl ?? null),
      provider: blank(input.provider ?? null),
      remarks: blank(input.remarks ?? null),
      ...ownerPatch(input.ownerId),
    };
    const { data, error } = (await db()
      .from("crm_call_logs")
      .insert(payload)
      .select(`*, ${OWNER("crm_call_logs")}`)
      .single()) as QueryResult;
    fail(error);

    if (input.leadId) {
      if (input.outcome === "wrong_number") {
        await save("crm_leads", input.leadId, { status: "unqualified" });
      } else if (
        (input.outcome === "no_answer" ||
          input.outcome === "busy" ||
          input.outcome === "call_back_required") &&
        input.followUpAt
      ) {
        await save("crm_leads", input.leadId, { next_follow_up_at: input.followUpAt });
      }
    }

    return mapCallLog(one(data) ?? {});
  },

  // ------------------------------------------------------------- whatsapp
  /**
   * CRM-side foundation only. Actually delivering a message requires the
   * official WhatsApp Business API/provider, which is not configured in
   * this environment -- see src/lib/whatsapp-provider.ts. This records the
   * outbound message as "failed" with the provider's refusal reason rather
   * than claiming it was sent.
   */
  async whatsappConversations(): Promise<CrmWhatsappConversation[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_whatsapp_conversations")
          .select(`*, ${OWNER("crm_whatsapp_conversations")}`)
          .order("updated_at", { ascending: false }),
      )
    ).map(mapWhatsappConversation);
  },
  async whatsappMessages(conversationId: string): Promise<CrmWhatsappMessage[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    return (
      await rows(
        db()
          .from("crm_whatsapp_messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
      )
    ).map(mapWhatsappMessage);
  },
  async openWhatsappConversation(input: {
    leadId?: string | null;
    contactId?: string | null;
    customerPhone: string;
    ownerId?: string;
  }) {
    const { data, error } = (await db()
      .from("crm_whatsapp_conversations")
      .insert({
        lead_id: input.leadId || null,
        contact_id: input.contactId || null,
        customer_phone: input.customerPhone.trim(),
        ...ownerPatch(input.ownerId),
      })
      .select("id")
      .single()) as QueryResult;
    fail(error);
    return text(one(data)?.["id"]);
  },
  /**
   * Sends through the whatsapp-send Edge Function, which both calls the
   * real WhatsApp Business API and records the resulting message (status
   * "sent" only on confirmed provider acceptance, "failed" otherwise) --
   * see src/lib/whatsapp-provider.ts and supabase/functions/whatsapp-send.
   * This never inserts into crm_whatsapp_messages itself: the Edge Function
   * already does, using the caller's own session, so RLS/ownership apply
   * exactly as if the browser had written the row directly, with no
   * separate client-side insert that could create a duplicate or a row the
   * provider call didn't actually agree with.
   */
  async sendWhatsappMessage(conversationId: string, customerPhone: string, body: string) {
    await whatsappProvider.sendMessage(conversationId, customerPhone, body.trim());
  },
};
