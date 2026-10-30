"""Read-only Sheets transport and idempotent source-metadata import.

Operational status, notes, callbacks and activity history are never updated here.
"""
import json
import os
import re
from datetime import datetime, timezone as dt_timezone
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import AppSetting, Event, HeaderMapping, Person, Registration, SyncRun

ISO_INSTANT = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z')
EVENT_ALIASES = {
    'source_event_id': ['event id', 'eventbrite event id', 'source event id'],
    'master_event_key': ['master event key', 'master key', 'event key'],
    'event_name': ['event name', 'name', 'title'],
    'description': ['description', 'summary'],
    'location': ['location', 'venue'],
    'start_at': ['start date', 'start', 'start date time', 'starts at'],
    'end_at': ['end time', 'end date', 'ends at'],
    'timezone': ['timezone', 'time zone', 'tz'],
    'status': ['status', 'event status'],
    'meeting_url': ['zoom link', 'meeting url', 'zoom url', 'join link', 'meeting link'],
}
ATTENDEE_ALIASES = {
    'source_event_id': ['event id', 'eventbrite event id'],
    'master_event_key': ['master event key', 'master key', 'event key'],
    'event_name': ['event name'], 'event_date': ['event date'], 'event_time': ['event time'],
    'source_attendee_id': ['attendee id', 'registration id', 'order id'],
    'full_name': ['attendee name', 'name', 'full name'],
    'email': ['attendee email', 'email', 'email address'],
    'phone': ['phone', 'phone number', 'mobile', 'telephone'],
    'job_title': ['job title', 'role', 'position'],
    'booking_status': ['status', 'booking status', 'attendee status'],
    'meeting_url': ['zoom link', 'meeting url', 'join link'],
    'source_account': ['source account', 'account', 'owner'],
    'booking_key': ['attendee unique key', 'unique key'],
    'booked_at': ['booking date', 'booked at', 'registration date'],
}


def normalise_header(value):
    return re.sub(r'[^a-z0-9]+', ' ', value.lower()).strip()


def parse_instant(value):
    if not value:
        return None
    match = ISO_INSTANT.search(value)
    try:
        parsed = datetime.fromisoformat(match.group() if match else value.strip())
        return parsed.replace(tzinfo=dt_timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt_timezone.utc)
    except (ValueError, TypeError):
        return None


def canonical_key(raw='', fallback=''):
    match = ISO_INSTANT.search(raw)
    instant = parse_instant(match.group()) if match else parse_instant(fallback)
    return instant.isoformat(timespec='milliseconds').replace('+00:00', 'Z') if instant else raw.strip().lower()


def person_key(fields):
    email = (fields.get('email') or '').strip().lower()
    if email and '@' in email:
        return f'email:{email}'
    if fields.get('source_attendee_id'):
        return f"attendee:{fields['source_attendee_id']}"
    name = (fields.get('full_name') or '').strip().lower()
    phone = re.sub(r'\D', '', fields.get('phone') or '')
    return f'composite:{name}|{phone}' if name or phone else ''


def mapped_rows(table, aliases, overrides=None):
    headers, rows = table.get('headers', []), table.get('rows', [])
    overrides = overrides or {}
    mapping, unmapped = {}, []
    for index, header in enumerate(headers):
        name = str(header).strip()
        field = overrides.get(name) or overrides.get(normalise_header(name))
        field = 'booking_key' if field == 'source_booking_key' else field
        if not field:
            field = next((key for key, values in aliases.items() if normalise_header(name) in values), None)
        if field:
            mapping[index] = field
        elif name:
            unmapped.append(name)
    output = []
    for row in rows:
        raw = {str(header).strip(): str(row[index]).strip() if index < len(row) and row[index] is not None else '' for index, header in enumerate(headers) if str(header).strip()}
        if any(raw.values()):
            fields = {field: raw[str(headers[index]).strip()] for index, field in mapping.items() if raw.get(str(headers[index]).strip())}
            output.append((fields, raw))
    return output, unmapped


