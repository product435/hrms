import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  CircleDollarSign,
  Download,
  History,
  LayoutGrid,
  Lightbulb,
  List,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  UploadCloud,
  Video,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { FilterBar } from "@/components/common/FilterBar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { IconAction } from "@/components/common/IconAction";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/common/States";
import {
  AccountDialog,
  ActivityDialog,
  CRM_QUERY_KEY,
  CallHistoryDialog,
  CallLogDialog,
  ConfirmDelete,
  ContactDialog,
  ConvertLeadDialog,
  DealDialog,
  LeadDialog,
  LeadImportDialog,
  WhatsAppDialog,
  CallDialog,
  WhatsAppInboxDialog,
  callHref,
  exportActivities,
  exportLeads,
} from "@/components/crm/CrmForms";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthForPath } from "@/lib/auth-guard";
import { usePermissions } from "@/hooks/usePermissions";
import { compactInr, indiaDateKey, indianDateTime, inr, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { crmService } from "@/services/crmService";
import {
  computeForecastTotals,
  currentForecastPeriod,
  fetchSalesTargets,
  forecastInsights,
  forecastVsActualSeries,
  pipelineByStage,
  requestAiForecastNotes,
  salespersonForecastRows,
  shiftForecastPeriod,
  type AiForecastNotes,
  type ForecastPeriod,
  type ForecastPeriodKind,
  type ForecastTotals,
  type SalespersonForecastRow,
  type StageForecastRow,
} from "@/services/forecastService";
import {
  ACTIVITY_STATUSES,
  DEAL_STAGES,
  LEAD_STATUSES,
  LISTING_RATING_RANGES,
  OPEN_DEAL_STAGES,
  STAGE_PROBABILITY,
  crmLabel,
  matchesListingRatingRange,
  type ActivityInput,
  type CrmAccount,
  type CrmActivity,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type DealStage,
  type ListingRatingRange,
} from "@/types/crm";

export const Route = createFileRoute("/crm")({
  beforeLoad: () => requireAuthForPath("/crm"),
  head: () => ({
    meta: [{ title: "Sales CRM · JeeVijay HRMS" }],
  }),
  component: CrmPage,
});

const ALL = "all";
const MINE = "mine";

type DeleteTarget =
  | { kind: "lead"; id: string; name: string }
  | { kind: "deal"; id: string; name: string }
  | { kind: "account"; id: string; name: string }
  | { kind: "contact"; id: string; name: string }
  | { kind: "activity"; id: string; name: string };

/** Which dialog is open, and with what record (null = create). */
type Editing =
  | { kind: "lead"; record: CrmLead | null }
  | { kind: "deal"; record: CrmDeal | null }
  | { kind: "account"; record: CrmAccount | null }
  | { kind: "contact"; record: CrmContact | null }
  | { kind: "activity"; record: CrmActivity | null; preset?: Partial<ActivityInput> };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Try again.";
}

function personName(first: string, last: string) {
  return `${first} ${last}`.trim();
}

const STAGE_TONE: Record<DealStage, string> = {
  prospecting: "bg-muted",
  qualification: "bg-info/12",
  proposal: "bg-primary/10",
  negotiation: "bg-warning/15",
  won: "bg-success/12",
  lost: "bg-destructive/10",
};

