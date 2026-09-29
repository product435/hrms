import { indiaDateKey, indiaLocalDateTimeToUtcIso } from "@/lib/format";

/**
 * IST window math for daily work reports.
 * SQL in `20260926000004_tasks_and_dwr.sql` (`dwr_shift_bounds`) uses the same rules:
 * the report date is the shift start date, the window opens 30 minutes before shift end,
 * on-time runs through shift end, and late runs until the first 10:00 IST after shift end.
 */

export interface ShiftClock {
  startTime: string;
  endTime: string;
  isOvernight: boolean;
}

export const DEFAULT_SHIFT: ShiftClock = {
  startTime: "09:30",
  endTime: "18:30",
  isOvernight: false,
};

export interface ShiftBounds {
  windowOpensAt: Date;
  shiftEndsAt: Date;
  lateClosesAt: Date;
  tenMinuteReminderAt: Date;
}

export type SubmitPhase = "before-window" | "on-time" | "late" | "closed";

export type ReportStatus = "draft" | "submitted" | "late" | "missed" | null;

export interface CheckoutInput {
  reportStatus: ReportStatus;
  approvedLeave: boolean;
  holiday: boolean;
  weekOff: boolean;
}

export interface CheckoutDecision {
  allowed: boolean;
  reason?: string;
}

export const CHECKOUT_DRAFT_REASON =
  "Today's work report is still a draft. Submit it before check-out.";
export const CHECKOUT_MISSED_REASON =
  "Today's work report was missed. Ask HR to waive it before check-out.";
export const CHECKOUT_MISSING_REASON = "Submit today's work report before check-out.";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addCalendarDays(dateKey: string, days: number): string {
  const match = DATE_KEY.exec(dateKey);
  if (!match) throw new Error("Report date must be YYYY-MM-DD.");
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12),
  );
  return shifted.toISOString().slice(0, 10);
}

export function shiftBounds(reportDate: string, shift: ShiftClock): ShiftBounds {
  const endDate = shift.isOvernight ? addCalendarDays(reportDate, 1) : reportDate;
  const shiftEndsAt = new Date(indiaLocalDateTimeToUtcIso(endDate, shift.endTime));
  const windowOpensAt = new Date(shiftEndsAt.getTime() - 30 * 60 * 1000);
  const tenMinuteReminderAt = new Date(shiftEndsAt.getTime() - 10 * 60 * 1000);
  const endKey = indiaDateKey(shiftEndsAt);
  let lateClosesAt = new Date(indiaLocalDateTimeToUtcIso(endKey, "10:00"));
  if (lateClosesAt.getTime() <= shiftEndsAt.getTime()) {
    lateClosesAt = new Date(indiaLocalDateTimeToUtcIso(addCalendarDays(endKey, 1), "10:00"));
  }
  return { windowOpensAt, shiftEndsAt, lateClosesAt, tenMinuteReminderAt };
}

export function submitPhase(now: Date, reportDate: string, shift: ShiftClock): SubmitPhase {
  const bounds = shiftBounds(reportDate, shift);
  const time = now.getTime();
  if (time < bounds.windowOpensAt.getTime()) return "before-window";
  if (time <= bounds.shiftEndsAt.getTime()) return "on-time";
  if (time < bounds.lateClosesAt.getTime()) return "late";
  return "closed";
}

function istMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function clockMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Shift-start date whose window contains `now`, otherwise the date the employee is working. */
export function activeReportDate(now: Date, shift: ShiftClock): string {
  const today = indiaDateKey(now);
  const candidates = [addCalendarDays(today, -1), today];
  const onTime = candidates.find((date) => submitPhase(now, date, shift) === "on-time");
  if (onTime) return onTime;
  const late = candidates.find((date) => submitPhase(now, date, shift) === "late");
  if (late) return late;
  if (!shift.isOvernight) return today;
  const minute = istMinutes(now);
  if (minute >= clockMinutes(shift.startTime)) return today;
  if (minute < clockMinutes(shift.endTime)) return addCalendarDays(today, -1);
  return today;
}

/**
 * Mirrors `checkout_allowed`. The database function is authoritative;
 * this helper is the same decision for tests and previews.
 */
export function checkoutDecision(input: CheckoutInput): CheckoutDecision {
  if (
    input.reportStatus === "submitted" ||
    input.reportStatus === "late" ||
    input.approvedLeave ||
    input.holiday ||
    input.weekOff
  ) {
    return { allowed: true };
  }
  if (input.reportStatus === "draft") return { allowed: false, reason: CHECKOUT_DRAFT_REASON };
  if (input.reportStatus === "missed") return { allowed: false, reason: CHECKOUT_MISSED_REASON };
  return { allowed: false, reason: CHECKOUT_MISSING_REASON };
}
