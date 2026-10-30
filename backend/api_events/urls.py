from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts.views import UserViewSet
from . import views

router = DefaultRouter()
for prefix, viewset, basename in [
    ('users', UserViewSet, 'users'),
    ('events', views.EventViewSet, 'events'),
    ('people', views.PersonViewSet, 'people'),
    ('registrations', views.RegistrationViewSet, 'registrations'),
    ('attendance', views.AttendanceViewSet, 'attendance'),
    ('call-outcomes', views.CallOutcomeViewSet, 'call-outcomes'),
    ('notes', views.NoteViewSet, 'notes'),
    ('follow-ups', views.CallbackViewSet, 'follow-ups'),
    ('activities', views.ActivityViewSet, 'activities'),
    ('sync-runs', views.SyncRunViewSet, 'sync-runs'),
    ('header-mappings', views.HeaderMappingViewSet, 'header-mappings'),
    ('settings', views.SettingViewSet, 'settings'),
]:
    router.register(prefix, viewset, basename=basename)

urlpatterns = [
    path('auth/', include('accounts.urls')),
    path('dashboard/', views.DashboardView.as_view()),
    path('reports/', views.ReportView.as_view()),
    path('source/status/', views.SourceStatusView.as_view()),
    path('source/preview/', views.SourcePreviewView.as_view()),
    path('source/sync/', views.SourceSyncView.as_view()),
    path('', include(router.urls)),
]
