# Eventbrite workflow storage in Neon

This schema replaces Sheets storage. It does not activate an n8n workflow, import
the spreadsheet, send mail, or switch React away from Supabase.

Applied and verified on 30 October 2026 against the existing Events Neon branch:
both migrations succeeded; public now contains 24 tables and the two read-only
views below. All existing business-table counts were unchanged and all three new
tables were empty. Thirteen named workflow constraints were validated; no
migrations remained pending. Forty-seven isolated SQLite tests passed, followed
by PostgreSQL catalog, view-query and column-type verification. A full custom-format
backup and before/after manifests are retained in ignored `backend/backups/`.

## Tables and separate columns

| Table | Purpose |
| --- | --- |
| `api_events_event` | Existing canonical events: name, description, start/end, timezone, location, status, Zoom URL in separate columns. |
| `api_events_person` | Existing people: adds `first_name`; retains full_name, email, phone and job_title as separate columns. |
| `api_events_registration` | Existing event/person bookings: one per person per event; different events retain different bookings. |
| `api_events_eventsource` | New: each Eventbrite provider/account/event ID links to one canonical event. Retains source title, original master key and Zoom meeting ID. |
| `api_events_registrationsource` | New: preserves each external attendee ID, source booking/unique/dedupe keys and source booking state when duplicate registrations share one canonical booking. |
| `api_events_registrationreminder` | New: scheduled time, type, event occurrence, recipient, status, delivery time, provider message ID, attempts/error and claim fields. |

The extra registration-source table preserves the IDs from different accounts
instead of discarding them when the same person registers for the same event.
`raw_payload` remains optional provenance; ordinary fields are separate columns.
IDs and phone numbers are text, not numeric quantities.

## Identity rules

- Reuse the person identified by a trimmed, lower-case nonempty email. Without an
  email, use reviewed source identity rules; never merge unrelated people by name
  alone. Existing identity keys and records must be reconciled before importing.
- A database unique constraint on `(event_id, person_id)` prevents duplicate
  canonical bookings, even if a different source booking key is supplied.
- The same person in three different events has three bookings and up to six
  independent reminder records for those occurrences.
- Multiple accounts' source bookings can point at the same booking. The writer
  must verify that the source event and canonical booking refer to the same event.
- Event source identity is `(provider, source_account, source_event_id)`; source
  attendee identity is `(event_source_id, source_attendee_id)`.
- Preserve internal UUIDs when names or dates change. Do not derive canonical
  identity solely from the event title or start time. Events at the same time
  remain separate unless their source mappings are explicitly reconciled.
- Existing operational status, notes, callbacks and audit history are independent
  from source booking state and must not be overwritten by source refreshes.

## Sheet-like read views

`workflow_events` and `workflow_attendees` are **read-only views**, not duplicate
storage. Both expose individual columns. The attendee view joins person/event
information so the person appears once for each different event, as in the sheet.

Example reads for a future Postgres node:

```sql
SELECT * FROM public.workflow_events ORDER BY start_at, event_id;
SELECT * FROM public.workflow_attendees ORDER BY start_at, attendee_name, registration_id;
```

The attendee view exposes `registration_id`, `person_id`, `event_id`, source IDs,
`attendee_name`, `first_name`, `attendee_email`, `phone`, `job_title`,
`booking_status`, `source_account`, `zoom_link`, `booking_key`, separate London
`event_date`/`event_time`, operational intent/attendance and `day_before_sent` /
`two_hours_sent`. Source keys are preserved in the source tables, not reused as
canonical UUIDs. Sent flags apply only to the current event start instant.

## Reminder semantics and later workflow work

- `day_before` means the previous London calendar day, matching the exported
  workflow. It does not automatically mean exactly 24 hours before the event.
- `two_hours` is eligible during the last two hours before start, matching the
  current workflow. Due times and catch-up policy must be set by the future writer.
- Unique `(booking_id, reminder_type, event_start_at)` prevents duplicate reminder
  records for one booking/occurrence/type. Rescheduling preserves prior delivery
  history; explicitly cancel old unsent jobs and schedule the new occurrence.
- Import a legacy `Yes` as `status='sent', imported_sent=true`. Leave `sent_at`
  unknown if the sheet has no send timestamp; never invent one. Do this before
  enabling the new sender so old messages are not resent.
- Delivery states: pending, processing, sent, failed, cancelled, unknown.
  Processing requires a claim timestamp/token. Workers must atomically claim
  eligible reminders, skip cancellations/invalid emails/missing required links,
  and record provider results. Claim fields alone do not implement a worker.
- Gmail and PostgreSQL cannot share one transaction. A crash after sending but
  before recording success needs reconciliation (`unknown`), not blind retry.
  The schema does not claim exactly-once email delivery.

## Cutover boundary

Apply through Django migrations `0003_workflow_storage` and
`0004_workflow_views`. The latter creates PostgreSQL-only read views; isolated
SQLite tests validate models/constraints, not those view definitions.

The future ingestion service must write people, registrations, source aliases
and missing default operational status together in a transaction. Django model
defaults and `save()` hooks do not run for a raw n8n SQL insert. An authenticated,
restricted ingestion endpoint and reminder-claim endpoints still need to be built;
the existing browser-session API is not an n8n service-auth integration.

The existing Sheets importer remains disabled in Neon. It has not been adapted
to the new aliases or reminders; a duplicate pair is now rejected and rolled back
rather than silently retained. Do not enable it as the new workflow writer.

No CSV data, old reminder flags, accounts or Supabase history were imported in
this schema-only step. Review and reconcile those exports before enabling writes
or reminders. Keep the original workflow and Sheets available for rollback.