function CrmPage() {
  const { user, crm } = usePermissions();
  const me = user.employeeId ?? "";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [converting, setConverting] = useState<CrmLead | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [loggingCallFor, setLoggingCallFor] = useState<CrmActivity | null>(null);
  const [viewingCallHistoryFor, setViewingCallHistoryFor] = useState<string | null>(null);
  const [whatsappInboxOpen, setWhatsappInboxOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [visibleActivities, setVisibleActivities] = useState<CrmActivity[]>([]);

  const leads = useQuery({ queryKey: [...CRM_QUERY_KEY, "leads"], queryFn: crmService.leads });
  const deals = useQuery({ queryKey: [...CRM_QUERY_KEY, "deals"], queryFn: crmService.deals });
  const accounts = useQuery({
    queryKey: [...CRM_QUERY_KEY, "accounts"],
    queryFn: crmService.accounts,
  });
  const contacts = useQuery({
    queryKey: [...CRM_QUERY_KEY, "contacts"],
    queryFn: crmService.contacts,
  });
  const activities = useQuery({
    queryKey: [...CRM_QUERY_KEY, "activities"],
    queryFn: crmService.activities,
  });
  const owners = useQuery({
    queryKey: [...CRM_QUERY_KEY, "owners"],
    queryFn: crmService.owners,
    enabled: crm.canManageAll,
  });

  /** Own records, or anyone's for a sales lead / Super Admin. Never for read-only viewers. */
  const canEdit = (ownerId: string) => crm.canWrite && (crm.canManageAll || ownerId === me);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
  const remove = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      if (target.kind === "lead") return crmService.deleteLead(target.id);
      if (target.kind === "deal") return crmService.deleteDeal(target.id);
      if (target.kind === "account") return crmService.deleteAccount(target.id);
      if (target.kind === "contact") return crmService.deleteContact(target.id);
      return crmService.deleteActivity(target.id);
    },
    onSuccess: (_data, target) => {
      toast.success(`${crmLabel(target.kind)} deleted`);
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const shared = {
    leads: leads.data ?? [],
    deals: deals.data ?? [],
    accounts: accounts.data ?? [],
    contacts: contacts.data ?? [],
    activities: activities.data ?? [],
  };
  const ownerList = owners.data ?? [];

  const newButton = (() => {
    if (!crm.canWrite) return null;
    const map: Record<string, { label: string; open: () => void }> = {
      overview: { label: "New deal", open: () => setEditing({ kind: "deal", record: null }) },
      leads: { label: "New lead", open: () => setEditing({ kind: "lead", record: null }) },
      deals: { label: "New deal", open: () => setEditing({ kind: "deal", record: null }) },
      accounts: {
        label: "New account",
        open: () => setEditing({ kind: "account", record: null }),
      },
      contacts: {
        label: "New contact",
        open: () => setEditing({ kind: "contact", record: null }),
      },
      activities: {
        label: "Log activity",
        open: () => setEditing({ kind: "activity", record: null }),
      },
    };
    const action = map[tab];
    if (!action) return null;
    return (
      <div className="flex gap-2">
        {tab === "leads" && (crm.canWrite || crm.canManageAll) ? (
          <Button variant="outline" onClick={() => setWhatsappInboxOpen(true)}>
            <MessageCircle className="size-4" /> WhatsApp inbox
          </Button>
        ) : null}
        {tab === "leads" && crm.canWrite ? (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadCloud className="size-4" /> Import
          </Button>
        ) : null}
        {tab === "activities" ? (
          <Button variant="outline" onClick={() => void exportActivities(visibleActivities)}>
            <Download className="size-4" /> Export
          </Button>
        ) : null}
        <Button onClick={action.open}>
          <Plus className="size-4" /> {action.label}
        </Button>
      </div>
    );
  })();

  return (
    <AppLayout>
      <PageHeader
        eyebrow={crm.canWrite ? "Sales team" : "Read-only oversight"}
        title="Sales CRM"
        description={
          crm.canWrite
            ? "Leads, pipeline, accounts, contacts and follow-ups shared across the sales team."
            : "You can see the whole sales pipeline. Only the sales team and Super Admin make changes."
        }
        actions={newButton}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="activities">Activities</TabsTrigger>
            <TabsTrigger value="forecasting">Sales Forecasting</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <OverviewTab
            loading={leads.isLoading || deals.isLoading || activities.isLoading}
            error={leads.error ?? deals.error ?? activities.error}
            onRetry={refresh}
            me={me}
            showTeam={crm.canManageAll || !crm.canWrite}
            {...shared}
            onOpenTab={setTab}
          />
        </TabsContent>

        <TabsContent value="leads">
          <LeadsTab
            leads={shared.leads}
            accounts={shared.accounts}
            contacts={shared.contacts}
            query={leads}
            me={me}
            canManageAll={crm.canManageAll}
            canEdit={canEdit}
            onEdit={(record) => setEditing({ kind: "lead", record })}
            onConvert={setConverting}
            onDelete={(lead) =>
              setDeleting({
                kind: "lead",
                id: lead.id,
                name: personName(lead.firstName, lead.lastName),
              })
            }
            onLog={(lead) =>
              setEditing({
                kind: "activity",
                record: null,
                preset: { leadId: lead.id, subject: `Follow up with ${lead.firstName}` },
              })
            }
            onOpenTab={setTab}
          />
        </TabsContent>

        <TabsContent value="deals">
          <DealsTab
            deals={shared.deals}
            query={deals}
            me={me}
            canEdit={canEdit}
            onEdit={(record) => setEditing({ kind: "deal", record })}
            onDelete={(deal) => setDeleting({ kind: "deal", id: deal.id, name: deal.name })}
          />
        </TabsContent>

        <TabsContent value="accounts">
          <AccountsTab
            accounts={shared.accounts}
            deals={shared.deals}
            contacts={shared.contacts}
            query={accounts}
            canEdit={canEdit}
            onEdit={(record) => setEditing({ kind: "account", record })}
            onDelete={(account) =>
              setDeleting({ kind: "account", id: account.id, name: account.name })
            }
          />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsTab
            contacts={shared.contacts}
            query={contacts}
            canEdit={canEdit}
            onEdit={(record) => setEditing({ kind: "contact", record })}
            onDelete={(contact) =>
              setDeleting({
                kind: "contact",
                id: contact.id,
                name: personName(contact.firstName, contact.lastName),
              })
            }
          />
        </TabsContent>

        <TabsContent value="activities">
          <ActivitiesTab
            activities={shared.activities}
            query={activities}
            me={me}
            canEdit={canEdit}
            onEdit={(record) => setEditing({ kind: "activity", record })}
            onDelete={(activity) =>
              setDeleting({ kind: "activity", id: activity.id, name: activity.subject })
            }
            onLogCall={(activity) => setLoggingCallFor(activity)}
            onViewCallHistory={(activity) => setViewingCallHistoryFor(activity.id)}
            onVisibleRowsChange={setVisibleActivities}
          />
        </TabsContent>

        <TabsContent value="forecasting">
          <ForecastingTab
            loading={deals.isLoading}
            error={deals.error}
            onRetry={refresh}
            me={me}
            showTeam={crm.canManageAll || !crm.canWrite}
            deals={shared.deals}
          />
        </TabsContent>
      </Tabs>

      {editing?.kind === "lead" ? (
        <LeadDialog
          key={editing.record?.id ?? "new-lead"}
          open
          lead={editing.record}
          owners={ownerList}
          canAssign={crm.canManageAll}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "deal" ? (
        <DealDialog
          key={editing.record?.id ?? "new-deal"}
          open
          deal={editing.record}
          accounts={shared.accounts}
          contacts={shared.contacts}
          owners={ownerList}
          canAssign={crm.canManageAll}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "account" ? (
        <AccountDialog
          key={editing.record?.id ?? "new-account"}
          open
          account={editing.record}
          owners={ownerList}
          canAssign={crm.canManageAll}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "contact" ? (
        <ContactDialog
          key={editing.record?.id ?? "new-contact"}
          open
          contact={editing.record}
          accounts={shared.accounts}
          owners={ownerList}
          canAssign={crm.canManageAll}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "activity" ? (
        <ActivityDialog
          key={editing.record?.id ?? `new-activity-${editing.preset?.leadId ?? ""}`}
          open
          activity={editing.record}
          {...(editing.preset ? { preset: editing.preset } : {})}
          leads={shared.leads}
          deals={shared.deals}
          accounts={shared.accounts}
          contacts={shared.contacts}
          owners={ownerList}
          canAssign={crm.canManageAll}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {converting ? (
        <ConvertLeadDialog
          key={converting.id}
          lead={converting}
          onClose={() => setConverting(null)}
        />
      ) : null}
      <CallLogDialog
        open={loggingCallFor != null}
        activity={loggingCallFor}
        owners={ownerList}
        canAssign={crm.canManageAll}
        onClose={() => setLoggingCallFor(null)}
      />
      <CallHistoryDialog
        open={viewingCallHistoryFor != null}
        activityId={viewingCallHistoryFor}
        onClose={() => setViewingCallHistoryFor(null)}
      />
      <WhatsAppInboxDialog
        open={whatsappInboxOpen}
        leads={shared.leads}
        me={me}
        canViewAll={crm.canManageAll}
        onClose={() => setWhatsappInboxOpen(false)}
      />
      <LeadImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmDelete
        target={deleting}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </AppLayout>
  );
}

// ------------------------------------------------------------------ Overview

function OverviewTab({
  loading,
  error,
  onRetry,
  me,
  showTeam,
  leads,
  deals,
  activities,
  onOpenTab,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  me: string;
  showTeam: boolean;
  leads: CrmLead[];
  deals: CrmDeal[];
  accounts: CrmAccount[];
  contacts: CrmContact[];
  activities: CrmActivity[];
  onOpenTab: (tab: string) => void;
}) {
  const today = indiaDateKey();
  const thisMonth = today.slice(0, 7);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [ownerFilter, setOwnerFilter] = useState(ALL);

  const applyQuickRange = (from: string, to: string) => {
    setRangeFrom(from);
    setRangeTo(to);
    setDraftFrom(from);
    setDraftTo(to);
  };

  const inRange = useCallback(
    (iso: string | null) => {
      if (!iso) return !rangeFrom && !rangeTo;
      const key = indiaDateKey(iso);
      if (rangeFrom && key < rangeFrom) return false;
      if (rangeTo && key > rangeTo) return false;
      return true;
    },
    [rangeFrom, rangeTo],
  );
  const matchesFilterOwner = useCallback(
    (ownerId: string) => (ownerFilter === ALL ? true : ownerId === ownerFilter),
    [ownerFilter],
  );

  const filteredLeads = useMemo(
    () => leads.filter((lead) => matchesFilterOwner(lead.ownerId) && inRange(lead.createdAt)),
    [leads, matchesFilterOwner, inRange],
  );
  const filteredDeals = useMemo(
    () => deals.filter((deal) => matchesFilterOwner(deal.ownerId) && inRange(deal.createdAt)),
    [deals, matchesFilterOwner, inRange],
  );

  const metrics = useMemo(() => {
    const open = filteredDeals.filter((deal) => OPEN_DEAL_STAGES.includes(deal.stage));
    const wonInRange = filteredDeals.filter(
      (deal) => deal.stage === "won" && deal.closedAt && inRange(deal.closedAt),
    );
    const lostInRange = filteredDeals.filter(
      (deal) => deal.stage === "lost" && deal.closedAt && inRange(deal.closedAt),
    );
    const won = filteredDeals.filter((deal) => deal.stage === "won").length;
    const lost = filteredDeals.filter((deal) => deal.stage === "lost").length;
    const plannedActivities = activities.filter((activity) => activity.status === "planned");
    const overdue = plannedActivities.filter(
      (activity) => activity.dueAt && indiaDateKey(activity.dueAt) < today,
    );
    const qualified = filteredLeads.filter((lead) => lead.status === "qualified").length;
    const demosScheduled = filteredLeads.filter((lead) => lead.demoStatus === "scheduled").length;
    const demosCompleted = filteredLeads.filter((lead) => lead.demoStatus === "completed").length;
    return {
      pipeline: open.reduce((sum, deal) => sum + deal.amount, 0),
      weighted: open.reduce((sum, deal) => sum + (deal.amount * deal.probability) / 100, 0),
      openCount: open.length,
      wonValue: wonInRange.reduce((sum, deal) => sum + deal.amount, 0),
      wonCount: wonInRange.length,
      lostCount: lostInRange.length,
      winRate: won + lost === 0 ? null : (won / (won + lost)) * 100,
      openLeads: filteredLeads.filter((lead) => !["converted", "unqualified"].includes(lead.status))
        .length,
      hotLeads: filteredLeads.filter((lead) => lead.rating === "hot" && lead.status !== "converted")
        .length,
      overdue: overdue.length,
      totalProspects: filteredLeads.length,
      qualifiedProspects: qualified,
      demosScheduled,
      demosCompleted,
    };
  }, [activities, filteredDeals, filteredLeads, inRange, today]);

  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of [...leads, ...deals]) seen.set(row.ownerId, row.ownerName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads, deals]);

  const employeeStats = useMemo(() => {
    const byOwner = new Map<
      string,
      {
        name: string;
        prospects: number;
        callsCompleted: number;
        interested: number;
        demosCompleted: number;
        dealsConverted: number;
        dealsWon: number;
        wonRevenue: number;
      }
    >();
    const get = (id: string, name: string) =>
      byOwner.get(id) ?? {
        name,
        prospects: 0,
        callsCompleted: 0,
        interested: 0,
        demosCompleted: 0,
        dealsConverted: 0,
        dealsWon: 0,
        wonRevenue: 0,
      };
    for (const lead of filteredLeads) {
      const row = get(lead.ownerId, lead.ownerName);
      row.prospects += 1;
      if (lead.rating === "hot") row.interested += 1;
      if (lead.demoStatus === "completed") row.demosCompleted += 1;
      if (lead.status === "converted") row.dealsConverted += 1;
      byOwner.set(lead.ownerId, row);
    }
    for (const activity of activities) {
      if (activity.type !== "call" || activity.status !== "done") continue;
      if (!matchesFilterOwner(activity.ownerId)) continue;
      const row = get(activity.ownerId, activity.ownerName);
      row.callsCompleted += 1;
      byOwner.set(activity.ownerId, row);
    }
    for (const deal of filteredDeals) {
      if (deal.stage !== "won") continue;
      const row = get(deal.ownerId, deal.ownerName);
      row.dealsWon += 1;
      row.wonRevenue += deal.amount;
      byOwner.set(deal.ownerId, row);
    }
    return [...byOwner.values()].sort((a, b) => b.wonRevenue - a.wonRevenue);
  }, [filteredLeads, filteredDeals, activities, matchesFilterOwner]);

  const byStage = useMemo(
    () =>
      OPEN_DEAL_STAGES.map((stage) => {
        const inStage = filteredDeals.filter((deal) => deal.stage === stage);
        return {
          stage,
          count: inStage.length,
          value: inStage.reduce((sum, deal) => sum + deal.amount, 0),
        };
      }),
    [filteredDeals],
  );
  const maxStageValue = Math.max(1, ...byStage.map((row) => row.value));

  const upcoming = activities
    .filter(
      (activity) =>
        activity.status === "planned" &&
        (showTeam || activity.ownerId === me) &&
        matchesFilterOwner(activity.ownerId),
    )
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))
    .slice(0, 6);

  const leaderboard = useMemo(() => {
    const byOwner = new Map<string, { name: string; won: number; open: number; count: number }>();
    for (const deal of filteredDeals) {
      const row = byOwner.get(deal.ownerId) ?? { name: deal.ownerName, won: 0, open: 0, count: 0 };
      if (deal.stage === "won") row.won += deal.amount;
      if (OPEN_DEAL_STAGES.includes(deal.stage)) row.open += deal.amount;
      row.count += 1;
      byOwner.set(deal.ownerId, row);
    }
    return [...byOwner.values()].sort((a, b) => b.won - a.won || b.open - a.open).slice(0, 6);
  }, [filteredDeals]);

  if (error) return <ErrorState message={errorText(error)} onRetry={onRetry} />;
  if (loading) return <CardsSkeleton count={4} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          aria-label="Salesperson"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-[200px]"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
        >
          <option value={ALL}>All salespeople</option>
          {owners.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => applyQuickRange(today, today)}>
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const weekAgo = new Date(now);
              weekAgo.setDate(now.getDate() - 6);
              applyQuickRange(indiaDateKey(weekAgo), today);
            }}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyQuickRange(`${thisMonth}-01`, today)}
          >
            This month
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground" htmlFor="overview-from">
            From
          </label>
          <input
            id="overview-from"
            type="date"
            lang="en-GB"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
          <label className="text-muted-foreground" htmlFor="overview-to">
            To
          </label>
          <input
            id="overview-to"
            type="date"
            lang="en-GB"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
          />
          {draftFrom !== rangeFrom || draftTo !== rangeTo ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setRangeFrom(draftFrom);
                setRangeTo(draftTo);
              }}
            >
              Apply
            </Button>
          ) : null}
          {rangeFrom || rangeTo || draftFrom || draftTo ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRangeFrom("");
                setRangeTo("");
                setDraftFrom("");
                setDraftTo("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open pipeline"
          value={compactInr(metrics.pipeline)}
          icon={CircleDollarSign}
          tone="primary"
          hint={`${metrics.openCount} open ${metrics.openCount === 1 ? "deal" : "deals"}`}
        />
        <StatCard
          label="Weighted forecast"
          value={compactInr(metrics.weighted)}
          icon={TrendingUp}
          tone="info"
          hint="Amount × win probability"
        />
        <StatCard
          label="Won this month"
          value={compactInr(metrics.wonValue)}
          icon={Trophy}
          tone="success"
          hint={`${metrics.wonCount} ${metrics.wonCount === 1 ? "deal" : "deals"} · win rate ${metrics.winRate == null ? "—" : `${Math.round(metrics.winRate)}%`}`}
        />
        <StatCard
          label="Open leads"
          value={String(metrics.openLeads)}
          icon={Target}
          tone="warning"
          hint={`${metrics.hotLeads} hot · ${metrics.overdue} overdue follow-ups`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total prospects"
          value={String(metrics.totalProspects)}
          icon={Target}
          tone="primary"
          hint="Leads in the selected range"
        />
        <StatCard
          label="Qualified prospects"
          value={String(metrics.qualifiedProspects)}
          icon={Check}
          tone="info"
          hint="Status = Qualified"
        />
        <StatCard
          label="Demos scheduled/completed"
          value={`${metrics.demosScheduled} / ${metrics.demosCompleted}`}
          icon={Video}
          tone="warning"
          hint="From lead demo tracking"
        />
        <StatCard
          label="Deals won/lost"
          value={`${metrics.wonCount} / ${metrics.lostCount}`}
          icon={Trophy}
          tone="success"
          hint="Closed in the selected range"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard
          title="Pipeline by stage"
          description="Open deal value in each stage"
          action={
            <Button variant="ghost" size="sm" onClick={() => onOpenTab("deals")}>
              Open board
            </Button>
          }
        >
          <ul className="space-y-3">
            {byStage.map((row) => (
              <li key={row.stage}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{crmLabel(row.stage)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.count} · {compactInr(row.value)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(row.value / maxStageValue) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title={showTeam ? "Upcoming follow-ups" : "My upcoming follow-ups"}
          description="Planned activities, soonest first"
          action={
            <Button variant="ghost" size="sm" onClick={() => onOpenTab("activities")}>
              All activities
            </Button>
          }
          bodyClassName="p-0"
        >
          {upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Nothing planned. Log a call or meeting to stay on top of deals.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((activity) => {
                const overdue = activity.dueAt && indiaDateKey(activity.dueAt) < today;
                return (
                  <li key={activity.id} className="flex items-start gap-3 px-5 py-3">
                    <CalendarClock
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        overdue ? "text-destructive" : "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{activity.subject}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {crmLabel(activity.type)}
                        {activity.relatedTo ? ` · ${activity.relatedTo}` : ""}
                        {showTeam ? ` · ${activity.ownerName}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        overdue ? "font-semibold text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {activity.dueAt ? indianDateTime(activity.dueAt) : "No date"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {showTeam ? (
        <SectionCard title="Team leaderboard" description="Won and open deal value by owner">
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-semibold">Owner</th>
                    <th className="pb-2 text-right font-semibold">Deals</th>
                    <th className="pb-2 text-right font-semibold">Open value</th>
                    <th className="pb-2 text-right font-semibold">Won value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leaderboard.map((row) => (
                    <tr key={row.name}>
                      <td className="py-2 font-medium">{row.name}</td>
                      <td className="py-2 text-right tabular-nums">{row.count}</td>
                      <td className="py-2 text-right tabular-nums">{inr(row.open)}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{inr(row.won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {showTeam ? (
        <SectionCard
          title="Employee-wise performance"
          description="Assigned prospects, calls, demos and actual won revenue — never counts open or interested pipeline as a sale"
        >
          {employeeStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-semibold">Salesperson</th>
                    <th className="pb-2 text-right font-semibold">Prospects</th>
                    <th className="pb-2 text-right font-semibold">Calls done</th>
                    <th className="pb-2 text-right font-semibold">Interested</th>
                    <th className="pb-2 text-right font-semibold">Demos done</th>
                    <th className="pb-2 text-right font-semibold">Converted</th>
                    <th className="pb-2 text-right font-semibold">Deals won</th>
                    <th className="pb-2 text-right font-semibold">Won revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {employeeStats.map((row) => (
                    <tr key={row.name}>
                      <td className="py-2 font-medium">{row.name}</td>
                      <td className="py-2 text-right tabular-nums">{row.prospects}</td>
                      <td className="py-2 text-right tabular-nums">{row.callsCompleted}</td>
                      <td className="py-2 text-right tabular-nums">{row.interested}</td>
                      <td className="py-2 text-right tabular-nums">{row.demosCompleted}</td>
                      <td className="py-2 text-right tabular-nums">{row.dealsConverted}</td>
                      <td className="py-2 text-right tabular-nums">{row.dealsWon}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {inr(row.wonRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- Forecasting

const INSIGHT_TONE_CLASS: Record<string, string> = {
  warning: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
};

const salespersonColumns: Column<SalespersonForecastRow>[] = [
  {
    key: "owner",
    header: "Salesperson",
    sortValue: (row) => row.ownerName,
    cell: (row) => <span className="text-sm font-semibold">{row.ownerName}</span>,
  },
  {
    key: "openPipeline",
    header: "Pipeline",
    align: "right",
    sortValue: (row) => row.openPipeline,
    cell: (row) => <span className="tabular-nums">{compactInr(row.openPipeline)}</span>,
  },
  {
    key: "expectedRevenue",
    header: "Expected",
    align: "right",
    sortValue: (row) => row.expectedRevenue,
    cell: (row) => (
      <span className="font-semibold tabular-nums">{compactInr(row.expectedRevenue)}</span>
    ),
  },
  {
    key: "closedWon",
    header: "Won",
    align: "right",
    sortValue: (row) => row.closedWon,
    cell: (row) => <span className="tabular-nums">{compactInr(row.closedWon)}</span>,
  },
  {
    key: "dealCount",
    header: "Deals",
    align: "right",
    sortValue: (row) => row.dealCount,
    cell: (row) => <span className="tabular-nums">{row.dealCount}</span>,
  },
];

/**
 * AI Forecast Insights panel. Tries the Gemini-backed Edge Function with
 * ONLY the already-computed forecast summary (never raw deals); on any
 * error -- including "not configured" when GEMINI_API_KEY isn't set -- it
 * falls back to the existing data-only insights and says so plainly. It
 * never claims AI ran unless requestAiForecastNotes actually returned a
 * result from the model.
 */
function AiForecastInsightsCard({
  period,
  totals,
  byStage,
  byOwner,
  fallbackInsights,
}: {
  period: ForecastPeriod;
  totals: ForecastTotals;
  byStage: StageForecastRow[];
  byOwner: SalespersonForecastRow[];
  fallbackInsights: ReturnType<typeof forecastInsights>;
}) {
  const [notes, setNotes] = useState<AiForecastNotes | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const run = () => {
    setAiLoading(true);
    setAiError(null);
    requestAiForecastNotes(period, totals, byStage, byOwner)
      .then((result) => setNotes(result))
      .catch((error: unknown) => {
        // requestAiForecastNotes() already turns any failure (network,
        // non-2xx, missing secret, undeployed function) into a short,
        // user-safe message -- never raw platform/HTTP error text.
        setNotes(null);
        setAiError(error instanceof Error ? error.message : "AI Forecast Insights is unavailable.");
      })
      .finally(() => setAiLoading(false));
  };

  useEffect(() => {
    setNotes(null);
    setAiError(null);
  }, [period.start, period.kind, totals, byOwner]);

  return (
    <SectionCard
      title="AI forecast insights"
      {...(notes
        ? {}
        : { description: "Data-based observations, calculated from this period's deals" })}
      action={
        <Button variant="outline" size="sm" onClick={run} disabled={aiLoading}>
          {aiLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {aiLoading ? "Generating…" : notes ? "Regenerate" : "Try AI insights"}
        </Button>
      }
    >
      {notes ? (
        <div className="space-y-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> AI-generated from this period's calculated totals
          </p>
          <InsightGroup icon={TrendingDown} label="Risks" tone="warning" items={notes.risks} />
          <InsightGroup
            icon={TrendingUp}
            label="Opportunities"
            tone="success"
            items={notes.opportunities}
          />
          <InsightGroup
            icon={Lightbulb}
            label="Recommendations"
            tone="info"
            items={notes.recommendations}
          />
          {notes.risks.length === 0 &&
          notes.opportunities.length === 0 &&
          notes.recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The AI model found nothing notable to report for this period.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {aiError ? (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" /> {aiError}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lightbulb className="size-3.5" /> Data-based insights (not generated by an AI model)
            </p>
          )}
          {fallbackInsights.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No notable patterns"
              description="Nothing stands out for this period and scope yet."
            />
          ) : (
            <ul className="space-y-3">
              {fallbackInsights.map((insight, index) => {
                const { icon: Icon, text } = describeInsight(insight);
                return (
                  <li key={index} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-xl",
                        INSIGHT_TONE_CLASS[insight.tone] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <p className="pt-1.5 text-sm">{text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function InsightGroup({
  icon: Icon,
  label,
  tone,
  items,
}: {
  icon: typeof TrendingUp;
  label: string;
  tone: "warning" | "success" | "info";
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
          tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-info",
        )}
      >
        <Icon className="size-3.5" /> {label}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Compact month/year picker for the forecast period, beside the period
 * label. Shows a native select pair (not a day-grid calendar) because a
 * forecast period is a month, quarter or year -- never a single day --
 * so a day picker would invite a selection that has no meaning here.
 */
function ForecastPeriodPicker({
  period,
  onPick,
}: {
  period: ForecastPeriod;
  onPick: (period: ForecastPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const year = Number(period.start.slice(0, 4));
  const month = Number(period.start.slice(5, 7));
  const [draftYear, setDraftYear] = useState(year);
  const [draftMonth, setDraftMonth] = useState(month);

  const years = Array.from({ length: 11 }, (_, i) => year - 5 + i);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraftYear(year);
          setDraftMonth(month);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-[8rem] justify-center gap-1.5">
          <CalendarIcon className="size-3.5" />
          <span className="text-sm font-semibold tabular-nums">{period.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">Jump to month &amp; year</p>
        <div className="flex gap-2">
          <select
            aria-label="Month"
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={draftMonth}
            onChange={(e) => setDraftMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Year"
            className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
            value={draftYear}
            onChange={(e) => setDraftYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            const reference = `${draftYear}-${String(draftMonth).padStart(2, "0")}-01`;
            onPick(currentForecastPeriod(period.kind, reference));
            setOpen(false);
          }}
        >
          Go
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const STAGE_DONUT_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

/**
 * Pipeline-by-stage donut with amount + percentage in the legend (not
 * just a raw count, which is what the shared DistributionDonut shows --
 * this is a forecasting-specific wrapper, kept separate so the shared
 * component used elsewhere in the CRM/dashboard is untouched).
 */
function PipelineStageDonut({ byStage }: { byStage: StageForecastRow[] }) {
  const rows = byStage.filter((row) => row.amount > 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const data = rows.map((row) => ({ name: crmLabel(row.stage), value: row.amount }));

  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="85%"
              paddingAngle={3}
              stroke="var(--color-card)"
              strokeWidth={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={STAGE_DONUT_COLORS[index % STAGE_DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-popover-foreground)",
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-popover-foreground)", fontWeight: 600 }}
              itemStyle={{ color: "var(--color-popover-foreground)" }}
              formatter={(value: number, name: string) => [
                `${inr(value)} (${totalAmount > 0 ? ((value / totalAmount) * 100).toFixed(0) : 0}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">Total open</span>
          <span className="text-lg font-bold">{compactInr(totalAmount)}</span>
        </div>
      </div>
      <ul className="mt-2 w-full space-y-1.5">
        {rows.map((row, index) => (
          <li key={row.stage} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: STAGE_DONUT_COLORS[index % STAGE_DONUT_COLORS.length] }}
              />
              {crmLabel(row.stage)}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {compactInr(row.amount)} ·{" "}
              {totalAmount > 0 ? ((row.amount / totalAmount) * 100).toFixed(0) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForecastingTab({
  loading,
  error,
  onRetry,
  me,
  showTeam,
  deals,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  me: string;
  showTeam: boolean;
  deals: CrmDeal[];
}) {
  const todayKey = useMemo(() => indiaDateKey(), []);
  const [periodKind, setPeriodKind] = useState<ForecastPeriodKind>("monthly");
  const [ownerFilter, setOwnerFilter] = useState(showTeam ? ALL : MINE);
  const [referenceDate, setReferenceDate] = useState(todayKey);

  const period: ForecastPeriod = useMemo(
    () => currentForecastPeriod(periodKind, referenceDate),
    [periodKind, referenceDate],
  );
  const isCurrentPeriod = period.start <= todayKey && todayKey <= period.end;

  const goToPeriod = (next: ForecastPeriod) => setReferenceDate(next.start);

  const scopedDeals = useMemo(
    () => deals.filter((deal) => matchesOwner(deal.ownerId, ownerFilter, me)),
    [deals, ownerFilter, me],
  );

  const totals = useMemo(() => computeForecastTotals(scopedDeals, period), [scopedDeals, period]);
  const byOwner = useMemo(
    () => salespersonForecastRows(scopedDeals, period),
    [scopedDeals, period],
  );
  const byStage = useMemo(() => pipelineByStage(scopedDeals, period), [scopedDeals, period]);
  const trend = useMemo(
    () => forecastVsActualSeries(scopedDeals, period, 6),
    [scopedDeals, period],
  );
  const insights = useMemo(() => forecastInsights(scopedDeals, period), [scopedDeals, period]);

  const owners = useMemo(() => ownerFilterOptions(deals), [deals]);

  const targetsQuery = useQuery({
    queryKey: [...CRM_QUERY_KEY, "sales-targets", period.kind, period.start],
    queryFn: () => fetchSalesTargets(period),
  });
  // null = "no target source configured"; a number = the applicable target
  // for the current owner scope (company-wide target when scope is "All",
  // the matching rep's target when scope is one person or "Mine"). Never
  // invented -- only ever a real row from crm_sales_targets, or null.
  const salesTarget = useMemo(() => {
    const result = targetsQuery.data;
    if (!result || result.status !== "ok") return null;
    if (ownerFilter === ALL) {
      const company = result.targets.find((t) => t.ownerId === null);
      return company?.targetAmount ?? null;
    }
    const ownerId = ownerFilter === MINE ? me : ownerFilter;
    const mine = result.targets.find((t) => t.ownerId === ownerId);
    return mine?.targetAmount ?? null;
  }, [targetsQuery.data, ownerFilter, me]);

  if (error) return <ErrorState message={errorText(error)} onRetry={onRetry} />;
  if (loading) return <CardsSkeleton count={4} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 rounded-lg border border-input bg-background p-1">
            {(["monthly", "quarterly", "yearly"] as ForecastPeriodKind[]).map((kind) => (
              <Button
                key={kind}
                variant={periodKind === kind ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriodKind(kind)}
              >
                {crmLabel(kind)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous period"
              onClick={() => goToPeriod(shiftForecastPeriod(period, -1))}
            >
              ←
            </Button>
            <ForecastPeriodPicker period={period} onPick={goToPeriod} />
            <Button
              variant="outline"
              size="sm"
              aria-label="Next period"
              onClick={() => goToPeriod(shiftForecastPeriod(period, 1))}
            >
              →
            </Button>
            {!isCurrentPeriod ? (
              <Button variant="ghost" size="sm" onClick={() => setReferenceDate(todayKey)}>
                Current
              </Button>
            ) : null}
          </div>
        </div>
        {showTeam ? (
          <select
            aria-label="Salesperson"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-[200px]"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            {owners.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales target"
          value={salesTarget == null ? "Not configured" : compactInr(salesTarget)}
          icon={Target}
          tone="neutral"
          hint={
            salesTarget == null
              ? "No target set for this period and scope"
              : salesTarget > 0
                ? `${((totals.closedWon / salesTarget) * 100).toFixed(0)}% of target closed won`
                : "Target is set to zero for this period"
          }
        />
        <StatCard
          label="Expected revenue"
          value={compactInr(totals.expectedRevenue)}
          icon={TrendingUp}
          tone="info"
          hint={`${period.label} · amount × probability`}
        />
        <StatCard
          label="Closed won"
          value={compactInr(totals.closedWon)}
          icon={Trophy}
          tone="success"
          hint={`${totals.closedWonCount} ${totals.closedWonCount === 1 ? "deal" : "deals"} closed in period`}
        />
        <StatCard
          label="Open pipeline"
          value={compactInr(totals.openPipeline)}
          icon={CircleDollarSign}
          tone="accent"
          hint={`${totals.openCount} open, expected to close in ${period.label}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <SectionCard
          title="Revenue forecast"
          description="Expected revenue vs closed-won, last 6 periods"
        >
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trend.map((row) => ({
                  label: row.period.label,
                  expected: row.expectedRevenue,
                  closed: row.closedWon,
                }))}
                margin={{ left: 0, right: 16, top: 12, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  tickMargin={8}
                  fontSize={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  width={48}
                  fontSize={12}
                  tickFormatter={(value) => compactInr(Number(value))}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--color-popover-foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--color-popover-foreground)" }}
                  formatter={(value: number) => inr(value)}
                  cursor={{ stroke: "var(--color-primary)", strokeOpacity: 0.18 }}
                />
                <Legend
                  wrapperStyle={{ color: "var(--color-muted-foreground)", fontSize: 12, paddingTop: 8 }}
                />
                <Line
                  type="monotone"
                  dataKey="expected"
                  name="Expected revenue"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="closed"
                  name="Closed won"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Company forecast"
          description={`Open pipeline, expected revenue and closed-won in ${period.label}`}
        >
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { label: "Open pipeline", value: totals.openPipeline, fill: "var(--color-chart-3)" },
                  {
                    label: "Expected revenue",
                    value: totals.expectedRevenue,
                    fill: "var(--color-chart-2)",
                  },
                  { label: "Closed won", value: totals.closedWon, fill: "var(--color-chart-1)" },
                ]}
                layout="vertical"
                margin={{ left: 8, right: 64, top: 8, bottom: 8 }}
                barCategoryGap={32}
              >
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  fontSize={12}
                  tickFormatter={(value) => compactInr(Number(value))}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tick={{ fill: "var(--color-muted-foreground)" }}
                  width={110}
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--color-popover-foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--color-popover-foreground)" }}
                  formatter={(value: number) => inr(value)}
                  cursor={{ fill: "var(--color-primary)", fillOpacity: 0.08 }}
                />
                {/* Value labels guarantee every bar is readable even when one
                    series dwarfs the others on a shared linear scale -- the
                    scale itself stays honest (no log/clamp tricks), the
                    label is what keeps a tiny bar legible. */}
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={36} minPointSize={2}>
                  {[totals.openPipeline, totals.expectedRevenue, totals.closedWon].map(
                    (_, index) => (
                      <Cell
                        key={index}
                        fill={
                          [
                            "var(--color-chart-3)",
                            "var(--color-chart-2)",
                            "var(--color-chart-1)",
                          ][index]
                        }
                      />
                    ),
                  )}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(value: number) => compactInr(value)}
                    fill="var(--color-foreground)"
                    fontSize={12}
                    fontWeight={600}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_1fr]">
        <SectionCard
          title="Salesperson forecast"
          description={`Per-owner breakdown for ${period.label}`}
          bodyClassName="p-0"
        >
          {byOwner.length === 0 ? (
            <EmptyState
              title="No deals in this period"
              description="No open or closed deals fall into the selected period for this scope."
            />
          ) : (
            <DataTable data={byOwner} rowKey={(row) => row.ownerId} columns={salespersonColumns} />
          )}
        </SectionCard>

        <SectionCard
          title="Pipeline by stage"
          description={`Open deals expected to close in ${period.label}`}
          bodyClassName="flex flex-col items-center"
        >
          {byStage.every((row) => row.amount === 0) ? (
            <EmptyState
              title="No open pipeline"
              description="No open deals are expected to close in this period."
            />
          ) : (
            <PipelineStageDonut byStage={byStage} />
          )}
        </SectionCard>

        <SectionCard
          title="Forecast vs actual"
          description="Expected revenue vs closed-won, side by side per period"
        >
          {trend.every((row) => row.expectedRevenue === 0 && row.closedWon === 0) ? (
            <EmptyState
              title="No data yet"
              description="No open or closed deals fall into the last 6 periods for this scope."
            />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={trend.map((row) => ({
                    label: row.period.label,
                    expected: row.expectedRevenue,
                    closed: row.closedWon,
                  }))}
                  margin={{ left: 0, right: 8, top: 12, bottom: 8 }}
                  barGap={2}
                >
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tick={{ fill: "var(--color-muted-foreground)" }}
                    tickMargin={8}
                    fontSize={11}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tick={{ fill: "var(--color-muted-foreground)" }}
                    width={44}
                    fontSize={12}
                    tickFormatter={(value) => compactInr(Number(value))}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--color-popover-foreground)", fontWeight: 600 }}
                    itemStyle={{ color: "var(--color-popover-foreground)" }}
                    formatter={(value: number) => inr(value)}
                    cursor={{ fill: "var(--color-primary)", fillOpacity: 0.08 }}
                  />
                  <Legend
                    wrapperStyle={{
                      color: "var(--color-muted-foreground)",
                      fontSize: 12,
                      paddingTop: 8,
                    }}
                  />
                  <Bar
                    dataKey="expected"
                    name="Expected"
                    fill="var(--color-chart-2)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="closed"
                    name="Actual (won)"
                    fill="var(--color-chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <AiForecastInsightsCard
        period={period}
        totals={totals}
        byStage={byStage}
        byOwner={byOwner}
        fallbackInsights={insights}
      />
    </div>
  );
}

function describeInsight(insight: ReturnType<typeof forecastInsights>[number]) {
  switch (insight.kind) {
    case "overdue":
      return {
        icon: AlertTriangle,
        text: `${insight.count} open ${insight.count === 1 ? "deal" : "deals"} worth ${compactInr(insight.amount)} ${insight.count === 1 ? "has" : "have"} an expected close date in the past but ${insight.count === 1 ? "is" : "are"} still open.`,
      };
    case "stalled":
      return {
        icon: Lightbulb,
        text: `${insight.count} deals are still in Prospecting with a close date in this period — consider reviewing them for progress.`,
      };
    case "win-rate":
      return {
        icon: TrendingUp,
        text: `Win rate for this period is ${insight.winRate.toFixed(0)}% (${insight.won} won / ${insight.lost} lost).`,
      };
    case "no-activity":
    default:
      return {
        icon: Lightbulb,
        text: "No open or closed deals fall into this period and scope yet.",
      };
  }
}

// --------------------------------------------------------------------- Leads

function ownerFilterOptions(rows: { ownerId: string; ownerName: string }[]) {
  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.ownerId, row.ownerName);
  return [
    { value: ALL, label: "All owners" },
    { value: MINE, label: "Mine" },
    ...[...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];
}

function matchesOwner(ownerId: string, filter: string, me: string) {
  if (filter === ALL) return true;
  if (filter === MINE) return ownerId === me;
  return ownerId === filter;
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
}

function LeadsTab({
  leads,
  accounts,
  contacts,
  query,
  me,
  canManageAll,
  canEdit,
  onEdit,
  onConvert,
  onDelete,
  onLog,
  onOpenTab,
}: {
  leads: CrmLead[];
  accounts: CrmAccount[];
  contacts: CrmContact[];
  query: QueryState;
  me: string;
  canManageAll: boolean;
  canEdit: (ownerId: string) => boolean;
  onEdit: (lead: CrmLead) => void;
  onConvert: (lead: CrmLead) => void;
  onDelete: (lead: CrmLead) => void;
  onLog: (lead: CrmLead) => void;
  onOpenTab: (tab: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [rating, setRating] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [whatsappLead, setWhatsappLead] = useState<CrmLead | null>(null);
  const [callLead, setCallLead] = useState<CrmLead | null>(null);
  const needle = search.trim().toLowerCase();
  const rows = leads.filter((lead) => {
    if (status === "open" && ["converted", "unqualified"].includes(lead.status)) return false;
    if (status !== "open" && status !== ALL && lead.status !== status) return false;
    if (
      rating !== ALL &&
      !matchesListingRatingRange(lead.listingRating, rating as ListingRatingRange)
    )
      return false;
    if (!matchesOwner(lead.ownerId, owner, me)) return false;
    if (!needle) return true;
    return [lead.firstName, lead.lastName, lead.company, lead.email, lead.phone].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const columns: Column<CrmLead>[] = [
    {
      key: "name",
      header: "Lead",
      sortValue: (row) => personName(row.firstName, row.lastName),
      cell: (row) => {
        const linkedAccount = row.convertedAccountId
          ? accountById.get(row.convertedAccountId)
          : undefined;
        const linkedContact = row.convertedContactId
          ? contactById.get(row.convertedContactId)
          : undefined;
        return (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {personName(row.firstName, row.lastName)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[row.company, row.jobTitle].filter(Boolean).join(" · ") || "—"}
            </p>
            {row.status === "converted" && (linkedAccount || linkedContact) ? (
              <p className="mt-0.5 truncate text-xs">
                {linkedAccount ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTab("accounts");
                    }}
                  >
                    {linkedAccount.name}
                  </button>
                ) : null}
                {linkedAccount && linkedContact ? " · " : ""}
                {linkedContact ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTab("contacts");
                    }}
                  >
                    {personName(linkedContact.firstName, linkedContact.lastName)}
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div className="text-xs">
          <p>{row.email || "—"}</p>
          {row.phone ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <a
                className="hover:underline"
                href={callHref(row.phone)}
                onClick={(e) => e.stopPropagation()}
              >
                {row.phone}
              </a>
              <button
                type="button"
                aria-label="Call"
                className="text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setCallLead(row);
                }}
              >
                <Phone className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="WhatsApp"
                className="text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setWhatsappLead(row);
                }}
              >
                <MessageCircle className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => LEAD_STATUSES.indexOf(row.status),
      cell: (row) => (
        <StatusBadge
          status={row.status}
          tone={
            row.status === "qualified"
              ? "success"
              : row.status === "converted"
                ? "accent"
                : row.status === "unqualified"
                  ? "neutral"
                  : "info"
          }
        />
      ),
    },
    {
      key: "rating",
      header: "Rating",
      sortValue: (row) => row.listingRating,
      cell: (row) =>
        row.listingRating != null ? (
          <span className="tabular-nums text-sm font-medium">{row.listingRating.toFixed(1)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => <span className="text-sm">{crmLabel(row.source)}</span>,
    },
    {
      key: "value",
      header: "Est. value",
      align: "right",
      sortValue: (row) => row.estimatedValue,
      cell: (row) =>
        row.estimatedValue != null ? (
          <span className="tabular-nums">{inr(row.estimatedValue)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.ownerName,
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        canEdit(row.ownerId) ? (
          <div className="flex justify-end gap-1">
            {row.status !== "converted" && row.status !== "unqualified" ? (
              <IconAction
                label="Convert to deal"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onConvert(row);
                }}
              >
                <ArrowRightLeft />
              </IconAction>
            ) : null}
            <IconAction
              label="Log activity"
              onClick={(e) => {
                e.stopPropagation();
                onLog(row);
              }}
            >
              <CalendarClock />
            </IconAction>
            <IconAction
              label="Edit lead"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(row);
              }}
            >
              <Pencil />
            </IconAction>
            <IconAction
              label="Delete lead"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row);
              }}
            >
              <Trash2 />
            </IconAction>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search name, company, email or phone"
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "open", label: "Open leads" },
              { value: ALL, label: "All statuses" },
              ...LEAD_STATUSES.map((value) => ({ value, label: crmLabel(value) })),
            ],
          },
          {
            id: "rating",
            label: "Rating",
            value: rating,
            onChange: setRating,
            options: [{ value: ALL, label: "All ratings" }, ...LISTING_RATING_RANGES],
          },
          {
            id: "owner",
            label: "Owner",
            value: owner,
            onChange: setOwner,
            options: ownerFilterOptions(leads),
          },
        ]}
        actions={
          <Button variant="outline" onClick={() => exportLeads(rows)}>
            <Download className="size-4" /> Export
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => {
          if (canEdit(row.ownerId)) onEdit(row);
        }}
        pageSize={15}
        emptyTitle="No leads here"
        emptyDescription="New enquiries, referrals and event contacts land here first."
      />
      <WhatsAppDialog
        open={whatsappLead != null}
        leadId={whatsappLead?.id ?? null}
        contactId={null}
        customerPhone={whatsappLead?.phone ?? ""}
        ownerId={whatsappLead?.ownerId ?? ""}
        canAssign={canManageAll}
        me={me}
        onClose={() => setWhatsappLead(null)}
      />
      <CallDialog
        open={callLead != null}
        phone={callLead?.phone ?? ""}
        onClose={() => setCallLead(null)}
      />
    </div>
  );
}

// --------------------------------------------------------------------- Deals

function DealsTab({
  deals,
  query,
  me,
  canEdit,
  onEdit,
  onDelete,
}: {
  deals: CrmDeal[];
  query: QueryState;
  me: string;
  canEdit: (ownerId: string) => boolean;
  onEdit: (deal: CrmDeal) => void;
  onDelete: (deal: CrmDeal) => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ALL);
  const needle = search.trim().toLowerCase();
  const rows = deals.filter((deal) => {
    if (!matchesOwner(deal.ownerId, owner, me)) return false;
    if (!needle) return true;
    return [deal.name, deal.accountName, deal.contactName].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  const move = useMutation({
    mutationFn: ({ deal, stage }: { deal: CrmDeal; stage: DealStage }) =>
      crmService.moveDeal(deal.id, stage, STAGE_PROBABILITY[stage]),
    onSuccess: (_data, { stage }) => {
      toast.success(`Moved to ${crmLabel(stage)}`);
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const columns: Column<CrmDeal>[] = [
    {
      key: "name",
      header: "Deal",
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.accountName, row.contactName].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      sortValue: (row) => DEAL_STAGES.indexOf(row.stage),
      cell: (row) => <StatusBadge status={row.stage} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (row) => row.amount,
      cell: (row) => <span className="font-semibold tabular-nums">{inr(row.amount)}</span>,
    },
    {
      key: "probability",
      header: "Prob.",
      align: "right",
      sortValue: (row) => row.probability,
      cell: (row) => <span className="tabular-nums">{row.probability}%</span>,
    },
    {
      key: "close",
      header: "Close",
      sortValue: (row) => row.closedAt ?? row.expectedCloseDate,
      cell: (row) =>
        row.closedAt ? (
          <span className="text-sm">{shortDate(row.closedAt)}</span>
        ) : row.expectedCloseDate ? (
          <span className="text-sm text-muted-foreground">{shortDate(row.expectedCloseDate)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.ownerName,
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        canEdit(row.ownerId) ? (
          <div className="flex justify-end gap-1">
            <IconAction
              label="Edit deal"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(row);
              }}
            >
              <Pencil />
            </IconAction>
            <IconAction
              label="Delete deal"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row);
              }}
            >
              <Trash2 />
            </IconAction>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search deal, account or contact"
        filters={[
          {
            id: "owner",
            label: "Owner",
            value: owner,
            onChange: setOwner,
            options: ownerFilterOptions(deals),
          },
        ]}
        actions={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Deal view">
            <Button
              size="sm"
              variant={view === "board" ? "secondary" : "ghost"}
              onClick={() => setView("board")}
              aria-pressed={view === "board"}
            >
              <LayoutGrid className="size-4" /> Board
            </Button>
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
            >
              <List className="size-4" /> List
            </Button>
          </div>
        }
      />
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : view === "list" ? (
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          isLoading={query.isLoading}
          pageSize={15}
          emptyTitle="No deals yet"
          emptyDescription="Convert a qualified lead or add a deal to start the pipeline."
        />
      ) : query.isLoading ? (
        <CardsSkeleton count={4} />
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {DEAL_STAGES.map((stage) => {
            const inStage = rows.filter((deal) => deal.stage === stage);
            const total = inStage.reduce((sum, deal) => sum + deal.amount, 0);
            return (
              <section
                key={stage}
                className={cn(
                  "flex min-h-40 w-64 shrink-0 flex-col rounded-xl p-2",
                  STAGE_TONE[stage],
                )}
                aria-label={`${crmLabel(stage)} deals`}
              >
                <header className="flex items-baseline justify-between px-1.5 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider">{crmLabel(stage)}</h3>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {inStage.length} · {compactInr(total)}
                  </span>
                </header>
                <ul className="flex flex-1 flex-col gap-2">
                  {inStage.map((deal) => (
                    <li key={deal.id} className="rounded-lg border bg-card p-2.5 shadow-card">
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          className="block min-w-0 flex-1 text-left"
                          onClick={() => canEdit(deal.ownerId) && onEdit(deal)}
                          disabled={!canEdit(deal.ownerId)}
                        >
                          <p className="line-clamp-2 text-sm font-semibold">{deal.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {deal.accountName || "No account"}
                          </p>
                          <p className="mt-1.5 text-sm font-bold tabular-nums">
                            {inr(deal.amount)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {deal.ownerName}
                            {deal.expectedCloseDate && !deal.closedAt
                              ? ` · ${shortDate(deal.expectedCloseDate)}`
                              : ""}
                          </p>
                        </button>
                        {canEdit(deal.ownerId) ? (
                          <IconAction
                            label="Edit deal"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(deal);
                            }}
                          >
                            <Pencil />
                          </IconAction>
                        ) : null}
                      </div>
                      {canEdit(deal.ownerId) ? (
                        <select
                          aria-label={`Move ${deal.name}`}
                          className="mt-2 h-8 w-full rounded-md border bg-background px-2 text-xs"
                          value={deal.stage}
                          disabled={move.isPending}
                          onChange={(event) => {
                            const stage = event.target.value as DealStage;
                            // Losing a deal needs a reason, which the edit dialog asks for.
                            if (stage === "lost") {
                              onEdit({ ...deal, stage, probability: 0 });
                            } else {
                              move.mutate({ deal, stage });
                            }
                          }}
                        >
                          {DEAL_STAGES.map((option) => (
                            <option key={option} value={option}>
                              {option === deal.stage
                                ? crmLabel(option)
                                : `Move to ${crmLabel(option)}`}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  ))}
                  {inStage.length === 0 ? (
                    <li className="px-1.5 py-4 text-center text-xs text-muted-foreground">
                      No deals
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Accounts

function AccountsTab({
  accounts,
  deals,
  contacts,
  query,
  canEdit,
  onEdit,
  onDelete,
}: {
  accounts: CrmAccount[];
  deals: CrmDeal[];
  contacts: CrmContact[];
  query: QueryState;
  canEdit: (ownerId: string) => boolean;
  onEdit: (account: CrmAccount) => void;
  onDelete: (account: CrmAccount) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const stats = useMemo(() => {
    const map = new Map<string, { open: number; won: number; contacts: number }>();
    const get = (id: string) => map.get(id) ?? { open: 0, won: 0, contacts: 0 };
    for (const deal of deals) {
      if (!deal.accountId) continue;
      const row = get(deal.accountId);
      if (deal.stage === "won") row.won += deal.amount;
      else if (deal.stage !== "lost") row.open += deal.amount;
      map.set(deal.accountId, row);
    }
    for (const contact of contacts) {
      if (!contact.accountId) continue;
      const row = get(contact.accountId);
      row.contacts += 1;
      map.set(contact.accountId, row);
    }
    return map;
  }, [contacts, deals]);
  const rows = accounts.filter(
    (account) =>
      !needle ||
      [account.name, account.industry, account.city, account.email].some((value) =>
        value.toLowerCase().includes(needle),
      ),
  );

  const columns: Column<CrmAccount>[] = [
    {
      key: "name",
      header: "Account",
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.industry, row.city].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div className="text-xs">
          <p>{row.email || "—"}</p>
          <p className="text-muted-foreground">{row.phone}</p>
        </div>
      ),
    },
    {
      key: "people",
      header: "Contacts",
      align: "right",
      sortValue: (row) => stats.get(row.id)?.contacts ?? 0,
      cell: (row) => <span className="tabular-nums">{stats.get(row.id)?.contacts ?? 0}</span>,
    },
    {
      key: "open",
      header: "Open pipeline",
      align: "right",
      sortValue: (row) => stats.get(row.id)?.open ?? 0,
      cell: (row) => <span className="tabular-nums">{inr(stats.get(row.id)?.open ?? 0)}</span>,
    },
    {
      key: "won",
      header: "Won",
      align: "right",
      sortValue: (row) => stats.get(row.id)?.won ?? 0,
      cell: (row) => (
        <span className="font-semibold tabular-nums">{inr(stats.get(row.id)?.won ?? 0)}</span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.ownerName,
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        canEdit(row.ownerId) ? (
          <div className="flex justify-end gap-1">
            <IconAction
              label="Edit account"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(row);
              }}
            >
              <Pencil />
            </IconAction>
            <IconAction
              label="Delete account"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row);
              }}
            >
              <Trash2 />
            </IconAction>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search accounts" />
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        pageSize={15}
        emptyTitle="No accounts yet"
        emptyDescription="Accounts are created when you convert a lead, or add one directly."
      />
    </div>
  );
}

// ------------------------------------------------------------------ Contacts

function ContactsTab({
  contacts,
  query,
  canEdit,
  onEdit,
  onDelete,
}: {
  contacts: CrmContact[];
  query: QueryState;
  canEdit: (ownerId: string) => boolean;
  onEdit: (contact: CrmContact) => void;
  onDelete: (contact: CrmContact) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const rows = contacts.filter(
    (contact) =>
      !needle ||
      [contact.firstName, contact.lastName, contact.accountName, contact.email, contact.phone].some(
        (value) => value.toLowerCase().includes(needle),
      ),
  );
  const columns: Column<CrmContact>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (row) => personName(row.firstName, row.lastName),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {personName(row.firstName, row.lastName)}
          </p>
          <p className="truncate text-xs text-muted-foreground">{row.jobTitle || "—"}</p>
        </div>
      ),
    },
    {
      key: "account",
      header: "Account",
      sortValue: (row) => row.accountName,
      cell: (row) => <span className="text-sm">{row.accountName || "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      cell: (row) =>
        row.email ? (
          <a className="text-sm text-primary hover:underline" href={`mailto:${row.email}`}>
            {row.email}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "phone",
      header: "Phone",
      cell: (row) =>
        row.phone ? (
          <a className="text-sm hover:underline" href={`tel:${row.phone}`}>
            {row.phone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.ownerName,
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        canEdit(row.ownerId) ? (
          <div className="flex justify-end gap-1">
            <IconAction
              label="Edit contact"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(row);
              }}
            >
              <Pencil />
            </IconAction>
            <IconAction
              label="Delete contact"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row);
              }}
            >
              <Trash2 />
            </IconAction>
          </div>
        ) : null,
    },
  ];
  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search contacts" />
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        pageSize={15}
        emptyTitle="No contacts yet"
        emptyDescription="Contacts are created when you convert a lead, or add one directly."
      />
    </div>
  );
}

// ---------------------------------------------------------------- Activities

function ActivitiesTab({
  activities,
  query,
  me,
  canEdit,
  onEdit,
  onDelete,
  onLogCall,
  onViewCallHistory,
  onVisibleRowsChange,
}: {
  activities: CrmActivity[];
  query: QueryState;
  me: string;
  canEdit: (ownerId: string) => boolean;
  onEdit: (activity: CrmActivity) => void;
  onDelete: (activity: CrmActivity) => void;
  onViewCallHistory: (activity: CrmActivity) => void;
  onLogCall: (activity: CrmActivity) => void;
  onVisibleRowsChange: (rows: CrmActivity[]) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const today = indiaDateKey();
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      activities.filter((activity) => {
        if (status !== ALL && activity.status !== status) return false;
        if (!matchesOwner(activity.ownerId, owner, me)) return false;
        if (!needle) return true;
        return [activity.subject, activity.relatedTo, activity.description].some((value) =>
          value.toLowerCase().includes(needle),
        );
      }),
    [activities, status, owner, me, needle],
  );

  useEffect(() => {
    onVisibleRowsChange(rows);
  }, [rows, onVisibleRowsChange]);

  const complete = useMutation({
    mutationFn: (activity: CrmActivity) => crmService.setActivityStatus(activity.id, "done"),
    onSuccess: () => {
      toast.success("Marked done");
      void queryClient.invalidateQueries({ queryKey: CRM_QUERY_KEY });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const columns: Column<CrmActivity>[] = [
    {
      key: "subject",
      header: "Activity",
      sortValue: (row) => row.subject,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            {crmLabel(row.type)}
            {row.relatedTo ? ` · ${row.relatedTo}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "due",
      header: "Due",
      sortValue: (row) => row.dueAt,
      cell: (row) => {
        const overdue =
          row.status === "planned" && row.dueAt != null && indiaDateKey(row.dueAt) < today;
        return row.dueAt ? (
          <span className={cn("text-sm", overdue && "font-semibold text-destructive")}>
            {indianDateTime(row.dueAt)}
            {overdue ? " · overdue" : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.status}
          tone={row.status === "done" ? "success" : row.status === "cancelled" ? "neutral" : "info"}
        />
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (row) => row.ownerName,
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.type === "call" ? (
            <IconAction
              label="View call history"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onViewCallHistory(row);
              }}
            >
              <History />
            </IconAction>
          ) : null}
          {canEdit(row.ownerId) ? (
            <>
              {row.type === "call" ? (
                <IconAction
                  label="Log call details"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLogCall(row);
                  }}
                >
                  <PhoneCall />
                </IconAction>
              ) : null}
              {row.status === "planned" ? (
                <IconAction
                  label="Mark done"
                  variant="outline"
                  disabled={complete.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    complete.mutate(row);
                  }}
                >
                  <Check />
                </IconAction>
              ) : null}
              <IconAction
                label="Edit activity"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(row);
                }}
              >
                <Pencil />
              </IconAction>
              <IconAction
                label="Delete activity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row);
                }}
              >
                <Trash2 />
              </IconAction>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search activities"
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: [
              { value: ALL, label: "All statuses" },
              ...ACTIVITY_STATUSES.map((value) => ({ value, label: crmLabel(value) })),
            ],
          },
          {
            id: "owner",
            label: "Owner",
            value: owner,
            onChange: setOwner,
            options: ownerFilterOptions(activities),
          },
        ]}
      />
      {rows.length === 0 && !query.isLoading && !query.isError ? (
        <EmptyState
          title="No activities match"
          description="Log calls, meetings and follow-ups so the team knows what happens next."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          pageSize={20}
        />
      )}
    </div>
  );
}
