from django.conf import settings
from rest_framework import serializers


class SignUploadRequestSerializer(serializers.Serializer[dict[str, object]]):
    purpose = serializers.ChoiceField(choices=sorted(settings.MEDIA_UPLOAD_RULES))
    filename = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)


class SignUploadResponseSerializer(serializers.Serializer[dict[str, object]]):
    upload_url = serializers.URLField()
    api_key = serializers.CharField()
    signature = serializers.CharField()
    public_id = serializers.CharField()
    timestamp = serializers.IntegerField()
    allowed_formats = serializers.CharField(required=False, help_text="Images only.")
    overwrite = serializers.CharField()
    resource_type = serializers.ChoiceField(choices=["image", "raw"])
