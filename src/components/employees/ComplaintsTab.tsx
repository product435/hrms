import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { shortDate } from "@/lib/format";
import type { Complaint, ComplaintStatus } from "@/types";

const COMPLAINT_STATUSES: ComplaintStatus[] = ["open", "in-progress", "resolved", "closed"];

export function ComplaintsTab({
  complaints,
  canManageComplaints,
  isOwnProfile,
  assignees,
  onRaise,
  onStatusChange,
  onAssigneeChange,
}: {
  complaints: Complaint[] | undefined;
  canManageComplaints: boolean;
  isOwnProfile: boolean;
  assignees: { id: string; firstName: string; lastName: string }[] | undefined;
  onRaise: () => void;
  onStatusChange: (id: string, status: ComplaintStatus) => void;
  onAssigneeChange: (id: string, assignedTo: string | null) => void;
}) {
  return (
    <TabsContent value="complaints" className="mt-4">
      <SectionCard
        title="Complaints"
        description={
          canManageComplaints
            ? "Raised complaints for this employee, within your organization."
            : "Complaints you've raised and their current status."
        }
        bodyClassName="p-0"
        action={
          isOwnProfile ? (
            <Button size="sm" onClick={onRaise}>
              Raise complaint
            </Button>
          ) : undefined
        }
      >
        <ul className="divide-y divide-border">
          {(complaints ?? []).map((complaint) => (
            <li key={complaint.id} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{complaint.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {complaint.category || "Uncategorized"} · {complaint.priority} priority · raised{" "}
                    {shortDate(complaint.createdAt)}
                  </p>
                  {complaint.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                      {complaint.description}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={complaint.status} />
              </div>
              {canManageComplaints ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select
                      value={complaint.status}
                      onValueChange={(value) =>
                        onStatusChange(complaint.id, value as ComplaintStatus)
                      }
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPLAINT_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Assigned to</Label>
                    <Select
                      value={complaint.assignedTo ?? "unassigned"}
                      onValueChange={(value) =>
                        onAssigneeChange(complaint.id, value === "unassigned" ? null : value)
                      }
                    >
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {(assignees ?? []).map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.firstName} {employee.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
          {complaints?.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No complaints raised.
            </li>
          ) : null}
          {!isOwnProfile && !canManageComplaints ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              You don't have access to manage complaints.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </TabsContent>
  );
}
