import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { indianTime, shortDate } from "@/lib/format";
import type { AttendanceRecord } from "@/types";

export function AttendanceTab({
  records,
  canRequestCorrection,
  onRequestCorrection,
}: {
  records: AttendanceRecord[] | undefined;
  canRequestCorrection: boolean;
  onRequestCorrection: () => void;
}) {
  return (
    <TabsContent value="attendance" className="mt-4">
      <SectionCard
        title="Recent attendance"
        bodyClassName="p-0"
        action={
          canRequestCorrection ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!records?.length}
              onClick={onRequestCorrection}
            >
              Request correction
            </Button>
          ) : null
        }
      >
        <ul className="divide-y divide-border">
          {(records ?? []).map((record) => (
            <li key={record.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{shortDate(record.date)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  In {indianTime(record.checkIn)} · Out {indianTime(record.checkOut)} ·{" "}
                  {record.workedHours}h · {record.source}
                </p>
              </div>
              <StatusBadge status={record.status} />
            </li>
          ))}
          {records?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No attendance records yet.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </TabsContent>
  );
}
