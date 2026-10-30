from django.conf import settings
from django.http import JsonResponse


class StagedAPIMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/v1/') and not settings.DJANGO_API_ENABLED:
            return JsonResponse({'detail': 'Django API is staged and disabled pending migration/cutover approval.'}, status=503)
        return self.get_response(request)
