from django.contrib.auth import get_user_model
from rest_framework import serializers

from . import models


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Event
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'last_synced_at', 'first_seen_at']

    def validate(self, attrs):
        start = attrs.get('start_at', getattr(self.instance, 'start_at', None))
        end = attrs.get('end_at', getattr(self.instance, 'end_at', None))
        if start and end and end < start:
            raise serializers.ValidationError({'end_at': 'End must not precede start.'})
        return attrs


class PersonSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Person
        fields = '__all__'
        read_only_fields = ['id', 'identity_key', 'email_normalised', 'created_at', 'updated_at', 'last_synced_at']

    def validate(self, attrs):
        from .sync import person_key
        if not self.instance:
            key = person_key(attrs)
            if not key:
                raise serializers.ValidationError('Provide email, source attendee ID, or name/phone.')
            if models.Person.objects.filter(identity_key=key).exists():
                raise serializers.ValidationError('This attendee already exists. Reuse their person ID for another registration.')
        return attrs

    def validate_email(self, value):
        if value and models.Person.objects.filter(email__iexact=value.strip()).exclude(pk=getattr(self.instance, 'pk', None)).exists():
            raise serializers.ValidationError('This email already belongs to an attendee; reuse that person record.')
        return value.strip()

    def create(self, attrs):
        from .sync import person_key
        attrs['identity_key'] = person_key(attrs)
        return super().create(attrs)


class OperationalStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.OperationalStatus
        fields = ['booking', 'attendance_intent', 'actual_attendance', 'last_contacted_at', 'last_contacted_by', 'callback_at', 'assigned_to', 'version', 'updated_at']
        read_only_fields = fields


class RegistrationSerializer(serializers.ModelSerializer):
    person = PersonSerializer(read_only=True)
    person_id = serializers.PrimaryKeyRelatedField(source='person', queryset=models.Person.objects.all(), write_only=True)
    status = OperationalStatusSerializer(read_only=True)

    class Meta:
        model = models.Registration
        fields = ['id', 'booking_key', 'event', 'event_id', 'person', 'person_id', 'status', 'booking_status', 'booked_at', 'source_event_id', 'source_attendee_id', 'source_account', 'source_sheet', 'meeting_url', 'raw_payload', 'data_origin', 'first_seen_at', 'last_synced_at', 'created_at', 'updated_at']
        read_only_fields = ['id', 'event_id', 'first_seen_at', 'last_synced_at', 'created_at', 'updated_at']

    def validate(self, attrs):
        if self.instance:
            for field in ('event', 'person', 'booking_key'):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: 'Registration identity and relationships cannot be changed. Preserve the original booking history.'})
        return attrs


class IntentActionSerializer(serializers.Serializer):
    intent = serializers.ChoiceField(choices=models.AttendanceIntent.choices)
    note = serializers.CharField(required=False, default='', max_length=10000, allow_blank=True)
    expected_version = serializers.IntegerField(required=False, min_value=0)


class AttendanceActionSerializer(serializers.Serializer):
    attendance = serializers.ChoiceField(choices=models.ActualAttendance.choices)
    expected_version = serializers.IntegerField(required=False, min_value=0)


class UndoSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(required=False, min_value=0)


class BulkIntentSerializer(IntentActionSerializer):
    booking_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=200)

    def validate_booking_ids(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError('Duplicate registration IDs are not allowed.')
        return value


class BulkAttendanceSerializer(AttendanceActionSerializer):
    booking_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=200)
    validate_booking_ids = BulkIntentSerializer.validate_booking_ids


class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ContactNote
        fields = '__all__'
        read_only_fields = ['id', 'created_by', 'created_at']

    def validate(self, attrs):
        if self.instance:
            if any(field in attrs for field in ('booking', 'person', 'event')):
                raise serializers.ValidationError('A saved note cannot be moved to another record.')
            return attrs
        booking = attrs.get('booking')
        if booking:
            if attrs.get('person', booking.person) != booking.person or attrs.get('event', booking.event) != booking.event:
                raise serializers.ValidationError('Note relationships do not match the registration.')
            attrs['person'], attrs['event'] = booking.person, booking.event
        elif not attrs.get('person'):
            raise serializers.ValidationError('A booking or person is required.')
        return attrs

    def validate_body(self, value):
        if not value.strip() or len(value) > 10000:
            raise serializers.ValidationError('Write a note of at most 10000 characters.')
        return value.strip()


class CallbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.CallbackTask
        fields = '__all__'
        read_only_fields = ['id', 'status', 'created_at', 'updated_at', 'created_by', 'completed_at', 'completed_by']


class ScheduleCallbackSerializer(serializers.Serializer):
    booking = serializers.PrimaryKeyRelatedField(queryset=models.Registration.objects.all())
    due_at = serializers.DateTimeField()
    owner = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.filter(is_active=True, status='active'), required=False, allow_null=True)
    note = serializers.CharField(required=False, default='', max_length=10000, allow_blank=True)
    expected_version = serializers.IntegerField(required=False, min_value=0)


class CallbackActionSerializer(serializers.Serializer):
    due_at = serializers.DateTimeField(required=False)
    intent = serializers.ChoiceField(choices=models.AttendanceIntent.choices, required=False)
    note = serializers.CharField(required=False, max_length=10000, allow_blank=True)
    expected_version = serializers.IntegerField(required=False, min_value=0)


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ActivityLog
        fields = '__all__'
        read_only_fields = fields


class SyncRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.SyncRun
        fields = '__all__'
        read_only_fields = fields


class HeaderMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.HeaderMapping
        fields = '__all__'
        read_only_fields = ['id', 'created_at']


class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.AppSetting
        fields = '__all__'
        read_only_fields = ['updated_at', 'updated_by']

    def validate_key(self, value):
        if value not in ('source_spreadsheet', 'demo_mode'):
            raise serializers.ValidationError('Only source_spreadsheet and demo_mode are managed through this API. Keep secrets in server environment variables.')
        return value

    def validate_value(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Settings must be a JSON object.')
        return value
