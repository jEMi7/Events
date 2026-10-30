# Events backend integration and approval plan

Status: backend code implemented and locally tested. The owner approved schema
execution on 23 October 2026: all 21 reviewed migrations succeeded in Neon neondb,
with 21 tables verified. See [MIGRATION_EXECUTION.md](MIGRATION_EXECUTION.md).
No source import or provider cutover has been performed or authorized. Stages and
approval boundaries below describe the original plan; schema approval alone
does not authorize any later stage.

## Evidence inspected on 22 October 2026

Reviewed the React queries, mutations, analytics, auth hooks, protected routes,
Sheets mapper/importer, SQL history and live Supabase schema through read-only
metadata/count queries. Neon `neondb` has no public tables. Local SQL migrations
are not a reliable baseline by themselves: live tables also contain source_sheet,
person raw_payload/source_attendee_id/last_synced_at, and activity previous_value/
next_value. These fields must survive the transfer.

| Source | Records to preserve |
| --- | ---: |
| auth.users / auth.identities | 10 / 10 (8 email, 2 Google) |
| profiles / user_roles | 9 / 7 (1 admin, 6 staff) |
| events / people / event_bookings | 16 / 129 / 137 |
| attendee_operational_statuses | 137 |
| contact_notes / callback_tasks / activity_log | 5 / 4 / 106 |
| sync_runs / header_mappings / app_settings | 3779 / 22 / 2 |

One auth user lacks a profile; two profiles lack role rows. Preserve all of them
in a reconciliation report. Never infer admin from profiles.role or silently
grant permissions to unassigned users. No duplicate nonempty person emails or
repeated event/person registration pairs were found at inspection time. Counts
are a point-in-time inventory, not an export or a backup.

## Proposed database schema

Use new, namespaced Django tables in the existing database. Do not manage or
rename Supabase's tables in place. Preserve original UUIDs during a later import.

| Model | Fields and relationships |
| --- | --- |
| accounts.User | UUID PK; unique case-insensitive email; full_name; Django password hash; admin/staff role; active/pending/suspended status; is_active, is_staff, is_superuser; last_login; created_at, updated_at; Django groups/permissions. |
| accounts.ExternalIdentity | UUID; user FK PROTECT; provider and subject, unique together; retains Supabase UUID and later Google subject; no access tokens or plaintext passwords. |
| Event | UUID; unique master_event_key; source_event_id; event_name; description; location; start_at/end_at; timezone; source status text; meeting_url; source_sheet; raw_payload; data_origin; first_seen_at, last_synced_at, created_at, updated_at. |
| Person | UUID; unique identity_key; full_name; email (case-insensitive unique when nonempty); indexed email_normalised; phone; job_title; source_attendee_id; raw_payload; data_origin; last_synced_at; timestamps. Email identity uses trimmed lowercase email; no-email identity follows the existing attendee/composite fallback. |
| Registration | UUID; unique booking_key; Event and Person FKs PROTECT; booking_status; booked_at (nullable when unknown); source_event_id, source_attendee_id, source_account, source_sheet; meeting_url; raw_payload; data_origin; first_seen_at, last_synced_at, timestamps. Do not enforce a new event/person uniqueness rule: distinct real source booking keys must be preserved. |
| OperationalStatus | One-to-one Registration (booking_id); attendance_intent; actual_attendance; last_contacted_at/by; callback_at; assigned_to; timestamps and concurrency version. Separate from source-owned registration metadata. |
| ContactNote | UUID; booking/person/event scope; body; author; created_at. Preserve notes; allow edits by the author or Admin and audit edits. No API hard deletion. |
| CallbackTask | UUID; booking; due_at; owner; open/completed/cancelled status; note; completed_at/by; created_by; timestamps. Undo cancels created tasks instead of deleting history. |
| ActivityLog | UUID; booking/person/event/actor links; action; detail (including previous_state); previous_value; next_value; note; created_at. Append-only API. |
| SyncRun | UUID; source; running/success/succeeded/failed/connection_required state; all existing counters; detail; error_message; triggered_by; start/finish times. |
| AppSetting / HeaderMapping | Existing JSON settings and per-tab source-header overrides; unique tab/header; Admin-managed. |

