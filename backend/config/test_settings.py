"""Isolated test configuration. Never contacts the database in backend/.env."""
import os

os.environ['DATABASE_URL'] = 'postgresql://unused:unused@invalid/never_connected'
os.environ['DJANGO_SECRET_KEY'] = 'isolated-test-key-not-used-by-the-application'
from .settings import *  # noqa: E402,F403

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
DJANGO_API_ENABLED = True
PASSWORD_RESET_EMAIL_ENABLED = True
SHEETS_SYNC_ENABLED = True
DEBUG = False
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
MAILERS = {'default': {'BACKEND': 'django.core.mail.backends.locmem.EmailBackend'}}
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECRET_KEY = 'isolated-test-key-not-used-by-the-application'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
