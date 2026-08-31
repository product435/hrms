export type Role = "admin" | "hr" | "manager" | "employee";

export interface SessionUser {
  id: string;
  /** The linked `employees.id` row, when this account has one (profiles.id is a different id space). */
  employeeId?: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
  department: string;
  avatarUrl?: string;
}

export type EmploymentStatus = "active" | "probation" | "notice" | "resigned" | "on-leave";
export type EmploymentType = "full-time" | "part-time" | "contract" | "intern";

export interface Employee {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  department: string;
  designation: string;
  role: Role;
  managerName: string | null;
  location: string;
  joinedOn: string;
  status: EmploymentStatus;
  exitDate?: string;
  employmentType: EmploymentType;
  shift: string;
  gender: string;
  dateOfBirth: string;
  bloodGroup: string;
  maritalStatus: string;
  address: string;
  emergencyContact: { name: string; relation: string; phone: string };
  bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string };
  ctcAnnual: number;
  leaveBalance: { casual: number; sick: number; earned: number; unpaid: number };
}

export interface Department {
  id: string;
  name: string;
  head: string;
  headcount: number;
  openRoles: number;
  designations: string[];
  costCenter: string;
}

export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "half-day"
  | "wfh"
  | "leave"
  | "holiday"
  | "week-off";

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  workedHours: number;
  overtimeHours: number;
  status: AttendanceStatus;
  shift: string;
  source: "web" | "mobile" | "biometric" | "manual";
  note?: string;
}

export interface AttendanceCorrection {
  id: string;
  employeeName: string;
  date: string;
  requested: string;
  reason: string;
  status: RequestStatus;
}

export interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
  breakMinutes: number;
  graceMinutes: number;
  weekOffs: string[];
  assigned: number;
  isNightShift: boolean;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "Casual" | "Sick" | "Earned" | "Unpaid" | "Maternity" | "Comp-off";
  from: string;
  to: string;
  days: number;
  reason: string;
  status: RequestStatus;
  appliedOn: string;
  approver: string;
}

export interface PayrollRun {
  id: string;
  period: string;
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  status: "draft" | "processed" | "approved";
  payDate: string;
}

export interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string;
  basic: number;
  hra: number;
  allowances: number;
  bonus: number;
  pf: number;
  tax: number;
  otherDeductions: number;
  net: number;
  status: "paid" | "pending";
}

export type AssetCategory =
  | "Laptop"
  | "Desktop"
  | "Monitor"
  | "Mobile"
  | "Keyboard"
  | "Mouse"
  | "ID Card"
  | "Other";

export type AssetStatus = "assigned" | "available" | "in-repair" | "retired" | "lost";
export type AssetCondition = "new" | "good" | "fair" | "damaged";

export interface Asset {
  id: string;
  tag: string;
  name: string;
  category: AssetCategory;
  serial: string;
  status: AssetStatus;
  condition: AssetCondition;
  assignedTo: string | null;
  assignedOn: string | null;
  purchaseDate: string;
  value: number;
  warrantyTill: string;
  location: string;
}

export interface AssetEvent {
  id: string;
  assetTag: string;
  type: "assigned" | "returned" | "repair" | "replaced" | "audit";
  actor: string;
  date: string;
  note: string;
}

export type AssetRequestStatus = "pending" | "approved" | "rejected";

export interface AssetRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  category: AssetCategory;
  details: string;
  status: AssetRequestStatus;
  reviewedByName: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  requestedAt: string;
}

export interface JobOpening {
  id: string;
  title: string;
  department: string;
  location: string;
  type: EmploymentType;
  openings: number;
  applicants: number;
  stage: "draft" | "open" | "on-hold" | "closed";
  postedOn: string;
  hiringManager: string;
}

export interface Candidate {
  id: string;
  applicationId?: string | null;
  name: string;
  role: string;
  stage: "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";
  experience: string;
  source: string;
  // No rating column exists on candidates or job_applications -- null means
  // "not rated", never a fabricated 0.
  rating: number | null;
  appliedOn: string;
}

export interface OnboardingJourney {
  id: string;
  employeeName: string;
  designation: string;
  startDate: string;
  buddy: string;
  progress: number;
  tasks: { id: string; label: string; owner: string; done: boolean }[];
}

export interface Goal {
  id: string;
  employeeId?: string;
  employeeName: string;
  title: string;
  description?: string;
  target?: string;
  category: "Business" | "Learning" | "Team" | "Quality";
  progress: number;
  weight: number;
  dueDate: string;
  status: "on-track" | "at-risk" | "delayed" | "completed";
}

export interface PerformanceReview {
  id: string;
  employeeId?: string;
  employeeName: string;
  cycle: string;
  reviewer: string;
  // null means not yet submitted -- distinct from a genuine 0 rating.
  selfScore: number | null;
  managerScore: number | null;
  finalRating: number | null;
  status: "not-started" | "in-progress" | "submitted" | "closed" | "completed";
}

export interface DocumentItem {
  id: string;
  name: string;
  category: "Identity" | "Education" | "Contract" | "Policy" | "Payroll" | "Other";
  owner: string;
  size: string;
  uploadedOn: string;
  expiresOn: string | null;
  verified: boolean;
  filePath?: string;
}

export interface ExpenseClaim {
  id: string;
  employeeName: string;
  category: "Travel" | "Food" | "Internet" | "Equipment" | "Client" | "Other";
  amount: number;
  date: string;
  status: RequestStatus | "reimbursed";
  note: string;
}

export interface HelpdeskTicket {
  id: string;
  subject: string;
  category: "Payroll" | "IT" | "Attendance" | "Policy" | "Facilities" | "Other";
  raisedBy: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in-progress" | "resolved" | "closed";
  createdOn: string;
  assignee: string;
  assignedTo?: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "All" | "Engineering" | "Sales" | "Managers";
  author: string;
  publishedOn: string;
  pinned: boolean;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  type: "leave" | "payroll" | "asset" | "attendance" | "system";
  createdAt: string;
  read: boolean;
  // For an "employee_complaint" notification this is the complaining
  // employee's id, so the notification can link straight to their profile's
  // Complaints tab -- there's no separate single-complaint detail page.
  referenceId?: string;
  referenceType?: string;
}

export type ComplaintPriority = "low" | "medium" | "high" | "urgent";
export type ComplaintStatus = "open" | "in-progress" | "resolved" | "closed";

export interface Complaint {
  id: string;
  employeeId: string;
  employeeName: string;
  subject: string;
  category: string;
  description: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  assignedTo: string | null;
  assignedToName: string;
  createdAt: string;
  updatedAt: string;
}

export type PasswordResetRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";

export interface PasswordResetRequest {
  id: string;
  employeeId: string | null;
  employeeName: string;
  email: string;
  status: PasswordResetRequestStatus;
  requestedAt: string;
  approvedByName: string;
  approvedAt: string | null;
  rejectedReason: string | null;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entity: string;
  ip: string;
  timestamp: string;
}

export interface TrendPoint {
  label: string;
  present: number;
  absent: number;
  wfh: number;
}

export interface HeadcountPoint {
  label: string;
  joined: number;
  exited: number;
  headcount: number;
}