def source_config():
    row = AppSetting.objects.filter(key='source_spreadsheet').first()
    source = row.value if row else {}
    return {'spreadsheet_id': source.get('spreadsheet_id', ''), 'events_tab': source.get('events_tab', 'Upcoming_Events_Raw'), 'attendees_tab': source.get('attendees_tab', 'Upcoming_Attendees_Raw')}


def source_connected():
    return bool(os.environ.get('GOOGLE_SHEETS_ACCESS_TOKEN') or (os.environ.get('LOVABLE_API_KEY') and os.environ.get('GOOGLE_SHEETS_API_KEY')))


def fetch_tabs(source):
    if not source.get('spreadsheet_id') or not source_connected():
        raise ValidationError('Configure a read-only Google Sheets connection and source spreadsheet before syncing.')
    tabs = [source['events_tab'], source['attendees_tab']]
    params = [('ranges', "'" + tab.replace("'", "''") + "'!A1:AZ20000") for tab in tabs]
    params += [('valueRenderOption', 'UNFORMATTED_VALUE'), ('dateTimeRenderOption', 'FORMATTED_STRING')]
    token = os.environ.get('GOOGLE_SHEETS_ACCESS_TOKEN')
    if token:
        gateway = 'https://sheets.googleapis.com/v4'
        headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
    else:
        gateway = 'https://connector-gateway.lovable.dev/google_sheets/v4'
        headers = {'Authorization': 'Bearer ' + os.environ['LOVABLE_API_KEY'], 'X-Connection-Api-Key': os.environ['GOOGLE_SHEETS_API_KEY'], 'Accept': 'application/json'}
    url = f"{gateway}/spreadsheets/{quote(source['spreadsheet_id'], safe='')}/values:batchGet?{urlencode(params)}"
    try:
        with urlopen(Request(url, headers=headers, method='GET'), timeout=20) as response:
            raw = response.read(20_000_001)
            if len(raw) > 20_000_000:
                raise ValueError('Response too large')
            payload = json.loads(raw)
    except Exception:
        raise ValidationError('Google Sheets read failed; verify source access and read-only credentials.') from None
    ranges = payload.get('valueRanges', [])
    if len(ranges) != 2:
        raise ValidationError('Both source tabs must be available.')
    result = {}
    for tab, value_range in zip(tabs, ranges):
        values = value_range.get('values', [])
        if not values or not values[0]:
            raise ValidationError('Both tabs must contain a header row.')
        result[tab] = {'headers': [str(h) for h in values[0]], 'rows': values[1:]}
    return result


def prepare(tabs, source):
    overrides = {}
    for row in HeaderMapping.objects.all():
        overrides.setdefault(row.tab_name, {})[row.source_header] = row.target_field
    events, unmapped_events = mapped_rows(tabs[source['events_tab']], EVENT_ALIASES, overrides.get(source['events_tab']))
    attendees, unmapped_attendees = mapped_rows(tabs[source['attendees_tab']], ATTENDEE_ALIASES, overrides.get(source['attendees_tab']))
    return events, attendees, {'unmapped_event_headers': unmapped_events, 'unmapped_attendee_headers': unmapped_attendees}


