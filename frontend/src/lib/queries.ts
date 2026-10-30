import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ActualAttendance, AttendanceIntent } from "./domain";

export type EventRecord = {
  id: string;
  master_event_key: string;
  source_event_id: string | null;
  event_name: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  status: string | null;
  meeting_url: string | null;
  raw_payload: Record<string, unknown> | null;
  data_origin: string;
  last_synced_at: string | null;
};

export type OperationalStatus = {
  attendance_intent: AttendanceIntent;
  actual_attendance: ActualAttendance;
  last_contacted_at: string | null;
  last_contacted_by: string | null;
  callback_at: string | null;
  assigned_to: string | null;
};

export type BookingRecord = {
  id: string;
  booking_key: string;
  event_id: string;
  person_id: string;
  booking_status: string | null;
  source_account: string | null;
  source_attendee_id: string | null;
  meeting_url: string | null;
  raw_payload: Record<string, unknown> | null;
  data_origin: string;
  person: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    job_title: string | null;
  };
  status: OperationalStatus;
};

const DEFAULT_STATUS: OperationalStatus = {
  attendance_intent: "not_contacted",
  actual_attendance: "unknown",
  last_contacted_at: null,
  last_contacted_by: null,
  callback_at: null,
  assigned_to: null,
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const BOOKING_SELECT = `
  id, booking_key, event_id, person_id, booking_status, source_account,
  source_attendee_id, meeting_url, raw_payload, data_origin,
  people!inner ( id, full_name, email, phone, job_title ),
  attendee_operational_statuses (
    attendance_intent, actual_attendance, last_contacted_at,
    last_contacted_by, callback_at, assigned_to
  )
`;

function shapeBooking(row: any): BookingRecord {
  const person = one<any>(row.people);
  const status = one<any>(row.attendee_operational_statuses);
  return {
    id: row.id,
    booking_key: row.booking_key,
    event_id: row.event_id,
    person_id: row.person_id,
    booking_status: row.booking_status,
    source_account: row.source_account,
    source_attendee_id: row.source_attendee_id,
    meeting_url: row.meeting_url,
    raw_payload: row.raw_payload,
    data_origin: row.data_origin,
    person: {
      id: person?.id ?? row.person_id,
      full_name: person?.full_name ?? null,
      email: person?.email ?? null,
      phone: person?.phone ?? null,
      job_title: person?.job_title ?? null,
    },
    status: status ? { ...DEFAULT_STATUS, ...status } : DEFAULT_STATUS,
  };
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: async (): Promise<EventRecord[]> => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("start_at", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as EventRecord[];
    },
  });
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId],
    enabled: Boolean(eventId),
    queryFn: async (): Promise<EventRecord | null> => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as EventRecord | null;
    },
  });
}

/** All bookings with their operational state — the core working set. */
export function useBookings(eventId?: string) {
  return useQuery({
    queryKey: ["bookings", eventId ?? "all"],
    queryFn: async (): Promise<BookingRecord[]> => {
      let request = supabase.from("event_bookings").select(BOOKING_SELECT).limit(8000);
      if (eventId) request = request.eq("event_id", eventId);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []).map(shapeBooking);
    },
  });
}

/** Contact attempts (intent changes) per booking for one event, for exports. */
export async function fetchContactAttempts(eventId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("booking_id")
    .eq("event_id", eventId)
    .eq("action", "intent_updated")
    .limit(20000);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as { booking_id: string | null }).booking_id;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export function usePersonBookings(personId: string) {
  return useQuery({
    queryKey: ["person-bookings", personId],
    enabled: Boolean(personId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_bookings")
        .select(
          `${BOOKING_SELECT}, events!inner ( id, event_name, start_at, timezone, status )`,
        )
        .eq("person_id", personId);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...shapeBooking(row),
        event: one<any>(row.events) as {
          id: string;
          event_name: string;
          start_at: string | null;
          timezone: string | null;
          status: string | null;
        },
      }));
    },
  });
}

export type PersonRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  identity_key: string;
  created_at: string;
};

export function usePeople(search: string) {
  return useQuery({
    queryKey: ["people", search],
    queryFn: async (): Promise<PersonRecord[]> => {
      let request = supabase
        .from("people")
        .select("id, full_name, email, phone, job_title, identity_key, created_at")
        .order("full_name", { ascending: true })
        .limit(300);
      const term = search.trim();
      if (term) {
        const safe = term.replace(/[%,()]/g, " ");
        request = request.or(
          `full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`,
        );
      }
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as unknown as PersonRecord[];
    },
  });
}

