from django.contrib import admin
from .models import Room, Topic, Message

# Register your models here.
# admin.site.register(Room)
# admin.site.register(Topic)
# admin.site.register(Message)

class DontLog:
    def log_addition(self, *args):
        return
    def log_deletion(self, *args):
        return
    def log_change(self, *args):
        return

@admin.register(Room)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass
@admin.register(Topic)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass
@admin.register(Message)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass