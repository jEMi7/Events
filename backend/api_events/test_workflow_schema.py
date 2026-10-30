"""Schema guarantees; fixtures live only in the isolated test database."""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone

from .models import (
    Event, EventSource, Person, Registration, RegistrationReminder,
    RegistrationSource, OperationalStatus,
)


class WorkflowSchemaTests(TestCase):
    def setUp(self):
        self.start = timezone.now() + timedelta(days=5)
        self.person = Person.objects.create(
            identity_key='email:person@example.test', first_name='Alex',
            full_name='Alex Example', email='person@example.test', phone='07123456789',
        )
        self.event = Event.objects.create(master_event_key='event-one', event_name='Workshop', start_at=self.start)
        self.booking = Registration.objects.create(booking_key='booking-one', event=self.event, person=self.person)

    def reminder(self, **kwargs):
        values = dict(booking=self.booking, reminder_type='day_before',
                      event_start_at=self.start, due_at=self.start-timedelta(days=1))
        values.update(kwargs)
        return RegistrationReminder.objects.create(**values)

    def assert_rejected(self, action):
        with self.assertRaises(IntegrityError), transaction.atomic():
            action()

    def test_three_events_have_three_independent_bookings_and_reminders(self):
        bookings = [self.booking]
        for number in (2, 3):
            event = Event.objects.create(master_event_key=f'event-{number}', event_name='Workshop', start_at=self.start)
            bookings.append(Registration.objects.create(booking_key=f'booking-{number}', event=event, person=self.person))
        for booking in bookings:
            self.reminder(booking=booking)
            self.reminder(booking=booking, reminder_type='two_hours', due_at=self.start-timedelta(hours=2))
        self.assertEqual(Person.objects.count(), 1)
        self.assertEqual(Registration.objects.count(), 3)
        self.assertEqual(OperationalStatus.objects.count(), 3)
        self.assertEqual(RegistrationReminder.objects.count(), 6)

    def test_same_person_same_event_cannot_be_duplicated_by_new_source_key(self):
        self.assert_rejected(lambda: Registration.objects.create(booking_key='another-source-key', event=self.event, person=self.person))

    def test_source_aliases_preserve_two_accounts_without_second_reminder(self):
        for account, source_id in [('Mohamed', '123'), ('Student', '456')]:
            source = EventSource.objects.create(event=self.event, source_account=account, source_event_id=source_id)
            RegistrationSource.objects.create(booking=self.booking, event_source=source, source_attendee_id='789')
        self.reminder()
        self.assertEqual(RegistrationSource.objects.count(), 2)
        self.assertEqual(Registration.objects.count(), 1)
        self.assertEqual(RegistrationReminder.objects.count(), 1)

    def test_duplicate_external_event_and_attendee_identities_are_rejected(self):
        source = EventSource.objects.create(event=self.event, source_account='Mohamed', source_event_id='123')
        self.assert_rejected(lambda: EventSource.objects.create(event=self.event, source_account='Mohamed', source_event_id='123'))
        RegistrationSource.objects.create(booking=self.booking, event_source=source, source_attendee_id='789')
        self.assert_rejected(lambda: RegistrationSource.objects.create(booking=self.booking, event_source=source, source_attendee_id='789'))

    def test_rescheduling_preserves_old_sent_history_and_allows_new_reminders(self):
        old = self.reminder(status='sent', sent_at=timezone.now())
        self.reminder(event_start_at=self.start+timedelta(days=1))
        self.assertEqual(RegistrationReminder.objects.count(), 2)
        self.assertEqual(RegistrationReminder.objects.get(pk=old.pk).status, 'sent')

    def test_reminder_identity_and_delivery_state_are_validated(self):
        self.reminder()
        self.assert_rejected(lambda: self.reminder())
        self.assert_rejected(lambda: self.reminder(reminder_type='invalid'))
        self.assert_rejected(lambda: self.reminder(reminder_type='two_hours', status='invalid'))
        self.assert_rejected(lambda: self.reminder(reminder_type='two_hours', due_at=self.start+timedelta(seconds=1)))
        self.assert_rejected(lambda: self.reminder(reminder_type='two_hours', status='sent'))
        self.assert_rejected(lambda: self.reminder(reminder_type='two_hours', status='processing'))

    def test_legacy_yes_can_be_preserved_without_fabricating_a_send_date(self):
        reminder = self.reminder(status='sent', imported_sent=True)
        self.assertIsNone(reminder.sent_at)
        self.assert_rejected(lambda: self.reminder(reminder_type='two_hours', imported_sent=True))

    def test_history_cannot_be_deleted_by_deleting_the_booking(self):
        self.reminder()
        with self.assertRaises(ProtectedError):
            self.booking.delete()