def import_tabs(tabs, source, actor):
    events, attendees, detail = prepare(tabs, source)
    run = SyncRun.objects.create(triggered_by=actor, events_read=len(events), attendees_read=len(attendees))
    counters = dict(events_upserted=0, people_upserted=0, bookings_upserted=0, skipped_rows=0)
    try:
        with transaction.atomic():
            now = timezone.now()
            meeting_by_key = {}
            for fields, _ in attendees:
                key = canonical_key(fields.get('master_event_key', ''), (fields.get('event_date', '') + ' ' + fields.get('event_time', '')).strip())
                if key and fields.get('meeting_url'):
                    meeting_by_key.setdefault(key, fields['meeting_url'])
            saved_events = {}
            for fields, raw in events:
                key = canonical_key(fields.get('master_event_key', ''), fields.get('start_at', ''))
                if not key or not fields.get('event_name'):
                    counters['skipped_rows'] += 1
                    continue
                start = parse_instant(key) or parse_instant(fields.get('start_at'))
                end, naive_start = parse_instant(fields.get('end_at')), parse_instant(fields.get('start_at'))
                if end and naive_start and parse_instant(key):
                    end -= naive_start - parse_instant(key)
                defaults = {name: fields.get(name, '') for name in ('source_event_id', 'event_name', 'description', 'location', 'timezone', 'status')}
                defaults.update(start_at=start, end_at=end, meeting_url=fields.get('meeting_url') or meeting_by_key.get(key, ''), raw_payload=raw, data_origin='google_sheets', last_synced_at=now, source_sheet=source['events_tab'])
                # Refuse invalid time ranges rather than commit a partial source import.
                if start and end and end < start:
                    raise ValidationError('Source event end precedes its start.')
                event, _ = Event.objects.update_or_create(master_event_key=key, defaults=defaults)
                saved_events[key] = event
            counters['events_upserted'] = len(saved_events)
            saved_people, saved_bookings = set(), set()
            for fields, raw in attendees:
                key = canonical_key(fields.get('master_event_key', ''), (fields.get('event_date', '') + ' ' + fields.get('event_time', '')).strip())
                identity = person_key(fields)
                if not key or not identity:
                    counters['skipped_rows'] += 1
                    continue
                event = saved_events.get(key) or Event.objects.filter(master_event_key=key).first()
                if event is None:
                    event = Event.objects.create(master_event_key=key, event_name=fields.get('event_name') or 'Untitled event', start_at=parse_instant(key), source_event_id=fields.get('source_event_id', ''), meeting_url=fields.get('meeting_url', ''), data_origin='google_sheets', last_synced_at=now, source_sheet=source['attendees_tab'])
                    saved_events[key] = event
                defaults = {name: fields[name] for name in ('full_name', 'email', 'phone', 'job_title', 'source_attendee_id') if fields.get(name)}
                defaults.update(raw_payload=raw, data_origin='google_sheets', last_synced_at=now)
                if 'email' in defaults:
                    defaults['email_normalised'] = defaults['email'].strip().lower()
                person, _ = Person.objects.update_or_create(identity_key=identity, defaults=defaults)
                saved_people.add(person.pk)
                booking_key = fields.get('booking_key', '').strip().lower() or f'{key}|{identity}'
                existing = Registration.objects.filter(booking_key=booking_key).first()
                if existing and (existing.event_id != event.pk or existing.person_id != person.pk):
                    raise ValidationError('A source booking key refers to conflicting event/person records. Reconcile it before syncing.')
                defaults = {name: fields.get(name, '') for name in ('booking_status', 'source_event_id', 'source_attendee_id', 'source_account', 'meeting_url')}
                defaults.update(event=event, person=person, raw_payload=raw, data_origin='google_sheets', last_synced_at=now, source_sheet=source['attendees_tab'])
                if fields.get('booked_at'):
                    defaults['booked_at'] = parse_instant(fields['booked_at'])
                booking, _ = Registration.objects.update_or_create(booking_key=booking_key, defaults=defaults)
                saved_bookings.add(booking.pk)
            counters.update(people_upserted=len(saved_people), bookings_upserted=len(saved_bookings))
            run.status, run.finished_at, run.detail = 'success', timezone.now(), detail
            for key, value in counters.items():
                setattr(run, key, value)
            run.save()
        return run
    except Exception:
        run.status, run.finished_at = 'failed', timezone.now()
        run.error_message = 'Source import failed and its changes were rolled back. Review source keys and formats.'
        run.detail = {**detail, 'rolled_back': True}
        run.save()
        raise ValidationError(run.error_message) from None
