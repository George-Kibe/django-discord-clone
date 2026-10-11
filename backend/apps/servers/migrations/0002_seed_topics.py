from django.db import migrations

TOPICS = [
    "Art", "Books", "Education", "Finance", "Fitness", "Food", "Gaming", "Movies & TV",
    "Music", "Programming", "Science", "Sports", "Study", "Technology", "Travel",
]


def seed(apps, schema_editor):
    Topic = apps.get_model("servers", "Topic")
    from django.utils.text import slugify

    for name in TOPICS:
        Topic.objects.get_or_create(slug=slugify(name), defaults={"name": name})


class Migration(migrations.Migration):
    dependencies = [("servers", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
