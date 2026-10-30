# Neon schema review

Pre-execution review refreshed on 23 October 2026. The reviewed migrations were
subsequently applied after explicit approval on the same date. All 21 migrations
succeeded; 21 public tables now exist and no migrations are pending. See
[MIGRATION_EXECUTION.md](MIGRATION_EXECUTION.md) for the backup and verification.

The inspection and plan below preserve the pre-execution findings.

Connected database: `neondb`. Client-to-Neon TLS (libpq): `True`.
Existing public tables: 0.

## Verified connection and existing objects

Database-side Neon settings report:

| Identity | Actual value |
| --- | --- |
| Project ID | mute-bonus-74132374 |
| Branch ID | br-cold-bread-zazku3z3 |
| Endpoint ID | ep-wispy-firefly-zajug7qa |
| Database / current schema | neondb / public |

These IDs are identifiers, not credentials. PostgreSQL does not expose the
project/branch display names. The owner subsequently confirmed in Neon Console
that these IDs map to Events / Events before approving execution.
No Neon control-plane credentials were supplied or requested.

Read-only catalog queries found zero non-system tables across the connected
database and zero public tables, views, materialized views, foreign tables or
sequences. The connection role has CREATE and USAGE privileges on public.
There is no existing Django migration recorder or application table data to
alter. Other databases/branches and Supabase are outside this migration target.

## Readiness checks

- `python manage.py check`: no issues.
- `python manage.py makemigrations --check --dry-run --noinput
  --settings=config.test_settings`: no changes detected; no missing migration
  files were required. Test settings isolate this model-state check from Neon.
- `python manage.py migrate --plan`: completed against the configured Neon
  connection. The exact output is saved in [MIGRATION_PLAN.txt](MIGRATION_PLAN.txt).
- The plan was also captured within BEGIN READ ONLY / ROLLBACK; the public
  table count afterward remains zero. No schema or data migration was applied.
- Application migrations contain CreateModel and AddConstraint operations,
  with no custom RunSQL/RunPython data import or deletion.

All required model categories exist:

| Requirement | Django model(s) |
| --- | --- |
| Accounts, password hashes, roles, status, timestamps | accounts.User (Django AbstractUser; create_user uses set_password) |
| External identity preservation | accounts.ExternalIdentity |
| Events | api_events.Event |
| Attendees | api_events.Person |
| Event registrations/bookings | api_events.Registration |
| Attendance and confirmation status | api_events.OperationalStatus |
| Staff calls, outcomes, audit history | api_events.ActivityLog plus OperationalStatus.last_contacted_by/at |
| Callbacks/follow-ups | api_events.CallbackTask |
| Notes | api_events.ContactNote |
| Sheets sync history/config/header mapping | api_events.SyncRun, AppSetting, HeaderMapping |

Registration links one reusable Person to an Event; a Person can have many
registrations. Unique identity/booking keys and a case-insensitive unique index
for nonempty attendee emails protect against duplicates. Foreign keys protect
historical relationships. Dashboard/report statistics are computed from saved
records rather than requiring another statistics table.

## Tables proposed by the installed Django models

```text
accounts_externalidentity
accounts_user
accounts_user_groups
accounts_user_user_permissions
api_events_activitylog
api_events_appsetting
api_events_callbacktask
api_events_contactnote
api_events_event
api_events_headermapping
api_events_operationalstatus
api_events_person
api_events_registration
api_events_syncrun
auth_group
auth_group_permissions
auth_permission
django_admin_log
django_content_type
django_session
django_migrations (Django migration recorder)
```

## Pending migrations

- `contenttypes.0001_initial`
  - Create model ContentType
  - Alter unique_together for contenttype (1 constraint(s))
- `contenttypes.0002_remove_content_type_name`
  - Change Meta options on contenttype
  - Alter field name on contenttype
  - Raw Python operation
  - Remove field name from contenttype
- `auth.0001_initial`
  - Create model Permission
  - Create model Group
  - Create model User
- `auth.0002_alter_permission_name_max_length`
  - Alter field name on permission
- `auth.0003_alter_user_email_max_length`
  - Alter field email on user
- `auth.0004_alter_user_username_opts`
  - Alter field username on user
