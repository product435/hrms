import type { TaskPriority, TaskStatus } from "./work";

export type ProjectStatus = "planning" | "active" | "on-hold" | "completed" | "cancelled";
export type ProjectRole = "owner" | "manager" | "contributor" | "observer";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: TaskPriority;
  ownerId: string | null;
  ownerName: string;
  startDate: string | null;
  dueDate: string | null;
  archivedAt: string | null;
  memberCount: number;
  taskCount: number;
  doneCount: number;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  employeeId: string;
  name: string;
  role: ProjectRole;
  addedAt: string;
}

/** Narrow row from project_member_directory(). No payroll or document fields. */
export interface ProjectMemberOption {
  id: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedToName: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  sourceMessageId: string | null;
}

export interface ProjectMessage {
  id: string;
  projectId: string;
  authorId: string | null;
  authorName: string;
  bodyText: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface CreateProjectTaskInput {
  projectId: string;
  assignedTo: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  sourceMessageId?: string | null;
}
