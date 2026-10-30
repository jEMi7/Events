# Approved Neon migration execution ? 23 October 2026

Status: completed successfully after explicit user approval.

## Target and approval

- User confirmed project Events and branch Events match the IDs below.
- Database: neondb; schema: public; TLS verified.
- Project ID: mute-bonus-74132374
- Branch ID: br-cold-bread-zazku3z3
- The reviewed 21-migration plan matched MIGRATION_PLAN.txt exactly before execution.
- Before execution: zero user tables across the connected database; zero public table/view/sequence objects.
- No existing table data was deleted or overwritten.

## Backup checkpoint

- Full custom-format logical backup: [backups/events-neondb-pre-migrate-20261023T091750Z.dump](backups/events-neondb-pre-migrate-20261023T091750Z.dump).
- Backup started (UTC): 2026-10-23T09:17:50.070867+00:00
- Backup finished (UTC): 2026-10-23T09:17:56.735451+00:00
- Backup size: 2080 bytes (the database had zero user tables).
- SHA-256: `ee3bbc4a8f7775a581f8ce2ac11eec60faece12eb0c1c6990569fbc1b6696ec4`
- PostgreSQL pg_dump/pg_restore 18.6 client binaries extracted to the temporary directory without installing a server. Official archive SHA-256 was verified.
- pg_dump ran read-only with credentials supplied only through the subprocess environment.
- pg_restore archive listing and complete offline SQL decoding passed; no live restore test or recovery operation was performed.
- The logical backup covers neondb, not other branch databases or cluster-level role definitions.
- The backup directory and execution artifacts are excluded from Git via backend/backups/ in the root .gitignore. Keep a secure off-device copy; a local file is not a Neon managed snapshot.

Client provenance: [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries), [EDB published checksum](https://github.com/EnterpriseDB/edb-installers/issues/746), [PostgreSQL pg_dump documentation](https://www.postgresql.org/docs/18/app-pgdump.html).

## Execution and verification

- Command: python manage.py migrate --noinput --no-color
- ALLOW_NEON_MIGRATIONS=1 was supplied only to that approved subprocess; backend/.env was not changed.
- Migration started (UTC): 2026-10-23T09:20:17.107007+00:00
- Migration finished (UTC): 2026-10-23T09:20:58.244127+00:00
- Verification (UTC): 2026-10-23T09:24:14.983382+00:00
- All 21 reviewed migrations succeeded, with no fake/reset/flush options.
- Final migrate --plan: No planned migration operations.
- Final table count: 21; applied migration records: 21; pending migrations: 0.
- Validated foreign keys: 29; all recorded constraints validated; critical unique indexes verified.
- Only django_migrations (21 rows), django_content_type (17 rows) and auth_permission (68 rows) have data. All remaining tables have zero rows.

## Tables created

| Table | Purpose | Rows after migration |
| --- | --- | ---: |
| `accounts_externalidentity` | External provider identity links for later account migration | 0 |
| `accounts_user` | User accounts, Django password hashes, Admin/Staff role and account status | 0 |
| `accounts_user_groups` | User-to-Django-group membership | 0 |
| `accounts_user_user_permissions` | User-specific Django permissions | 0 |
| `api_events_activitylog` | Calls, outcomes, changes and audit/undo history | 0 |
| `api_events_appsetting` | Source spreadsheet and application settings | 0 |
| `api_events_callbacktask` | Callbacks, follow-ups, owners, due dates and completion | 0 |
| `api_events_contactnote` | Staff notes scoped to attendees, events and bookings | 0 |
| `api_events_event` | Event names, dates, location, source IDs and metadata | 0 |
| `api_events_headermapping` | Google Sheets header mappings | 0 |
| `api_events_operationalstatus` | Confirmation intent, actual attendance, contact stamps and assignment | 0 |
| `api_events_person` | Reusable attendee details and deduplicated identity | 0 |
| `api_events_registration` | Bookings linking attendees to events | 0 |
| `api_events_syncrun` | Google Sheets sync run history, counts and errors | 0 |
| `auth_group` | Django permission groups | 0 |
| `auth_group_permissions` | Permissions assigned to groups | 0 |
| `auth_permission` | Standard Django permission definitions | 68 |
| `django_admin_log` | Django administration audit log | 0 |
| `django_content_type` | Django model metadata | 17 |
| `django_migrations` | Applied migration history | 21 |
| `django_session` | Django server-side sessions | 0 |

## Scope preserved

- No Supabase data was imported, altered or synchronized.
- No accounts, passwords, Admin users, bookings, attendees or event records were created.
- No frontend, authentication implementation/configuration, .env, model, migration or API code was modified.
- DJANGO_API_ENABLED and SHEETS_SYNC_ENABLED remain false. The frontend still uses its existing provider.
- No new database or Neon branch was created.

## Files changed in the approved execution stage

- Root .gitignore: exclude backend/backups/.
- backend/MIGRATION_EXECUTION.md: this result and table-purpose summary.
- backend/SCHEMA_REVIEW.md, INTEGRATION_PLAN.md and README.md: record completed schema execution while leaving data migration and provider cutover pending.
- Local ignored backend/backups/ contains the dump, manifest, TOC, offline SQL decoding, execution log and verification record.
- The original MIGRATION_PLAN.txt is retained unchanged as the approved pre-migration plan.

Do not execute the decoded backup SQL as cleanup or run migrations to zero automatically. Recovery or a later data import requires its own reviewed scope and approval.
