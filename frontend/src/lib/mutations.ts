import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ATTENDANCE_LABELS, INTENT_LABELS } from "./domain";
import type { ActualAttendance, AttendanceIntent } from "./domain";

type BookingRef = { bookingId: string; eventId: string; personId: string };

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Your session has expired. Please sign in again.");
  return data.user.id;
}

async function logActivity(
  ref: BookingRef,
  actorId: string,
  action: string,
  detail: Record<string, unknown> = {},
  note?: string | null,
) {
  const { error } = await supabase.from("activity_log").insert({
    booking_id: ref.bookingId,
    event_id: ref.eventId,
    person_id: ref.personId,
    actor_id: actorId,
    action,
    detail: detail as never,
    note: note ?? null,
  });
  if (error) throw error;
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    ["bookings", "activity", "callbacks", "booking-callbacks", "notes", "person-bookings"].forEach(
      (key) => queryClient.invalidateQueries({ queryKey: [key] }),
    );
  };
}

type StatusSnapshot = {
  attendance_intent: AttendanceIntent;
  actual_attendance: ActualAttendance;
  last_contacted_at: string | null;
  last_contacted_by: string | null;
  callback_at: string | null;
  assigned_to: string | null;
};

const EMPTY_SNAPSHOT: StatusSnapshot = {
  attendance_intent: "not_contacted",
  actual_attendance: "unknown",
  last_contacted_at: null,
  last_contacted_by: null,
  callback_at: null,
  assigned_to: null,
};

async function currentSnapshot(bookingId: string): Promise<StatusSnapshot> {
  const { data, error } = await supabase
    .from("attendee_operational_statuses")
    .select(
      "attendance_intent, actual_attendance, last_contacted_at, last_contacted_by, callback_at, assigned_to",
    )
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY_SNAPSHOT;
  return {
    attendance_intent: (data.attendance_intent as AttendanceIntent) ?? "not_contacted",
    actual_attendance: (data.actual_attendance as ActualAttendance) ?? "unknown",
    last_contacted_at: data.last_contacted_at ?? null,
    last_contacted_by: data.last_contacted_by ?? null,
    callback_at: data.callback_at ?? null,
    assigned_to: data.assigned_to ?? null,
  };
}

async function snapshotsFor(bookingIds: string[]): Promise<Map<string, StatusSnapshot>> {
  const { data, error } = await supabase
    .from("attendee_operational_statuses")
    .select(
      "booking_id, attendance_intent, actual_attendance, last_contacted_at, last_contacted_by, callback_at, assigned_to",
    )
    .in("booking_id", bookingIds);
  if (error) throw error;
  const map = new Map<string, StatusSnapshot>();
  (data ?? []).forEach((row) => {
    map.set(row.booking_id, {
      attendance_intent: (row.attendance_intent as AttendanceIntent) ?? "not_contacted",
      actual_attendance: (row.actual_attendance as ActualAttendance) ?? "unknown",
      last_contacted_at: row.last_contacted_at ?? null,
      last_contacted_by: row.last_contacted_by ?? null,
      callback_at: row.callback_at ?? null,
      assigned_to: row.assigned_to ?? null,
    });
  });
  return map;
}

/** Every action that mutates attendee state and can therefore be undone. */
const UNDOABLE_ACTIONS = [
  "intent_updated",
  "attendance_updated",
  "callback_scheduled",
  "callback_rescheduled",
  "callback_completed",
] as const;



