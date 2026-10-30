from rest_framework.permissions import BasePermission, SAFE_METHODS


class ActiveStaff(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.status == 'active' and user.role in ('admin', 'staff'))


class EventAdmin(ActiveStaff):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_event_admin


class AdminWriteStaffRead(ActiveStaff):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and (request.method in SAFE_METHODS or request.user.is_event_admin)
