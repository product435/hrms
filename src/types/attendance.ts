import type { AttendanceStatus, RequestStatus } from "@/types";

export type CalendarDayStatus = AttendanceStatus | "unmarked";

export interface AttendanceCalendarDay {
  date: string;
  status: CalendarDayStatus;
  note?: string;
  compOffEligible?: boolean;
  missedCheckout?: boolean;
  workedHours?: number;
}

export interface Holiday {
  id: string;
  organizationId: string;
  date: string;
  name: string;
  isOptional: boolean;
}

export interface AttendancePolicy {
  halfDayHours: number;
  regularizationMonthlyLimit: number;
}

export interface TeamAttendanceRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  shift: string;
  note?: string;
}

export interface AttendanceCorrectionView {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  requested: string;
  reason: string;
  status: RequestStatus;
}
