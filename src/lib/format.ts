export const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export const compactInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export const INDIA_TIME_ZONE = "Asia/Kolkata";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function asDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = DATE_ONLY.exec(value);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeParts(hour: number, minute: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
}

export const indianDate = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  const date = asDate(value);
  if (!date) return typeof value === "string" ? value : "—";
  const key = indiaDateKey(date);
  return `${key.slice(8, 10)} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
};

export const indianTime = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  if (typeof value === "string") {
    const timeOnly = TIME_ONLY.exec(value);
    if (timeOnly) return formatTimeParts(Number(timeOnly[1]), Number(timeOnly[2]));
  }
  const date = asDate(value);
  if (!date) return typeof value === "string" ? value : "—";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return formatTimeParts(hour, minute);
};

export const indianDateTime = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  const date = asDate(value);
  if (!date) return typeof value === "string" ? value : "—";
  return `${indianDate(date)}, ${indianTime(date)}`;
};

export const indiaDateKey = (value: string | Date = new Date()) => {
  const date = asDate(value);
  if (!date) throw new Error("A valid instant is required to create an IST date key.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const indiaDateKeyDaysAgo = (days: number, value: Date = new Date()) => {
  const key = indiaDateKey(value);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day - days, 12));
  return shifted.toISOString().slice(0, 10);
};

/** Converts a date and wall-clock time entered in IST into a UTC ISO instant. */
export const indiaLocalDateTimeToUtcIso = (dateKey: string, time: string) => {
  const dateMatch = DATE_ONLY.exec(dateKey);
  const timeMatch = TIME_ONLY.exec(time);
  if (!dateMatch || !timeMatch) throw new Error("Enter a valid IST date and time.");
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error("Enter a valid IST date and time.");
  }
  const utcMilliseconds =
    Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      hour,
      minute,
      second,
    ) -
    330 * 60 * 1000;
  const result = new Date(utcMilliseconds);
  if (Number.isNaN(result.getTime()) || indiaDateKey(result) !== dateKey) {
    throw new Error("Enter a valid IST date and time.");
  }
  return result.toISOString();
};

export const shortDate = indianDate;

export const dayMonth = (value: string | null) => {
  if (!value) return "—";
  const date = asDate(value);
  if (!date) return value;
  const key = indiaDateKey(date);
  return `${key.slice(8, 10)} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]}`;
};

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const percent = (value: number) => `${Math.round(value)}%`;
