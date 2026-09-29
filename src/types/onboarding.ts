export const ONBOARDING_STEPS = [
  { id: "personal", label: "Personal" },
  { id: "family", label: "Family" },
  { id: "emergency", label: "Emergency" },
  { id: "addresses", label: "Addresses" },
  { id: "identity", label: "Identity" },
  { id: "education", label: "Education" },
  { id: "bank", label: "Bank" },
  { id: "review", label: "Review" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export type OnboardingQueueBucket = "incomplete" | "pending" | "changes" | "approved" | "rejected";

export interface EmergencyContactDraft {
  name: string;
  relationship: string;
  phone: string;
}

export interface ExperienceDraft {
  company: string;
  roleTitle: string;
  fromDate: string;
  toDate: string;
  reasonForLeaving: string;
}

export interface AddressDraft {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  yearsAtAddress: string;
  sameAsCurrent: boolean;
}

export interface OnboardingFormValues {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  maritalStatus: string;
  nationality: string;
  phone: string;
  alternatePhone: string;
  personalEmail: string;
  photoPath: string;
  fatherName: string;
  fatherPhone: string;
  motherName: string;
  motherPhone: string;
  spouseName: string;
  spousePhone: string;
  dependents: string;
  emergency: EmergencyContactDraft[];
  currentAddress: AddressDraft;
  permanentAddress: AddressDraft;
  pan: string;
  aadhaar: string;
  aadhaarOnFile: boolean;
  passport: string;
  panDocumentPath: string;
  aadhaarDocumentPath: string;
  passportDocumentPath: string;
  qualification: string;
  institute: string;
  educationYear: string;
  uan: string;
  experience: ExperienceDraft[];
  accountName: string;
  accountNumber: string;
  accountNumberConfirm: string;
  ifsc: string;
  bankName: string;
  branch: string;
  cancelledChequePath: string;
  declaration: boolean;
}

export interface OnboardingDraft extends OnboardingFormValues {
  employeeId: string;
  employmentStatus: string;
  submissionStatus: string;
  remarks: string;
  sectionFlags: Record<string, string>;
  submittedAt: string | null;
  createdAt: string | null;
  profileCompletedAt: string | null;
  employeeCode: string;
  workEmail: string;
}

export interface OnboardingQueueItem {
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  employeeCode: string;
  employmentStatus: string;
  submissionStatus: string;
  submittedAt: string | null;
  createdAt: string | null;
  remarks: string;
  sectionFlags: Record<string, string>;
  bucket: OnboardingQueueBucket;
  stale: boolean;
}

export interface OnboardingReferenceOption {
  id: string;
  name: string;
}

export interface OnboardingReferences {
  departments: OnboardingReferenceOption[];
  designations: OnboardingReferenceOption[];
  shifts: OnboardingReferenceOption[];
  leads: OnboardingReferenceOption[];
}

export interface OnboardingTaskItem {
  id: string;
  title: string;
  done: boolean;
}

export interface OnboardingTaskList {
  recordId: string | null;
  tasks: OnboardingTaskItem[];
}

export interface ProfileChangeRequestItem {
  id: string;
  employeeId: string;
  employeeName: string;
  section: "address" | "bank" | "phone";
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  remarks: string;
  createdAt: string | null;
}

export interface ApproveOnboardingInput {
  employeeId: string;
  departmentId: string;
  designationId: string;
  role: string;
  managerId: string;
  shiftId: string;
  joiningDate: string;
  employeeCode: string;
  overrideJoiningDateReason: string;
}
