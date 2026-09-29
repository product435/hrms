/**
 * Pure checks for src/lib/dwr-window.ts. No test framework and no new dependencies.
 * Run: node --experimental-strip-types --import ./scripts/register-ts-alias.mjs scripts/assert-dwr-window.ts
 */
import assert from "node:assert/strict";
import {
  activeReportDate,
  CHECKOUT_DRAFT_REASON,
  CHECKOUT_MISSED_REASON,
  CHECKOUT_MISSING_REASON,
  checkoutDecision,
  shiftBounds,
  submitPhase,
} from "../src/lib/dwr-window.ts";

const day = { startTime: "09:30", endTime: "18:30", isOvernight: false };
const night = { startTime: "22:00", endTime: "06:00", isOvernight: true };

function ist(dateKey: string, time: string) {
  const [year, month, dayOfMonth] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year!, month! - 1, dayOfMonth!, hour!, minute!) - 330 * 60 * 1000);
}

const dayBounds = shiftBounds("2026-09-26", day);
assert.equal(dayBounds.windowOpensAt.toISOString(), ist("2026-09-26", "18:00").toISOString());
assert.equal(dayBounds.shiftEndsAt.toISOString(), ist("2026-09-26", "18:30").toISOString());
assert.equal(dayBounds.tenMinuteReminderAt.toISOString(), ist("2026-09-26", "18:20").toISOString());
assert.equal(dayBounds.lateClosesAt.toISOString(), ist("2026-09-27", "10:00").toISOString());

assert.equal(submitPhase(ist("2026-09-26", "17:59"), "2026-09-26", day), "before-window");
assert.equal(submitPhase(ist("2026-09-26", "18:00"), "2026-09-26", day), "on-time");
assert.equal(submitPhase(ist("2026-09-26", "18:30"), "2026-09-26", day), "on-time");
assert.equal(submitPhase(ist("2026-09-26", "18:31"), "2026-09-26", day), "late");
assert.equal(submitPhase(ist("2026-09-27", "09:59"), "2026-09-26", day), "late");
assert.equal(submitPhase(ist("2026-09-27", "10:00"), "2026-09-26", day), "closed");

const nightBounds = shiftBounds("2026-09-26", night);
assert.equal(nightBounds.windowOpensAt.toISOString(), ist("2026-09-27", "05:30").toISOString());
assert.equal(nightBounds.shiftEndsAt.toISOString(), ist("2026-09-27", "06:00").toISOString());
assert.equal(nightBounds.lateClosesAt.toISOString(), ist("2026-09-27", "10:00").toISOString());
assert.equal(activeReportDate(ist("2026-09-27", "03:00"), night), "2026-09-26");
assert.equal(activeReportDate(ist("2026-09-27", "05:45"), night), "2026-09-26");
assert.equal(activeReportDate(ist("2026-09-27", "07:00"), night), "2026-09-26");
assert.equal(activeReportDate(ist("2026-09-27", "11:00"), night), "2026-09-27");

assert.deepEqual(
  checkoutDecision({
    reportStatus: "submitted",
    approvedLeave: false,
    holiday: false,
    weekOff: false,
  }),
  {
    allowed: true,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: "late", approvedLeave: false, holiday: false, weekOff: false }),
  {
    allowed: true,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: null, approvedLeave: true, holiday: false, weekOff: false }),
  {
    allowed: true,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: null, approvedLeave: false, holiday: true, weekOff: false }),
  {
    allowed: true,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: "draft", approvedLeave: false, holiday: false, weekOff: true }),
  {
    allowed: true,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: "draft", approvedLeave: false, holiday: false, weekOff: false }),
  {
    allowed: false,
    reason: CHECKOUT_DRAFT_REASON,
  },
);
assert.deepEqual(
  checkoutDecision({
    reportStatus: "missed",
    approvedLeave: false,
    holiday: false,
    weekOff: false,
  }),
  {
    allowed: false,
    reason: CHECKOUT_MISSED_REASON,
  },
);
assert.deepEqual(
  checkoutDecision({ reportStatus: null, approvedLeave: false, holiday: false, weekOff: false }),
  {
    allowed: false,
    reason: CHECKOUT_MISSING_REASON,
  },
);

console.log("dwr-window assertions passed");
