from django.contrib import admin
from django.contrib.auth.models import Group
from .models import Product, Signal, Snippet
# Register your models here.
#customize admin section
admin.site.site_header = "Studybuddy Admin"

class SnippetAdmin(admin.ModelAdmin):
    #exclude= ('title',)
    fields = ('title',)
    list_display=('title','created',)
    list_filter=('created',)
    #change_list_template='admin/snippets/snippets_change_list.html'

class DontLog:
    def log_addition(self, *args):
        return
    def log_deletion(self, *args):
        return
    def log_change(self, *args):
        return

@admin.register(Product)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass
@admin.register(Signal)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass
@admin.register(Snippet)
class CategoryAdmin(DontLog, admin.ModelAdmin):
    pass