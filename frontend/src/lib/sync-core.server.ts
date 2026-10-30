/**
 * Shared Google Sheets import logic. Used by both the admin-triggered server
 * function and the scheduled (cron) endpoint so there is exactly one sync
 * implementation.
 *
 * Source data is read-only: nothing is ever written back to the spreadsheet,
 * and staff-owned operational rows (attendee_operational_statuses, notes,
 * callbacks, activity log) are never overwritten or reset by a sync.
 */
import {
  ATTENDEE_FIELD_ALIASES,
  EVENT_FIELD_ALIASES,
  bookingKeyFor,
  buildFieldMap,
  canonicalMasterKey,
  mapRows,
  normaliseEmail,
  personIdentityKey,
  resolveEventTimes,
} from "./sheet-mapping";

export const DEFAULT_SOURCE = {
  spreadsheet_id: "1GNsiqHkTiVhWJY62F-fQeQY5hEyW0d-yNY5604-zZfQ",
  events_tab: "Upcoming_Events_Raw",
  attendees_tab: "Upcoming_Attendees_Raw",
};

export type SourceConfig = typeof DEFAULT_SOURCE;

export async function loadSourceConfig(supabase: any): Promise<SourceConfig> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "source_spreadsheet")
    .maybeSingle();
  return { ...DEFAULT_SOURCE, ...(data?.value ?? {}) } as SourceConfig;
}