export function useSetIntent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      ref,
      intent,
      note,
    }: {
      ref: BookingRef;
      intent: AttendanceIntent;
      note?: string;
    }) => {
      const actorId = await currentUserId();
      const snapshot = await currentSnapshot(ref.bookingId);
      const previous = snapshot.attendance_intent;
      const now = new Date().toISOString();
      const { error } = await supabase.from("attendee_operational_statuses").upsert(
        {
          booking_id: ref.bookingId,
          attendance_intent: intent,
          last_contacted_at: now,
          last_contacted_by: actorId,
        },
        { onConflict: "booking_id" },
      );
      if (error) throw error;

      if (note?.trim()) {
        const { error: noteError } = await supabase.from("contact_notes").insert({
          booking_id: ref.bookingId,
          person_id: ref.personId,
          event_id: ref.eventId,
          body: note.trim(),
          created_by: actorId,
        });
        if (noteError) throw noteError;
      }

      await logActivity(
        ref,
        actorId,
        "intent_updated",
        { intent, previous, previous_state: snapshot },
        note?.trim() || null,
      );
      return intent;
    },
    onSuccess: (intent) => {
      invalidate();
      toast.success(`Attendance intent set to ${INTENT_LABELS[intent]}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUndoIntent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ ref }: { ref: BookingRef }) => {
      const actorId = await currentUserId();
      const { data, error } = await supabase
        .from("activity_log")
        .select("action, detail, created_at")
        .eq("booking_id", ref.bookingId)
        .in("action", [...UNDOABLE_ACTIONS, "status_reverted"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;

      const latest = data?.[0];
      if (!latest || latest.action === "status_reverted") {
        throw new Error("There is no status change left to undo for this attendee.");
      }

      const detail = (latest.detail ?? {}) as Record<string, unknown>;
      const live = await currentSnapshot(ref.bookingId);
      const stored = (detail['previous_state'] as Partial<StatusSnapshot> | undefined) ?? undefined;
      const previousIntent =
        stored?.attendance_intent ??
        (detail['previous'] as AttendanceIntent | undefined) ??
        "not_contacted";

      // One shared rule for every action: restore the state captured before it,
      // and always clear the contact stamp the action itself created.
      const restored: StatusSnapshot = {
        attendance_intent: previousIntent,
        actual_attendance: stored?.actual_attendance ?? "unknown",
        last_contacted_at: null,
        last_contacted_by: null,
        callback_at: stored?.callback_at ?? null,
        assigned_to: stored?.assigned_to ?? null,
      };

      const { error: opsError } = await supabase.from("attendee_operational_statuses").upsert(
        { booking_id: ref.bookingId, ...restored },
        { onConflict: "booking_id" },
      );
      if (opsError) throw opsError;

      // Roll back the call back task this action created, if any.
      const taskId = detail['callback_task_id'] as string | undefined;
      if (taskId && latest.action === "callback_scheduled") {
        const { error: taskError } = await supabase
          .from("callback_tasks")
          .update({ status: "cancelled" })
          .eq("id", taskId);
        if (taskError) throw taskError;
      }
      if (taskId && (latest.action === "callback_completed" || latest.action === "callback_rescheduled")) {
        const previousTask = (detail['previous_task'] ?? {}) as Record<string, unknown>;
        const { error: taskError } = await supabase
          .from("callback_tasks")
          .update({
            status: (previousTask['status'] as string | undefined) ?? "open",
            due_at:
              (previousTask['due_at'] as string | undefined) ??
              restored.callback_at ??
              new Date().toISOString(),

            completed_at: null,
            completed_by: null,
          })
          .eq("id", taskId);
        if (taskError) throw taskError;
      }

      await logActivity(ref, actorId, "status_reverted", {
        undone_action: latest.action,
        from: live.attendance_intent,
        to: restored.attendance_intent,
        from_attendance: live.actual_attendance,
        to_attendance: restored.actual_attendance,
        restored_state: restored,
      });
      return restored.attendance_intent;
    },
    onSuccess: (previous) => {
      invalidate();
      toast.success(`Status reverted to ${INTENT_LABELS[previous]}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}


export function useSetAttendance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      ref,
      attendance,
    }: {
      ref: BookingRef;
      attendance: ActualAttendance;
    }) => {
      const actorId = await currentUserId();
      const snapshot = await currentSnapshot(ref.bookingId);
      const { error } = await supabase
        .from("attendee_operational_statuses")
        .upsert(
          { booking_id: ref.bookingId, actual_attendance: attendance },
          { onConflict: "booking_id" },
        );
      if (error) throw error;
      await logActivity(ref, actorId, "attendance_updated", {
        attendance,
        previous: snapshot.actual_attendance,
        previous_state: snapshot,
      });
      return attendance;
    },
    onSuccess: (attendance) => {
      invalidate();
      toast.success(`Marked as ${ATTENDANCE_LABELS[attendance].toLowerCase()}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}


export function useAddNote() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ ref, body }: { ref: BookingRef; body: string }) => {
      const text = body.trim();
      if (!text) throw new Error("Please write a note before saving.");
      const actorId = await currentUserId();
      const { error } = await supabase.from("contact_notes").insert({
        booking_id: ref.bookingId,
        person_id: ref.personId,
        event_id: ref.eventId,
        body: text,
        created_by: actorId,
      });
      if (error) throw error;
      await logActivity(ref, actorId, "note_added", {}, text);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Note saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useScheduleCallback() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      ref,
      dueAt,
      ownerId,
      note,
    }: {
      ref: BookingRef;
      dueAt: string;
      ownerId: string | null;
      note?: string;
    }) => {
      if (!dueAt) throw new Error("Choose a date and time for the call back.");
      const actorId = await currentUserId();
      const snapshot = await currentSnapshot(ref.bookingId);
      const dueIso = new Date(dueAt).toISOString();

      const { data: task, error } = await supabase
        .from("callback_tasks")
        .insert({
          booking_id: ref.bookingId,
          due_at: dueIso,
          owner_id: ownerId ?? actorId,
          note: note?.trim() || null,
          created_by: actorId,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;

      const { error: opsError } = await supabase.from("attendee_operational_statuses").upsert(
        {
          booking_id: ref.bookingId,
          attendance_intent: "call_back" as AttendanceIntent,
          callback_at: dueIso,
          assigned_to: ownerId ?? actorId,
          last_contacted_at: new Date().toISOString(),
          last_contacted_by: actorId,
        },
        { onConflict: "booking_id" },
      );
      if (opsError) throw opsError;

      await logActivity(
        ref,
        actorId,
        "callback_scheduled",
        {
          due_at: dueIso,
          previous: snapshot.attendance_intent,
          previous_state: snapshot,
          callback_task_id: task?.id ?? null,
        },
        note?.trim() || null,
      );

    },
    onSuccess: () => {
      invalidate();
      toast.success("Call back scheduled");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCompleteCallback() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      id,
      ref,
      note,
      intent,
    }: {
      id: string;
      ref: BookingRef;
      note?: string;
      intent?: AttendanceIntent;
    }) => {
      const actorId = await currentUserId();
      const snapshot = await currentSnapshot(ref.bookingId);
      const { data: before } = await supabase
        .from("callback_tasks")
        .select("status, due_at")
        .eq("id", id)
        .maybeSingle();
      const { error } = await supabase
        .from("callback_tasks")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by: actorId,
          note: note?.trim() || null,
        })
        .eq("id", id);
      if (error) throw error;

      const { error: opsError } = await supabase.from("attendee_operational_statuses").upsert(
        {
          booking_id: ref.bookingId,
          callback_at: null,
          last_contacted_at: new Date().toISOString(),
          last_contacted_by: actorId,
          ...(intent ? { attendance_intent: intent } : {}),
        },
        { onConflict: "booking_id" },
      );
      if (opsError) throw opsError;

      await logActivity(
        ref,
        actorId,
        "callback_completed",
        {
          intent: intent ?? null,
          previous: snapshot.attendance_intent,
          previous_state: snapshot,
          callback_task_id: id,
          previous_task: before ?? null,
        },
        note?.trim() || null,
      );

    },
    onSuccess: () => {
      invalidate();
      toast.success("Call back completed");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRescheduleCallback() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, ref, dueAt }: { id: string; ref: BookingRef; dueAt: string }) => {
      if (!dueAt) throw new Error("Choose a new date and time.");
      const actorId = await currentUserId();
      const snapshot = await currentSnapshot(ref.bookingId);
      const dueIso = new Date(dueAt).toISOString();
      const { data: before } = await supabase
        .from("callback_tasks")
        .select("status, due_at")
        .eq("id", id)
        .maybeSingle();
      const { error } = await supabase
        .from("callback_tasks")
        .update({ due_at: dueIso, status: "open" })
        .eq("id", id);
      if (error) throw error;
      const { error: opsError } = await supabase
        .from("attendee_operational_statuses")
        .upsert({ booking_id: ref.bookingId, callback_at: dueIso }, { onConflict: "booking_id" });
      if (opsError) throw opsError;
      await logActivity(ref, actorId, "callback_rescheduled", {
        due_at: dueIso,
        previous: snapshot.attendance_intent,
        previous_state: snapshot,
        callback_task_id: id,
        previous_task: before ?? null,
      });

    },
    onSuccess: () => {
      invalidate();
      toast.success("Call back rescheduled");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useBulkIntent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ refs, intent }: { refs: BookingRef[]; intent: AttendanceIntent }) => {
      if (!refs.length) throw new Error("Select at least one attendee.");
      const actorId = await currentUserId();
      const now = new Date().toISOString();
      const before = await snapshotsFor(refs.map((ref) => ref.bookingId));
      const { error } = await supabase.from("attendee_operational_statuses").upsert(
        refs.map((ref) => ({
          booking_id: ref.bookingId,
          attendance_intent: intent,
          last_contacted_at: now,
          last_contacted_by: actorId,
        })),
        { onConflict: "booking_id" },
      );
      if (error) throw error;
      const { error: logError } = await supabase.from("activity_log").insert(
        refs.map((ref) => {
          const snapshot = before.get(ref.bookingId) ?? EMPTY_SNAPSHOT;
          return {
            booking_id: ref.bookingId,
            event_id: ref.eventId,
            person_id: ref.personId,
            actor_id: actorId,
            action: "intent_updated",
            detail: {
              intent,
              bulk: true,
              previous: snapshot.attendance_intent,
              previous_state: snapshot,
            } as never,
          };
        }),
      );
      if (logError) throw logError;

      return refs.length;
    },
    onSuccess: (count) => {
      invalidate();
      toast.success(`Updated ${count} attendee${count === 1 ? "" : "s"}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useBulkAttendance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      refs,
      attendance,
    }: {
      refs: BookingRef[];
      attendance: ActualAttendance;
    }) => {
      if (!refs.length) throw new Error("Select at least one attendee.");
      const actorId = await currentUserId();
      const before = await snapshotsFor(refs.map((ref) => ref.bookingId));
      const { error } = await supabase.from("attendee_operational_statuses").upsert(
        refs.map((ref) => ({ booking_id: ref.bookingId, actual_attendance: attendance })),
        { onConflict: "booking_id" },
      );
      if (error) throw error;
      const { error: logError } = await supabase.from("activity_log").insert(
        refs.map((ref) => {
          const snapshot = before.get(ref.bookingId) ?? EMPTY_SNAPSHOT;
          return {
            booking_id: ref.bookingId,
            event_id: ref.eventId,
            person_id: ref.personId,
            actor_id: actorId,
            action: "attendance_updated",
            detail: {
              attendance,
              bulk: true,
              previous: snapshot.actual_attendance,
              previous_state: snapshot,
            } as never,
          };
        }),
      );
      if (logError) throw logError;

      return refs.length;
    },
    onSuccess: (count) => {
      invalidate();
      toast.success(`Attendance recorded for ${count} attendee${count === 1 ? "" : "s"}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
