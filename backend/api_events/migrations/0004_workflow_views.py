"""Read-only, column-based equivalents of the two Sheets tabs (PostgreSQL)."""
from django.db import migrations


CREATE_SQL = """
CREATE VIEW public.workflow_events AS
SELECT e.id AS event_id, e.master_event_key, e.source_event_id,
       e.event_name, e.description, e.start_at, e.end_at, e.timezone,
       e.location, e.status, e.meeting_url AS zoom_link,
       e.created_at, e.updated_at, e.last_synced_at
FROM public.api_events_event e OFFSET 0;

CREATE VIEW public.workflow_attendees AS
SELECT r.id AS registration_id, e.id AS event_id, p.id AS person_id,
       e.master_event_key, e.event_name, e.start_at, e.end_at,
       COALESCE(tz.name, 'Europe/London') AS timezone,
       (e.start_at AT TIME ZONE COALESCE(tz.name, 'Europe/London'))::date AS event_date,
       (e.start_at AT TIME ZONE COALESCE(tz.name, 'Europe/London'))::time AS event_time,
       r.source_event_id, r.source_attendee_id AS attendee_id,
       p.full_name AS attendee_name, p.first_name, p.email AS attendee_email,
       p.phone, p.job_title, r.booking_status, r.source_account,
       COALESCE(NULLIF(r.meeting_url, ''), e.meeting_url) AS zoom_link,
       r.booking_key, s.attendance_intent, s.actual_attendance,
       EXISTS (SELECT 1 FROM public.api_events_registrationreminder m
               WHERE m.booking_id=r.id AND m.event_start_at=e.start_at
                 AND m.reminder_type='day_before' AND m.status='sent') AS day_before_sent,
       EXISTS (SELECT 1 FROM public.api_events_registrationreminder m
               WHERE m.booking_id=r.id AND m.event_start_at=e.start_at
                 AND m.reminder_type='two_hours' AND m.status='sent') AS two_hours_sent,
       r.created_at, r.updated_at, r.last_synced_at
FROM public.api_events_registration r
JOIN public.api_events_event e ON e.id=r.event_id
JOIN public.api_events_person p ON p.id=r.person_id
LEFT JOIN public.api_events_operationalstatus s ON s.booking_id=r.id
LEFT JOIN pg_catalog.pg_timezone_names tz ON tz.name=e.timezone;

COMMENT ON VIEW public.workflow_events IS
  'Read-only workflow projection. Write through the reviewed Django ingestion service; identity is event_id, not title/time.';
COMMENT ON VIEW public.workflow_attendees IS
  'One row per person/event registration, with separate contact columns. Sent flags apply to the current event occurrence. Read-only integration contract.';
"""


def create_views(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(CREATE_SQL)


def drop_views(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('DROP VIEW public.workflow_attendees; DROP VIEW public.workflow_events;')


class Migration(migrations.Migration):
    dependencies = [('api_events', '0003_workflow_storage')]
    operations = [migrations.RunPython(create_views, drop_views)]