async function loadOverrides(supabase: any) {
  const { data } = await supabase
    .from("header_mappings")
    .select("tab_name, source_header, target_field");
  const byTab: Record<string, Record<string, string>> = {};
  (data ?? []).forEach((row: { tab_name: string; source_header: string; target_field: string }) => {
    byTab[row.tab_name] = byTab[row.tab_name] ?? {};
    byTab[row.tab_name]![row.source_header] = row.target_field;
  });
  return byTab;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function performSync(supabase: any, triggeredBy: string | null) {
  const source = await loadSourceConfig(supabase);

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ status: "running", source: "google_sheets", triggered_by: triggeredBy })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);
  const runId = run.id as string;

  const counters = {
    events_read: 0,
    events_upserted: 0,
    attendees_read: 0,
    people_upserted: 0,
    bookings_upserted: 0,
    skipped_rows: 0,
  };
  const detail: Record<string, unknown> = { spreadsheet_id: source.spreadsheet_id };

  try {
    const { fetchTabs } = await import("./sheets.server");
    const overrides = await loadOverrides(supabase);
    const tabs = await fetchTabs(source.spreadsheet_id, [source.events_tab, source.attendees_tab]);

    const eventsTab = tabs[source.events_tab]!;
    const attendeesTab = tabs[source.attendees_tab]!;

    const eventMap = buildFieldMap(
      eventsTab.headers,
      EVENT_FIELD_ALIASES,
      overrides[source.events_tab] ?? {},
    );
    const attendeeMap = buildFieldMap(
      attendeesTab.headers,
      ATTENDEE_FIELD_ALIASES,
      overrides[source.attendees_tab] ?? {},
    );
    detail["unmapped_event_headers"] = eventMap.unmapped;
    detail["unmapped_attendee_headers"] = attendeeMap.unmapped;

    const eventRows = mapRows(eventsTab.headers, eventsTab.rows, eventMap.map);
    const attendeeRows = mapRows(attendeesTab.headers, attendeesTab.rows, attendeeMap.map);
    counters.events_read = eventRows.length;
    counters.attendees_read = attendeeRows.length;

    // The source's real "Zoom Link" column lives on attendee rows. Index it
    // by the same canonical event key used everywhere else in the sync.
    const meetingUrlByEventKey = new Map<string, string>();
    for (const row of attendeeRows) {
      const masterKey = canonicalMasterKey(
        row.fields["master_event_key"],
        row.fields["event_date"] && row.fields["event_time"]
          ? `${row.fields["event_date"]} ${row.fields["event_time"]}`
          : undefined,
      );
      const meetingUrl = row.fields["meeting_url"];
      if (masterKey && meetingUrl && !meetingUrlByEventKey.has(masterKey)) {
        meetingUrlByEventKey.set(masterKey, meetingUrl);
      }
    }

    // ---- Events: one logical event per start instant -------------------
    const eventsByKey = new Map<string, Record<string, unknown>>();
    for (const row of eventRows) {
      const masterKey = canonicalMasterKey(row.fields["master_event_key"], row.fields["start_at"]);
      if (!masterKey || !row.fields["event_name"]) {
        counters.skipped_rows += 1;
        continue;
      }
      const times = resolveEventTimes(row.fields, masterKey);
      eventsByKey.set(masterKey, {
        master_event_key: masterKey,
        source_event_id: row.fields["source_event_id"] ?? null,
        event_name: row.fields["event_name"],
        description: row.fields["description"] ?? null,
        start_at: times.start_at,
        end_at: times.end_at,
        timezone: row.fields["timezone"] ?? null,
        status: row.fields["status"] ?? null,
        meeting_url: row.fields["meeting_url"] ?? meetingUrlByEventKey.get(masterKey) ?? null,
        raw_payload: row.raw,
        data_origin: "google_sheets",
        last_synced_at: new Date().toISOString(),
      });
    }

    for (const batch of chunk([...eventsByKey.values()], 200)) {
      const { error } = await supabase
        .from("events")
        .upsert(batch, { onConflict: "master_event_key" });
      if (error) throw new Error(`Events upsert failed: ${error.message}`);
      counters.events_upserted += batch.length;
    }

    // Attendee rows can reference events that are missing from the events tab.
    const attendeeEventKeys = new Map<string, Record<string, unknown>>();
    for (const row of attendeeRows) {
      const masterKey = canonicalMasterKey(
        row.fields["master_event_key"],
        row.fields["event_date"] && row.fields["event_time"]
          ? `${row.fields["event_date"]} ${row.fields["event_time"]}`
          : undefined,
      );
      if (!masterKey || eventsByKey.has(masterKey) || attendeeEventKeys.has(masterKey)) continue;
      attendeeEventKeys.set(masterKey, {
        master_event_key: masterKey,
        source_event_id: row.fields["source_event_id"] ?? null,
        event_name: row.fields["event_name"] ?? "Untitled event",
        start_at: masterKey.includes("T") ? masterKey : null,
        meeting_url: row.fields["meeting_url"] ?? null,
        raw_payload: {},
        data_origin: "google_sheets",
        last_synced_at: new Date().toISOString(),
      });
    }
    if (attendeeEventKeys.size) {
      const { error } = await supabase.from("events").upsert([...attendeeEventKeys.values()], {
        onConflict: "master_event_key",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`Derived events upsert failed: ${error.message}`);
    }

    const { data: allEvents, error: eventsError } = await supabase
      .from("events")
      .select("id, master_event_key");
    if (eventsError) throw new Error(eventsError.message);
    const eventIdByKey = new Map<string, string>(
      (allEvents ?? []).map((e: { id: string; master_event_key: string }) => [
        e.master_event_key,
        e.id,
      ]),
    );

    // ---- People --------------------------------------------------------
    const peopleByKey = new Map<string, Record<string, unknown>>();
    const preparedBookings: {
      booking_key: string;
      identity_key: string;
      master_event_key: string;
      payload: Record<string, unknown>;
    }[] = [];

    for (const row of attendeeRows) {
      const masterKey = canonicalMasterKey(
        row.fields["master_event_key"],
        row.fields["event_date"] && row.fields["event_time"]
          ? `${row.fields["event_date"]} ${row.fields["event_time"]}`
          : undefined,
      );
      const identityKey = personIdentityKey(row.fields);
      if (!masterKey || !identityKey || !eventIdByKey.has(masterKey)) {
        counters.skipped_rows += 1;
        continue;
      }

      const email = normaliseEmail(row.fields["email"]);
      const existing = peopleByKey.get(identityKey) ?? {};
      peopleByKey.set(identityKey, {
        identity_key: identityKey,
        email: row.fields["email"] ?? (existing["email"] as string | undefined) ?? null,
        email_normalised: email ?? (existing["email_normalised"] as string | undefined) ?? null,
        full_name: row.fields["full_name"] ?? (existing["full_name"] as string | undefined) ?? null,
        phone: row.fields["phone"] ?? (existing["phone"] as string | undefined) ?? null,
        job_title: row.fields["job_title"] ?? (existing["job_title"] as string | undefined) ?? null,
        data_origin: "google_sheets",
      });

      preparedBookings.push({
        booking_key: bookingKeyFor(row.fields, masterKey, identityKey),
        identity_key: identityKey,
        master_event_key: masterKey,
        payload: {
          source_attendee_id: row.fields["source_attendee_id"] ?? null,
          booking_status: row.fields["booking_status"] ?? null,
          source_account: row.fields["source_account"] ?? null,
          meeting_url: row.fields["meeting_url"] ?? null,
          raw_payload: row.raw,
          data_origin: "google_sheets",
          last_synced_at: new Date().toISOString(),
        },
      });
    }

    for (const batch of chunk([...peopleByKey.values()], 400)) {
      const { error } = await supabase.from("people").upsert(batch, { onConflict: "identity_key" });
      if (error) throw new Error(`People upsert failed: ${error.message}`);
      counters.people_upserted += batch.length;
    }

    const identityKeys = [...peopleByKey.keys()];
    const personIdByKey = new Map<string, string>();
    for (const batch of chunk(identityKeys, 300)) {
      const { data, error } = await supabase
        .from("people")
        .select("id, identity_key")
        .in("identity_key", batch);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((p: { id: string; identity_key: string }) =>
        personIdByKey.set(p.identity_key, p.id),
      );
    }

    // ---- Bookings (never touches operational records) ------------------
    const bookingRows = new Map<string, Record<string, unknown>>();
    for (const booking of preparedBookings) {
      const eventId = eventIdByKey.get(booking.master_event_key);
      const personId = personIdByKey.get(booking.identity_key);
      if (!eventId || !personId) {
        counters.skipped_rows += 1;
        continue;
      }
      bookingRows.set(booking.booking_key, {
        booking_key: booking.booking_key,
        event_id: eventId,
        person_id: personId,
        ...booking.payload,
      });
    }

    for (const batch of chunk([...bookingRows.values()], 300)) {
      const { error } = await supabase
        .from("event_bookings")
        .upsert(batch, { onConflict: "booking_key" });
      if (error) throw new Error(`Bookings upsert failed: ${error.message}`);
      counters.bookings_upserted += batch.length;
    }

    // Ensure an operational row exists for every booking, without overwriting.
    const bookingKeys = [...bookingRows.keys()];
    const bookingIds: string[] = [];
    for (const batch of chunk(bookingKeys, 300)) {
      const { data, error } = await supabase
        .from("event_bookings")
        .select("id")
        .in("booking_key", batch);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((b: { id: string }) => bookingIds.push(b.id));
    }
    for (const batch of chunk(bookingIds, 400)) {
      const { error } = await supabase.from("attendee_operational_statuses").upsert(
        batch.map((id) => ({ booking_id: id })),
        { onConflict: "booking_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Operational rows failed: ${error.message}`);
    }

    const { data: finished, error: finishError } = await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        detail,
        ...counters,
      })
      .eq("id", runId)
      .select("id");
    if (finishError) throw new Error(`Could not record the sync result: ${finishError.message}`);
    if (!finished || finished.length === 0)
      throw new Error("Could not record the sync result: the sync history row was not updated.");

    return {
      ok: true as const,
      runId,
      ...counters,
      unmappedEventHeaders: (detail["unmapped_event_headers"] as string[] | undefined) ?? [],
      unmappedAttendeeHeaders: (detail["unmapped_attendee_headers"] as string[] | undefined) ?? [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("[sync] failed", error);
    // A failed sync leaves previously imported data untouched.
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
        detail,
        ...counters,
      })
      .eq("id", runId);
    throw new Error(message);
  }
}
