import re

from django.core import mail


def last_email_link(to: str | None = None) -> str:
    messages = [m for m in mail.outbox if to is None or to in m.to]
    assert messages, f"no email sent to {to}"
    match = re.search(r"https?://\S+", str(messages[-1].body))
    assert match, messages[-1].body
    return match.group(0)


def query_param(link: str, name: str) -> str:
    match = re.search(rf"[?&]{name}=([^&\s]+)", link)
    assert match, link
    return match.group(1)
