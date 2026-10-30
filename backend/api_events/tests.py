from datetime import timedelta
from unittest.mock import patch
import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import ActivityLog, AppSetting, CallbackTask, ContactNote, Event, HeaderMapping, OperationalStatus, Person, Registration, SyncRun
from . import services, sync

User = get_user_model()


class OperationsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user('admin@example.test', 'Safe-Password-234!', full_name='Admin', role='admin')
        cls.staff = User.objects.create_user('staff@example.test', 'Safe-Password-234!', full_name='Staff')
        cls.other_staff = User.objects.create_user('other@example.test', 'Safe-Password-234!', full_name='Other Staff')
        cls.event = Event.objects.create(master_event_key='2026-11-01T12:00:00.000Z', event_name='Open Day', start_at=timezone.now() + timedelta(days=2))
        cls.person = Person.objects.create(identity_key='email:person@example.test', full_name='Attendee', email='person@example.test')
        cls.booking = Registration.objects.create(booking_key='booking-one', event=cls.event, person=cls.person)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def test_anonymous_cannot_access_data(self):
        self.client.force_authenticate(None)
        for endpoint in ['events', 'people', 'registrations', 'attendance', 'notes', 'follow-ups', 'dashboard', 'reports']:
            self.assertEqual(self.client.get(f'/api/v1/{endpoint}/').status_code, 403)

    def test_staff_read_and_admin_master_write_permissions(self):
        self.assertEqual(self.client.get('/api/v1/events/').status_code, 200)
        payload = {'master_event_key': 'new-key', 'event_name': 'New Event'}
        self.assertEqual(self.client.post('/api/v1/events/', payload).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post('/api/v1/events/', payload).status_code, 201)
        self.assertEqual(self.client.delete(f'/api/v1/events/{self.event.pk}/').status_code, 405)

    def test_one_person_has_multiple_events_and_status_rows_are_created(self):
        event = Event.objects.create(master_event_key='second-key', event_name='Second')
        Registration.objects.create(booking_key='booking-two', event=event, person=self.person)
        self.assertEqual(Person.objects.count(), 1)
        self.assertEqual(self.person.registrations.count(), 2)
        self.assertEqual(OperationalStatus.objects.count(), 2)

    def test_person_email_deduplication(self):
        self.client.force_authenticate(self.admin)
        result = self.client.post('/api/v1/people/', {'email': 'PERSON@example.test', 'full_name': 'Duplicate'})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(Person.objects.count(), 1)

    def test_imported_legacy_audit_without_snapshot_can_be_undone(self):
        state = OperationalStatus.objects.get(booking=self.booking)
        state.attendance_intent = 'declined'
        state.save()
        ActivityLog.objects.create(booking=self.booking, action='intent_updated', detail={'previous': 'confirmed', 'previous_state': None})
        result = self.client.post(f'/api/v1/registrations/{self.booking.pk}/undo/')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['attendance_intent'], 'confirmed')

    def test_registration_relationships_cannot_be_rewritten(self):
        self.client.force_authenticate(self.admin)
        event = Event.objects.create(master_event_key='second-key', event_name='Second')
        result = self.client.patch(f'/api/v1/registrations/{self.booking.pk}/', {'event': str(event.pk)})
        self.assertEqual(result.status_code, 400)

    def test_intent_and_audit_are_atomic_and_undo_clears_contact_stamp(self):
        url = f'/api/v1/registrations/{self.booking.pk}/'
        result = self.client.post(url+'intent/', {'intent': 'confirmed', 'note': 'Confirmed by phone', 'expected_version': 0})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(ContactNote.objects.count(), 1)
        self.assertEqual(ActivityLog.objects.count(), 1)
        self.assertEqual(result.data['attendance_intent'], 'confirmed')
        self.assertEqual(self.client.post(url+'undo/', {'expected_version': 1}).status_code, 200)
        state = OperationalStatus.objects.get(booking=self.booking)
        self.assertEqual(state.attendance_intent, 'not_contacted')
        self.assertIsNone(state.last_contacted_at)
        self.assertIsNone(state.last_contacted_by)
        self.assertEqual(self.client.post(url+'undo/', {}).status_code, 400)
        self.assertEqual(ContactNote.objects.count(), 1)  # Notes remain in history.

    def test_audit_failure_rolls_back_status_and_note(self):
        with patch('api_events.services.log', side_effect=RuntimeError('Synthetic failure')):
            with self.assertRaises(RuntimeError):
                services.set_intent(self.booking, self.staff, 'confirmed', note='Must roll back')
        self.assertEqual(OperationalStatus.objects.get(booking=self.booking).attendance_intent, 'not_contacted')
        self.assertEqual(ContactNote.objects.count(), 0)

    def test_stale_version_conflicts_without_changing_data(self):
        services.set_intent(self.booking, self.staff, 'confirmed')
        result = self.client.post(f'/api/v1/registrations/{self.booking.pk}/attendance/', {'attendance': 'attended', 'expected_version': 0})
        self.assertEqual(result.status_code, 409)
        self.assertEqual(OperationalStatus.objects.get(booking=self.booking).actual_attendance, 'unknown')

    def test_invalid_intent_does_not_write(self):
        result = self.client.post(f'/api/v1/registrations/{self.booking.pk}/intent/', {'intent': 'arbitrary'})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(ActivityLog.objects.count(), 0)

    def test_callback_schedule_and_undo_preserve_cancelled_history(self):
        task = services.schedule_callback(self.booking, self.staff, timezone.now() + timedelta(days=1))
        self.assertEqual(OperationalStatus.objects.get(booking=self.booking).attendance_intent, 'call_back')
        services.undo(self.booking, self.staff)
        task.refresh_from_db()
        self.assertEqual(task.status, 'cancelled')
        self.assertEqual(CallbackTask.objects.count(), 1)
        self.assertEqual(self.client.get('/api/v1/follow-ups/').data['count'], 0)

    def test_callback_completion_and_reschedule_can_be_undone(self):
        due = timezone.now() + timedelta(days=1)
        task = services.schedule_callback(self.booking, self.staff, due)
        services.change_callback(task, self.staff, 'reschedule', due_at=due + timedelta(days=1))
        services.undo(self.booking, self.staff)
        task.refresh_from_db()
        self.assertEqual(task.due_at, due)
        services.change_callback(task, self.staff, 'complete', intent='confirmed')
        services.undo(self.booking, self.staff)
        task.refresh_from_db()
        self.assertEqual(task.status, 'open')
        self.assertIsNone(task.completed_at)

    def test_note_scope_author_and_edit_permissions(self):
        result = self.client.post('/api/v1/notes/', {'booking': str(self.booking.pk), 'body': 'Call note', 'created_by': str(self.other_staff.pk)})
        self.assertEqual(result.status_code, 201)
        note = ContactNote.objects.get()
        self.assertEqual(note.created_by, self.staff)
        self.client.force_authenticate(self.other_staff)
        self.assertEqual(self.client.patch(f'/api/v1/notes/{note.pk}/', {'body': 'Changed'}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f'/api/v1/notes/{note.pk}/', {'body': 'Changed'}).status_code, 200)
        self.assertEqual(ActivityLog.objects.filter(action='note_updated').count(), 1)

    def test_note_rejects_mismatched_person(self):
        other = Person.objects.create(identity_key='composite:other|', full_name='Other')
        result = self.client.post('/api/v1/notes/', {'booking': str(self.booking.pk), 'person': str(other.pk), 'body': 'Wrong scope'})
        self.assertEqual(result.status_code, 400)

    def test_bulk_missing_id_does_not_partially_write(self):
        result = self.client.post('/api/v1/registrations/bulk-intent/', {'booking_ids': [str(self.booking.pk), str(uuid.uuid4())], 'intent': 'confirmed'}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertEqual(ActivityLog.objects.count(), 0)

    def test_bulk_late_conflict_rolls_back_earlier_writes(self):
        other = Person.objects.create(identity_key='email:other@example.test', email='other@example.test')
        second = Registration.objects.create(booking_key='second', event=self.event, person=other)
        ids = sorted([self.booking.pk, second.pk])
        OperationalStatus.objects.filter(booking_id=ids[-1]).update(version=1)
        result = self.client.post('/api/v1/registrations/bulk-attendance/', {'booking_ids': [str(value) for value in ids], 'attendance': 'attended', 'expected_version': 0}, format='json')
        self.assertEqual(result.status_code, 409)
        self.assertEqual(ActivityLog.objects.count(), 0)
        self.assertFalse(OperationalStatus.objects.filter(actual_attendance='attended').exists())

    def test_dashboard_and_report_rates_match_frontend(self):
        services.set_intent(self.booking, self.staff, 'confirmed')
        services.set_attendance(self.booking, self.staff, 'attended')
        result = self.client.get('/api/v1/dashboard/')
        self.assertEqual(result.data['overall']['booked'], 1)
        self.assertEqual(result.data['overall']['confirmationRate'], 100)
        self.assertEqual(result.data['overall']['showUpRate'], 100)
        report = self.client.get('/api/v1/reports/?range=7')
        self.assertEqual(len(report.data['rows']), 1)
        self.assertEqual(self.client.get('/api/v1/reports/?range=invalid').status_code, 400)

    def test_registration_representation_retains_nested_person_and_status(self):
        result = self.client.get(f'/api/v1/registrations/{self.booking.pk}/')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['person']['email'], self.person.email)
        self.assertEqual(result.data['status']['attendance_intent'], 'not_contacted')

    def test_source_admin_permissions_and_sync_gate(self):
        self.assertEqual(self.client.get('/api/v1/source/preview/').status_code, 403)
        self.client.force_authenticate(self.admin)
        with override_settings(SHEETS_SYNC_ENABLED=False):
            self.assertEqual(self.client.post('/api/v1/source/sync/').status_code, 503)

    def test_activity_history_is_read_only(self):
        services.set_intent(self.booking, self.staff, 'confirmed')
        row = ActivityLog.objects.first()
        self.assertEqual(self.client.delete(f'/api/v1/activities/{row.pk}/').status_code, 405)
        self.assertEqual(self.client.post('/api/v1/activities/', {'action': 'forged'}).status_code, 405)


class SourceImportTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user('admin@example.test', 'Safe-Password-234!', full_name='Admin', role='admin')
        self.source = {'spreadsheet_id': 'test-sheet', 'events_tab': 'Events', 'attendees_tab': 'Attendees'}
        self.tabs = {
            'Events': {'headers': ['Master Event Key', 'Event Name', 'Start Date', 'Extra Field'], 'rows': [['Day|2026-11-01T12:00:00Z', 'Open Day', '2026-11-01 13:00:00', 'preserve me']]},
            'Attendees': {'headers': ['Master Event Key', 'Attendee Email', 'Attendee Name', 'Attendee Unique Key', 'Zoom Link'], 'rows': [['2026-11-01T12:00:00Z', 'PERSON@example.test', 'Person', 'booking-1', 'https://example.test/meeting']]},
        }

    def test_repeated_sync_is_idempotent_and_never_overwrites_operational_data(self):
        sync.import_tabs(self.tabs, self.source, self.actor)
        booking = Registration.objects.get()
        services.set_intent(booking, self.actor, 'confirmed', note='Keep this note')
        services.set_attendance(booking, self.actor, 'attended')
        task = services.schedule_callback(booking, self.actor, timezone.now() + timedelta(days=1))
        before = services.snapshot(OperationalStatus.objects.get(booking=booking))
        history_count = ActivityLog.objects.count()
        self.tabs['Events']['rows'][0][1] = 'Changed Source Name'
        sync.import_tabs(self.tabs, self.source, self.actor)
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Person.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 1)
        self.assertEqual(Event.objects.get().event_name, 'Changed Source Name')
        self.assertEqual(Event.objects.get().raw_payload['Extra Field'], 'preserve me')
        self.assertEqual(services.snapshot(OperationalStatus.objects.get(booking=booking)), before)
        self.assertEqual(ContactNote.objects.count(), 1)
        self.assertEqual(ActivityLog.objects.count(), history_count)
        self.assertEqual(CallbackTask.objects.get().pk, task.pk)

    def test_same_person_can_register_for_second_event_without_duplicate_person(self):
        self.tabs['Attendees']['rows'].append(['2026-11-02T12:00:00Z', 'person@example.test', 'Person', 'booking-2', ''])
        sync.import_tabs(self.tabs, self.source, self.actor)
        self.assertEqual(Person.objects.count(), 1)
        self.assertEqual(Event.objects.count(), 2)
        self.assertEqual(Registration.objects.count(), 2)

    def test_conflicting_booking_key_rolls_back_source_changes(self):
        sync.import_tabs(self.tabs, self.source, self.actor)
        self.tabs['Events']['rows'][0][1] = 'Must roll back'
        self.tabs['Attendees']['rows'][0][1] = 'other@example.test'
        with self.assertRaises(Exception):
            sync.import_tabs(self.tabs, self.source, self.actor)
        self.assertEqual(Event.objects.get().event_name, 'Open Day')
        self.assertEqual(Person.objects.count(), 1)
        self.assertEqual(SyncRun.objects.filter(status='failed').count(), 1)

    def test_key_rules_preserve_legacy_identity_and_utc_grouping(self):
        self.assertEqual(sync.canonical_key('Some name|2026-11-01T12:00:00Z'), '2026-11-01T12:00:00.000Z')
        self.assertEqual(sync.person_key({'email': ' PERSON@example.test '}), 'email:person@example.test')
        self.assertEqual(sync.person_key({'source_attendee_id': 'abc'}), 'attendee:abc')
        self.assertEqual(sync.person_key({'full_name': ' Person ', 'phone': '+44 123'}), 'composite:person|44123')

    def test_legacy_header_override_is_preserved(self):
        HeaderMapping.objects.create(tab_name='Attendees', source_header='Attendee Unique Key', target_field='source_booking_key')
        sync.import_tabs(self.tabs, self.source, self.actor)
        self.assertEqual(Registration.objects.get().booking_key, 'booking-1')

    @patch.dict('os.environ', {'GOOGLE_SHEETS_ACCESS_TOKEN': 'synthetic-token'})
    def test_sheets_transport_only_uses_get(self):
        import json
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'valueRanges': [{'values': [['Header'], ['one']]}, {'values': [['Header'], ['two']]}]}).encode()
        with patch('api_events.sync.urlopen', return_value=response) as fetch:
            sync.fetch_tabs(self.source)
        request = fetch.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
