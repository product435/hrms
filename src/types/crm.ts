export type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted";
export type LeadSource =
  "website" | "referral" | "cold-call" | "email" | "event" | "social" | "partner" | "other";
export type LeadRating = "hot" | "warm" | "cold";
export type DealStage =
  "prospecting" | "qualification" | "proposal" | "negotiation" | "won" | "lost";
export type ActivityType = "call" | "meeting" | "email" | "task" | "note";
export type ActivityStatus = "planned" | "done" | "cancelled";

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
export const ACTIVITY_TYPES: ActivityType[] = ["call", "meeting", "email", "task", "note"];
export const ACTIVITY_STATUSES: ActivityStatus[] = ["planned", "done", "cancelled"];

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
  estimatedValue: number | null;
  notes: string;
  convertedAt: string | null;
  convertedDealId: string | null;
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
export type LeadInput = Omit<CrmLead, keyof CrmOwned | "convertedAt" | "convertedDealId"> & {
  ownerId?: string;
};
export type DealInput = Omit<
  CrmDeal,
  keyof CrmOwned | "accountName" | "contactName" | "closedAt"
> & { ownerId?: string };
export type ActivityInput = Omit<CrmActivity, keyof CrmOwned | "completedAt" | "relatedTo"> & {
  ownerId?: string;
};
