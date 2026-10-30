export type AttendanceIntent =
  | "not_contacted"
  | "confirmed"
  | "declined"
  | "maybe"
  | "no_answer"
  | "call_back"
  | "cancelled";

export type ActualAttendance = "unknown" | "attended" | "absent";

export const INTENT_LABELS: Record<AttendanceIntent, string> = {
  not_contacted: "Not contacted",
  confirmed: "Confirmed",
  declined: "Declined",
  maybe: "Maybe",
  no_answer: "No answer",
  call_back: "Call back",
  cancelled: "Cancelled",
};

export const INTENT_ORDER: AttendanceIntent[] = [
  "not_contacted",
  "confirmed",
  "maybe",
  "call_back",
  "no_answer",
  "declined",
  "cancelled",
];

export const ATTENDANCE_LABELS: Record<ActualAttendance, string> = {
  unknown: "Unknown",
  attended: "Attended",
  absent: "Absent",
};

type Tone = "neutral" | "lavender" | "success" | "warning" | "danger" | "info";

export const INTENT_TONE: Record<AttendanceIntent, Tone> = {
  not_contacted: "neutral",
  confirmed: "success",
  declined: "danger",
  maybe: "warning",
  no_answer: "warning",
  call_back: "info",
  cancelled: "danger",
};

export const ATTENDANCE_TONE: Record<ActualAttendance, Tone> = {
  unknown: "neutral",
  attended: "success",
  absent: "danger",
};

export const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-1 ring-border",
  lavender: "bg-lav-100 text-secondary-foreground ring-1 ring-lav-200",
  success: "bg-success/10 text-success ring-1 ring-success/20",
  warning: "bg-warning/15 text-warning-foreground ring-1 ring-warning/30",
  danger: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  info: "bg-info/10 text-info ring-1 ring-info/20",
};

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

const shortFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeFormat.format(d);
}

export function formatShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return shortFormat.format(d);
}

export function formatDay(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dayFormat.format(d);
}

export function relativeFromNow(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 60
      ? `${mins} min`
      : abs < 86400000
        ? `${Math.round(mins / 60)} hr`
        : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
