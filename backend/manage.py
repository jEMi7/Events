#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    # Default-deny live migrations. --plan is read-only; isolated test settings
    # use SQLite. Set the approval flag only after reviewing the migration plan.
    if len(sys.argv) > 1 and sys.argv[1] in ('migrate', 'test') and '--plan' not in sys.argv:
        from django.conf import settings
        for index, arg in enumerate(sys.argv):
            if arg.startswith('--settings='):
                os.environ['DJANGO_SETTINGS_MODULE'] = arg.split('=', 1)[1]
            elif arg == '--settings' and index + 1 < len(sys.argv):
                os.environ['DJANGO_SETTINGS_MODULE'] = sys.argv[index + 1]
        if settings.DATABASES['default']['ENGINE'] == 'django.db.backends.postgresql':
            if sys.argv[1] == 'test':
                raise SystemExit('Tests must use --settings=config.test_settings. Testing against Neon is blocked.')
            if os.environ.get('ALLOW_NEON_MIGRATIONS') != '1':
                raise SystemExit('Neon migrations are blocked. Review INTEGRATION_PLAN.md and obtain approval before setting ALLOW_NEON_MIGRATIONS=1.')
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
