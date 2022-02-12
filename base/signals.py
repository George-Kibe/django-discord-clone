from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.dispatch import receiver
from signalstest.models import Signal

@receiver(user_logged_in)
def user_login(sender, user, request, **kwargs):
    signal=Signal(name=user.username, description="Logged in")
    signal.save()
    print(user.username+" Logged in at "+str(signal.date))

@receiver(user_logged_out)
def user_logout(sender, user, request, **kwargs):
    signal=Signal(name=user.username, description="Logged out")
    signal.save()
    print(user.username+" Logged out at "+str(signal.date))

@receiver(user_login_failed)
def user_login_fail(sender, credentials, request, **kwargs):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    username=credentials['username']
    signal=Signal(name=username, description="Failed login Attempt at ip address:"+ip)
    signal.save()
    print(username+" Failed login Attempt at ip address:"+ip+" on "+str(signal.date))