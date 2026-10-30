from datetime import timedelta
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()
PASSWORD = 'Correct-Horse-Purple-742!'


class AuthenticationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user('staff@example.test', PASSWORD, full_name='Existing Staff')

    def test_registration_hashes_password_and_never_accepts_admin_role(self):
        result = self.client.post('/api/v1/auth/register/', {'email': 'NEW@example.test', 'full_name': 'New Staff', 'password': PASSWORD, 'role': 'admin', 'is_superuser': True})
        self.assertEqual(result.status_code, 201)
        user = User.objects.get(email='new@example.test')
        self.assertEqual(user.role, 'staff')
        self.assertFalse(user.is_superuser)
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertNotIn('password', result.data['user'])

    def test_duplicate_email_case_and_weak_password_are_rejected(self):
        result = self.client.post('/api/v1/auth/register/', {'email': 'STAFF@example.test', 'full_name': 'Duplicate', 'password': PASSWORD})
        self.assertEqual(result.status_code, 400)
        result = self.client.post('/api/v1/auth/register/', {'email': 'new@example.test', 'full_name': 'New', 'password': '123'})
        self.assertEqual(result.status_code, 400)

    def test_login_session_and_logout(self):
        result = self.client.post('/api/v1/auth/login/', {'email': 'STAFF@example.test', 'password': PASSWORD})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['redirect_to'], '/dashboard')
        self.assertTrue(result.cookies['events_sessionid']['httponly'])
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/auth/logout/').status_code, 204)
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code, 403)

    def test_suspended_user_cannot_log_in_or_use_existing_session(self):
        self.client.force_login(self.user)
        self.user.status = 'suspended'
        self.user.save()
        self.assertEqual(self.client.get('/api/v1/events/').status_code, 403)
        self.assertEqual(self.client.post('/api/v1/auth/login/', {'email': self.user.email, 'password': PASSWORD}).status_code, 400)

    def test_login_and_signup_require_real_csrf(self):
        secure_client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(secure_client.post('/api/v1/auth/login/', {'email': self.user.email, 'password': PASSWORD}).status_code, 403)
        self.assertEqual(secure_client.post('/api/v1/auth/register/', {}).status_code, 403)
        token = secure_client.get('/api/v1/auth/csrf/').data['csrfToken']
        result = secure_client.post('/api/v1/auth/login/', {'email': self.user.email, 'password': PASSWORD}, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(secure_client.post('/api/v1/auth/logout/').status_code, 403)

    def test_untrusted_origin_is_rejected(self):
        client = APIClient(enforce_csrf_checks=True)
        token = client.get('/api/v1/auth/csrf/').data['csrfToken']
        result = client.post('/api/v1/auth/login/', {'email': self.user.email, 'password': PASSWORD}, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://untrusted.example')
        self.assertEqual(result.status_code, 403)

    def test_password_reset_is_one_time_and_supports_unusable_password(self):
        self.user.set_unusable_password()
        self.user.save()
        result = self.client.post('/api/v1/auth/password-reset/', {'email': self.user.email})
        self.assertEqual(result.status_code, 200)
        unknown = self.client.post('/api/v1/auth/password-reset/', {'email': 'missing@example.test'})
        self.assertEqual(result.data, unknown.data)
        self.assertEqual(len(mail.outbox), 1)
        link = next(line for line in mail.outbox[0].body.splitlines() if line.startswith('http'))
        query = parse_qs(urlsplit(link).query)
        payload = {'uid': query['reset_uid'][0], 'token': query['reset_token'][0], 'password': 'A-Different-Safe-Password-864!'}
        self.assertEqual(self.client.post('/api/v1/auth/password-reset/confirm/', payload).status_code, 200)
        self.assertEqual(self.client.post('/api/v1/auth/password-reset/confirm/', payload).status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(payload['password']))

    def test_expired_reset_token_is_rejected(self):
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        old_time = default_token_generator._now() - timedelta(hours=2)
        with patch.object(default_token_generator, '_now', return_value=old_time):
            token = default_token_generator.make_token(self.user)
        result = self.client.post('/api/v1/auth/password-reset/confirm/', {'uid': urlsafe_base64_encode(force_bytes(self.user.pk)), 'token': token, 'password': PASSWORD})
        self.assertEqual(result.status_code, 400)

    def test_reset_delivery_failure_does_not_reveal_account_existence(self):
        with patch('accounts.views.EmailMessage.send', side_effect=RuntimeError('synthetic failure')):
            with self.assertLogs('accounts.views', level='ERROR') as logged:
                known = self.client.post('/api/v1/auth/password-reset/', {'email': self.user.email})
        unknown = self.client.post('/api/v1/auth/password-reset/', {'email': 'missing@example.test'})
        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual(known.data, unknown.data)
        self.assertNotIn(self.user.email, str(logged.output))

    def test_session_writes_require_csrf_and_accept_current_token(self):
        from api_events.models import Event, Person, Registration
        event = Event.objects.create(master_event_key='csrf-event', event_name='CSRF test')
        person = Person.objects.create(identity_key='csrf-person', full_name='Person')
        booking = Registration.objects.create(booking_key='csrf-booking', event=event, person=person)
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.user)
        endpoint = f'/api/v1/registrations/{booking.pk}/intent/'
        self.assertEqual(client.post(endpoint, {'intent': 'confirmed'}).status_code, 403)
        token = client.get('/api/v1/auth/csrf/').data['csrfToken']
        self.assertEqual(client.post(endpoint, {'intent': 'confirmed'}, HTTP_X_CSRFTOKEN=token).status_code, 200)

    @override_settings(DJANGO_API_ENABLED=False)
    def test_staged_api_is_disabled_without_cutover(self):
        self.assertEqual(self.client.get('/api/v1/auth/csrf/').status_code, 503)

    def test_last_active_admin_cannot_be_demoted(self):
        admin = User.objects.create_user('admin@example.test', PASSWORD, full_name='Admin', role='admin')
        self.client.force_authenticate(admin)
        result = self.client.patch(f'/api/v1/users/{admin.pk}/', {'role': 'staff'})
        self.assertEqual(result.status_code, 400)

    def test_cors_allowlist(self):
        result = self.client.options('/api/v1/auth/login/', HTTP_ORIGIN='http://localhost:8080', HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST')
        self.assertEqual(result.get('Access-Control-Allow-Origin'), 'http://localhost:8080')
        denied = self.client.options('/api/v1/auth/login/', HTTP_ORIGIN='https://untrusted.example', HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST')
        self.assertIsNone(denied.get('Access-Control-Allow-Origin'))
