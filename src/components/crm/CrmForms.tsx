import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { CheckCircle2, FileSpreadsheet, Trash2, UploadCloud } from "lucide-react";
import { isWhatsappConfigured } from "@/lib/whatsapp-provider";
import {
  browserCallingProvider,
  getBrowserCallingConfigStatus,
  type ActiveCall,
  type CallState,
} from "@/lib/browser-calling-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  indiaDateKey,
  indianDateTime,
  indiaLocalDateTimeToUtcIso,
  INDIA_TIME_ZONE,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { crmService } from "@/services/crmService";
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  CALL_OUTCOMES,
  DEAL_STAGES,
  DEMO_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  STAGE_PROBABILITY,
  crmLabel,
  type AccountInput,
  type ActivityInput,
  type CallOutcome,
  type ContactInput,
  type CrmAccount,
  type CrmActivity,
  type CrmCallLog,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type CrmOwner,
  type DealInput,
  type LeadInput,
} from "@/types/crm";

export const CRM_QUERY_KEY = ["crm"] as const;

const selectClass =
  "mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO instant → value for <input type="datetime-local">, in IST. */
function toIstInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${indiaDateKey(date)}T${time}`;
}

function fromIstInput(value: string): string | null {
  if (!value) return null;
  const [date, time] = value.split("T");
  return indiaLocalDateTimeToUtcIso(date ?? "", time ?? "");
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Saves through a mutation, refreshes every CRM query, and closes on
 * success. `success` may be a function of the actual result when the
 * message needs to reflect what really happened (e.g. whether a requested
 * Deal was actually created), instead of a fixed string shown regardless
 * of outcome.
 */
function useCrmSave<T, R = unknown>(
  save: (value: T) => Promise<R>,
  success: string | ((result: R) => string),
  onDone: () => void,
  onSaved?: (result: R) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: (result) => {
      toast.success(typeof success === "function" ? success(result) : success);
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
      onSaved?.(result);
      onDone();
    },
    onError: (error) => toast.error(errorText(error)),
  });
}

function OwnerSelect({
  id,
  owners,
  value,
  onChange,
}: {
  id: string;
  owners: CrmOwner[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Owner" htmlFor={id}>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Me</option>
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.name}
            {owner.department ? ` · ${owner.department}` : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  pending: boolean;
  submitLabel: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-4 py-4 sm:grid-cols-2">{children}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------- Lead

function leadDraft(lead: CrmLead | null): LeadInput {
  return {
    firstName: lead?.firstName ?? "",
    lastName: lead?.lastName ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    jobTitle: lead?.jobTitle ?? "",
    source: lead?.source ?? "website",
    status: lead?.status ?? "new",
    rating: lead?.rating ?? "warm",
    listingRating: lead?.listingRating ?? null,
    estimatedValue: lead?.estimatedValue ?? null,
    notes: lead?.notes ?? "",
    ownerId: lead?.ownerId ?? "",
    demoStatus: lead?.demoStatus ?? "none",
    demoAt: lead?.demoAt ?? null,
    demoOutcome: lead?.demoOutcome ?? "",
    demoNotes: lead?.demoNotes ?? "",
    nextFollowUpAt: lead?.nextFollowUpAt ?? null,
  };
}

/**
 * Read-only "what happened with this record" list, filtered client-side
 * from whatever activities are already loaded -- no new query. Shown
 * inside the Lead/Account/Contact edit dialogs so a user does not have to
 * leave the dialog and search the Activities tab by name to see history.
 * Only renders once the record exists (a brand-new, unsaved record has no
 * activities yet).
 */
function RelatedActivityTimeline({
  activities,
  matches,
}: {
  activities: CrmActivity[];
  matches: (activity: CrmActivity) => boolean;
}) {
  const related = activities
    .filter(matches)
    .sort((a, b) => (b.dueAt ?? b.completedAt ?? "").localeCompare(a.dueAt ?? a.completedAt ?? ""));
  if (related.length === 0) return null;
  return (
    <div className="sm:col-span-2">
      <Label>Recent activity</Label>
      <ul className="mt-1.5 max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
        {related.slice(0, 20).map((activity) => (
          <li key={activity.id} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{activity.subject}</span>
              <span className="shrink-0 text-muted-foreground">
                {crmLabel(activity.type)} · {crmLabel(activity.status)}
              </span>
            </div>
            <p className="text-muted-foreground">
              {activity.dueAt
                ? indianDateTime(activity.dueAt)
                : activity.completedAt
                  ? indianDateTime(activity.completedAt)
                  : "No date"}
              {" · "}
              {activity.ownerName}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadDialog({
  open,
  lead,
  activities,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  lead: CrmLead | null;
  activities?: CrmActivity[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LeadInput>(() => leadDraft(lead));
  const [value, setValue] = useState(lead?.estimatedValue?.toString() ?? "");
  const [listingRatingInput, setListingRatingInput] = useState(
    lead?.listingRating?.toString() ?? "",
  );
  const save = useCrmSave(
    (input: LeadInput) => crmService.saveLead(lead?.id ?? null, input),
    lead ? "Lead updated" : "Lead added",
    onClose,
    (result) => {
      if (!result.demoFieldsSaved) {
        toast.warning(
          "Demo tracking is not installed on this database yet, so the demo fields were not saved. The rest of the lead was saved.",
        );
      }
    },
  );
  const set = (patch: Partial<LeadInput>) => setDraft((current) => ({ ...current, ...patch }));
  const statuses = LEAD_STATUSES.filter(
    (status) => status !== "converted" || lead?.status === "converted",
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={lead ? "Edit lead" : "New lead"}
      description="A person or company that might buy. Convert it once it is qualified."
      pending={save.isPending}
      submitLabel={lead ? "Save lead" : "Add lead"}
      onSubmit={() => {
        if (!draft.firstName.trim()) {
          toast.error("First name is required.");
          return;
        }
        const estimatedValue = numberOrNull(value);
        if (value.trim() && (estimatedValue == null || estimatedValue < 0)) {
          toast.error("Estimated value must be a positive number.");
          return;
        }
        const listingRating = numberOrNull(listingRatingInput);
        if (
          listingRatingInput.trim() &&
          (listingRating == null || listingRating < 0 || listingRating > 5)
        ) {
          toast.error("Rating must be a number between 0 and 5.");
          return;
        }
        const input: LeadInput = { ...draft, estimatedValue, listingRating };
        if (!canAssign || !draft.ownerId) delete input.ownerId;
        save.mutate(input);
      }}
    >
      <Field label="First name *" htmlFor="lead-first">
        <Input
          id="lead-first"
          className="mt-1.5"
          value={draft.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
          required
          maxLength={100}
        />
      </Field>
      <Field label="Last name" htmlFor="lead-last">
        <Input
          id="lead-last"
          className="mt-1.5"
          value={draft.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
          maxLength={100}
        />
      </Field>
      <Field label="Company" htmlFor="lead-company">
        <Input
          id="lead-company"
          className="mt-1.5"
          value={draft.company}
          onChange={(e) => set({ company: e.target.value })}
          maxLength={200}
        />
      </Field>
      <Field label="Job title" htmlFor="lead-title">
        <Input
          id="lead-title"
          className="mt-1.5"
          value={draft.jobTitle}
          onChange={(e) => set({ jobTitle: e.target.value })}
        />
      </Field>
      <Field label="Email" htmlFor="lead-email">
        <Input
          id="lead-email"
          type="email"
          className="mt-1.5"
          value={draft.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label="Phone" htmlFor="lead-phone">
        <Input
          id="lead-phone"
          type="tel"
          className="mt-1.5"
          value={draft.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>
      <Field label="Source" htmlFor="lead-source">
        <select
          id="lead-source"
          className={selectClass}
          value={draft.source}
          onChange={(e) => set({ source: e.target.value as LeadInput["source"] })}
        >
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {crmLabel(source)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Rating" htmlFor="lead-rating">
        <Input
          id="lead-rating"
          type="number"
          min={0}
          max={5}
          step="0.1"
          className="mt-1.5"
          placeholder="—"
          value={listingRatingInput}
          onChange={(e) => setListingRatingInput(e.target.value)}
        />
      </Field>
      <Field label="Status" htmlFor="lead-status">
        <select
          id="lead-status"
          className={selectClass}
          value={draft.status}
          disabled={lead?.status === "converted"}
          onChange={(e) => set({ status: e.target.value as LeadInput["status"] })}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {crmLabel(status)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Estimated value (₹)" htmlFor="lead-value">
        <Input
          id="lead-value"
          type="number"
          min={0}
          step="1"
          className="mt-1.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      {canAssign ? (
        <OwnerSelect
          id="lead-owner"
          owners={owners}
          value={draft.ownerId ?? ""}
          onChange={(ownerId) => set({ ownerId })}
        />
      ) : null}
      <Field label="Demo status" htmlFor="lead-demo-status">
        <select
          id="lead-demo-status"
          className={selectClass}
          value={draft.demoStatus}
          onChange={(e) => set({ demoStatus: e.target.value as LeadInput["demoStatus"] })}
        >
          {DEMO_STATUSES.map((status) => (
            <option key={status} value={status}>
              {crmLabel(status)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Demo date/time" htmlFor="lead-demo-at">
        <Input
          id="lead-demo-at"
          type="datetime-local"
          className="mt-1.5"
          value={toIstInput(draft.demoAt)}
          onChange={(e) => set({ demoAt: fromIstInput(e.target.value) })}
        />
      </Field>
      <Field label="Demo outcome" htmlFor="lead-demo-outcome">
        <Input
          id="lead-demo-outcome"
          className="mt-1.5"
          value={draft.demoOutcome}
          onChange={(e) => set({ demoOutcome: e.target.value })}
          placeholder="e.g. Interested, needs pricing"
        />
      </Field>
      <Field label="Next follow-up" htmlFor="lead-next-follow-up">
        <Input
          id="lead-next-follow-up"
          type="datetime-local"
          className="mt-1.5"
          value={toIstInput(draft.nextFollowUpAt)}
          onChange={(e) => set({ nextFollowUpAt: fromIstInput(e.target.value) })}
        />
      </Field>
      <Field label="Demo notes" htmlFor="lead-demo-notes" className="sm:col-span-2">
        <Textarea
          id="lead-demo-notes"
          className="mt-1.5"
          rows={2}
          value={draft.demoNotes}
          onChange={(e) => set({ demoNotes: e.target.value })}
        />
      </Field>
      <Field label="Notes" htmlFor="lead-notes" className="sm:col-span-2">
        <Textarea
          id="lead-notes"
          className="mt-1.5"
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      {lead && activities ? (
        <RelatedActivityTimeline activities={activities} matches={(a) => a.leadId === lead.id} />
      ) : null}
    </FormDialog>
  );
}

export function ConvertLeadDialog({
  lead,
  onClose,
}: {
  lead: CrmLead | null;
  onClose: () => void;
}) {
  const [createDeal, setCreateDeal] = useState(true);
  const [dealName, setDealName] = useState(
    lead ? `${lead.company || `${lead.firstName} ${lead.lastName}`.trim()} deal` : "",
  );
  const [amount, setAmount] = useState(lead?.estimatedValue?.toString() ?? "");
  // "new" means create one; any other value is an existing record's id.
  const [accountChoice, setAccountChoice] = useState<string>("new");
  const [contactChoice, setContactChoice] = useState<string>("new");

  const matchingAccounts = useQuery({
    queryKey: ["crm-matching-accounts", lead?.company],
    queryFn: () => crmService.findMatchingAccounts(lead?.company ?? ""),
    enabled: lead != null && Boolean(lead.company?.trim()),
  });
  const matchingContacts = useQuery({
    queryKey: ["crm-matching-contacts", lead?.email, lead?.phone],
    queryFn: () => crmService.findMatchingContacts(lead?.email ?? "", lead?.phone ?? ""),
    enabled: lead != null && Boolean(lead.email?.trim() || lead.phone?.trim()),
  });

  // Reset the choice back to "new" whenever a different lead opens, or once
  // a match comes back -- defaults to the first match found so the common
  // case (one obvious match) needs no extra click, while still letting the
  // user switch to "create new" explicitly.
  useEffect(() => {
    setAccountChoice(matchingAccounts.data?.[0]?.id ?? "new");
  }, [lead?.id, matchingAccounts.data]);
  useEffect(() => {
    setContactChoice(matchingContacts.data?.[0]?.id ?? "new");
  }, [lead?.id, matchingContacts.data]);

  const convert = useCrmSave(
    () =>
      crmService.convertLead(lead?.id ?? "", {
        createDeal,
        dealName,
        dealAmount: numberOrNull(amount),
        existingAccountId: accountChoice === "new" ? null : accountChoice,
        existingContactId: contactChoice === "new" ? null : contactChoice,
      }),
    (result) =>
      result.dealId != null
        ? "Lead converted — account, contact and deal created"
        : "Lead converted — account and contact created",
    onClose,
  );
  return (
    <FormDialog
      open={lead != null}
      onOpenChange={(next) => !next && onClose()}
      title="Convert lead"
      description="Creates an account and a contact from this lead, and optionally an open deal in the pipeline."
      pending={convert.isPending}
      submitLabel="Convert"
      onSubmit={() => {
        if (createDeal && amount.trim() && (numberOrNull(amount) ?? -1) < 0) {
          toast.error("Deal amount must be a positive number.");
          return;
        }
        convert.mutate(undefined);
      }}
    >
      {matchingAccounts.data && matchingAccounts.data.length > 0 ? (
        <Field label="Account" htmlFor="convert-account" className="sm:col-span-2">
          <select
            id="convert-account"
            className={selectClass}
            value={accountChoice}
            onChange={(e) => setAccountChoice(e.target.value)}
          >
            <option value="new">Create a new account</option>
            {matchingAccounts.data.map((account) => (
              <option key={account.id} value={account.id}>
                Use existing: {account.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Found an existing account with a matching name. Using it avoids a duplicate.
          </p>
        </Field>
      ) : null}
      {matchingContacts.data && matchingContacts.data.length > 0 ? (
        <Field label="Contact" htmlFor="convert-contact" className="sm:col-span-2">
          <select
            id="convert-contact"
            className={selectClass}
            value={contactChoice}
            onChange={(e) => setContactChoice(e.target.value)}
          >
            <option value="new">Create a new contact</option>
            {matchingContacts.data.map((contact) => (
              <option key={contact.id} value={contact.id}>
                Use existing: {`${contact.firstName} ${contact.lastName}`.trim()}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Found an existing contact with a matching email or phone. Using it avoids a duplicate.
          </p>
        </Field>
      ) : null}
      <div className="flex items-center gap-2 sm:col-span-2">
        <Checkbox
          id="convert-deal"
          checked={createDeal}
          onCheckedChange={(checked) => setCreateDeal(checked === true)}
        />
        <Label htmlFor="convert-deal">Create a deal</Label>
      </div>
      {createDeal ? (
        <>
          <Field label="Deal name" htmlFor="convert-name">
            <Input
              id="convert-name"
              className="mt-1.5"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
            />
          </Field>
          <Field label="Amount (₹)" htmlFor="convert-amount">
            <Input
              id="convert-amount"
              type="number"
              min={0}
              className="mt-1.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------- Deal

function dealDraft(deal: CrmDeal | null): DealInput {
  return {
    name: deal?.name ?? "",
    accountId: deal?.accountId ?? null,
    contactId: deal?.contactId ?? null,
    amount: deal?.amount ?? 0,
    currency: deal?.currency ?? "INR",
    stage: deal?.stage ?? "prospecting",
    probability: deal?.probability ?? STAGE_PROBABILITY.prospecting,
    expectedCloseDate: deal?.expectedCloseDate ?? null,
    lostReason: deal?.lostReason ?? "",
    notes: deal?.notes ?? "",
    ownerId: deal?.ownerId ?? "",
  };
}

export function DealDialog({
  open,
  deal,
  accounts,
  contacts,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  deal: CrmDeal | null;
  accounts: CrmAccount[];
  contacts: CrmContact[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DealInput>(() => dealDraft(deal));
  const [amount, setAmount] = useState(deal ? String(deal.amount) : "");
  const save = useCrmSave(
    (input: DealInput) => crmService.saveDeal(deal?.id ?? null, input),
    deal ? "Deal updated" : "Deal added",
    onClose,
  );
  const set = (patch: Partial<DealInput>) => setDraft((current) => ({ ...current, ...patch }));
  const accountContacts = draft.accountId
    ? contacts.filter((contact) => contact.accountId === draft.accountId)
    : contacts;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={deal ? "Edit deal" : "New deal"}
      description="An opportunity in the pipeline. Probability follows the stage unless you change it."
      pending={save.isPending}
      submitLabel={deal ? "Save deal" : "Add deal"}
      onSubmit={() => {
        if (!draft.name.trim()) {
          toast.error("Deal name is required.");
          return;
        }
        const parsed = numberOrNull(amount);
        if (parsed == null || parsed < 0) {
          toast.error("Amount must be zero or more.");
          return;
        }
        if (draft.stage === "lost" && !draft.lostReason.trim()) {
          toast.error("Give a reason when a deal is lost.");
          return;
        }
        const input: DealInput = { ...draft, amount: parsed };
        if (!canAssign || !draft.ownerId) delete input.ownerId;
        save.mutate(input);
      }}
    >
      <Field label="Deal name *" htmlFor="deal-name" className="sm:col-span-2">
        <Input
          id="deal-name"
          className="mt-1.5"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Account" htmlFor="deal-account">
        <select
          id="deal-account"
          className={selectClass}
          value={draft.accountId ?? ""}
          onChange={(e) => set({ accountId: e.target.value || null, contactId: null })}
        >
          <option value="">No account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact" htmlFor="deal-contact">
        <select
          id="deal-contact"
          className={selectClass}
          value={draft.contactId ?? ""}
          onChange={(e) => set({ contactId: e.target.value || null })}
        >
          <option value="">No contact</option>
          {accountContacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {`${contact.firstName} ${contact.lastName}`.trim()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount (₹) *" htmlFor="deal-amount">
        <Input
          id="deal-amount"
          type="number"
          min={0}
          className="mt-1.5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </Field>
      <Field label="Expected close" htmlFor="deal-close">
        <Input
          id="deal-close"
          type="date"
          className="mt-1.5"
          value={draft.expectedCloseDate ?? ""}
          onChange={(e) => set({ expectedCloseDate: e.target.value || null })}
        />
      </Field>
      <Field label="Stage" htmlFor="deal-stage">
        <select
          id="deal-stage"
          className={selectClass}
          value={draft.stage}
          onChange={(e) => {
            const stage = e.target.value as DealInput["stage"];
            set({ stage, probability: STAGE_PROBABILITY[stage] });
          }}
        >
          {DEAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {crmLabel(stage)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Probability (%)" htmlFor="deal-probability">
        <Input
          id="deal-probability"
          type="number"
          min={0}
          max={100}
          className="mt-1.5"
          value={draft.probability}
          disabled={draft.stage === "won" || draft.stage === "lost"}
          onChange={(e) => set({ probability: Number(e.target.value) || 0 })}
        />
      </Field>
      {draft.stage === "lost" ? (
        <Field label="Lost reason *" htmlFor="deal-lost" className="sm:col-span-2">
          <Input
            id="deal-lost"
            className="mt-1.5"
            value={draft.lostReason}
            onChange={(e) => set({ lostReason: e.target.value })}
          />
        </Field>
      ) : null}
      {canAssign ? (
        <OwnerSelect
          id="deal-owner"
          owners={owners}
          value={draft.ownerId ?? ""}
          onChange={(ownerId) => set({ ownerId })}
        />
      ) : null}
      <Field label="Notes" htmlFor="deal-notes" className="sm:col-span-2">
        <Textarea
          id="deal-notes"
          className="mt-1.5"
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------- Account

function accountDraft(account: CrmAccount | null): AccountInput {
  return {
    name: account?.name ?? "",
    industry: account?.industry ?? "",
    website: account?.website ?? "",
    email: account?.email ?? "",
    phone: account?.phone ?? "",
    city: account?.city ?? "",
    country: account?.country ?? "India",
    annualRevenue: account?.annualRevenue ?? null,
    employeeCount: account?.employeeCount ?? null,
    notes: account?.notes ?? "",
    ownerId: account?.ownerId ?? "",
  };
}

export function AccountDialog({
  open,
  account,
  activities,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  account: CrmAccount | null;
  activities?: CrmActivity[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AccountInput>(() => accountDraft(account));
  const [revenue, setRevenue] = useState(account?.annualRevenue?.toString() ?? "");
  const [size, setSize] = useState(account?.employeeCount?.toString() ?? "");
  // Tracks the exact name already checked and confirmed (or cleared) for
  // duplicates, so editing the name after a warning re-triggers the check,
  // but clicking Save a second time for the SAME name goes straight through.
  const [duplicateCheckedFor, setDuplicateCheckedFor] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const save = useCrmSave(
    (input: AccountInput) => crmService.saveAccount(account?.id ?? null, input),
    account ? "Account updated" : "Account added",
    onClose,
  );
  const set = (patch: Partial<AccountInput>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={account ? "Edit account" : "New account"}
      description="A customer or prospect company."
      pending={save.isPending || checkingDuplicate}
      submitLabel={account ? "Save account" : "Add account"}
      onSubmit={async () => {
        if (!draft.name.trim()) {
          toast.error("Account name is required.");
          return;
        }
        const input: AccountInput = {
          ...draft,
          annualRevenue: numberOrNull(revenue),
          employeeCount: numberOrNull(size),
        };
        if ((input.annualRevenue ?? 0) < 0 || (input.employeeCount ?? 0) < 0) {
          toast.error("Revenue and employee count cannot be negative.");
          return;
        }
        if (!canAssign || !draft.ownerId) delete input.ownerId;

        if (!account && duplicateCheckedFor !== draft.name) {
          setCheckingDuplicate(true);
          const matches = await crmService.findMatchingAccounts(draft.name);
          setCheckingDuplicate(false);
          setDuplicateCheckedFor(draft.name);
          if (matches.length > 0) {
            toast.warning(
              `An account named "${matches[0]?.name}" already exists. Click "${account ? "Save account" : "Add account"}" again to create a separate one anyway.`,
            );
            return;
          }
        }
        save.mutate(input);
      }}
    >
      <Field label="Account name *" htmlFor="account-name" className="sm:col-span-2">
        <Input
          id="account-name"
          className="mt-1.5"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Industry" htmlFor="account-industry">
        <Input
          id="account-industry"
          className="mt-1.5"
          value={draft.industry}
          onChange={(e) => set({ industry: e.target.value })}
        />
      </Field>
      <Field label="Website" htmlFor="account-website">
        <Input
          id="account-website"
          className="mt-1.5"
          value={draft.website}
          onChange={(e) => set({ website: e.target.value })}
          placeholder="https://"
        />
      </Field>
      <Field label="Email" htmlFor="account-email">
        <Input
          id="account-email"
          type="email"
          className="mt-1.5"
          value={draft.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label="Phone" htmlFor="account-phone">
        <Input
          id="account-phone"
          type="tel"
          className="mt-1.5"
          value={draft.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>
      <Field label="City" htmlFor="account-city">
        <Input
          id="account-city"
          className="mt-1.5"
          value={draft.city}
          onChange={(e) => set({ city: e.target.value })}
        />
      </Field>
      <Field label="Country" htmlFor="account-country">
        <Input
          id="account-country"
          className="mt-1.5"
          value={draft.country}
          onChange={(e) => set({ country: e.target.value })}
        />
      </Field>
      <Field label="Annual revenue (₹)" htmlFor="account-revenue">
        <Input
          id="account-revenue"
          type="number"
          min={0}
          className="mt-1.5"
          value={revenue}
          onChange={(e) => setRevenue(e.target.value)}
        />
      </Field>
      <Field label="Employees" htmlFor="account-size">
        <Input
          id="account-size"
          type="number"
          min={0}
          step={1}
          className="mt-1.5"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </Field>
      {canAssign ? (
        <OwnerSelect
          id="account-owner"
          owners={owners}
          value={draft.ownerId ?? ""}
          onChange={(ownerId) => set({ ownerId })}
        />
      ) : null}
      <Field label="Notes" htmlFor="account-notes" className="sm:col-span-2">
        <Textarea
          id="account-notes"
          className="mt-1.5"
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      {account && activities ? (
        <RelatedActivityTimeline
          activities={activities}
          matches={(a) => a.accountId === account.id}
        />
      ) : null}
    </FormDialog>
  );
}

// ------------------------------------------------------------------- Contact

function contactDraft(contact: CrmContact | null): ContactInput {
  return {
    accountId: contact?.accountId ?? null,
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    jobTitle: contact?.jobTitle ?? "",
    notes: contact?.notes ?? "",
    ownerId: contact?.ownerId ?? "",
  };
}

export function ContactDialog({
  open,
  contact,
  accounts,
  activities,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  contact: CrmContact | null;
  accounts: CrmAccount[];
  activities?: CrmActivity[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ContactInput>(() => contactDraft(contact));
  // Tracks the exact email+phone pair already checked for duplicates, so
  // editing either after a warning re-triggers the check, but clicking Save
  // a second time for the SAME values goes straight through.
  const [duplicateCheckedFor, setDuplicateCheckedFor] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const save = useCrmSave(
    (input: ContactInput) => crmService.saveContact(contact?.id ?? null, input),
    contact ? "Contact updated" : "Contact added",
    onClose,
  );
  const set = (patch: Partial<ContactInput>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={contact ? "Edit contact" : "New contact"}
      description="A person you talk to, usually at one of your accounts."
      pending={save.isPending || checkingDuplicate}
      submitLabel={contact ? "Save contact" : "Add contact"}
      onSubmit={async () => {
        if (!draft.firstName.trim()) {
          toast.error("First name is required.");
          return;
        }
        const input: ContactInput = { ...draft };
        if (!canAssign || !draft.ownerId) delete input.ownerId;

        const checkKey = `${draft.email}|${draft.phone}`;
        if (!contact && (draft.email.trim() || draft.phone.trim()) && duplicateCheckedFor !== checkKey) {
          setCheckingDuplicate(true);
          const matches = await crmService.findMatchingContacts(draft.email, draft.phone);
          setCheckingDuplicate(false);
          setDuplicateCheckedFor(checkKey);
          if (matches.length > 0) {
            const match = matches[0];
            const name = match ? `${match.firstName} ${match.lastName}`.trim() : "";
            toast.warning(
              `A contact matching this email or phone already exists${name ? ` (${name})` : ""}. Click "Add contact" again to create a separate one anyway.`,
            );
            return;
          }
        }
        save.mutate(input);
      }}
    >
      <Field label="First name *" htmlFor="contact-first">
        <Input
          id="contact-first"
          className="mt-1.5"
          value={draft.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
          required
          maxLength={100}
        />
      </Field>
      <Field label="Last name" htmlFor="contact-last">
        <Input
          id="contact-last"
          className="mt-1.5"
          value={draft.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
      </Field>
      <Field label="Account" htmlFor="contact-account">
        <select
          id="contact-account"
          className={selectClass}
          value={draft.accountId ?? ""}
          onChange={(e) => set({ accountId: e.target.value || null })}
        >
          <option value="">No account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Job title" htmlFor="contact-title">
        <Input
          id="contact-title"
          className="mt-1.5"
          value={draft.jobTitle}
          onChange={(e) => set({ jobTitle: e.target.value })}
        />
      </Field>
      <Field label="Email" htmlFor="contact-email">
        <Input
          id="contact-email"
          type="email"
          className="mt-1.5"
          value={draft.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label="Phone" htmlFor="contact-phone">
        <Input
          id="contact-phone"
          type="tel"
          className="mt-1.5"
          value={draft.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>
      {canAssign ? (
        <OwnerSelect
          id="contact-owner"
          owners={owners}
          value={draft.ownerId ?? ""}
          onChange={(ownerId) => set({ ownerId })}
        />
      ) : null}
      <Field label="Notes" htmlFor="contact-notes" className="sm:col-span-2">
        <Textarea
          id="contact-notes"
          className="mt-1.5"
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      {contact && activities ? (
        <RelatedActivityTimeline
          activities={activities}
          matches={(a) => a.contactId === contact.id}
        />
      ) : null}
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Activity

type RelatedKind = "none" | "lead" | "deal" | "account" | "contact";

function activityDraft(
  activity: CrmActivity | null,
  preset?: Partial<ActivityInput>,
): ActivityInput {
  return {
    type: activity?.type ?? preset?.type ?? "call",
    subject: activity?.subject ?? preset?.subject ?? "",
    description: activity?.description ?? "",
    status: activity?.status ?? "planned",
    dueAt: activity?.dueAt ?? null,
    leadId: activity?.leadId ?? preset?.leadId ?? null,
    dealId: activity?.dealId ?? preset?.dealId ?? null,
    accountId: activity?.accountId ?? preset?.accountId ?? null,
    contactId: activity?.contactId ?? preset?.contactId ?? null,
    ownerId: activity?.ownerId ?? "",
  };
}

function relatedKindOf(draft: ActivityInput): RelatedKind {
  if (draft.dealId) return "deal";
  if (draft.leadId) return "lead";
  if (draft.accountId) return "account";
  if (draft.contactId) return "contact";
  return "none";
}

export function ActivityDialog({
  open,
  activity,
  preset,
  leads,
  deals,
  accounts,
  contacts,
  existingActivities,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  activity: CrmActivity | null;
  preset?: Partial<ActivityInput>;
  leads: CrmLead[];
  deals: CrmDeal[];
  accounts: CrmAccount[];
  contacts: CrmContact[];
  existingActivities?: CrmActivity[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ActivityInput>(() => activityDraft(activity, preset));
  const [kind, setKind] = useState<RelatedKind>(() =>
    relatedKindOf(activityDraft(activity, preset)),
  );
  const [due, setDue] = useState(() => toIstInput(activity?.dueAt ?? null));
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const save = useCrmSave(
    (input: ActivityInput) => crmService.saveActivity(activity?.id ?? null, input),
    activity ? "Activity updated" : "Activity logged",
    onClose,
  );
  const set = (patch: Partial<ActivityInput>) => setDraft((current) => ({ ...current, ...patch }));
  const related: { id: string; label: string }[] =
    kind === "lead"
      ? leads
          .filter((lead) => lead.status !== "converted" || lead.id === draft.leadId)
          .map((lead) => ({
            id: lead.id,
            label: [`${lead.firstName} ${lead.lastName}`.trim(), lead.company]
              .filter(Boolean)
              .join(" · "),
          }))
      : kind === "deal"
        ? deals.map((deal) => ({ id: deal.id, label: deal.name }))
        : kind === "account"
          ? accounts.map((account) => ({ id: account.id, label: account.name }))
          : kind === "contact"
            ? contacts.map((contact) => ({
                id: contact.id,
                label: `${contact.firstName} ${contact.lastName}`.trim(),
              }))
            : [];
  const relatedValue =
    kind === "lead"
      ? draft.leadId
      : kind === "deal"
        ? draft.dealId
        : kind === "account"
          ? draft.accountId
          : kind === "contact"
            ? draft.contactId
            : null;
  const setRelated = (id: string | null) =>
    set({
      leadId: kind === "lead" ? id : null,
      dealId: kind === "deal" ? id : null,
      accountId: kind === "account" ? id : null,
      contactId: kind === "contact" ? id : null,
    });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={activity ? "Edit activity" : "Log activity"}
      description="Calls, meetings, emails and follow-ups. Times are in IST."
      pending={save.isPending}
      submitLabel={activity ? "Save activity" : "Save"}
      onSubmit={() => {
        if (!draft.subject.trim()) {
          toast.error("Subject is required.");
          return;
        }
        let dueAt: string | null;
        try {
          dueAt = fromIstInput(due);
        } catch (error) {
          toast.error(errorText(error));
          return;
        }
        // Same related record, same owner, same day, another still-planned
        // activity -- a likely accidental double-booking. Warn once; the
        // user can still confirm (a genuine second call on the same day is
        // a real case, so this never hard-blocks).
        if (!confirmDuplicate && dueAt && draft.status !== "done" && existingActivities) {
          const dueDay = dueAt.slice(0, 10);
          const relatedId =
            kind === "lead"
              ? draft.leadId
              : kind === "deal"
                ? draft.dealId
                : kind === "account"
                  ? draft.accountId
                  : kind === "contact"
                    ? draft.contactId
                    : null;
          const duplicate =
            relatedId &&
            existingActivities.some(
              (other) =>
                other.id !== activity?.id &&
                other.status === "planned" &&
                other.dueAt != null &&
                other.dueAt.slice(0, 10) === dueDay &&
                (other.leadId === relatedId ||
                  other.dealId === relatedId ||
                  other.accountId === relatedId ||
                  other.contactId === relatedId),
            );
          if (duplicate) {
            setConfirmDuplicate(true);
            toast.warning(
              "Another follow-up is already planned for this record on the same day. Click Save again to add it anyway.",
            );
            return;
          }
        }
        const input: ActivityInput = { ...draft, dueAt };
        if (!canAssign || !draft.ownerId) delete input.ownerId;
        save.mutate(input);
      }}
    >
      <Field label="Type" htmlFor="activity-type">
        <select
          id="activity-type"
          className={selectClass}
          value={draft.type}
          onChange={(e) => set({ type: e.target.value as ActivityInput["type"] })}
        >
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {crmLabel(type)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" htmlFor="activity-status">
        <select
          id="activity-status"
          className={selectClass}
          value={draft.status}
          onChange={(e) => set({ status: e.target.value as ActivityInput["status"] })}
        >
          {ACTIVITY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {crmLabel(status)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject *" htmlFor="activity-subject" className="sm:col-span-2">
        <Input
          id="activity-subject"
          className="mt-1.5"
          value={draft.subject}
          onChange={(e) => set({ subject: e.target.value })}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Due (IST)" htmlFor="activity-due">
        <Input
          id="activity-due"
          type="datetime-local"
          className="mt-1.5"
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
            setConfirmDuplicate(false);
          }}
        />
      </Field>
      {canAssign ? (
        <OwnerSelect
          id="activity-owner"
          owners={owners}
          value={draft.ownerId ?? ""}
          onChange={(ownerId) => set({ ownerId })}
        />
      ) : (
        <div />
      )}
      <Field label="Related to" htmlFor="activity-kind">
        <select
          id="activity-kind"
          className={selectClass}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as RelatedKind);
            set({ leadId: null, dealId: null, accountId: null, contactId: null });
            setConfirmDuplicate(false);
          }}
        >
          <option value="none">Nothing</option>
          <option value="deal">Deal</option>
          <option value="lead">Lead</option>
          <option value="account">Account</option>
          <option value="contact">Contact</option>
        </select>
      </Field>
      {kind !== "none" ? (
        <Field label={crmLabel(kind)} htmlFor="activity-related">
          <select
            id="activity-related"
            className={selectClass}
            value={relatedValue ?? ""}
            onChange={(e) => {
              setRelated(e.target.value || null);
              setConfirmDuplicate(false);
            }}
          >
            <option value="">Choose…</option>
            {related.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div />
      )}
      <Field label="Notes" htmlFor="activity-notes" className="sm:col-span-2">
        <Textarea
          id="activity-notes"
          className="mt-1.5"
          rows={3}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
    </FormDialog>
  );
}

// -------------------------------------------------------------------- Call log

/** Click-to-call: opens the device/OS dialer. No telephony provider is
 * configured in this environment (see src/lib/telephony-provider.ts), so
 * this `tel:` link is the real, working calling action rather than a stub. */
export function callHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/** Browser calling panel -- opened from the lead phone icon instead of
 * navigating straight to `tel:`. Uses the official Exotel CRM WebSDK (see
 * src/lib/browser-calling-provider.ts). Placing a real call still requires
 * this organisation's Exotel account credentials to be configured as
 * exotel-call-token Edge Function secrets; until then, starting a call
 * surfaces that function's real error here rather than a simulated
 * connection. The `tel:` link stays as a real, working manual fallback. */
export function CallDialog({
  open,
  phone,
  onClose,
}: {
  open: boolean;
  phone: string;
  onClose: () => void;
}) {
  const [callError, setCallError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const status = getBrowserCallingConfigStatus();

  const start = useMutation({
    mutationFn: async () => {
      setCallError(null);
      setCallState("connecting");
      return browserCallingProvider.startCall(phone, (event) => {
        if (event === "connected") setCallState("in-call");
        if (event === "callEnded") {
          setCallState("ended");
          setActiveCall(null);
        }
      });
    },
    onSuccess: (call) => {
      setActiveCall(call);
      setCallState((current) => (current === "connecting" ? "ringing" : current));
    },
    onError: (error) => {
      setCallError(errorText(error));
      setCallState("failed");
    },
  });

  const hangUp = () => {
    if (activeCall) browserCallingProvider.endCall(activeCall);
    setActiveCall(null);
    setCallState("ended");
  };

  const busy = callState === "connecting" || callState === "ringing" || callState === "in-call";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (activeCall) browserCallingProvider.endCall(activeCall);
          setActiveCall(null);
          setCallError(null);
          setCallState("idle");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Call — {phone}</DialogTitle>
          <DialogDescription>
            {busy ? `Call status: ${callState}` : "Browser calling for this CRM."}
          </DialogDescription>
        </DialogHeader>

        {callError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">Could not start the call.</p>
            <p className="mt-1">{callError}</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
              {status.missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Manual fallback — opens your device's dialer, not a tracked CRM call.
          </p>
          <a
            href={callHref(phone)}
            className="whitespace-nowrap text-sm text-primary hover:underline"
          >
            Call {phone}
          </a>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {busy ? (
            <Button variant="destructive" onClick={hangUp}>
              Hang up
            </Button>
          ) : (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? "Connecting…" : "Start browser call"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FOLLOW_UP_OUTCOMES: CallOutcome[] = ["no_answer", "busy", "call_back_required"];

export function CallLogDialog({
  open,
  activity,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  activity: CrmActivity | null;
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [outcome, setOutcome] = useState<CallOutcome | "">("connected");
  const [duration, setDuration] = useState("");
  const [remarks, setRemarks] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [followUp, setFollowUp] = useState("");
  const needsFollowUp = FOLLOW_UP_OUTCOMES.includes(outcome as CallOutcome);
  const isWrongNumber = outcome === "wrong_number";
  const save = useCrmSave(
    (_: void) =>
      crmService.logCall({
        activityId: activity?.id ?? "",
        direction,
        outcome: outcome || null,
        durationSeconds: numberOrNull(duration),
        remarks,
        leadId: activity?.leadId ?? null,
        followUpAt: needsFollowUp ? fromIstInput(followUp) : null,
        ...(canAssign && ownerId ? { ownerId } : {}),
      }),
    isWrongNumber
      ? "Call logged — lead marked unqualified"
      : needsFollowUp && followUp
        ? "Call logged — follow-up scheduled"
        : "Call logged",
    onClose,
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Log call details"
      description="Outcome and remarks for this call. Recording requires a configured telephony provider."
      pending={save.isPending}
      submitLabel="Save call log"
      onSubmit={() => {
        if (needsFollowUp && !followUp) {
          toast.error("Pick a follow-up date for this outcome.");
          return;
        }
        save.mutate(undefined);
      }}
    >
      <Field label="Direction" htmlFor="call-direction">
        <select
          id="call-direction"
          className={selectClass}
          value={direction}
          onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
        >
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
      </Field>
      <Field label="Outcome" htmlFor="call-outcome">
        <select
          id="call-outcome"
          className={selectClass}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as CallOutcome)}
        >
          {CALL_OUTCOMES.map((value) => (
            <option key={value} value={value}>
              {crmLabel(value)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Duration (seconds)" htmlFor="call-duration">
        <Input
          id="call-duration"
          type="number"
          min={0}
          className="mt-1.5"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </Field>
      {canAssign ? (
        <OwnerSelect id="call-owner" owners={owners} value={ownerId} onChange={setOwnerId} />
      ) : (
        <div />
      )}
      {needsFollowUp && activity?.leadId ? (
        <Field label="Follow-up date *" htmlFor="call-follow-up" className="sm:col-span-2">
          <Input
            id="call-follow-up"
            type="datetime-local"
            className="mt-1.5"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
        </Field>
      ) : null}
      {isWrongNumber && activity?.leadId ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          This will mark the linked lead as unqualified.
        </p>
      ) : null}
      <Field label="Remarks" htmlFor="call-remarks" className="sm:col-span-2">
        <Textarea
          id="call-remarks"
          className="mt-1.5"
          rows={3}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function CallHistoryDialog({
  open,
  activityId,
  onClose,
}: {
  open: boolean;
  activityId: string | null;
  onClose: () => void;
}) {
  const logs = useQuery({
    queryKey: [...CRM_QUERY_KEY, "call-logs", activityId],
    queryFn: () => crmService.callLogsForActivity(activityId ?? ""),
    enabled: open && Boolean(activityId),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Call history</DialogTitle>
          <DialogDescription>Outcome, duration and remarks logged for this call.</DialogDescription>
        </DialogHeader>
        {logs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (logs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No call details logged yet.</p>
        ) : (
          <ul className="space-y-3">
            {(logs.data ?? []).map((log) => (
              <li key={log.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{crmLabel(log.outcome ?? "unknown")}</span>
                  <span className="text-xs text-muted-foreground">
                    {indianDateTime(log.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {crmLabel(log.direction)} · {log.ownerName}
                  {log.durationSeconds != null ? ` · ${log.durationSeconds}s` : ""}
                </p>
                {log.remarks ? <p className="mt-1.5">{log.remarks}</p> : null}
                {log.recordingUrl ? (
                  <audio controls className="mt-2 w-full" src={log.recordingUrl}>
                    Your browser cannot play this recording.
                  </audio>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    No recording available (requires a configured telephony provider).
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ WhatsApp

/** Opens the customer's WhatsApp chat in a new tab, using whatever WhatsApp
 * app the device already has signed in -- a real, working action, separate
 * from the provider-backed send below. */
export function whatsappChatHref(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

export function WhatsAppDialog({
  open,
  leadId,
  contactId,
  customerPhone,
  ownerId,
  canAssign,
  me,
  onClose,
}: {
  open: boolean;
  leadId: string | null;
  contactId: string | null;
  customerPhone: string;
  ownerId: string;
  canAssign: boolean;
  me: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const canSendHere = canAssign || ownerId === me;

  const conversations = useQuery({
    queryKey: [...CRM_QUERY_KEY, "whatsapp-conversations"],
    queryFn: crmService.whatsappConversations,
    enabled: open,
  });
  const conversation = conversations.data?.find(
    (c) =>
      (leadId && c.leadId === leadId) ||
      (contactId && c.contactId === contactId) ||
      c.customerPhone === customerPhone,
  );

  const messages = useQuery({
    queryKey: [...CRM_QUERY_KEY, "whatsapp-messages", conversation?.id],
    queryFn: () => crmService.whatsappMessages(conversation?.id ?? ""),
    enabled: open && Boolean(conversation?.id),
  });

  const ensureConversation = useMutation({
    mutationFn: () =>
      crmService.openWhatsappConversation({ leadId, contactId, customerPhone, ownerId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY }),
    onError: (error) => toast.error(errorText(error)),
  });

  const send = useMutation({
    mutationFn: async () => {
      let id = conversation?.id;
      if (!id)
        id = await crmService.openWhatsappConversation({
          leadId,
          contactId,
          customerPhone,
          ownerId,
        });
      await crmService.sendWhatsappMessage(id, customerPhone, draft);
    },
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>WhatsApp — {customerPhone}</DialogTitle>
          <DialogDescription>
            Conversation history for this prospect. Shared organisation WhatsApp number.
          </DialogDescription>
        </DialogHeader>

        {!isWhatsappConfigured ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            Supabase is not configured, so WhatsApp sending is unavailable. Open the chat in
            WhatsApp directly instead.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Manual fallback — opens your own device's WhatsApp, not sent through the CRM.
          </p>
          <a
            href={whatsappChatHref(customerPhone)}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-sm text-primary hover:underline"
            onClick={() => {
              if (!conversation) ensureConversation.mutate();
            }}
          >
            Open in WhatsApp ↗
          </a>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
          {!conversation || (messages.data ?? []).length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">No messages recorded yet.</p>
          ) : (
            (messages.data ?? []).map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                  message.direction === "outbound"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                <p>{message.body}</p>
                <p className="mt-0.5 text-[10px] opacity-70">
                  {message.status} · {indianDateTime(message.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>

        {canSendHere ? (
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) send.mutate();
              }}
            />
            <Button disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
              Send
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the assigned salesperson or a sales lead can send from here.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppInboxDialog({
  open,
  leads,
  me,
  canViewAll,
  onClose,
}: {
  open: boolean;
  leads: CrmLead[];
  me: string;
  canViewAll: boolean;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState<{
    leadId: string | null;
    contactId: string | null;
    customerPhone: string;
    ownerId: string;
  } | null>(null);

  const conversations = useQuery({
    queryKey: [...CRM_QUERY_KEY, "whatsapp-conversations"],
    queryFn: crmService.whatsappConversations,
    enabled: open,
  });

  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  return (
    <>
      <Dialog open={open && !opening} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>WhatsApp inbox</DialogTitle>
            <DialogDescription>
              {canViewAll
                ? "Every conversation your sales team is having on the shared WhatsApp number."
                : "Conversations you own on the shared WhatsApp number."}
            </DialogDescription>
          </DialogHeader>

          {!isWhatsappConfigured ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
              WhatsApp Business is not configured in this environment. This inbox shows conversation
              history already recorded in the CRM only.
            </div>
          ) : null}

          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {conversations.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (conversations.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No WhatsApp conversations yet.
              </p>
            ) : (
              (conversations.data ?? [])
                .filter((c) => canViewAll || c.ownerId === me)
                .map((c) => {
                  const lead = c.leadId ? leadById.get(c.leadId) : undefined;
                  const title = lead
                    ? `${lead.firstName} ${lead.lastName}`.trim()
                    : c.customerPhone;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:bg-muted/50"
                      onClick={() =>
                        setOpening({
                          leadId: c.leadId,
                          contactId: c.contactId,
                          customerPhone: c.customerPhone,
                          ownerId: c.ownerId,
                        })
                      }
                    >
                      <span>
                        <span className="font-medium">{title}</span>
                        <span className="ml-2 text-muted-foreground">{c.customerPhone}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.ownerName} · {indianDateTime(c.updatedAt)}
                      </span>
                    </button>
                  );
                })
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsAppDialog
        open={opening != null}
        leadId={opening?.leadId ?? null}
        contactId={opening?.contactId ?? null}
        customerPhone={opening?.customerPhone ?? ""}
        ownerId={opening?.ownerId ?? ""}
        canAssign={canViewAll}
        me={me}
        onClose={() => setOpening(null)}
      />
    </>
  );
}

// -------------------------------------------------------------------- Delete

export function ConfirmDelete({
  target,
  onCancel,
  onConfirm,
  pending,
}: {
  target: { kind: string; name: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog open={target != null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {target?.kind}?</AlertDialogTitle>
          <AlertDialogDescription>
            “{target?.name}” will be removed for the whole sales team. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ------------------------------------------------------------------- Import

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

/** Case-insensitive, trimmed header synonyms -> the field they map to. */
const IMPORT_FIELD_SYNONYMS: Record<string, string[]> = {
  firstName: ["dr.name", "doctor name", "full name", "name", "lead name"],
  phone: ["mobile", "phone", "whatsapp", "contact"],
  email: ["email", "e-mail", "email address"],
  company: ["clinic", "listing name", "clinic / center", "company", "account"],
  jobTitle: ["designation", "title", "role"],
  estimatedValue: ["estimated deal", "deal", "value", "amount"],
  listingRating: [
    "rating",
    "listing rating",
    "business rating",
    "star rating",
    "stars",
    "review score",
  ],
  temperature: [
    "temperature",
    "lead temperature",
    "lead rating",
    "hot/warm/cold",
    "hot warm cold",
    "priority",
  ],
  notes: ["notes", "remarks", "details", "comments", "description"],
};

/** The DB's own first_name limit (crm_leads_first_name_check). Rows over
 * this are never silently truncated -- they're flagged for the user to fix
 * or exclude, same rule the server enforces as a backstop. */
const MAX_FIRST_NAME_LENGTH = 100;

/** "Hot"/"warm"/"cold" (any case, with extra words like "high priority") -> the
 * exact value crm_leads.rating accepts. Returns null for anything else --
 * never invents a temperature the sheet didn't actually provide. */
function parseTemperature(raw: string): "hot" | "warm" | "cold" | null {
  const value = raw.trim().toLowerCase();
  if (/\bhot\b/.test(value) || /\bhigh\b/.test(value)) return "hot";
  if (/\bwarm\b/.test(value) || /\bmedium\b/.test(value) || /\bmed\b/.test(value)) return "warm";
  if (/\bcold\b/.test(value) || /\blow\b/.test(value)) return "cold";
  return null;
}

type ImportField = keyof typeof IMPORT_FIELD_SYNONYMS;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

/** 10+ digits once everything but digits is stripped out. */
function isValidPhone(raw: string): boolean {
  return raw.replace(/\D/g, "").length >= 10;
}

/** Contains "@" with at least one "." somewhere after it. */
function isValidEmail(raw: string): boolean {
  const at = raw.indexOf("@");
  return at !== -1 && raw.indexOf(".", at) !== -1;
}

/**
 * Maps headers to fields by synonym first (as before), then by column
 * CONTENT for whatever firstName/phone/email a header didn't match -- so a
 * sheet with unfamiliar or meaningless headers (or none, e.g. "X1"/"X2") can
 * still import: a column whose cells are mostly "a@b"-shaped is email, one
 * whose cells mostly carry 10+ digits is phone, and the first remaining
 * mostly-text column is the name. A column a synonym already claimed is
 * never reconsidered for content-detection.
 */
function mapImportColumns(
  headers: string[],
  sheetRows: string[][],
): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const normalized = headers.map(normalizeHeader);
  for (const field of Object.keys(IMPORT_FIELD_SYNONYMS) as ImportField[]) {
    const synonyms: string[] = IMPORT_FIELD_SYNONYMS[field] ?? [];
    const index = normalized.findIndex((header) =>
      synonyms.some((synonym) => header === synonym || header.includes(synonym)),
    );
    if (index !== -1) mapping[field] = index;
  }

  const claimed = new Set(Object.values(mapping));

  function mostly(index: number, test: (value: string) => boolean): boolean {
    const cells = sheetRows.map((row) => (row[index] ?? "").trim()).filter((value) => value !== "");
    if (cells.length === 0) return false;
    return cells.filter(test).length / cells.length > 0.5;
  }
  function firstUnclaimedMatch(test: (index: number) => boolean): number | undefined {
    return headers.map((_, index) => index).find((index) => !claimed.has(index) && test(index));
  }

  if (mapping["email"] == null) {
    const index = firstUnclaimedMatch((i) => mostly(i, isValidEmail));
    if (index != null) {
      mapping["email"] = index;
      claimed.add(index);
    }
  }
  if (mapping["phone"] == null) {
    const index = firstUnclaimedMatch((i) => mostly(i, isValidPhone));
    if (index != null) {
      mapping["phone"] = index;
      claimed.add(index);
    }
  }
  // Content-guessing a name column only runs when there is no company
  // column either (by synonym or by this same content pass, run first on
  // purpose): buildImportRows already falls back to company for the lead
  // name when there is no name column, which is a far safer guess than
  // picking some other arbitrary mostly-text column (e.g. a "City"
  // column sitting next to "Company") as if it were a name.
  if (mapping["firstName"] == null && mapping["company"] == null) {
    const index = firstUnclaimedMatch((i) =>
      mostly(i, (v) => v !== "" && !isValidEmail(v) && !isValidPhone(v)),
    );
    if (index != null) {
      mapping["firstName"] = index;
      claimed.add(index);
    }
  }

  return mapping;
}

interface ImportRow {
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
}

/** A row read from the sheet, before the importable/too-long split: carries
 * its original sheet row number (1-based, header excluded) for reporting. */
interface ParsedImportRow extends ImportRow {
  sheetRow: number;
}

function parseEstimatedValue(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The spreadsheet's business/listing rating, e.g. "4.9" or "4.9/5" -- never Hot/Warm/Cold. */
function parseListingRating(raw: string): number | null {
  const match = raw.match(/[0-9]+(\.[0-9]+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

/** Reads every row of a sheet (CSV or XLSX/XLS) as plain string cells. */
async function readSheetRows(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  if (isCsv) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const [headers, ...rows] = parsed.data;
    return { headers: headers ?? [], rows };
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  const data = sheet
    ? XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" })
    : [];
  const [headers, ...rows] = data;
  return { headers: (headers ?? []).map(String), rows: rows.map((row) => row.map(String)) };
}

/** "NA", "-", "N/A", "none" and the like never count as real content. */
function isPlaceholder(value: string): boolean {
  return /^(n\.?\/?a\.?|-+|none|null|\.+)$/i.test(value.trim());
}

function meaningfulText(value: string): string {
  const trimmed = value.trim();
  return isPlaceholder(trimmed) ? "" : trimmed;
}

/** Human-readable labels for the mapping-review step, in display order. */
const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  firstName: "Lead name",
  phone: "Phone",
  email: "Email",
  company: "Company",
  jobTitle: "Job title",
  estimatedValue: "Estimated value",
  listingRating: "Listing rating",
  temperature: "Temperature (Hot/Warm/Cold)",
  notes: "Notes",
};

function buildImportRows(
  headers: string[],
  sheetRows: string[][],
  mappingOverride?: Partial<Record<ImportField, number | null>>,
): ParsedImportRow[] {
  const mapping = { ...mapImportColumns(headers, sheetRows), ...mappingOverride };
  const cell = (row: string[], field: ImportField) => {
    const index = mapping[field];
    return index == null ? "" : meaningfulText(row[index] ?? "");
  };
  return sheetRows
    .map((row, index) => ({ row, sheetRow: index + 1 }))
    .filter(({ row }) => row.some((value) => value.trim() !== ""))
    .map(({ row, sheetRow }) => {
      const name = cell(row, "firstName");
      const company = cell(row, "company");
      const email = cell(row, "email");
      const phone = cell(row, "phone");
      const validEmail = isValidEmail(email) ? email : "";
      const validPhone = isValidPhone(phone) ? phone : "";
      return {
        sheetRow,
        // Lead Name is never left empty for an importable row: name, else
        // company, else email, else the phone number itself.
        firstName: name || company || validEmail || validPhone,
        lastName: "",
        company,
        email,
        phone,
        jobTitle: cell(row, "jobTitle"),
        estimatedValue: parseEstimatedValue(cell(row, "estimatedValue")),
        listingRating: parseListingRating(cell(row, "listingRating")),
        rating: parseTemperature(cell(row, "temperature")),
        notes: cell(row, "notes"),
      };
    })
    .filter((row) => {
      // Importable if it has at least one of: a name, a valid phone, a
      // valid email, a company -- which is exactly what firstName's own
      // fallback chain above already requires: it's only empty when name,
      // company, a valid email and a valid phone are ALL missing.
      return Boolean(row.firstName);
    });
}

function PreviewCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success/5 text-success"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5 text-warning"
        : tone === "destructive"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-input bg-muted/30 text-muted-foreground";
  return (
    <div className={cn("rounded-md border p-1.5 text-center", toneClass)}>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide">{label}</p>
    </div>
  );
}

function describeImportFailureReason(reason: string): string {
  switch (reason) {
    case "duplicate":
      return "Already exists as another lead -- skipped, not modified";
    case "ambiguous":
      return "Matched more than one existing lead -- needs manual review";
    case "not_authorized":
      return "Matched a lead you do not own or manage";
    case "invalid":
      return "No name, company, phone or email found in this row";
    case "failed":
      return "Save failed";
    default:
      return reason || "Could not process this row";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LeadImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [dataRowCount, setDataRowCount] = useState(0);
  // null means "use the auto-detected column"; a number is a manual column
  // index override; a field absent from this map is still auto-detected.
  // Explicitly set to a sentinel of -1 to mean "skip this column entirely".
  const [mappingOverride, setMappingOverride] = useState<Partial<Record<ImportField, number>>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [lastResult, setLastResult] = useState<{
    newCount: number;
    duplicateCount: number;
    ambiguousCount: number;
    invalidCount: number;
    failedCount: number;
    replacedCount: number;
    restoredCount: number;
    failedRows: Array<{ row: number; firstName: string; reason: string; error?: string }>;
  } | null>(null);

  function reset() {
    setFileError(null);
    setFileName("");
    setFileSize(0);
    setSheetHeaders([]);
    setSheetRows([]);
    setDataRowCount(0);
    setMappingOverride({});
    setShowMapping(false);
    setLastResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileError(null);
    setLastResult(null);
    setMappingOverride({});
    setShowMapping(false);
    const isSupported = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!isSupported) {
      setFileError("Unsupported file type. Upload a .CSV, .XLSX, or .XLS file.");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setFileError("This file is larger than 25MB. Split it into smaller sheets.");
      return;
    }
    try {
      const { headers, rows } = await readSheetRows(file);
      setFileName(file.name);
      setFileSize(file.size);
      setSheetHeaders(headers);
      setSheetRows(rows);
      setDataRowCount(rows.filter((row) => row.some((value) => value.trim() !== "")).length);
    } catch {
      setFileError("Could not read this file. Make sure it is a valid spreadsheet.");
    }
  }

  const autoMapping = useMemo(() => mapImportColumns(sheetHeaders, sheetRows), [sheetHeaders, sheetRows]);
  // -1 is this component's own "explicitly skipped" sentinel -- translated
  // to a real `null` (never read as a column) only at the edge, here.
  const effectiveMapping = useMemo(() => {
    const result: Partial<Record<ImportField, number | null>> = { ...autoMapping };
    for (const [field, index] of Object.entries(mappingOverride) as Array<[ImportField, number]>) {
      result[field] = index === -1 ? null : index;
    }
    return result;
  }, [autoMapping, mappingOverride]);
  const parsedRows = useMemo(
    () => buildImportRows(sheetHeaders, sheetRows, effectiveMapping),
    [sheetHeaders, sheetRows, effectiveMapping],
  );

  // A name over the database's limit is never silently truncated -- it's
  // excluded from what gets sent and reported separately, so the user can
  // see exactly which rows need fixing before retrying.
  const tooLongRows = useMemo(
    () => parsedRows.filter((row) => row.firstName.length > MAX_FIRST_NAME_LENGTH),
    [parsedRows],
  );
  const importRows = useMemo(
    () => parsedRows.filter((row) => row.firstName.length <= MAX_FIRST_NAME_LENGTH),
    [parsedRows],
  );

  // dataRowCount > 0 but parsedRows is empty means every row was read but
  // none had a name, valid phone, valid email or company -- distinct from
  // a sheet that has headers but no data rows at all.
  const noDataRows = fileName !== "" && dataRowCount === 0;
  const noImportableRows = fileName !== "" && dataRowCount > 0 && parsedRows.length === 0;
  const missingColumnMessage = noImportableRows
    ? "No importable leads found. The sheet needs at least a name, phone, email or company column."
    : noDataRows
      ? "This sheet has no data rows."
      : null;

  // Server-side preview: accurate counts need to query the live database
  // (ambiguous-match detection and the replace count in particular can't
  // be done client-side), so this is a real read-only RPC call, not a
  // client guess. One universal workflow -- no mode to pass.
  const preview = useQuery({
    queryKey: ["crm-import-preview", importRows],
    queryFn: () => crmService.previewImportLeads(importRows),
    enabled: importRows.length > 0,
  });

  const importMutation = useMutation({
    mutationFn: () => crmService.importLeads(fileName, importRows),
    onSuccess: (result) => {
      const parts = [
        result.newCount > 0 ? `${result.newCount} new lead${result.newCount === 1 ? "" : "s"} imported` : "",
        result.replacedCount > 0
          ? `${result.replacedCount} previously imported lead${result.replacedCount === 1 ? "" : "s"} replaced`
          : "",
        result.restoredCount > 0
          ? `${result.restoredCount} manually added lead${result.restoredCount === 1 ? "" : "s"} kept`
          : "",
        result.duplicateCount > 0 ? `${result.duplicateCount} duplicate` : "",
        result.ambiguousCount > 0 ? `${result.ambiguousCount} ambiguous` : "",
        result.invalidCount > 0 ? `${result.invalidCount} invalid` : "",
        result.failedCount > 0
          ? `${result.failedCount} row${result.failedCount === 1 ? "" : "s"} failed`
          : "",
      ].filter(Boolean);
      toast.success(parts.length > 0 ? parts.join(", ") : "Nothing to import");
      setLastResult(result);
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
      if (result.failedCount === 0 && result.ambiguousCount === 0 && result.invalidCount === 0) {
        reset();
        onClose();
      }
    },
    onError: (error) => setFileError(errorText(error)),
  });

  const rowCount = importRows.length;
  const canImport = rowCount > 0 && !importMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" />
            <DialogTitle>Import prospects from a file</DialogTitle>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
              Batch Import
            </span>
          </div>
          <DialogDescription>
            Upload a CSV or Excel sheet. This replaces leads from your last import with this
            sheet's leads -- manually added leads and other reps' leads are never affected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Select spreadsheet source
          </Label>

          {!fileName ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40",
              )}
            >
              <UploadCloud className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                Click to browse or drag and drop your spreadsheet
              </p>
              <p className="text-xs text-muted-foreground">
                Supports .CSV, .XLSX, or .XLS (maximum file size 25MB)
              </p>
            </button>
          ) : (
            <div className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(fileSize)} · {dataRowCount} row{dataRowCount === 1 ? "" : "s"}{" "}
                      detected · UTF-8 Encoded
                    </p>
                  </div>
                </div>
                {tooLongRows.length > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/12 px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/20">
                    {tooLongRows.length} need{tooLongRows.length === 1 ? "s" : ""} attention
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-semibold text-success ring-1 ring-inset ring-success/20">
                    <CheckCircle2 className="size-3.5" /> Validated
                  </span>
                )}
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    tooLongRows.length > 0 ? "bg-warning" : "bg-success",
                  )}
                  style={{
                    width: `${dataRowCount === 0 ? 100 : Math.round((importRows.length / dataRowCount) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {importRows.length} row{importRows.length === 1 ? "" : "s"} ready to import
                  {tooLongRows.length > 0
                    ? ` · ${tooLongRows.length} row${tooLongRows.length === 1 ? "" : "s"} over the ${MAX_FIRST_NAME_LENGTH}-character name limit, excluded`
                    : ""}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <UploadCloud className="size-3.5" /> Replace
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMapping((v) => !v)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {showMapping ? "Hide column mapping" : "Review column mapping"}
              </button>
              {showMapping ? (
                <div className="mt-2 space-y-1.5 rounded-md border border-input bg-muted/20 p-2">
                  <p className="text-xs text-muted-foreground">
                    Detected columns below. Change any field to a different sheet column, or set it
                    to "Not in this sheet" to skip it.
                  </p>
                  {(Object.keys(IMPORT_FIELD_LABELS) as ImportField[]).map((field) => {
                    const current = effectiveMapping[field];
                    return (
                      <div key={field} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{IMPORT_FIELD_LABELS[field]}</span>
                        <select
                          className={cn(selectClass, "h-7 w-44 text-xs")}
                          value={current == null ? "-1" : String(current)}
                          onChange={(e) =>
                            setMappingOverride((prev) => ({
                              ...prev,
                              [field]: Number(e.target.value),
                            }))
                          }
                        >
                          <option value="-1">Not in this sheet</option>
                          {sheetHeaders.map((header, index) => (
                            <option key={index} value={index}>
                              {header || `Column ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {tooLongRows.length > 0 ? (
                <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-warning/30 bg-warning/5 p-2">
                  <p className="mb-1 text-xs font-semibold text-warning">
                    Rows excluded -- name longer than {MAX_FIRST_NAME_LENGTH} characters:
                  </p>
                  <ul className="space-y-0.5">
                    {tooLongRows.slice(0, 20).map((row) => (
                      <li key={row.sheetRow} className="truncate text-xs text-muted-foreground">
                        Row {row.sheetRow}: {row.firstName.slice(0, 60)}…
                      </li>
                    ))}
                    {tooLongRows.length > 20 ? (
                      <li className="text-xs text-muted-foreground">
                        …and {tooLongRows.length - 20} more
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
              {preview.data ? (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-xs">
                    <PreviewCount label="New" value={preview.data.newCount} tone="success" />
                    <PreviewCount label="Duplicate" value={preview.data.duplicateCount} tone="neutral" />
                    <PreviewCount label="Ambiguous" value={preview.data.ambiguousCount} tone="warning" />
                  </div>
                  {preview.data.replaceCount > 0 ? (
                    <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                      This will replace {preview.data.replaceCount} lead
                      {preview.data.replaceCount === 1 ? "" : "s"} from your previous import.
                      Manually added leads and other reps' leads are never affected.
                    </p>
                  ) : null}
                </>
              ) : preview.isLoading ? (
                <p className="mt-3 text-xs text-muted-foreground">Checking against existing leads…</p>
              ) : null}
              {preview.data && (preview.data.ambiguousCount > 0 || preview.data.invalidCount > 0) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Rows matching more than one existing lead are never guessed -- they are skipped
                  and reported after import so you can review them, fix the sheet, and retry just
                  those rows. A row matching a lead that will survive this import (someone else's
                  lead, a manually added lead, or a different past import) is skipped as a
                  duplicate, never modified.
                </p>
              ) : null}
              {lastResult && lastResult.failedRows.length > 0 ? (
                <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <p className="mb-1 text-xs font-semibold text-destructive">
                    {lastResult.failedRows.length} row{lastResult.failedRows.length === 1 ? "" : "s"}{" "}
                    not imported or updated:
                  </p>
                  <ul className="space-y-0.5">
                    {lastResult.failedRows.slice(0, 20).map((row) => (
                      <li key={row.row} className="truncate text-xs text-muted-foreground">
                        Row {row.row} ({row.firstName}): {describeImportFailureReason(row.reason)}
                        {row.error ? ` -- ${row.error}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
          {!fileError && missingColumnMessage ? (
            <p className="text-sm text-destructive">{missingColumnMessage}</p>
          ) : null}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {rowCount > 0
              ? preview.data && preview.data.replaceCount > 0
                ? `Ready to import ${rowCount} row${rowCount === 1 ? "" : "s"} and replace ${preview.data.replaceCount} lead${preview.data.replaceCount === 1 ? "" : "s"} from your last import`
                : `Ready to import ${rowCount} row${rowCount === 1 ? "" : "s"}`
              : fileName
                ? "This file cannot be imported"
                : "No file selected"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button disabled={!canImport} onClick={() => importMutation.mutate()}>
              {importMutation.isPending
                ? "Processing…"
                : preview.data && preview.data.replaceCount > 0
                  ? `Replace & Import ${rowCount} Rows`
                  : `Import ${rowCount} Rows`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTIVITY_EXPORT_COLUMNS = [
  "Activity",
  "Type",
  "Linked to",
  "Due date and time",
  "Status",
  "Owner",
  "Created at",
  "Completed at",
  "Direction",
  "Outcome",
  "Duration",
  "Duration (seconds)",
  "Remarks",
] as const;

function formatCallDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

const CALL_DIRECTION_LABEL: Record<string, string> = {
  outbound: "Outbound",
  inbound: "Inbound",
};

/**
 * Builds the Activities export workbook from already-filtered rows (all matching
 * rows, not just the current page). `callLogs` is the latest call log per
 * activity id, for call-type rows only; other rows leave those cells blank.
 */
export function buildActivitiesExportWorkbook(
  activities: CrmActivity[],
  callLogs: Map<string, CrmCallLog>,
) {
  const sheetRows = activities.map((activity) => {
    const call = activity.type === "call" ? callLogs.get(activity.id) : undefined;
    return {
      Activity: activity.subject,
      Type: crmLabel(activity.type),
      "Linked to": activity.relatedTo,
      "Due date and time": activity.dueAt ? indianDateTime(activity.dueAt) : "",
      Status: crmLabel(activity.status),
      Owner: activity.ownerName,
      "Created at": indianDateTime(activity.createdAt),
      "Completed at": activity.completedAt ? indianDateTime(activity.completedAt) : "",
      Direction: call ? CALL_DIRECTION_LABEL[call.direction] : "",
      Outcome: call?.outcome ? crmLabel(call.outcome) : "",
      Duration: call ? formatCallDuration(call.durationSeconds) : "",
      "Duration (seconds)": call?.durationSeconds ?? "",
      Remarks: call?.remarks ?? "",
    };
  });

  const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: [...ACTIVITY_EXPORT_COLUMNS] });
  sheet["!cols"] = ACTIVITY_EXPORT_COLUMNS.map((key) => ({
    wch: Math.max(
      key.length,
      ...sheetRows.map((row) => String(row[key as keyof (typeof sheetRows)[number]] ?? "").length),
      8,
    ),
  }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!views"] = [{ state: "frozen", ySplit: 1 }];
  for (let col = 0; col < ACTIVITY_EXPORT_COLUMNS.length; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell) cell.s = { font: { bold: true } };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Activities");
  return workbook;
}

/**
 * Downloads the Activities export in the browser. Fetches the latest call log
 * per call-type activity in one query, then writes the .xlsx client-side.
 */
export async function exportActivities(activities: CrmActivity[]) {
  if (activities.length === 0) {
    toast.error("No activities to export");
    return;
  }
  const callActivityIds = activities.filter((a) => a.type === "call").map((a) => a.id);
  const callLogs = await crmService.callLogsForActivities(callActivityIds);
  const workbook = buildActivitiesExportWorkbook(activities, callLogs);
  const fileName = `Sales_Activities_${indiaDateKey()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  toast.success(`Exported ${activities.length} activities`);
}

const LEAD_EXPORT_COLUMNS = [
  "Lead",
  "Designation",
  "Contact",
  "Email",
  "Status",
  "Rating",
  "Source",
  "Est. Value",
  "Owner",
] as const;

/**
 * Builds the Leads export workbook from already-filtered/searched rows
 * (every matching row, not just the current page). Columns match the Leads
 * table (Lead, Contact, Status, Rating, Source, Est. Value, Owner), plus
 * Designation (job title) and a separate Email column, since those are the
 * other lead fields an import sheet's own columns can map onto via
 * IMPORT_FIELD_SYNONYMS.
 */
export function buildLeadsExportWorkbook(leads: CrmLead[]) {
  const sheetRows = leads.map((lead) => ({
    Lead: `${lead.firstName} ${lead.lastName}`.trim(),
    Designation: lead.jobTitle,
    Contact: lead.phone,
    Email: lead.email,
    Status: crmLabel(lead.status),
    Rating: lead.listingRating != null ? lead.listingRating.toFixed(1) : "",
    Source: crmLabel(lead.source),
    "Est. Value": lead.estimatedValue ?? "",
    Owner: lead.ownerName,
  }));

  const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: [...LEAD_EXPORT_COLUMNS] });
  sheet["!cols"] = LEAD_EXPORT_COLUMNS.map((key) => ({
    wch: Math.max(
      key.length,
      ...sheetRows.map((row) => String(row[key as keyof (typeof sheetRows)[number]] ?? "").length),
      8,
    ),
  }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!views"] = [{ state: "frozen", ySplit: 1 }];
  for (let col = 0; col < LEAD_EXPORT_COLUMNS.length; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell) cell.s = { font: { bold: true } };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Leads");
  return workbook;
}

/** Downloads the Leads export in the browser. Read-only: writes no data. */
export function exportLeads(leads: CrmLead[]) {
  if (leads.length === 0) {
    toast.error("No leads to export");
    return;
  }
  const workbook = buildLeadsExportWorkbook(leads);
  const fileName = `Sales_Leads_${indiaDateKey()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  toast.success(`Exported ${leads.length} lead${leads.length === 1 ? "" : "s"}`);
}
