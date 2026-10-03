import { InfoHint } from "@/components/common/InfoHint";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TabsContent } from "@/components/ui/tabs";
import { dayMonth } from "@/lib/format";
import { HOW_LEAVE_WORKS, leaveTypeHint } from "@/lib/leave-hints";
import type { LeaveRequest } from "@/types";

export type LeaveBalanceEntry = {
  id: string;
  name: string;
  allocated: number;
  used: number;
  remaining: number;
};

export function LeaveTab({
  balance,
  requests,
}: {
  balance: LeaveBalanceEntry[] | undefined;
  requests: LeaveRequest[] | undefined;
}) {
  return (
    <TabsContent value="leave" className="mt-4 space-y-4">
      <SectionCard title="How leave works">
        <p className="text-sm text-muted-foreground">{HOW_LEAVE_WORKS}</p>
      </SectionCard>
      <div className="grid gap-3 sm:grid-cols-4">
        {(balance ?? []).map((entry) => (
          <div key={entry.id} className="surface-card p-4">
            <p className="flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <span className="truncate">{entry.name}</span>
              <InfoHint label={`About ${entry.name} leave`}>{leaveTypeHint(entry.name)}</InfoHint>
            </p>
            <p className="mt-1 font-display text-2xl font-bold">{entry.remaining}</p>
            <p className="text-xs text-muted-foreground">
              {entry.used} used of {entry.allocated}
            </p>
          </div>
        ))}
      </div>
      <SectionCard title="Leave history" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {(requests ?? []).map((request) => (
            <li key={request.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{request.type} leave</p>
                <p className="truncate text-xs text-muted-foreground">
                  {dayMonth(request.from)} – {dayMonth(request.to)} · {request.days}d ·{" "}
                  {request.reason}
                </p>
              </div>
              <StatusBadge status={request.status} />
            </li>
          ))}
          {requests?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No leave history.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </TabsContent>
  );
}
