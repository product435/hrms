import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  CircleDollarSign,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from "lucide-react";
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
  ConfirmDelete,
  ContactDialog,
  ConvertLeadDialog,
  DealDialog,
  LeadDialog,
} from "@/components/crm/CrmForms";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthForPath } from "@/lib/auth-guard";
import { usePermissions } from "@/hooks/usePermissions";
import { compactInr, indiaDateKey, indianDateTime, inr, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { crmService } from "@/services/crmService";
import {
  ACTIVITY_STATUSES,
  DEAL_STAGES,
  LEAD_RATINGS,
  LEAD_STATUSES,
  OPEN_DEAL_STAGES,
  STAGE_PROBABILITY,
  crmLabel,
  type ActivityInput,
  type CrmAccount,
  type CrmActivity,
  type CrmContact,
  type CrmDeal,
  type CrmLead,
  type DealStage,
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
    return action ? (
      <Button onClick={action.open}>
        <Plus className="size-4" /> {action.label}
      </Button>
    ) : null;
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
            query={leads}
            me={me}
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
  const thisMonth = indiaDateKey().slice(0, 7);
  const today = indiaDateKey();

  const metrics = useMemo(() => {
    const open = deals.filter((deal) => OPEN_DEAL_STAGES.includes(deal.stage));
    const wonThisMonth = deals.filter(
      (deal) =>
        deal.stage === "won" && deal.closedAt && indiaDateKey(deal.closedAt).startsWith(thisMonth),
    );
    const won = deals.filter((deal) => deal.stage === "won").length;
    const lost = deals.filter((deal) => deal.stage === "lost").length;
    const plannedActivities = activities.filter((activity) => activity.status === "planned");
    const overdue = plannedActivities.filter(
      (activity) => activity.dueAt && indiaDateKey(activity.dueAt) < today,
    );
    return {
      pipeline: open.reduce((sum, deal) => sum + deal.amount, 0),
      weighted: open.reduce((sum, deal) => sum + (deal.amount * deal.probability) / 100, 0),
      openCount: open.length,
      wonValue: wonThisMonth.reduce((sum, deal) => sum + deal.amount, 0),
      wonCount: wonThisMonth.length,
      winRate: won + lost === 0 ? null : (won / (won + lost)) * 100,
      openLeads: leads.filter((lead) => !["converted", "unqualified"].includes(lead.status)).length,
      hotLeads: leads.filter((lead) => lead.rating === "hot" && lead.status !== "converted").length,
      overdue: overdue.length,
    };
  }, [activities, deals, leads, thisMonth, today]);

  const byStage = useMemo(
    () =>
      OPEN_DEAL_STAGES.map((stage) => {
        const inStage = deals.filter((deal) => deal.stage === stage);
        return {
          stage,
          count: inStage.length,
          value: inStage.reduce((sum, deal) => sum + deal.amount, 0),
        };
      }),
    [deals],
  );
  const maxStageValue = Math.max(1, ...byStage.map((row) => row.value));

  const upcoming = activities
    .filter((activity) => activity.status === "planned" && (showTeam || activity.ownerId === me))
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))
    .slice(0, 6);

  const leaderboard = useMemo(() => {
    const byOwner = new Map<string, { name: string; won: number; open: number; count: number }>();
    for (const deal of deals) {
      const row = byOwner.get(deal.ownerId) ?? { name: deal.ownerName, won: 0, open: 0, count: 0 };
      if (deal.stage === "won") row.won += deal.amount;
      if (OPEN_DEAL_STAGES.includes(deal.stage)) row.open += deal.amount;
      row.count += 1;
      byOwner.set(deal.ownerId, row);
    }
    return [...byOwner.values()].sort((a, b) => b.won - a.won || b.open - a.open).slice(0, 6);
  }, [deals]);

  if (error) return <ErrorState message={errorText(error)} onRetry={onRetry} />;
  if (loading) return <CardsSkeleton count={4} />;

  return (
    <div className="space-y-4">
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
    </div>
  );
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
  query,
  me,
  canEdit,
  onEdit,
  onConvert,
  onDelete,
  onLog,
}: {
  leads: CrmLead[];
  query: QueryState;
  me: string;
  canEdit: (ownerId: string) => boolean;
  onEdit: (lead: CrmLead) => void;
  onConvert: (lead: CrmLead) => void;
  onDelete: (lead: CrmLead) => void;
  onLog: (lead: CrmLead) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [rating, setRating] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const needle = search.trim().toLowerCase();
  const rows = leads.filter((lead) => {
    if (status === "open" && ["converted", "unqualified"].includes(lead.status)) return false;
    if (status !== "open" && status !== ALL && lead.status !== status) return false;
    if (rating !== ALL && lead.rating !== rating) return false;
    if (!matchesOwner(lead.ownerId, owner, me)) return false;
    if (!needle) return true;
    return [lead.firstName, lead.lastName, lead.company, lead.email, lead.phone].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  const columns: Column<CrmLead>[] = [
    {
      key: "name",
      header: "Lead",
      sortValue: (row) => personName(row.firstName, row.lastName),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {personName(row.firstName, row.lastName)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.company, row.jobTitle].filter(Boolean).join(" · ") || "—"}
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
      sortValue: (row) => LEAD_RATINGS.indexOf(row.rating),
      cell: (row) => (
        <StatusBadge
          status={row.rating}
          tone={row.rating === "hot" ? "danger" : row.rating === "warm" ? "warning" : "info"}
        />
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
            options: [
              { value: ALL, label: "All ratings" },
              ...LEAD_RATINGS.map((value) => ({ value, label: crmLabel(value) })),
            ],
          },
          {
            id: "owner",
            label: "Owner",
            value: owner,
            onChange: setOwner,
            options: ownerFilterOptions(leads),
          },
        ]}
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
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => canEdit(deal.ownerId) && onEdit(deal)}
                        disabled={!canEdit(deal.ownerId)}
                      >
                        <p className="line-clamp-2 text-sm font-semibold">{deal.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {deal.accountName || "No account"}
                        </p>
                        <p className="mt-1.5 text-sm font-bold tabular-nums">{inr(deal.amount)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {deal.ownerName}
                          {deal.expectedCloseDate && !deal.closedAt
                            ? ` · ${shortDate(deal.expectedCloseDate)}`
                            : ""}
                        </p>
                      </button>
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
}: {
  activities: CrmActivity[];
  query: QueryState;
  me: string;
  canEdit: (ownerId: string) => boolean;
  onEdit: (activity: CrmActivity) => void;
  onDelete: (activity: CrmActivity) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("planned");
  const [owner, setOwner] = useState(ALL);
  const today = indiaDateKey();
  const needle = search.trim().toLowerCase();
  const rows = activities.filter((activity) => {
    if (status !== ALL && activity.status !== status) return false;
    if (!matchesOwner(activity.ownerId, owner, me)) return false;
    if (!needle) return true;
    return [activity.subject, activity.relatedTo, activity.description].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

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
      cell: (row) =>
        canEdit(row.ownerId) ? (
          <div className="flex justify-end gap-1">
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
          </div>
        ) : null,
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
