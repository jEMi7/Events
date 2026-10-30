import math
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import filters, mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, services, sync
from .permissions import ActiveStaff, AdminWriteStaffRead, EventAdmin
from .serializers import (
    ActivitySerializer, AttendanceActionSerializer, BulkAttendanceSerializer,
    BulkIntentSerializer, CallbackActionSerializer, CallbackSerializer,
    EventSerializer, HeaderMappingSerializer, IntentActionSerializer,
    NoteSerializer, OperationalStatusSerializer, PersonSerializer,
    RegistrationSerializer, ScheduleCallbackSerializer, SettingSerializer,
    SyncRunSerializer, UndoSerializer,
)


def validated(serializer_class, request):
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def filtered(queryset, request, allowed):
    for param, lookup in allowed.items():
        value = request.query_params.get(param)
        if value:
            try:
                queryset = queryset.filter(**{lookup: value})
            except (ValueError, DjangoValidationError):
                raise serializers.ValidationError({param: 'Invalid filter value.'})
    return queryset


class MasterViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [AdminWriteStaffRead]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]

    @transaction.atomic
    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            raise serializers.ValidationError('A record with these identity/source keys already exists or conflicts with another record.')

    @transaction.atomic
    def perform_update(self, serializer):
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            raise serializers.ValidationError('The update conflicts with an existing record.')


class EventViewSet(MasterViewSet):
    queryset = models.Event.objects.all()
    serializer_class = EventSerializer
    search_fields = ['event_name', 'source_event_id', 'master_event_key', 'location']
    ordering_fields = ['start_at', 'event_name', 'created_at']


class PersonViewSet(MasterViewSet):
    queryset = models.Person.objects.all()
    serializer_class = PersonSerializer
    search_fields = ['full_name', 'email', 'phone']
    ordering_fields = ['full_name', 'created_at']


class RegistrationViewSet(MasterViewSet):
    queryset = models.Registration.objects.select_related('person', 'event', 'status').all()
    serializer_class = RegistrationSerializer
    search_fields = ['booking_key', 'person__full_name', 'person__email', 'person__phone']
    ordering_fields = ['created_at', 'booked_at']

    def get_queryset(self):
        return filtered(super().get_queryset(), self.request, {'event_id': 'event_id', 'person_id': 'person_id', 'attendance_intent': 'status__attendance_intent', 'actual_attendance': 'status__actual_attendance'})

    def get_permissions(self):
        return [ActiveStaff()] if self.action in ('intent', 'attendance', 'undo', 'bulk_intent', 'bulk_attendance') else super().get_permissions()

    @action(detail=True, methods=['post'])
    def intent(self, request, pk=None):
        state = services.set_intent(self.get_object(), request.user, **validated(IntentActionSerializer, request))
        return Response(OperationalStatusSerializer(state).data)

    @action(detail=True, methods=['post'])
    def attendance(self, request, pk=None):
        state = services.set_attendance(self.get_object(), request.user, **validated(AttendanceActionSerializer, request))
        return Response(OperationalStatusSerializer(state).data)

    @action(detail=True, methods=['post'])
    def undo(self, request, pk=None):
        state = services.undo(self.get_object(), request.user, **validated(UndoSerializer, request))
        return Response(OperationalStatusSerializer(state).data)

    @transaction.atomic
    def bulk(self, request, serializer_class, operation):
        data = validated(serializer_class, request)
        ids = data.pop('booking_ids')
        bookings = list(models.Registration.objects.select_for_update().filter(pk__in=ids).order_by('pk'))
        if len(bookings) != len(ids):
            raise serializers.ValidationError('One or more registrations do not exist.')
        for booking in bookings:
            operation(booking, request.user, **data)
        return Response({'updated': len(bookings)})

    @action(detail=False, methods=['post'], url_path='bulk-intent')
    def bulk_intent(self, request):
        return self.bulk(request, BulkIntentSerializer, services.set_intent)

    @action(detail=False, methods=['post'], url_path='bulk-attendance')
    def bulk_attendance(self, request):
        return self.bulk(request, BulkAttendanceSerializer, services.set_attendance)


class NoteViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = models.ContactNote.objects.select_related('created_by').all()
    serializer_class = NoteSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return filtered(super().get_queryset(), self.request, {'booking_id': 'booking_id', 'person_id': 'person_id', 'event_id': 'event_id'})

    @transaction.atomic
    def perform_create(self, serializer):
        note = serializer.save(created_by=self.request.user)
        if note.booking:
            services.log(note.booking, self.request.user, 'note_added', {'note_id': str(note.pk)}, note.body)
        else:
            models.ActivityLog.objects.create(person=note.person, event=note.event, actor=self.request.user, action='note_added', detail={'note_id': str(note.pk)}, note=note.body)

    @transaction.atomic
    def perform_update(self, serializer):
        note = serializer.instance
        if note.created_by_id != self.request.user.pk and not self.request.user.is_event_admin:
            raise PermissionDenied('Only the author or an administrator may edit this note.')
        previous = note.body
        serializer.save()
        models.ActivityLog.objects.create(booking=note.booking, person=note.person, event=note.event, actor=self.request.user, action='note_updated', detail={'note_id': str(note.pk)}, previous_value={'body': previous}, next_value={'body': note.body})


class CallbackViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = models.CallbackTask.objects.select_related('booking', 'owner').all()
    serializer_class = CallbackSerializer

    def get_queryset(self):
        queryset = filtered(super().get_queryset(), self.request, {'booking_id': 'booking_id', 'owner_id': 'owner_id', 'status': 'status'})
        if self.action == 'list' and self.request.query_params.get('include_cancelled') != 'true':
            queryset = queryset.exclude(status='cancelled')
        return queryset

    def create(self, request, *args, **kwargs):
        task = services.schedule_callback(actor=request.user, **validated(ScheduleCallbackSerializer, request))
        return Response(CallbackSerializer(task).data, status=201)

    def change(self, request, kind):
        data = validated(CallbackActionSerializer, request)
        if kind == 'reschedule' and 'due_at' not in data:
            raise serializers.ValidationError({'due_at': 'Choose a new date and time.'})
        task = services.change_callback(self.get_object(), request.user, kind, **data)
        return Response(CallbackSerializer(task).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        return self.change(request, 'complete')

    @action(detail=True, methods=['post'])
    def reschedule(self, request, pk=None):
        return self.change(request, 'reschedule')

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        return self.change(request, 'cancel')


class ActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.ActivityLog.objects.select_related('actor').all()
    serializer_class = ActivitySerializer

    def get_queryset(self):
        return filtered(super().get_queryset(), self.request, {'booking_id': 'booking_id', 'person_id': 'person_id', 'event_id': 'event_id', 'action': 'action'})


class CallOutcomeViewSet(ActivityViewSet):
    queryset = models.ActivityLog.objects.filter(action__in=['intent_updated', 'callback_completed']).all()


class AttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.OperationalStatus.objects.all().order_by('booking_id')
    serializer_class = OperationalStatusSerializer

    def get_queryset(self):
        return filtered(super().get_queryset(), self.request, {'booking_id': 'booking_id', 'event_id': 'booking__event_id', 'actual_attendance': 'actual_attendance'})


def event_scope(request):
    events = models.Event.objects.all()
    now = timezone.now()
    selected_range = request.query_params.get('range', 'all')
    if selected_range in ('7', '30', '90'):
        events = events.filter(start_at__gte=now, start_at__lte=now + timedelta(days=int(selected_range)))
    elif selected_range == 'upcoming':
        events = events.filter(Q(start_at__gte=now) | Q(start_at__isnull=True))
    elif selected_range == 'past':
        events = events.filter(start_at__lt=now)
    elif selected_range != 'all':
        raise serializers.ValidationError({'range': 'Use all, upcoming, past, 7, 30 or 90.'})
    return filtered(events, request, {'event_id': 'id'})


def stats_for(queryset):
    intents = {'notContacted': 'not_contacted', 'confirmed': 'confirmed', 'declined': 'declined', 'maybe': 'maybe', 'noAnswer': 'no_answer', 'callBacks': 'call_back', 'cancelled': 'cancelled'}
    counts = {'booked': Count('pk')}
    counts.update({key: Count('pk', filter=Q(status__attendance_intent=value)) for key, value in intents.items()})
    counts.update({key: Count('pk', filter=Q(status__actual_attendance=value)) for key, value in {'attended': 'attended', 'absent': 'absent', 'unknownAttendance': 'unknown'}.items()})
    result = queryset.aggregate(**counts)
    result['pending'] = sum(result[k] for k in ('notContacted', 'maybe', 'noAnswer', 'callBacks'))
    def percent(numerator, denominator):
        return math.floor(numerator / denominator * 1000 + 0.5) / 10 if denominator else 0
    result['confirmationRate'] = percent(result['confirmed'], result['booked'])
    result['showUpRate'] = percent(result['attended'], result['attended'] + result['absent'])
    result['noAnswerRate'] = percent(result['noAnswer'], result['booked'])
    return result


class ReportView(APIView):
    def get(self, request):
        events = event_scope(request)
        bookings = models.Registration.objects.filter(event__in=events)
        return Response({'overall': stats_for(bookings), 'rows': [{'event': EventSerializer(event).data, 'stats': stats_for(bookings.filter(event=event))} for event in events]})


class DashboardView(APIView):
    def get(self, request):
        events = event_scope(request)
        bookings = models.Registration.objects.filter(event__in=events)
        callbacks = models.CallbackTask.objects.filter(booking__in=bookings, status='open')
        return Response({'overall': stats_for(bookings), 'events': events.count(), 'open_callbacks': callbacks.count(), 'overdue_callbacks': callbacks.filter(due_at__lt=timezone.now()).count()})


class SyncRunViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.SyncRun.objects.all()
    serializer_class = SyncRunSerializer


class HeaderMappingViewSet(MasterViewSet):
    queryset = models.HeaderMapping.objects.all()
    serializer_class = HeaderMappingSerializer
    search_fields = ['tab_name', 'source_header', 'target_field']
    ordering_fields = ['tab_name', 'source_header']


class SettingViewSet(MasterViewSet):
    queryset = models.AppSetting.objects.all().order_by('key')
    serializer_class = SettingSerializer
    search_fields = ['key']
    ordering_fields = ['key']
    lookup_value_regex = '[a-z_]+'

    def perform_create(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class SourceStatusView(APIView):
    def get(self, request):
        return Response({'connected': sync.source_connected(), 'sync_enabled': settings.SHEETS_SYNC_ENABLED, 'source': sync.source_config(), 'read_only_source': True})


class SourcePreviewView(APIView):
    permission_classes = [EventAdmin]

    def get(self, request):
        source = sync.source_config()
        tabs = sync.fetch_tabs(source)
        events, attendees, detail = sync.prepare(tabs, source)
        return Response({'events_read': len(events), 'attendees_read': len(attendees), **detail})


class SourceSyncView(APIView):
    permission_classes = [EventAdmin]

    def post(self, request):
        if not settings.SHEETS_SYNC_ENABLED:
            return Response({'detail': 'Sheets synchronization is disabled pending import/cutover approval.'}, status=503)
        source = sync.source_config()
        result = sync.import_tabs(sync.fetch_tabs(source), source, request.user)
        return Response(SyncRunSerializer(result).data)
