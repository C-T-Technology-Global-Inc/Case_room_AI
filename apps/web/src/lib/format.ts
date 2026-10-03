/**
 * Formatting helpers that are safe on server and client.
 * Clinical dates (DOB, document date, due date) are date-only values stored at
 * UTC midnight, so they are always formatted in UTC to avoid off-by-one days.
 */

type DateInput = Date | string;

function toDate(value: DateInput): Date {
  return typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
}

export function formatDate(value: DateInput, options: { year?: boolean } = {}): string {
  return toDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(options.year === false ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

export function formatShortDate(value: DateInput): string {
  return formatDate(value, { year: false });
}

export function formatDateTime(value: DateInput): string {
  return toDate(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(value: DateInput): string {
  return toDate(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "just now", "5m ago", "3h ago", "2d ago", else a date. */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date, { year: date.getFullYear() !== now.getFullYear() });
}

export function ageFromDob(dob: DateInput, now: Date = new Date()): number {
  const birth = toDate(dob);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Calendar-day difference between a date-only value and today (negative = past). */
export function daysFromToday(value: DateInput, now: Date = new Date()): number {
  const date = toDate(value);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export function dueLabel(value: DateInput | null | undefined): { text: string; tone: "overdue" | "today" | "soon" | "later" } | null {
  if (!value) return null;
  const days = daysFromToday(value);
  if (days < 0) return { text: `Overdue ${Math.abs(days)}d`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "today" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { text: `Due in ${days}d`, tone: "soon" };
  return { text: `Due ${formatShortDate(value)}`, tone: "later" };
}

export function patientName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`;
}

export function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function pluralize(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}
