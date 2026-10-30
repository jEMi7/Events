import { ATTENDANCE_LABELS, INTENT_LABELS, formatDateTime } from "./domain";
import type { BookingRecord, EventRecord } from "./queries";

const HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Job title",
  "Booking value",
  "Source",
  "Intent",
  "Attendance",
  "Last contacted",
  "Next callback",
  "Contact attempts",
];

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text === "—") return "";
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sanitiseFilename(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "event"
  );
}

export function attendeesCsvFilename(event: Pick<EventRecord, "event_name">) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${sanitiseFilename(event.event_name ?? "event")}-attendees-${stamp}.csv`;
}

export function buildAttendeesCsv(
  bookings: BookingRecord[],
  attempts: Record<string, number> = {},
) {
  const rows = bookings.map((booking) =>
    [
      booking.person.full_name,
      booking.person.email,
      booking.person.phone,
      booking.person.job_title,
      booking.booking_status,
      booking.source_account,
      INTENT_LABELS[booking.status.attendance_intent],
      ATTENDANCE_LABELS[booking.status.actual_attendance],
      formatDateTime(booking.status.last_contacted_at),
      formatDateTime(booking.status.callback_at),
      attempts[booking.id] ?? "",
    ]
      .map(cell)
      .join(","),
  );
  return [HEADERS.join(","), ...rows].join("\r\n");
}

export type PeopleExportRow = Pick<
  BookingRecord["person"],
  "full_name" | "email" | "phone" | "job_title"
>;

const PEOPLE_HEADERS = ["Full name", "Email", "Phone", "Job title"];

export function peopleCsvFilename() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `people-export-${stamp}.csv`;
}

export function buildPeopleCsv(people: PeopleExportRow[]) {
  const rows = people.map((person) =>
    [person.full_name, person.email, person.phone, person.job_title].map(cell).join(","),
  );
  return [PEOPLE_HEADERS.join(","), ...rows].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
