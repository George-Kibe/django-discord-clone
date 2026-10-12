"""Transcript rendering with reportlab (the legacy app's PDF library)."""

import re
from collections.abc import Iterable
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

import reportlab
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

_REPORTLAB_FONTS = Path(reportlab.__file__).parent / "fonts"
_FONT_CANDIDATES = [
    # DejaVu covers far more scripts; reportlab's bundled Vera is the fallback.
    (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ),
    (_REPORTLAB_FONTS / "Vera.ttf", _REPORTLAB_FONTS / "VeraBd.ttf"),
]
_registered = False


def _fonts() -> tuple[str, str]:
    global _registered
    if not _registered:
        for regular, bold in _FONT_CANDIDATES:
            if regular.exists() and bold.exists():
                pdfmetrics.registerFont(TTFont("Transcript", str(regular)))
                pdfmetrics.registerFont(TTFont("Transcript-Bold", str(bold)))
                break
        _registered = True
    return "Transcript", "Transcript-Bold"


USER_TOKEN = re.compile(r"<@([0-9a-fA-F-]{36})>")
ROLE_TOKEN = re.compile(r"<@&([0-9a-fA-F-]{36})>")


def readable(content: str, users: dict[str, str], roles: dict[str, str]) -> str:
    """Mention tokens → @names, then escaped for reportlab's mini-markup."""
    text = ROLE_TOKEN.sub(lambda m: f"@{roles.get(m.group(1), 'deleted-role')}", content)
    text = USER_TOKEN.sub(lambda m: f"@{users.get(m.group(1), 'unknown-user')}", text)
    return escape(text).replace("\n", "<br/>")


def render(
    path: str,
    *,
    title: str,
    subtitle: str,
    rows: Iterable[dict[str, Any]],
) -> int:
    """Write the PDF. ``rows``: {author, created_at, content, attachments, edited, reply_to}.
    Returns the number of messages written."""
    regular, bold = _fonts()
    styles = {
        "title": ParagraphStyle("title", fontName=bold, fontSize=16, leading=20, spaceAfter=4),
        "meta": ParagraphStyle(
            "meta",
            fontName=regular,
            fontSize=9,
            leading=12,
            textColor=HexColor("#555555"),
            spaceAfter=10,
        ),
        "head": ParagraphStyle("head", fontName=bold, fontSize=9.5, leading=12, spaceBefore=6),
        "body": ParagraphStyle("body", fontName=regular, fontSize=9.5, leading=13),
        "aside": ParagraphStyle(
            "aside",
            fontName=regular,
            fontSize=8.5,
            leading=11,
            textColor=HexColor("#666666"),
            leftIndent=8,
        ),
    }
    story: list[Any] = [
        Paragraph(escape(title), styles["title"]),
        Paragraph(escape(subtitle), styles["meta"]),
    ]
    count = 0
    for row in rows:
        count += 1
        when = row["created_at"].strftime("%Y-%m-%d %H:%M UTC")
        edited = " (edited)" if row.get("edited") else ""
        story.append(
            Paragraph(
                f"{escape(row['author'])} <font color='#777777'>{when}{edited}</font>",
                styles["head"],
            )
        )
        if row.get("reply_to"):
            story.append(Paragraph(f"↪ replying to {escape(row['reply_to'])}", styles["aside"]))
        if row["content"]:
            story.append(Paragraph(row["content"], styles["body"]))
        for name in row.get("attachments", []):
            story.append(Paragraph(f"[attachment: {escape(name)}]", styles["aside"]))
    if count == 0:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph("No messages in this range.", styles["body"]))

    def footer(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont(regular, 8)
        canvas.setFillColor("#888888")
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.drawString(15 * mm, 10 * mm, f"Exported {datetime.now():%Y-%m-%d}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="Discord Clone",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return count
