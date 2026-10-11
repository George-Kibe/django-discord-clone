from factory.declarations import Sequence
from factory.django import DjangoModelFactory, Password
from factory.faker import Faker

from apps.accounts.models import User


class UserFactory(DjangoModelFactory[User]):
    class Meta:
        model = User
        skip_postgeneration_save = True

    email = Sequence(lambda n: f"user{n}@example.com")
    username = Sequence(lambda n: f"user{n}")
    display_name = Faker("name")
    password = Password("correct-horse-battery")
