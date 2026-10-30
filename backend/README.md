# Events Django backend

On 30 October 2026, the requested Eventbrite workflow storage extensions were
applied to Neon: three source/reminder tables, a separate first-name column,
per-event registration uniqueness, and two read-only Sheet-like views. See
[WORKFLOW_DATABASE.md](WORKFLOW_DATABASE.md) for table names, column mappings,
verification and the remaining n8n/data-import cutover work. No workflow or
authentication provider was switched.

The existing Neon connection is retained. This stage adds Django models and a
versioned REST API without changing the React app or its Supabase authentication.

Read [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) for the source inventory, schema,
API contract, account migration strategy and staged frontend integration.
Read [SCHEMA_REVIEW.md](SCHEMA_REVIEW.md) for the exact pending migration list
and proposed table names. On 23 October 2026, the owner approved applying the
reviewed schema to Neon: all 21 migrations succeeded and 21 tables were verified.
See [MIGRATION_EXECUTION.md](MIGRATION_EXECUTION.md) for the backup and result.
No source data has been imported and no authentication provider was switched.

## Local validation without touching Neon

From backend/ in PowerShell:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pip check
.\venv\Scripts\python.exe manage.py check
.\venv\Scripts\python.exe manage.py makemigrations --check --dry-run --settings=config.test_settings
.\venv\Scripts\python.exe manage.py test accounts api_events --settings=config.test_settings --noinput
```

The test settings replace DATABASE_URL before importing the application settings,
use an in-memory SQLite database, local test mail and synthetic fixtures, and
never send email or contact Supabase/Sheets. PostgreSQL concurrency and live
provider behavior still need separate staging verification.

manage.py blocks tests against the configured PostgreSQL database. It also
blocks live migration execution by default. Do not bypass that guard without
the owner's explicit approval. No application data export or credential belongs
in this repository. backend/.env remains ignored by the root .gitignore.

## Staged configuration

The existing backend/.env has not been edited by this implementation.

| Setting | Purpose/default |
| --- | --- |
| DATABASE_URL | Existing Neon connection; read securely; TLS required. |
| DJANGO_API_ENABLED | false: /api/v1/ returns 503 until schema/setup approval. |
| SHEETS_SYNC_ENABLED | false: no scheduled or automatic source import. |
| DJANGO_DEBUG | true for local development; set false outside development. |
| DJANGO_SECRET_KEY | Required outside DEBUG; supply a private random value. |
| DJANGO_ALLOWED_HOSTS | Explicit server hosts; defaults to loopback hosts. |
| FRONTEND_ORIGINS | Exact CORS/CSRF origins; local defaults use port 8080. |
| FRONTEND_BASE_URL | Approved origin for reset links; local default port 8080. |
| PASSWORD_RESET_EMAIL_ENABLED | false until mail delivery and frontend reset handling are ready. |
| SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, DEFAULT_FROM_EMAIL | Configure server-side reset mail; TLS enabled. Never use a console mail backend for real reset tokens. |
| GOOGLE_SHEETS_ACCESS_TOKEN | Optional server-side credential with spreadsheets.readonly scope. |
| LOVABLE_API_KEY, GOOGLE_SHEETS_API_KEY | Alternative existing gateway connection, server-side only. |

Use a same-site HTTPS deployment for the frontend and API. Sessions use HttpOnly
cookies and SameSite=Lax, and secure cookies outside DEBUG. Do not mix localhost
and 127.0.0.1 during local browser testing. Production rate limits need a shared
cache and reverse-proxy limits; the included DRF throttle uses Django's local
cache by default.

## API request examples for staging

Paths start at /api/v1/. Authenticate through auth/login/ after obtaining a CSRF
token from auth/csrf/. POST/PATCH requests use JSON, the session cookie and
X-CSRFToken. Login rotates the CSRF token, so request a fresh token afterward.
Successful login returns redirect_to: /dashboard. Registration creates Staff,
never grants Admin based on request fields, and does not implicitly sign in.

Examples of authenticated action bodies:

```json
{"intent": "confirmed", "note": "Confirmed by phone", "expected_version": 0}
```

POST registrations/{id}/intent/; valid intents are not_contacted, confirmed,
declined, maybe, no_answer, call_back and cancelled.

```json
{"attendance": "attended", "expected_version": 1}
```

POST registrations/{id}/attendance/; valid values are unknown, attended and
absent. POST registrations/{id}/undo/ restores the preceding operational state
and retains audit history. A stale expected_version returns 409 without writing.
The version is optional for compatibility, but the new frontend adapter should
always send it for individual actions.

List endpoints return count, next, previous and results. All records with
historical relationships use protected FKs; the API exposes no hard deletion.
Master-data and user writes require Admin. Active Staff can update operational
intent/attendance, notes and callbacks. Notes can be edited by their author or
Admin, with an audit record. Actor IDs are derived from the session.

Google sign-in stays with Supabase. The new auth/config/ explicitly reports
google_oauth_configured=false. A Google client, callback configuration and tested
OIDC adapter are prerequisites for switching providers; there is no fake Django
Google endpoint or email-only account linking.

## Files changed in this stage

Existing files updated:

- requirements.txt: add Django REST Framework and django-cors-headers.
- config/settings.py: staged API, custom user, session/CSRF/CORS and mail settings.
- config/urls.py: mount the versioned API.
- manage.py: guard against unapproved PostgreSQL migrations and test databases.
- api_events/models.py: domain models and preservation constraints.
- api_events/views.py: REST resources, reports and source preview/sync endpoints.
- api_events/tests.py: operational, permission and source-import regression tests.

New files:

- accounts/__init__.py, apps.py, admin.py, models.py, serializers.py, views.py,
  urls.py, tests.py, migrations/__init__.py and migrations/0001_initial.py.
- api_events/permissions.py, middleware.py, serializers.py, services.py,
  sync.py and urls.py.
- api_events/migrations/0001_initial.py and
  0002_person_person_email_ci_unique.py.
- config/test_settings.py.
- README.md, INTEGRATION_PLAN.md and SCHEMA_REVIEW.md.

All 128 existing frontend files were checked against the pre-change SHA-256
snapshot: no frontend file changed and no frontend file was added. The existing
backend/.env and root .gitignore were not edited.
