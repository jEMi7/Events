# Event Attendance Hub

An operations tool for staff who call event registrants, record confirmation outcomes,
schedule call backs and track actual attendance. British English throughout.

## How the data works

There are two kinds of data, kept strictly apart:

1. **Source data (read only).** Imported from the Google Sheet tabs
   `Upcoming_Events_Raw` and `Upcoming_Attendees_Raw`. The app never writes to the
   spreadsheet, and no other tabs are read.
2. **Operational data (owned by the team).** Attendance intent, actual attendance,
   notes, call backs and the activity log live only in the app database. A sync
   inserts and updates source rows and creates missing operational rows, but never
   overwrites or deletes anything staff have recorded.

### Event identity

Events are unique on `master_event_key`, canonicalised to the event's start instant.
Events sharing a start date and time are treated as one logical event even when the
source IDs or names differ. Eventbrite event IDs are stored for traceability only.

### People and registrations

People are modelled separately from registrations. A person's `identity_key` prefers the
normalised email address, then the source attendee ID, then a name/phone composite, so one
person can hold many registrations across events.

### Header mapping

Column headers are matched flexibly (case and punctuation insensitive) through
`src/lib/sheet-mapping.ts`, with per-tab overrides in the `header_mappings` table.
Anything unmapped is preserved in each row's `raw_payload`. Unmapped headers are
reported on each sync run.

## Google Sheets connector authorisation

The sync reads the spreadsheet through the Lovable connector gateway, using the
workspace Google Sheets connection. It needs two environment values on the server:
`LOVABLE_API_KEY` and `GOOGLE_SHEETS_API_KEY` (both provided when the connection is
linked to the project).

If the connection is missing or unauthorised, Admin settings shows a **Not connected**
state and the sync fails with an explicit message — it never reports a false success.

The spreadsheet ID and both tab names are stored in `app_settings` under the
`source_spreadsheet` key, so they can be changed without a code release.

## Sync

Admin settings offers a manual **Sync now** action. Every run writes a `sync_runs`
record with status, row counts, unmapped headers and any error message, and the page
shows the last successful refresh. The sync is idempotent: repeat runs upsert on
`master_event_key`, `identity_key` and `booking_key`.

Scheduled syncing can be layered on later by calling the same logic from a scheduled job.

## Roles

Authentication uses email/password plus Google sign-in. The first account becomes an
**Admin**; later accounts are **Staff**.

- Admins: source settings, syncing, plus everything staff can do.
- Staff: events, attendees, notes, call backs and reports.

Row level security is enabled on every table, with roles held in a separate
`user_roles` table and checked through the `has_role` function.

## Screens

- **Dashboard** — KPIs, next-event spotlight, funnel and workload charts, today's queue, activity.
- **Events** — searchable, sortable list (cards on mobile, table on desktop).
- **Event detail** — KPI strip, attendee table, filters, bulk actions, attendee drawer.
- **People** — search across names, emails and phones with a full profile drawer.
- **Call backs** — Overdue, Today, Upcoming, Completed with complete and reschedule.
- **Reports** — event comparison and funnel figures from saved data only.
- **Admin** — source connection, mapping, manual sync, run history.

## Local development

```bash
bun install
bun run dev
```
