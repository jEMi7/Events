import { percent } from "./domain";
import type { BookingRecord, EventRecord } from "./queries";

export type EventStats = {
  booked: number;
  notContacted: number;
  confirmed: number;
  declined: number;
  maybe: number;
  noAnswer: number;
  callBacks: number;
  cancelled: number;
  attended: number;
  absent: number;
  unknownAttendance: number;
  pending: number;
  confirmationRate: number;
  showUpRate: number;
  noAnswerRate: number;
};

export function statsFor(bookings: BookingRecord[]): EventStats {
  const stats = {
    booked: bookings.length,
    notContacted: 0,
    confirmed: 0,
    declined: 0,
    maybe: 0,
    noAnswer: 0,
    callBacks: 0,
    cancelled: 0,
    attended: 0,
    absent: 0,
    unknownAttendance: 0,
  };

  for (const booking of bookings) {
    switch (booking.status.attendance_intent) {
      case "not_contacted":
        stats.notContacted += 1;
        break;
      case "confirmed":
        stats.confirmed += 1;
        break;
      case "declined":
        stats.declined += 1;
        break;
      case "maybe":
        stats.maybe += 1;
        break;
      case "no_answer":
        stats.noAnswer += 1;
        break;
      case "call_back":
        stats.callBacks += 1;
        break;
      case "cancelled":
        stats.cancelled += 1;
        break;
    }
    if (booking.status.actual_attendance === "attended") stats.attended += 1;
    else if (booking.status.actual_attendance === "absent") stats.absent += 1;
    else stats.unknownAttendance += 1;
  }

  const pending = stats.notContacted + stats.maybe + stats.noAnswer + stats.callBacks;

  return {
    ...stats,
    pending,
    confirmationRate: percent(stats.confirmed, stats.booked),
    showUpRate: percent(stats.attended, stats.attended + stats.absent),
    noAnswerRate: percent(stats.noAnswer, stats.booked),
  };
}

export function groupByEvent(bookings: BookingRecord[]) {
  const map = new Map<string, BookingRecord[]>();
  for (const booking of bookings) {
    const list = map.get(booking.event_id);
    if (list) list.push(booking);
    else map.set(booking.event_id, [booking]);
  }
  return map;
}

export type RangeKey = "7" | "30" | "90" | "upcoming" | "past" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "Next 7 days" },
  { key: "30", label: "Next 30 days" },
  { key: "90", label: "Next 90 days" },
  { key: "upcoming", label: "All upcoming" },
  { key: "past", label: "Past events" },
  { key: "all", label: "All time" },
];

export function filterEventsByRange(events: EventRecord[], range: RangeKey) {
  const now = Date.now();
  return events.filter((event) => {
    if (range === "all") return true;
    if (!event.start_at) return range === "upcoming";
    const start = new Date(event.start_at).getTime();
    if (range === "past") return start < now;
    if (range === "upcoming") return start >= now;
    const days = Number(range);
    return start >= now && start <= now + days * 86400000;
  });
}

export function sortByStart(events: EventRecord[], direction: "asc" | "desc" = "asc") {
  return [...events].sort((a, b) => {
    const left = a.start_at ? new Date(a.start_at).getTime() : Number.POSITIVE_INFINITY;
    const right = b.start_at ? new Date(b.start_at).getTime() : Number.POSITIVE_INFINITY;
    return direction === "asc" ? left - right : right - left;
  });
}
