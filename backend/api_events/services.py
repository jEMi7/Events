"""Atomic operational writes. Source synchronization never calls these actions."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from .models import ActivityLog, AttendanceIntent, CallbackStatus, CallbackTask, ContactNote, OperationalStatus, Registration


class Conflict(APIException):
    status_code = 409
    default_detail = 'This registration changed. Refresh it and try again.'


STATUS_FIELDS = ('attendance_intent', 'actual_attendance', 'last_contacted_at', 'last_contacted_by_id', 'callback_at', 'assigned_to_id')
UNDOABLE = ('intent_updated', 'attendance_updated', 'callback_scheduled', 'callback_rescheduled', 'callback_completed')


def snapshot(status):
    result = {}
    for field in STATUS_FIELDS:
        value = getattr(status, field)
        key = field.removesuffix('_id')
        result[key] = value.isoformat() if hasattr(value, 'isoformat') else str(value) if value is not None else None
    return result


def locked_status(booking, expected_version=None):
    booking = Registration.objects.select_for_update().get(pk=booking.pk)
    state, _ = OperationalStatus.objects.get_or_create(booking=booking)
    if expected_version is not None and state.version != expected_version:
        raise Conflict()
    return state


def log(booking, actor, action, detail=None, note='', previous=None, next_value=None):
    return ActivityLog.objects.create(booking=booking, event_id=booking.event_id, person_id=booking.person_id, actor=actor, action=action, detail=detail or {}, note=note, previous_value=previous, next_value=next_value)


def save_state(state, actor, action, before, detail=None, note=''):
    state.version += 1
    state.save()
    detail = {**(detail or {}), 'previous_state': before, 'next_version': state.version}
    log(state.booking, actor, action, detail, note, before, snapshot(state))
    return state


@transaction.atomic
def set_intent(booking, actor, intent, note='', expected_version=None):
    state = locked_status(booking, expected_version)
    before = snapshot(state)
    state.attendance_intent = intent
    state.last_contacted_at = timezone.now()
    state.last_contacted_by = actor
    if note:
        ContactNote.objects.create(booking=booking, person_id=booking.person_id, event_id=booking.event_id, body=note, created_by=actor)
    return save_state(state, actor, 'intent_updated', before, {'intent': intent, 'previous': before['attendance_intent']}, note)


@transaction.atomic
def set_attendance(booking, actor, attendance, expected_version=None):
    state = locked_status(booking, expected_version)
    before = snapshot(state)
    state.actual_attendance = attendance
    return save_state(state, actor, 'attendance_updated', before, {'attendance': attendance, 'previous': before['actual_attendance']})


@transaction.atomic
def schedule_callback(booking, actor, due_at, owner=None, note='', expected_version=None):
    state = locked_status(booking, expected_version)
    before = snapshot(state)
    owner = owner or actor
    task = CallbackTask.objects.create(booking=booking, due_at=due_at, owner=owner, note=note, created_by=actor)
    state.attendance_intent = 'call_back'
    state.callback_at = due_at
    state.assigned_to = owner
    state.last_contacted_at = timezone.now()
    state.last_contacted_by = actor
    save_state(state, actor, 'callback_scheduled', before, {'due_at': due_at.isoformat(), 'callback_task_id': str(task.pk), 'previous': before['attendance_intent']}, note)
    return task


@transaction.atomic
def change_callback(task, actor, action, due_at=None, intent=None, note=None, expected_version=None):
    state = locked_status(task.booking, expected_version)
    task = CallbackTask.objects.select_for_update().get(pk=task.pk)
    if task.status == 'cancelled' or (action == 'complete' and task.status != 'open'):
        raise ValidationError('This follow-up is no longer open.')
    before = snapshot(state)
    previous_task = {'status': task.status, 'due_at': task.due_at.isoformat(), 'completed_at': task.completed_at.isoformat() if task.completed_at else None, 'completed_by': str(task.completed_by_id) if task.completed_by_id else None, 'note': task.note}
    if action == 'complete':
        task.status, task.completed_at, task.completed_by = 'completed', timezone.now(), actor
        state.callback_at = None
        state.last_contacted_at, state.last_contacted_by = timezone.now(), actor
        if intent:
            state.attendance_intent = intent
        if note is not None:
            task.note = note
        action_name = 'callback_completed'
    elif action == 'reschedule':
        task.status, task.due_at = 'open', due_at
        task.completed_at, task.completed_by = None, None
        state.callback_at = due_at
        action_name = 'callback_rescheduled'
    else:
        task.status = CallbackStatus.CANCELLED
        if state.callback_at == task.due_at:
            state.callback_at = None
        action_name = 'callback_cancelled'
    task.save()
    save_state(state, actor, action_name, before, {'callback_task_id': str(task.pk), 'previous_task': previous_task}, note or '')
    return task


@transaction.atomic
def undo(booking, actor, expected_version=None):
    state = locked_status(booking, expected_version)
    latest = booking.activities.filter(action__in=(*UNDOABLE, 'status_reverted', 'callback_cancelled')).first()
    if latest is None or latest.action not in UNDOABLE:
        raise ValidationError('There is no status change left to undo for this attendee.')
    if latest.detail.get('next_version', state.version) != state.version:
        raise Conflict()
    before = snapshot(state)
    previous = latest.detail.get('previous_state') or {}
    legacy_intent = latest.detail.get('previous', 'not_contacted')
    if legacy_intent not in AttendanceIntent.values:
        legacy_intent = 'not_contacted'
    state.attendance_intent = previous.get('attendance_intent', legacy_intent)
    state.actual_attendance = previous.get('actual_attendance', 'unknown')
    # Existing Undo rule deliberately clears contact stamps.
    state.last_contacted_at, state.last_contacted_by = None, None
    state.callback_at = previous.get('callback_at')
    state.assigned_to_id = previous.get('assigned_to')
    task_id = latest.detail.get('callback_task_id')
    if task_id:
        task = CallbackTask.objects.select_for_update().get(pk=task_id, booking=booking)
        if latest.action == 'callback_scheduled':
            task.status = CallbackStatus.CANCELLED
        else:
            task_before = latest.detail.get('previous_task') or {}
            task.status = task_before.get('status', 'open')
            task.due_at = task_before.get('due_at') or state.callback_at or task.due_at
            task.completed_at = task_before.get('completed_at')
            task.completed_by_id = task_before.get('completed_by')
            task.note = task_before.get('note', task.note)
        task.save()
    return save_state(state, actor, 'status_reverted', before, {'undone_action': latest.action, 'undone_activity_id': str(latest.pk), 'restored_state': previous})