FK protection and APIs without destroy operations prevent incidental data loss.
Users referenced in history are retained and disabled instead of deleted.
Attendees are not staff accounts: a Person can register for many Events.
Existing event grouping by canonical UTC start instant is retained for Sheets
imports, even if different source accounts use different event names or IDs.

## Versioned API contract: /api/v1/

All operational endpoints require an active Django session and an assigned role.
Admin may manage source/master data and users. Staff may read master data and
record intent, attendance, notes and follow-ups, matching the current application.

| Endpoint | Methods and behavior |
| --- | --- |
| auth/csrf/, auth/config/ | GET CSRF token and staged provider availability. |
| auth/register/, auth/login/, auth/logout/ | POST; CSRF required even before login. New accounts are Staff; existing Admin roles are imported explicitly. |
| auth/me/ | GET current user, roles and account status. |
| auth/password-reset/, auth/password-reset/confirm/ | POST; generic request response, Django signed expiring token, validated new password, no token in API responses/logs. |
| users/ | Admin list/retrieve/update role and status; prevent removing the last active Admin. |
| events/, people/, registrations/ | GET list/detail; POST/PATCH Admin only; paginated search/filtering; no hard delete. Registration responses retain person and status nesting. |
| registrations/{id}/intent/, attendance/, undo/ | POST atomic staff actions with version checks; status, notes, callbacks and audit written together. |
| registrations/bulk-intent/, bulk-attendance/ | POST bounded batch actions, all-or-nothing transactions. |
| attendance/, call-outcomes/, activities/ | GET saved state/history; mutations use the registration action endpoints. |
| notes/ | GET/POST/PATCH; actor and relationships derived server-side. |
| follow-ups/ | GET/POST; POST {id}/complete/, reschedule/, cancel/; ownership validated. |
| dashboard/, reports/ | GET computed totals/rates; range and event filters mirror frontend analytics; no stale statistics table. |
| source/status/, source/preview/, source/sync/, sync-runs/, header-mappings/, settings/ | Read-only Sheets fetch/preview; Admin sync behind a disabled gate; import only source-owned fields, plus missing default status rows. No Google Sheets write operation. |

Authentication is session/cookie based (HttpOnly, SameSite, secure outside DEBUG).
All unsafe API calls enforce CSRF, including login/signup/reset. CORS uses an
explicit environment allowlist with credential support, never wildcard origins.
Use one site/reverse proxy for production frontend and API. Auth throttles are
implemented locally; production must configure a shared cache and edge limits.

## Safe implementation stages

1. Write the models, initial migration files, REST APIs and source-import services.
   Keep the new API disabled by default until the schema is approved/applied.
2. Run checks and meaningful auth/CSRF/role/sync/undo tests using only explicitly
   separate in-memory SQLite test settings. Never let tests target DATABASE_URL.
3. Review generated migrations and table names with the owner. Only after approval
   run schema migrations against Neon. Do not import or cut over yet.
4. Obtain a restricted Supabase export through an approved secure channel: users,
   identities, profiles, roles, all 12 public tables, timestamps and raw JSON.
   Reconcile missing roles/profiles; preserve UUIDs and every FK; compare counts,
   duplicates and canonical keys. Avoid converting the SQL history into a replay.
5. Import a copy on a disposable PostgreSQL database first. Never dedupe by name
   alone, delete unobserved rows, or overwrite operational fields from Sheets.
   Validate and quarantine conflicting keys before any real import. Require
   separate import approval and a fresh export/delta around the cutover window.
6. Stage the React transport adapter behind an explicit provider switch; leave
   the Supabase adapter and all UI/CSS untouched until approval. Compare read
   responses and perform staging end-to-end auth/actions tests first.
7. Approve a cutover window: pause the OLD sync writer, apply final deltas, verify
   counts and operational snapshots, then switch frontend auth/data transport and
   the cron target together. Do not run two active operational writers.
8. Retain Supabase and backups for rollback. If Django has received new writes,
   reconcile its delta before rollback rather than blindly switching providers.

## Account migration and Google configuration

Do not copy Supabase password hashes into Django as if they were Django hashes.
Default migration strategy: preserve user UUIDs and roles, set unusable Django
passwords, and send verified password-setup links via a configured mail provider.
Old sessions remain with Supabase until cutover, then users sign in again. A
temporary verified Supabase-token exchange could be separately reviewed, but no
unverified bearer token or email-only linking is accepted by this implementation.

