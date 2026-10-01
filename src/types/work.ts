export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in-progress" | "blocked" | "done";
export type DwrStatus = "draft" | "submitted" | "late" | "missed";
export type DwrReviewStatus = "pending" | "approved" | "needs-revision";
export type DwrItemStatus = "todo" | "in-progress" | "blocked" | "done";

export interface Project {
  id: string;
  name: string;
  isActive: boolean;
}

export interface WorkTask {
  id: string;
  projectId: string | null;
  projectName: string;
  assignedBy: string | null;
  assignedByName: string;
  assignedTo: string;
  assignedToName: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  estimatedHours: number | null;
  status: TaskStatus;
  completedAt: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface AssignTaskInput {
  assignedTo: string;
  projectId?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  estimatedHours: number | null;
}

export interface DwrItem {
  id: string;
  taskId: string | null;
  description: string;
  hours: number;
  itemStatus: DwrItemStatus;
  isUnplanned: boolean;
}

export interface DwrItemInput {
  taskId: string | null;
  description: string;
  hours: number;
  itemStatus: DwrItemStatus;
  isUnplanned: boolean;
}

export interface DailyWorkReport {
  id: string;
  employeeId: string;
  employeeName: string;
  reportDate: string;
  status: DwrStatus;
  submittedAt: string | null;
  totalHours: number;
  blockers: string;
  planForTomorrow: string;
  summaryHtml: string;
  reviewStatus: DwrReviewStatus;
  leadRating: number | null;
  leadRemarks: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  escalated: boolean;
  reopenReason: string;
  waiverReason: string;
  items: DwrItem[];
}

export interface SaveReportInput {
  reportDate: string;
  blockers: string;
  planForTomorrow: string;
  summaryHtml: string;
  items: DwrItemInput[];
}

export interface TeamDailySummary {
  id: string;
  leadEmployeeId: string;
  leadName: string;
  departmentId: string | null;
  departmentName: string;
  reportDate: string;
  summary: string;
  highlights: string;
  risks: string;
}

export interface SaveSummaryInput {
  reportDate: string;
  departmentId: string | null;
  summary: string;
  highlights: string;
  risks: string;
}

export interface DirectoryEmployee {
  id: string;
  name: string;
  departmentId: string | null;
}

export interface MyWorkContext {
  employeeId: string;
  departmentId: string | null;
  organizationId: string | null;
  shift: {
    startTime: string;
    endTime: string;
    isOvernight: boolean;
  };
}

export interface CheckoutAllowed {
  allowed: boolean;
  reason?: string;
}
