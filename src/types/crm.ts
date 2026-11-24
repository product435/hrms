export type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted";
export type LeadSource =
  "website" | "referral" | "cold-call" | "email" | "event" | "social" | "partner" | "other";
export type LeadRating = "hot" | "warm" | "cold";
export type DealStage =
  "prospecting" | "qualification" | "proposal" | "negotiation" | "won" | "lost";
export type ActivityType = "call" | "meeting" | "email" | "task" | "note" | "demo" | "whatsapp";
export type ActivityStatus = "planned" | "done" | "cancelled";
export type DemoStatus = "none" | "scheduled" | "completed" | "rescheduled" | "cancelled";
export type CallDirection = "outbound" | "inbound";
export type CallOutcome =
  | "connected"
  | "no_answer"
  | "wrong_number"
  | "busy"
  | "call_back_required"
  | "interested"
  | "not_interested";
export type WhatsappMessageDirection = "outbound" | "inbound";
export type WhatsappMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "unqualified",
  "converted",
];
export const LEAD_SOURCES: LeadSource[] = [
  "website",
  "referral",
  "cold-call",
  "email",
  "event",
  "social",
  "partner",
  "other",
];
export const LEAD_RATINGS: LeadRating[] = ["hot", "warm", "cold"];

export type ListingRatingRange = "4.5-5.0" | "4.0-4.49" | "3.0-3.99" | "below-3.0" | "not-rated";
/** Business/listing rating filter ranges (crm_leads.listing_rating), independent of hot/warm/cold. */
export const LISTING_RATING_RANGES: { value: ListingRatingRange; label: string }[] = [
  { value: "4.5-5.0", label: "4.5–5.0" },
  { value: "4.0-4.49", label: "4.0–4.49" },
  { value: "3.0-3.99", label: "3.0–3.99" },
  { value: "below-3.0", label: "Below 3.0" },
  { value: "not-rated", label: "Not rated" },
];
export function matchesListingRatingRange(
  value: number | null,
  range: ListingRatingRange,
): boolean {
  if (range === "not-rated") return value == null;
  if (value == null) return false;
  if (range === "4.5-5.0") return value >= 4.5 && value <= 5;
  if (range === "4.0-4.49") return value >= 4.0 && value < 4.5;
  if (range === "3.0-3.99") return value >= 3.0 && value < 4.0;
  return value < 3.0;
}
/** Pipeline order. Won and lost are the closed columns. */
export const DEAL_STAGES: DealStage[] = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
  "won",
  "lost",
];
export const OPEN_DEAL_STAGES: DealStage[] = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
];
/** Default win probability when a deal moves into a stage. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};
export const ACTIVITY_TYPES: ActivityType[] = [
  "call",
  "meeting",
  "email",
  "task",
  "note",
  "demo",
  "whatsapp",
];
export const ACTIVITY_STATUSES: ActivityStatus[] = ["planned", "done", "cancelled"];
export const DEMO_STATUSES: DemoStatus[] = [
  "none",
  "scheduled",
  "completed",
  "rescheduled",
  "cancelled",
];
export const CALL_OUTCOMES: CallOutcome[] = [
  "connected",
  "no_answer",
  "wrong_number",
  "busy",
  "call_back_required",
  "interested",
  "not_interested",
];

export function crmLabel(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface CrmOwner {
  id: string;
  name: string;
  department: string;
}

interface CrmOwned {
  id: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmAccount extends CrmOwned {
  name: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  annualRevenue: number | null;
  employeeCount: number | null;
  notes: string;
}

export interface CrmContact extends CrmOwned {
  accountId: string | null;
  accountName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  notes: string;
}

export interface CrmLead extends CrmOwned {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  jobTitle: string;
  source: LeadSource;
  status: LeadStatus;
  rating: LeadRating;
  listingRating: number | null;
  estimatedValue: number | null;
  notes: string;
  convertedAt: string | null;
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  demoStatus: DemoStatus;
  demoAt: string | null;
  demoOutcome: string;
  demoNotes: string;
  nextFollowUpAt: string | null;
  importBatchId: string | null;
  importSequence: number | null;
}

export interface CrmDeal extends CrmOwned {
  name: string;
  accountId: string | null;
  accountName: string;
  contactId: string | null;
  contactName: string;
  amount: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string;
  notes: string;
}

export interface CrmActivity extends CrmOwned {
  type: ActivityType;
  subject: string;
  description: string;
  status: ActivityStatus;
  dueAt: string | null;
  completedAt: string | null;
  leadId: string | null;
  dealId: string | null;
  accountId: string | null;
  contactId: string | null;
  /** Human label of whatever the activity is attached to. */
  relatedTo: string;
}

export type AccountInput = Omit<CrmAccount, keyof CrmOwned> & { ownerId?: string };
export type ContactInput = Omit<CrmContact, keyof CrmOwned | "accountName"> & { ownerId?: string };
export type LeadInput = Omit<
  CrmLead,
  | keyof CrmOwned
  | "convertedAt"
  | "convertedAccountId"
  | "convertedContactId"
  | "convertedDealId"
  | "importBatchId"
  | "importSequence"
> & {
  ownerId?: string;
};
export type DealInput = Omit<
  CrmDeal,
  keyof CrmOwned | "accountName" | "contactName" | "closedAt"
> & { ownerId?: string };
export type ActivityInput = Omit<CrmActivity, keyof CrmOwned | "completedAt" | "relatedTo"> & {
  ownerId?: string;
};

export interface CrmCallLog {
  id: string;
  activityId: string;
  leadId: string | null;
  dealId: string | null;
  accountId: string | null;
  contactId: string | null;
  direction: CallDirection;
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  provider: string | null;
  remarks: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
}

export type CallLogInput = {
  activityId: string;
  direction: CallDirection;
  outcome: CallOutcome | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  provider?: string | null;
  remarks?: string;
  ownerId?: string;
};

export interface CrmWhatsappConversation {
  id: string;
  leadId: string | null;
  contactId: string | null;
  customerPhone: string;
  status: "open" | "closed";
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmWhatsappMessage {
  id: string;
  conversationId: string;
  direction: WhatsappMessageDirection;
  body: string;
  status: WhatsappMessageStatus;
  createdAt: string;
}
