"""The house style for every message this product sends.

Three separate shells used to exist -- one inside the invitation builder, one
inside the outbox composer, and nothing at all for the transactional mail that
went out as bare text. They drifted, as three copies of a design do, and the
mail a customer actually receives arrived looking like three different
companies. This module is the single one they all call now.

Everything here is deliberately old-fashioned HTML: nested tables, inline
styles, no stylesheet, no flexbox, no web fonts. That is not conservatism for
its own sake -- Outlook renders with Word's engine, Gmail strips ``<style>``
blocks on forwarded mail, and every client disagrees about margins. The subset
below is what survives all of them intact.

Two rules hold throughout:

* **Every caller-supplied string is escaped here.** Tenant names, invite
  messages, signer names and admin-composed bodies are data typed by one person
  and rendered in another person's mail client. A builder that took ready-made
  markup would make the compose form an injection vector, so none of them do.
* **The HTML part is never the only part.** Each caller passes a plain-text
  body alongside; a client that refuses HTML, or a screen reader working from
  the text part, still receives the whole message.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

#: The unbranded palette. Slate text on a soft grey page, with an indigo accent
#: that matches the app's own -- an unbranded tenant should look deliberate
#: rather than unfinished.
INK = "#0f172a"
BODY = "#334155"
MUTED = "#64748b"
FAINT = "#94a3b8"
RULE = "#e3e7ee"
PAGE = "#f5f6f8"
CARD = "#ffffff"
ACCENT = "#4f46e5"
ACCENT_TEXT = "#ffffff"
PANEL = "#f8fafc"

#: One family for the whole message. Helvetica/Arial resolve everywhere; the
#: rest of the stack is there for clients that have something nicer.
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,monospace"

#: `logo_position` -> the alignment the header cell needs.
_ALIGN = {"left": "left", "center": "center", "right": "right"}


@dataclass(frozen=True)
class Brand:
    """How one message should look, resolved from a tenant's theme or stock.

    A dataclass rather than the theme row itself so that callers without a
    theme -- password resets, member invitations, the outbox composer -- get
    the same builders without inventing a theme to pass.
    """

    name: str | None = None
    logo_url: str | None = None
    logo_position: str = "left"
    accent: str = ACCENT
    accent_text: str = ACCENT_TEXT
    reply_to: str | None = None
    signature: str | None = None

    @classmethod
    def from_theme(cls, theme, *, logo_url: str | None = None, name: str | None = None) -> "Brand":
        """Read a ``BrandingTheme`` row, falling back to stock for blanks.

        A theme with an empty colour is a theme that never set one, not a theme
        that wants black: every field falls back individually.
        """
        if theme is None:
            return cls(name=name, logo_url=logo_url)
        return cls(
            name=name,
            logo_url=logo_url if logo_url is not None else theme.logo_url,
            logo_position=theme.logo_position or "left",
            accent=theme.primary_color or ACCENT,
            accent_text=theme.primary_text_color or ACCENT_TEXT,
            reply_to=theme.contact_sender_email,
            signature=theme.footer_signature,
        )


def paragraph(text: str, *, color: str = BODY, size: str = "15px") -> str:
    """One escaped paragraph, with single newlines kept as line breaks."""

    safe = escape(text.strip()).replace("\n", "<br />")
    return (
        f'<p style="margin:0 0 16px;font-family:{FONT};font-size:{size};'
        f'line-height:1.65;color:{color};">{safe}</p>'
    )


def paragraphs(text: str, *, color: str = BODY, size: str = "15px") -> str:
    """A block of text split into paragraphs on blank lines.

    What someone typing into a textarea means by an empty line is a new
    paragraph, so that is what they get.
    """
    blocks = [b for b in text.strip().split("\n\n") if b.strip()]
    return "".join(paragraph(b, color=color, size=size) for b in blocks)


def heading(text: str) -> str:
    """The one line saying what this message is about."""

    return (
        f'<h1 style="margin:0 0 14px;font-family:{FONT};font-size:21px;'
        f'line-height:1.35;font-weight:600;letter-spacing:-0.01em;'
        f'color:{INK};">{escape(text)}</h1>'
    )


def eyebrow(text: str) -> str:
    """The small tracked label above a heading -- "Payment receipt", "Invoice"."""

    return (
        f'<p style="margin:0 0 8px;font-family:{FONT};font-size:11px;'
        f'font-weight:700;letter-spacing:0.09em;text-transform:uppercase;'
        f'color:{FAINT};">{escape(text)}</p>'
    )


def button(label: str, href: str, brand: Brand | None = None) -> str:
    """The single call to action, as a table so Outlook gives it its padding.

    A bare padded ``<a>`` collapses in Word's rendering engine, which is how a
    prominent button becomes an underlined word. The table is the workaround
    every mail template arrives at eventually.
    """
    brand = brand or Brand()
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        'style="margin:4px 0 20px;"><tr><td align="center" '
        f'style="border-radius:10px;background:{escape(brand.accent, quote=True)};">'
        f'<a href="{escape(href, quote=True)}" '
        f'style="display:inline-block;padding:13px 26px;font-family:{FONT};'
        f'font-size:15px;font-weight:600;line-height:1;text-decoration:none;'
        f'color:{escape(brand.accent_text, quote=True)};">{escape(label)}</a>'
        "</td></tr></table>"
    )


def fallback_link(href: str) -> str:
    """The URL in full, for whoever cannot click the button.

    Word-break is set because a signing token is one unbroken 40-character
    string, and without it the card grows a horizontal scrollbar.
    """
    safe = escape(href, quote=True)
    return (
        f'<p style="margin:0 0 16px;font-family:{FONT};font-size:12px;'
        f'line-height:1.6;color:{MUTED};">Or paste this link into your browser:'
        f'<br /><a href="{safe}" style="color:{MUTED};word-break:break-all;">'
        f"{escape(href)}</a></p>"
    )


def details(rows: list[tuple[str, str]]) -> str:
    """A label/value panel -- what the message is about, at a glance.

    Rows with an empty value are dropped rather than rendered blank: a receipt
    with no tax line reads better without a "Tax --" row in it.
    """
    cells = "".join(
        f'<tr><td style="padding:5px 0;font-family:{FONT};font-size:13px;'
        f'color:{MUTED};white-space:nowrap;">{escape(label)}</td>'
        f'<td style="padding:5px 0 5px 18px;font-family:{FONT};font-size:13px;'
        f'font-weight:600;color:{INK};" align="right">{escape(value)}</td></tr>'
        for label, value in rows
        if str(value).strip()
    )
    if not cells:
        return ""
    # The padding lives on an inner cell rather than on the panel's own table:
    # Word's rendering engine ignores `padding` on a table, which would leave
    # the text sitting flush against the border in Outlook.
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:0 0 20px;background:{PANEL};border:1px solid {RULE};'
        'border-radius:10px;"><tr><td style="padding:14px 18px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        f"{cells}</table></td></tr></table>"
    )


def code_panel(code: str) -> str:
    """A one-time passcode, spaced so it can be read aloud or retyped."""

    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:4px 0 18px;background:{PANEL};border:1px solid {RULE};'
        'border-radius:10px;"><tr><td align="center" style="padding:20px 16px;">'
        f'<span style="font-family:{MONO};font-size:31px;font-weight:700;'
        f'letter-spacing:0.22em;color:{INK};">{escape(code)}</span>'
        "</td></tr></table>"
    )


def divider() -> str:
    return f'<hr style="border:0;border-top:1px solid {RULE};margin:22px 0 18px;" />'


def note(text: str) -> str:
    """Fine print: expiry, "ignore this if it wasn't you", merchant of record."""

    return paragraph(text, color=MUTED, size="12px")


def _header(brand: Brand) -> str:
    """The logo, or the tenant's name set as one when there is no logo.

    An unbranded tenant gets neither: borrowing SignerPro's mark for someone
    else's mail would misattribute the message.
    """
    align = _ALIGN.get(brand.logo_position, "left")
    if brand.logo_url:
        # `alt` is empty on purpose -- the logo sits beside a heading that
        # already says what the message is, and a screen reader announcing the
        # company name twice is noise.
        return (
            f'<div style="text-align:{align};margin:0 0 22px;">'
            f'<img src="{escape(brand.logo_url, quote=True)}" alt="" '
            'style="max-height:40px;max-width:190px;border:0;" /></div>'
        )
    if brand.name:
        return (
            f'<div style="text-align:{align};margin:0 0 22px;font-family:{FONT};'
            f'font-size:15px;font-weight:700;letter-spacing:-0.01em;color:{INK};">'
            f"{escape(brand.name)}</div>"
        )
    return ""


def _footer(brand: Brand, *, footer: str | None) -> str:
    """The signature block under the card's rule.

    Sits *inside* the card rather than below it: mail clients that invert
    colours in dark mode leave the page background alone, and text placed on it
    is the first thing to become unreadable.
    """
    parts: list[str] = []
    if brand.reply_to:
        parts.append(note(f"Questions? Reply to {brand.reply_to}."))
    if brand.signature:
        parts.append(paragraph(brand.signature, color=MUTED, size="12px"))
    if footer:
        parts.append(note(footer))
    if not parts:
        return ""
    return divider() + "".join(parts)


def shell(
    content: str,
    *,
    brand: Brand | None = None,
    preheader: str | None = None,
    footer: str | None = None,
) -> str:
    """Wrap assembled blocks in the standard card.

    ``preheader`` is the line an inbox shows beside the subject. It is hidden
    in the body itself: without one, clients pull the first visible words
    instead, which for a branded message is whatever the logo's surroundings
    happen to be.
    """
    brand = brand or Brand()
    hidden = ""
    if preheader:
        hidden = (
            '<div style="display:none;max-height:0;overflow:hidden;opacity:0;'
            f'mso-hide:all;">{escape(preheader)}</div>'
        )
    return (
        "<!doctype html><html><head>"
        '<meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width,initial-scale=1" />'
        '<meta name="color-scheme" content="light" />'
        "</head>"
        f'<body style="margin:0;padding:0;background:{PAGE};">'
        f"{hidden}"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{PAGE};padding:32px 12px;"><tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="width:600px;max-width:100%;background:{CARD};border-radius:16px;'
        f'border:1px solid {RULE};"><tr><td style="padding:32px 32px 28px;">'
        f"{_header(brand)}{content}{_footer(brand, footer=footer)}"
        "</td></tr></table>"
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="width:600px;max-width:100%;"><tr><td align="center" '
        f'style="padding:16px 8px 0;font-family:{FONT};font-size:11px;'
        f'line-height:1.6;color:{FAINT};">Sent by SignerPro</td></tr></table>'
        "</td></tr></table></body></html>"
    )