- `auth.0005_alter_user_last_login_null`
  - Alter field last_login on user
- `auth.0006_require_contenttypes_0002`
- `auth.0007_alter_validators_add_error_messages`
  - Alter field username on user
- `auth.0008_alter_user_username_max_length`
  - Alter field username on user
- `auth.0009_alter_user_last_name_max_length`
  - Alter field last_name on user
- `auth.0010_alter_group_name_max_length`
  - Alter field name on group
- `auth.0011_update_proxy_permissions`
  - Raw Python operation
- `auth.0012_alter_user_first_name_max_length`
  - Alter field first_name on user
- `accounts.0001_initial`
  - Create model User
  - Create model ExternalIdentity
  - Create constraint accounts_email_ci_unique on model user
  - Create constraint external_subject_unique on model externalidentity
- `admin.0001_initial`
  - Create model LogEntry
- `admin.0002_logentry_remove_auto_add`
  - Alter field action_time on logentry
- `admin.0003_logentry_add_action_flag_choices`
  - Alter field action_flag on logentry
- `api_events.0001_initial`
  - Create model Person
  - Create model AppSetting
  - Create model Event
  - Create model HeaderMapping
  - Create model Registration
  - Create model ActivityLog
  - Create model SyncRun
  - Create model OperationalStatus
  - Create model ContactNote
  - Create model CallbackTask
- `api_events.0002_person_person_email_ci_unique`
  - Create constraint person_email_ci_unique on model person
- `sessions.0001_initial`
  - Create model Session

## Approval scope

Create these new tables, indexes, constraints and standard Django permission/content-type metadata in the existing neondb database. Do not create another database, import source data, enable synchronization, bootstrap accounts or change frontend/authentication providers in this step.

The plan consists of 21 migrations and would result in 21 tables: 12 domain
model tables, two custom-user permission/group join tables, six Django support
tables and the migration recorder. AUTH_USER_MODEL is accounts.User, so the
historical auth migrations' "Create model User" entry does not create a second
auth_user account table. The built-in contenttypes RemoveField/RunPython entries
operate on the new Django metadata schema; they do not delete existing Events
records. Django's post_migrate hooks also insert standard content types and
permissions into the newly created metadata tables.

Review the exact application migration definitions in accounts/migrations/ and api_events/migrations/. Standard Django auth, contenttypes, admin and session migrations are required dependencies.

The local suite uses SQLite. PostgreSQL locking behavior, live email delivery and OAuth still require staging verification before frontend cutover.

## Recommended recovery checkpoint before execution

1. Confirm the project/branch IDs above in Neon Console and verify the intended
   Events branch's backup features, history window and root/child branch status.
2. Immediately before an approved migration, create a manual snapshot of the
   existing Events branch, if available on the account, named for example
   events-pre-initial-migrations-2026-10-23. Wait for completion and record its
   snapshot ID and UTC timestamp. No snapshot has been created in this review.
   See Neon's [snapshot API reference](https://api-docs.neon.tech/reference/createsnapshot).
3. Confirm a nonzero history window and record the UTC instant immediately before
   migration. A timestamp alone is not a backup: it is useful only while retained
   history is available. Retention depends on project settings and plan; no
   retention setting has been inspected or changed here. See
   [History window](https://neon.com/docs/postgres/backup-restore/history-window).
4. Instant restore requires a root branch and can overwrite schema/data across
   all databases on that branch. Do not use it as an automatic rollback or assume
   it is available on a child branch. Review the exact recovery target first:
   [Instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore).

No database, backup branch or snapshot was created, and no restoration operation
was performed. The existing Supabase production data should remain untouched;
its separate export/reconciliation remains a later approval stage.

## After explicit approval

Recheck the exact project/branch/database IDs and table inventory; stop if they
have changed. Confirm the recovery checkpoint, run the reviewed Django migration
plan without fake/reset/flush options, then verify recorded migration status,
expected tables, constraints and foreign keys. Confirm that application tables
are empty and only standard Django metadata has been initialized. Keep the API,
sync and provider-cutover gates unchanged. No frontend or authentication-provider
switch is included in schema approval.
