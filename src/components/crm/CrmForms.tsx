import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { indiaDateKey, indiaLocalDateTimeToUtcIso, INDIA_TIME_ZONE } from "@/lib/format";
import { crmService } from "@/services/crmService";
import {
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  DEAL_STAGES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  STAGE_PROBABILITY,
  crmLabel,
  type AccountInput,
  type ActivityInput,
  type ContactInput,
  type CrmAccount,
  type CrmActivity,
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

/** Saves through a mutation, refreshes every CRM query, and closes on success. */
function useCrmSave<T>(save: (value: T) => Promise<unknown>, success: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast.success(success);
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
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
    estimatedValue: lead?.estimatedValue ?? null,
    notes: lead?.notes ?? "",
    ownerId: lead?.ownerId ?? "",
  };
}

export function LeadDialog({
  open,
  lead,
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  lead: CrmLead | null;
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LeadInput>(() => leadDraft(lead));
  const [value, setValue] = useState(lead?.estimatedValue?.toString() ?? "");
  const save = useCrmSave(
    (input: LeadInput) => crmService.saveLead(lead?.id ?? null, input),
    lead ? "Lead updated" : "Lead added",
    onClose,
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
        const input: LeadInput = { ...draft, estimatedValue };
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
        <select
          id="lead-rating"
          className={selectClass}
          value={draft.rating}
          onChange={(e) => set({ rating: e.target.value as LeadInput["rating"] })}
        >
          {LEAD_RATINGS.map((rating) => (
            <option key={rating} value={rating}>
              {crmLabel(rating)}
            </option>
          ))}
        </select>
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
      <Field label="Notes" htmlFor="lead-notes" className="sm:col-span-2">
        <Textarea
          id="lead-notes"
          className="mt-1.5"
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
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
  const convert = useCrmSave(
    () =>
      crmService.convertLead(lead?.id ?? "", {
        createDeal,
        dealName,
        dealAmount: numberOrNull(amount),
      }),
    "Lead converted — account, contact and deal created",
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
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  account: CrmAccount | null;
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AccountInput>(() => accountDraft(account));
  const [revenue, setRevenue] = useState(account?.annualRevenue?.toString() ?? "");
  const [size, setSize] = useState(account?.employeeCount?.toString() ?? "");
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
      pending={save.isPending}
      submitLabel={account ? "Save account" : "Add account"}
      onSubmit={() => {
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
  owners,
  canAssign,
  onClose,
}: {
  open: boolean;
  contact: CrmContact | null;
  accounts: CrmAccount[];
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ContactInput>(() => contactDraft(contact));
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
      pending={save.isPending}
      submitLabel={contact ? "Save contact" : "Add contact"}
      onSubmit={() => {
        if (!draft.firstName.trim()) {
          toast.error("First name is required.");
          return;
        }
        const input: ContactInput = { ...draft };
        if (!canAssign || !draft.ownerId) delete input.ownerId;
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
  owners: CrmOwner[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ActivityInput>(() => activityDraft(activity, preset));
  const [kind, setKind] = useState<RelatedKind>(() =>
    relatedKindOf(activityDraft(activity, preset)),
  );
  const [due, setDue] = useState(() => toIstInput(activity?.dueAt ?? null));
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
          onChange={(e) => setDue(e.target.value)}
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
            onChange={(e) => setRelated(e.target.value || null)}
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
