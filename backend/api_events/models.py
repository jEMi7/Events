import uuid

from django.conf import settings
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone as django_timezone


class Timestamped(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=django_timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Event(Timestamped):
    master_event_key = models.CharField(max_length=512, unique=True)
    source_event_id = models.TextField(blank=True)
    event_name = models.CharField(max_length=512)
    description = models.TextField(blank=True)
    location = models.TextField(blank=True)
    start_at = models.DateTimeField(null=True, blank=True, db_index=True)
    end_at = models.DateTimeField(null=True, blank=True)
    timezone = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=80, blank=True)
    meeting_url = models.URLField(max_length=2048, blank=True)
    source_sheet = models.TextField(blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    data_origin = models.CharField(max_length=40, default='manual')
    first_seen_at = models.DateTimeField(default=django_timezone.now)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['start_at', 'id']
        constraints = [models.CheckConstraint(condition=Q(end_at__isnull=True) | Q(start_at__isnull=True) | Q(end_at__gte=models.F('start_at')), name='event_end_after_start')]


class Person(Timestamped):
    identity_key = models.CharField(max_length=512, unique=True)
    first_name = models.CharField(max_length=255, blank=True)
    full_name = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    email_normalised = models.EmailField(blank=True, db_index=True)
    phone = models.CharField(max_length=80, blank=True)
    job_title = models.CharField(max_length=255, blank=True)
    source_attendee_id = models.TextField(blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    data_origin = models.CharField(max_length=40, default='manual')
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['full_name', 'id']
        constraints = [models.UniqueConstraint(models.functions.Lower('email'), condition=~Q(email=''), name='person_email_ci_unique')]

    def save(self, *args, **kwargs):
        self.email_normalised = self.email.strip().lower()
        super().save(*args, **kwargs)


class Registration(Timestamped):
    booking_key = models.CharField(max_length=1024, unique=True)
    event = models.ForeignKey(Event, on_delete=models.PROTECT, related_name='registrations')
    person = models.ForeignKey(Person, on_delete=models.PROTECT, related_name='registrations')
    booking_status = models.CharField(max_length=80, blank=True)
    booked_at = models.DateTimeField(null=True, blank=True)
    source_event_id = models.TextField(blank=True)
    source_attendee_id = models.TextField(blank=True)
    source_account = models.TextField(blank=True)
    source_sheet = models.TextField(blank=True)
    meeting_url = models.URLField(max_length=2048, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    data_origin = models.CharField(max_length=40, default='manual')
    first_seen_at = models.DateTimeField(default=django_timezone.now)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [models.UniqueConstraint(fields=['event', 'person'], name='registration_event_person_unique')]

    def save(self, *args, **kwargs):
        adding = self._state.adding
        with transaction.atomic():
            super().save(*args, **kwargs)
            if adding:
                OperationalStatus.objects.get_or_create(booking=self)


class EventSource(Timestamped):
    """Stable external identity, independent of an event's name or rescheduled date."""
    event = models.ForeignKey(Event, on_delete=models.PROTECT, related_name='sources')
    provider = models.CharField(max_length=40, default='eventbrite')
    source_account = models.CharField(max_length=100)
    source_event_id = models.CharField(max_length=255)
    source_event_name = models.CharField(max_length=512, blank=True)
    source_master_event_key = models.CharField(max_length=1024, blank=True)
    zoom_meeting_id = models.CharField(max_length=255, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['provider', 'source_account', 'source_event_id'], name='event_source_identity_unique'),
            models.CheckConstraint(condition=~Q(provider='') & ~Q(source_account='') & ~Q(source_event_id=''), name='event_source_identity_nonempty'),
        ]


class RegistrationSource(Timestamped):
    """Preserve all source bookings when duplicate registrations are consolidated."""
    booking = models.ForeignKey(Registration, on_delete=models.PROTECT, related_name='sources')
    event_source = models.ForeignKey(EventSource, on_delete=models.PROTECT, related_name='registrations')
    source_attendee_id = models.CharField(max_length=255)
    source_booking_key = models.CharField(max_length=1024, blank=True)
    source_attendee_unique_key = models.CharField(max_length=1024, blank=True)
    source_attendee_dedupe_key = models.CharField(max_length=1024, blank=True)
    booking_status = models.CharField(max_length=80, blank=True)
    booked_at = models.DateTimeField(null=True, blank=True)
    meeting_url = models.URLField(max_length=2048, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['event_source', 'source_attendee_id'], name='registration_source_identity_unique'),
            models.CheckConstraint(condition=~Q(source_attendee_id=''), name='registration_source_id_nonempty'),
        ]


class ReminderType(models.TextChoices):
    DAY_BEFORE = 'day_before', 'Previous London calendar day'
    TWO_HOURS = 'two_hours', 'Two hours before start'


class ReminderStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PROCESSING = 'processing', 'Processing'
    SENT = 'sent', 'Sent'
    FAILED = 'failed', 'Failed'
    CANCELLED = 'cancelled', 'Cancelled'
    UNKNOWN = 'unknown', 'Send outcome requires reconciliation'


class RegistrationReminder(Timestamped):
    booking = models.ForeignKey(Registration, on_delete=models.PROTECT, related_name='reminders')
    reminder_type = models.CharField(max_length=20, choices=ReminderType.choices)
    # A new occurrence can have new reminders without erasing old delivery history.
    event_start_at = models.DateTimeField()
    due_at = models.DateTimeField()
    status = models.CharField(max_length=12, choices=ReminderStatus.choices, default=ReminderStatus.PENDING)
    recipient_email = models.EmailField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    provider_message_id = models.CharField(max_length=512, blank=True)
    attempt_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    claim_token = models.UUIDField(null=True, blank=True)
    # A legacy Yes means sent; never invent the historic delivery timestamp.
    imported_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ['due_at', 'id']
        indexes = [models.Index(fields=['status', 'due_at'], name='reminder_status_due_idx')]
        constraints = [
            models.UniqueConstraint(fields=['booking', 'reminder_type', 'event_start_at'], name='reminder_booking_type_start_unique'),
            models.CheckConstraint(condition=Q(reminder_type__in=ReminderType.values), name='reminder_type_valid'),
            models.CheckConstraint(condition=Q(status__in=ReminderStatus.values), name='reminder_status_valid'),
            models.CheckConstraint(condition=Q(due_at__lte=models.F('event_start_at')), name='reminder_due_before_event'),
            models.CheckConstraint(condition=~Q(status='sent') | Q(sent_at__isnull=False) | Q(imported_sent=True), name='reminder_sent_has_evidence'),
            models.CheckConstraint(condition=Q(sent_at__isnull=True) | Q(status='sent'), name='reminder_sent_at_matches_status'),
            models.CheckConstraint(condition=Q(imported_sent=False) | Q(status='sent'), name='reminder_imported_matches_status'),
            models.CheckConstraint(condition=~Q(status='processing') | (Q(claimed_at__isnull=False) & Q(claim_token__isnull=False)), name='reminder_processing_has_claim'),
        ]


class AttendanceIntent(models.TextChoices):
    NOT_CONTACTED = 'not_contacted', 'Not contacted'
    CONFIRMED = 'confirmed', 'Confirmed'
    DECLINED = 'declined', 'Declined'
    MAYBE = 'maybe', 'Maybe'
    NO_ANSWER = 'no_answer', 'No answer'
    CALL_BACK = 'call_back', 'Call back'
    CANCELLED = 'cancelled', 'Cancelled'


class ActualAttendance(models.TextChoices):
    UNKNOWN = 'unknown', 'Unknown'
    ATTENDED = 'attended', 'Attended'
    ABSENT = 'absent', 'Absent'


class OperationalStatus(Timestamped):
    booking = models.OneToOneField(Registration, on_delete=models.PROTECT, related_name='status')
    attendance_intent = models.CharField(max_length=20, choices=AttendanceIntent.choices, default=AttendanceIntent.NOT_CONTACTED, db_index=True)
    actual_attendance = models.CharField(max_length=12, choices=ActualAttendance.choices, default=ActualAttendance.UNKNOWN)
    last_contacted_at = models.DateTimeField(null=True, blank=True)
    last_contacted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='last_contacts')
    callback_at = models.DateTimeField(null=True, blank=True, db_index=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='assigned_registrations')
    version = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(attendance_intent__in=AttendanceIntent.values), name='valid_attendance_intent'),
            models.CheckConstraint(condition=Q(actual_attendance__in=ActualAttendance.values), name='valid_actual_attendance'),
        ]


class ContactNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(Registration, on_delete=models.PROTECT, null=True, blank=True, related_name='notes')
    person = models.ForeignKey(Person, on_delete=models.PROTECT, null=True, blank=True, related_name='notes')
    event = models.ForeignKey(Event, on_delete=models.PROTECT, null=True, blank=True, related_name='notes')
    body = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='contact_notes')
    created_at = models.DateTimeField(default=django_timezone.now)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [models.CheckConstraint(condition=Q(booking__isnull=False) | Q(person__isnull=False), name='note_has_scope')]


class CallbackStatus(models.TextChoices):
    OPEN = 'open', 'Open'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


class CallbackTask(Timestamped):
    booking = models.ForeignKey(Registration, on_delete=models.PROTECT, related_name='callbacks')
    due_at = models.DateTimeField(db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='owned_callbacks')
    status = models.CharField(max_length=12, choices=CallbackStatus.choices, default=CallbackStatus.OPEN, db_index=True)
    note = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='completed_callbacks')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='created_callbacks')

    class Meta:
        ordering = ['due_at', 'id']
        constraints = [models.CheckConstraint(condition=Q(status__in=CallbackStatus.values), name='valid_callback_status')]


class ActivityLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(Registration, on_delete=models.PROTECT, null=True, related_name='activities')
    person = models.ForeignKey(Person, on_delete=models.PROTECT, null=True, related_name='activities')
    event = models.ForeignKey(Event, on_delete=models.PROTECT, null=True, related_name='activities')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='activities')
    action = models.CharField(max_length=80, db_index=True)
    detail = models.JSONField(default=dict)
    previous_value = models.JSONField(null=True, blank=True)
    next_value = models.JSONField(null=True, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(default=django_timezone.now, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']


class SyncRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.CharField(max_length=40, default='google_sheets')
    status = models.CharField(max_length=24, default='running')
    events_read = models.PositiveIntegerField(default=0)
    attendees_read = models.PositiveIntegerField(default=0)
    events_upserted = models.PositiveIntegerField(default=0)
    bookings_upserted = models.PositiveIntegerField(default=0)
    people_upserted = models.PositiveIntegerField(default=0)
    skipped_rows = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    detail = models.JSONField(default=dict)
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    started_at = models.DateTimeField(default=django_timezone.now, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at', '-id']


class AppSetting(models.Model):
    key = models.CharField(max_length=100, primary_key=True)
    value = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)


class HeaderMapping(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tab_name = models.CharField(max_length=255)
    source_header = models.CharField(max_length=255)
    target_field = models.CharField(max_length=80)
    created_at = models.DateTimeField(default=django_timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['tab_name', 'source_header'], name='unique_header_mapping')]
        ordering = ['tab_name', 'source_header']