/** Every person in the dataset, ignoring search — used for the People export. */
export async function fetchPeopleForExport(): Promise<PersonRecord[]> {
  const { data, error } = await supabase
    .from("people")
    .select("id, full_name, email, phone, job_title, identity_key, created_at")
    .order("full_name", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as PersonRecord[];
}

export type ActivityRecord = {
  id: string;
  action: string;
  note: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
  booking_id: string | null;
  event_id: string | null;
  person_id: string | null;
  actor: { full_name: string | null } | null;
  person: { full_name: string | null } | null;
  event: { event_name: string | null } | null;
};

export function useActivity(
  options: { bookingId?: string | undefined; personId?: string | undefined; limit?: number } = {},
) {
  const { bookingId, personId, limit = 25 } = options;
  return useQuery({
    queryKey: ["activity", bookingId ?? null, personId ?? null, limit],
    queryFn: async (): Promise<ActivityRecord[]> => {
      let request = supabase
        .from("activity_log")
        .select(
          `id, action, note, detail, created_at, actor_id, booking_id, event_id, person_id,
           profiles:actor_id ( full_name ), people:person_id ( full_name ), events:event_id ( event_name )`,
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (bookingId) request = request.eq("booking_id", bookingId);
      if (personId) request = request.eq("person_id", personId);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        actor: one<any>(row.profiles),
        person: one<any>(row.people),
        event: one<any>(row.events),
      })) as ActivityRecord[];
    },
  });
}

export type NoteRecord = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  author: { full_name: string | null } | null;
};

export function useNotes(bookingId?: string, personId?: string) {
  return useQuery({
    queryKey: ["notes", bookingId ?? null, personId ?? null],
    enabled: Boolean(bookingId || personId),
    queryFn: async (): Promise<NoteRecord[]> => {
      let request = supabase
        .from("contact_notes")
        .select("id, body, created_at, created_by, profiles:created_by ( full_name )")
        .order("created_at", { ascending: false })
        .limit(100);
      if (bookingId) request = request.eq("booking_id", bookingId);
      else if (personId) request = request.eq("person_id", personId);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []).map((row: any) => ({ ...row, author: one<any>(row.profiles) }));
    },
  });
}

export type CallbackRecord = {
  id: string;
  booking_id: string;
  due_at: string;
  status: "open" | "completed" | "cancelled";
  note: string | null;
  owner_id: string | null;
  completed_at: string | null;
  created_at: string;
  owner: { full_name: string | null } | null;
  booking: {
    id: string;
    event_id: string;
    person_id: string;
    person: { full_name: string | null; email: string | null; phone: string | null } | null;
    event: { id: string; event_name: string; start_at: string | null } | null;
  } | null;
};

export function useCallbacks() {
  return useQuery({
    queryKey: ["callbacks"],
    queryFn: async (): Promise<CallbackRecord[]> => {
      const { data, error } = await supabase
        .from("callback_tasks")
        .select(
          `id, booking_id, due_at, status, note, owner_id, completed_at, created_at,
           profiles:owner_id ( full_name ),
           event_bookings!inner (
             id, event_id, person_id,
             people!inner ( full_name, email, phone ),
             events!inner ( id, event_name, start_at )
           )`,
        )
        // Call backs reverted by Undo stay in the audit trail but must not look
        // actionable in any of the normal queues or counts.
        .neq("status", "cancelled")
        .order("due_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((row: any) => {
        const booking = one<any>(row.event_bookings);
        return {
          ...row,
          owner: one<any>(row.profiles),
          booking: booking
            ? {
                id: booking.id,
                event_id: booking.event_id,
                person_id: booking.person_id,
                person: one<any>(booking.people),
                event: one<any>(booking.events),
              }
            : null,
        } as CallbackRecord;
      });
    },
  });
}

export function useBookingCallbacks(bookingId?: string) {
  return useQuery({
    queryKey: ["booking-callbacks", bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("callback_tasks")
        .select("id, due_at, status, note, owner_id, completed_at, profiles:owner_id ( full_name )")
        .eq("booking_id", bookingId!)
        .neq("status", "cancelled")
        .order("due_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({ ...row, owner: one<any>(row.profiles) }));
    },
  });
}

export type SyncRunRecord = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  source: string;
  events_read: number;
  events_upserted: number;
  attendees_read: number;
  bookings_upserted: number;
  people_upserted: number;
  skipped_rows: number;
  error_message: string | null;
  detail: Record<string, unknown> | null;
};

export function useSyncRuns() {
  return useQuery({
    queryKey: ["sync-runs"],
    queryFn: async (): Promise<SyncRunRecord[]> => {
      const { data, error } = await supabase
        .from("sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as SyncRunRecord[];
    },
  });
}

export function useHeaderMappings() {
  return useQuery({
    queryKey: ["header-mappings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("header_mappings")
        .select("id, tab_name, source_header, target_field")
        .order("tab_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useStaffDirectory() {
  return useQuery({
    queryKey: ["staff-directory"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
