#django signals
from django.db.models import signals
from django.dispatch import receiver
from .models import Product, Signal

#After post signal
@receiver(signals.post_save, sender=Product)
def create_product(sender, instance, created, **kwargs):
    signal=Signal(name=instance.name, description=instance.description, date=instance.updated)
    signal.save()
    print(instance.name, instance.description, instance.created, instance.updated)

#Before saving signal
@receiver(signals.pre_save, sender=Product)
def check_product_desc(sender, instance, **kwargs):
    if not instance.description:
        instance.description = "Default description means user never put description"

#Before deleting signal
@receiver(signals.pre_delete, sender=Product)
def delete_product_signal(sender, instance, **kwargs):
    print("Item is about to be deleted")

#Before deleting signal
@receiver(signals.post_delete, sender=Product)
def deleted_product_signal(sender, instance, **kwargs):
    print("Item has been deleted")