Preserve the current Lovable/Supabase Google flow until replacement is tested.
Django Google OAuth requires a Google Cloud OAuth client ID/secret, exact HTTPS
callback URI(s), consent screen, and OIDC state/nonce/PKCE and signature/audience/
issuer checks (a maintained adapter such as django-allauth is recommended).
Link existing Google users by exported provider subject plus verified identity;
never automatically join users merely because an email string matches. No Google
client secrets, SMTP secrets or exports belong in source control or API responses.

The original "first account becomes Admin" behavior is not repeated on a public
empty Django signup endpoint: import the existing Admin before enabling signups,
or approve an explicit local createsuperuser bootstrap. This avoids an unaffiliated
first visitor acquiring Admin privileges during migration.

## Approval boundary

No production changes, Neon migrations, source imports, role reconciliation,
email dispatch, cron changes or authentication-provider switch are included in
the code-only implementation stage. The owner must approve the exact next step.
Google OAuth, SMTP delivery and production origins must be configured before
cutover; tests with local mail and mocked Sheets are not live provider verification.

## Verification completed

- 39 tests passed using in-memory SQLite, with real Django password hashing.
- Covered login/logout, registration, suspended accounts, CSRF on anonymous auth
  and authenticated writes, origin checks, CORS, reset expiry/replay, generic
  reset responses even on mail failure, and last-Admin protection.
- Covered role restrictions, read-only history, duplicate attendee rejection,
  immutable booking relationships, multi-event attendees, atomic audit/notes,
  stale-version conflicts, bulk rollback, callbacks and legacy undo snapshots.
- Covered dashboard/report formulas, idempotent source imports, conflicting-key
  rollback, legacy header mappings, raw JSON preservation and GET-only Sheets
  transport. Mail and Sheets tests use local doubles, not live services.
- Django system checks, dependency consistency and migration drift checks pass.
- A fresh Neon transaction used BEGIN READ ONLY, SELECTs and ROLLBACK only:
  database neondb, SELECT 1 successful, client-to-Neon TLS confirmed through
  libpq, zero public tables. No schema/data write occurred.
- The generated application migrations and all installed dependencies are
  listed in [SCHEMA_REVIEW.md](SCHEMA_REVIEW.md): 20 model tables plus the
  migration recorder, 21 pending Django/application migrations.

SQLite tests do not prove PostgreSQL row-lock behavior. An isolated PostgreSQL
staging exercise, secure export/import rehearsal, live email delivery, Google
OAuth and browser end-to-end tests remain required before cutover. The Django
reset API is implemented; its new reset-link parameters are deliberately not
connected to the existing Supabase frontend yet.

## Frontend integration sequence after approval

No frontend files are changed in this stage. Existing images, CSS, navigation,
queries, auth hooks, Google login and protected routes continue using Supabase.

1. Add a session transport adapter alongside the existing Supabase client.
   Use credentials: include; acquire the token from auth/csrf/ and send it as
   X-CSRFToken on unsafe requests. Refresh the token after login rotates it.
   Never persist the session cookie or reset token in localStorage. Configure
   frontend/API under one site with an HTTPS reverse proxy in production.
2. Compare paginated API reads against src/lib/queries.ts and domain.ts; retain
   nested person/status and source keys, normalize FK names at the adapter,
   fetch all pages where the current screens expect complete collections.
3. Replace src/lib/mutations.ts action implementations in staging only, keeping
   components and UI unchanged. Send expected_version for individual writes;
   refresh after a 409 conflict. Confirm the note/callback/undo workflow and
   computed dashboard/report totals against the exported source snapshot.
4. Stage use-auth.ts against Django sessions, including signup validation,
   generic reset-request results, new reset-link handling and post-login
   dashboard redirect. Do not silently fall back to Supabase after a Django
   mutation: two active writers would split operational records.
5. Preserve the existing Google flow until the Django OAuth adapter and identity
   migration are verified. Only then request explicit provider/cutover approval.
6. Review the existing public Sheets webhook/cron separately. Its replacement
   needs authenticated server-to-server scheduling and one active writer;
   the staged Django admin sync endpoint is not a drop-in public cron endpoint.
