import logging
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from api_events.permissions import ActiveStaff, EventAdmin
from .serializers import LoginSerializer, RegisterSerializer, ResetConfirmSerializer, ResetRequestSerializer, UserAdminSerializer, UserSerializer

User = get_user_model()
logger = logging.getLogger(__name__)


@method_decorator(csrf_protect, name='dispatch')
class PublicAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'


class CsrfView(PublicAuthView):
    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class AuthConfigView(PublicAuthView):
    def get(self, request):
        return Response({'provider': 'django', 'google_oauth_configured': False, 'password_reset_email_configured': settings.PASSWORD_RESET_EMAIL_ENABLED})


class RegisterView(PublicAuthView):
    def post(self, request):
        data = RegisterSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                user = User.objects.create_user(**data.validated_data, role='staff')
        except IntegrityError:
            raise serializers.ValidationError({'email': 'An account with this email already exists.'})
        return Response({'user': UserSerializer(user).data}, status=status.HTTP_201_CREATED)


class LoginView(PublicAuthView):
    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(request, email=data.validated_data['email'].strip().lower(), password=data.validated_data['password'])
        if user is None or not user.is_active or user.status != 'active':
            return Response({'detail': 'Invalid email or password.'}, status=400)
        login(request, user)
        return Response({'user': UserSerializer(user).data, 'redirect_to': '/dashboard'})


@method_decorator(csrf_protect, name='dispatch')
class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response(status=204)


class MeView(APIView):
    permission_classes = [ActiveStaff]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ResetRequestView(PublicAuthView):
    def post(self, request):
        data = ResetRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not settings.PASSWORD_RESET_EMAIL_ENABLED:
            return Response({'detail': 'Password-reset email delivery must be configured before cutover.'}, status=503)
        user = User.objects.filter(email__iexact=data.validated_data['email'], is_active=True, status='active').first()
        if user:
            # Also supports migrated users with an unusable Django password.
            query = urlencode({'reset_uid': urlsafe_base64_encode(force_bytes(user.pk)), 'reset_token': default_token_generator.make_token(user)})
            link = f'{settings.FRONTEND_BASE_URL}/?{query}'
            message = EmailMessage(subject='Reset your Events password', body=f'Use this one-time link within one hour:\n{link}\n\nIf you did not request this, ignore this email.', from_email=settings.DEFAULT_FROM_EMAIL, to=[user.email])
            try:
                message.send()
            except Exception:
                # Never log the reset link, token, password or SMTP credentials.
                # Keep the response identical for known and unknown accounts.
                logger.error('Password-reset email delivery failed. Check the server mail configuration.')
        return Response({'detail': 'If the account is eligible, a password reset email will be sent.'})


class ResetConfirmView(PublicAuthView):
    def post(self, request):
        data = ResetConfirmSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            user_id = force_str(urlsafe_base64_decode(data.validated_data['uid']))
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=user_id, is_active=True, status='active')
                if not default_token_generator.check_token(user, data.validated_data['token']):
                    raise ValueError()
                try:
                    password_validation.validate_password(data.validated_data['password'], user)
                except DjangoValidationError as exc:
                    raise serializers.ValidationError({'password': exc.messages})
                user.set_password(data.validated_data['password'])
                user.save(update_fields=['password', 'updated_at'])
        except (ValueError, TypeError, OverflowError, User.DoesNotExist, DjangoValidationError):
            raise serializers.ValidationError({'detail': 'Invalid or expired password reset link.'})
        return Response({'detail': 'Password updated. Sign in with your new password.'})


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = User.objects.all().order_by('created_at')
    serializer_class = UserAdminSerializer
    permission_classes = [EventAdmin]
    http_method_names = ['get', 'patch', 'head', 'options']

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Lock the administrator set to prevent concurrent last-admin demotions.
        list(User.objects.select_for_update().filter(role='admin').order_by('pk'))
        user = self.get_object()
        serializer = self.get_serializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        attrs = serializer.validated_data
        remains_admin = attrs.get('role', user.role) == 'admin' and attrs.get('status', user.status) == 'active' and attrs.get('is_active', user.is_active)
        if user.is_event_admin and not remains_admin and not User.objects.filter(role='admin', status='active', is_active=True).exclude(pk=user.pk).exists():
            raise serializers.ValidationError({'detail': 'The last active administrator cannot be disabled or demoted.'})
        serializer.save(is_staff=attrs.get('role', user.role) == 'admin')
        return Response(serializer.data)
