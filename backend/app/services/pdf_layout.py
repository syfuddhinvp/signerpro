"""The house style for every PDF this product hands to a customer.

A receipt, a platform invoice and an audit certificate are three different
documents, but to whoever receives them they are all "the PDF from SignerPro".
They were each laid out by hand with bare ``canvas`` calls, in three different
margins, three type scales and three greys, which is how one product ends up
looking like three vendors.

``Sheet`` is a thin layer over ReportLab's canvas that owns the furniture --
margins, the cursor, the header band, rules, key/value rows, line-item tables,
totals and the page footer -- and leaves the canvas exposed as ``.canvas`` for
anything a document needs to draw for itself.

Two things it deliberately handles that hand-rolled layout kept getting wrong:

* **The cursor cannot run off the page.** ``space`` breaks to a new page when
  what comes next will not fit, so a receipt with many refund lines stops
  writing into the bottom margin and disappearing.
* **Text cannot run off the right edge.** Values are truncated to the column
  they were given, so a long document title overlaps nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdf_canvas

#: The palette, as RGB triples in ReportLab's 0..1 space. The same slate and
#: indigo as the mail, so a receipt and the mail carrying it match.
INK = (0.059, 0.090, 0.165)
BODY = (0.200, 0.255, 0.333)
MUTED = (0.392, 0.455, 0.545)
FAINT = (0.580, 0.639, 0.722)
RULE = (0.890, 0.906, 0.933)
PANEL = (0.973, 0.980, 0.988)
ACCENT = (0.310, 0.275, 0.898)

#: Status colours. Green reads as settled, amber as partial, red as reversed --
#: and each is stated in words as well, because colour alone is not a message a
#: printed page or a colour-blind reader can rely on.
POSITIVE = (0.086, 0.463, 0.243)
WARNING = (0.706, 0.404, 0.047)
NEGATIVE = (0.686, 0.184, 0.145)

MARGIN = 54.0
FOOTER_HEIGHT = 46.0


@dataclass
class Sheet:
    """One PDF being laid out, top-down.

    ``y`` is the baseline the next thing will be drawn at, counted from the top
    of the page rather than ReportLab's bottom-left origin -- every layout
    decision here is "how far down the page", and flipping that arithmetic by
    hand at each call site is where off-page text comes from.
    """

    pagesize: tuple[float, float] = LETTER
    margin: float = MARGIN
    #: Drawn at the foot of every page. Set once; each page gets it on break.
    footer: str | None = None
    canvas: pdf_canvas.Canvas = field(init=False)
    y: float = field(init=False)
    _buffer: object = field(init=False)
    _page: int = field(init=False, default=1)

    def __post_init__(self) -> None:
        from io import BytesIO

        self._buffer = BytesIO()
        self.canvas = pdf_canvas.Canvas(self._buffer, pagesize=self.pagesize)
        self.y = self.height - self.margin

    # -- geometry ---------------------------------------------------------

    @property
    def width(self) -> float:
        return self.pagesize[0]

    @property
    def height(self) -> float:
        return self.pagesize[1]

    @property
    def left(self) -> float:
        return self.margin

    @property
    def right(self) -> float:
        return self.width - self.margin

    @property
    def content_width(self) -> float:
        return self.right - self.left

    def space(self, amount: float, *, keep: float = 0.0) -> None:
        """Move down, breaking the page if ``keep`` points will not fit after.

        Callers pass ``keep`` for the height of the block they are about to
        draw, so a section heading never lands alone at the foot of a page with
        its rows on the next one.
        """
        self.y -= amount
        if self.y - keep < self.margin + FOOTER_HEIGHT:
            self.page_break()

    def page_break(self) -> None:
        self._finish_page()
        self.canvas.showPage()
        self._page += 1
        self.y = self.height - self.margin

    # -- primitives -------------------------------------------------------

    def _set(self, font: str, size: float, color: tuple[float, float, float]) -> None:
        self.canvas.setFont(font, size)
        self.canvas.setFillColorRGB(*color)

    def _fit(self, text: str, font: str, size: float, max_width: float) -> str:
        """Truncate to the column, with an ellipsis so the cut is visible.

        A silently clipped value looks like a shorter value; an ellipsis says
        there was more, which matters when the field is a document title
        somebody is trying to match against their records.
        """
        if max_width <= 0 or stringWidth(text, font, size) <= max_width:
            return text
        ellipsis = "…"
        while text and stringWidth(text + ellipsis, font, size) > max_width:
            text = text[:-1]
        return text + ellipsis

    def text(
        self,
        value: str,
        *,
        x: float | None = None,
        size: float = 9.5,
        bold: bool = False,
        color: tuple[float, float, float] = BODY,
        align: str = "left",
        max_width: float | None = None,
    ) -> None:
        """One line at the cursor. Does not advance it -- callers space."""

        font = "Helvetica-Bold" if bold else "Helvetica"
        x = self.left if x is None else x
        # `x` is the anchor, not the start: for a right-aligned value the room
        # available runs back towards the left margin. Measuring it forwards
        # gave a right-aligned label ten points of room and truncated it to an
        # ellipsis, which is how a payment status vanished off a certificate.
        if max_width is not None:
            limit = max_width
        elif align == "right":
            limit = x - self.left
        elif align == "center":
            limit = 2 * min(x - self.left, self.right - x)
        else:
            limit = self.right - x
        self._set(font, size, color)
        drawn = self._fit(str(value), font, size, limit)
        if align == "right":
            self.canvas.drawRightString(x, self.y, drawn)
        elif align == "center":
            self.canvas.drawCentredString(x, self.y, drawn)
        else:
            self.canvas.drawString(x, self.y, drawn)

    def rule(self, *, color: tuple[float, float, float] = RULE, width: float = 0.75) -> None:
        self.canvas.setStrokeColorRGB(*color)
        self.canvas.setLineWidth(width)
        self.canvas.line(self.left, self.y, self.right, self.y)

    # -- composed blocks --------------------------------------------------

    def header(
        self,
        *,
        title: str,
        eyebrow: str | None = None,
        reference: str | None = None,
        issuer: str | None = None,
        issued: str | None = None,
        logo: bytes | None = None,
    ) -> None:
        """The masthead: what this document is, who issued it, its reference.

        Laid out as two columns -- identity on the left, reference and date
        right-aligned -- because that is where a reader's eye goes looking for
        an invoice number, and it is what every accounting system's export
        looks like.
        """
        if logo:
            try:
                image = ImageReader(__import__("io").BytesIO(logo))
                iw, ih = image.getSize()
                scale = min(120.0 / iw, 34.0 / ih)
                self.canvas.drawImage(
                    image,
                    self.left,
                    self.y - ih * scale + 8,
                    width=iw * scale,
                    height=ih * scale,
                    mask="auto",
                )
                self.space(ih * scale + 14)
            except Exception:
                # A logo that will not decode is a cosmetic problem. Failing
                # the whole receipt over it would turn it into a billing one.
                pass

        if eyebrow:
            self.text(eyebrow.upper(), size=8, bold=True, color=FAINT)
            self.space(17)

        # The title gets whatever the reference beside it does not need, rather
        # than a fixed share: a document with a long name and a short reference
        # should not have its name cut off to reserve room nothing will use.
        reserved = (stringWidth(reference, "Helvetica-Bold", 11) + 24) if reference else 0
        self.text(title, size=19, bold=True, color=INK, max_width=self.content_width - reserved)
        if reference:
            self.text(reference, x=self.right, size=11, bold=True, color=INK, align="right")
        self.space(15)

        if issuer:
            self.text(issuer, size=9, color=MUTED, max_width=self.content_width * 0.6)
        if issued:
            self.text(issued, x=self.right, size=9, color=MUTED, align="right")
        self.space(16)
        self.rule()
        self.space(24)

    def badge(self, label: str, color: tuple[float, float, float]) -> None:
        """A filled status pill -- the one thing a reader must not misread.

        A refunded receipt that looks like a paid one is the failure this is
        here to prevent, so the status gets a shape of its own rather than
        being one grey row among many.
        """
        font, size = "Helvetica-Bold", 8.5
        text_width = stringWidth(label, font, size)
        pad_x, pad_y, height = 9.0, 5.0, 18.0
        self.canvas.setFillColorRGB(*color)
        self.canvas.roundRect(
            self.left, self.y - pad_y, text_width + pad_x * 2, height, 4, stroke=0, fill=1
        )
        self._set(font, size, (1, 1, 1))
        self.canvas.drawString(self.left + pad_x, self.y, label)
        self.space(30)

    def section(self, title: str) -> None:
        """A small tracked heading over a group of rows."""

        self.space(6, keep=40)
        self.text(title.upper(), size=8, bold=True, color=FAINT)
        self.space(15)

    def row(self, label: str, value: str, *, label_width: float = 150.0) -> None:
        """One label/value line: muted label, dark value, fixed gutter.

        The value is always the bolder of the two. A reader scanning a receipt
        is looking for the values, not the labels, and the labels are the same
        on every receipt they will ever see.
        """
        self.text(label, size=9, color=MUTED, max_width=label_width - 8)
        self.text(
            value,
            x=self.left + label_width,
            size=9,
            bold=True,
            color=INK,
            max_width=self.right - self.left - label_width,
        )
        self.space(16, keep=20)

    def rows(self, pairs: list[tuple[str, str | None]], *, label_width: float = 150.0) -> None:
        """Several rows, skipping any whose value is empty.

        An empty value is a field this document does not have, and a page of
        "--" tells the reader nothing they could not infer from its absence.
        """
        for label, value in pairs:
            if value is None or not str(value).strip():
                continue
            self.row(label, str(value), label_width=label_width)

    def table(
        self,
        *,
        headers: tuple[str, str],
        lines: list[tuple[str, str]],
        empty: str = "No line items",
    ) -> None:
        """A two-column description/amount table with a zebra-free rule style.

        Amounts are right-aligned on the margin so that the decimal points line
        up down the column, which is the only way a reader can add them up by
        eye and check the total.
        """
        self.text(headers[0], size=8, bold=True, color=FAINT)
        self.text(headers[1].upper(), x=self.right, size=8, bold=True, color=FAINT, align="right")
        self.space(8)
        self.rule()
        self.space(16, keep=30)

        if not lines:
            self.text(empty, size=9, color=MUTED)
            self.space(16)
        for description, amount in lines:
            self.text(description, size=9.5, color=BODY, max_width=self.content_width - 140)
            self.text(amount, x=self.right, size=9.5, color=INK, align="right")
            self.space(17, keep=30)

        self.space(2)
        self.rule()
        self.space(18)

    def totals(self, entries: list[tuple[str, str, bool]]) -> None:
        """The right-hand money stack. Each entry is (label, amount, emphasis).

        Anchored to the right margin rather than centred under the table: the
        total belongs in the same column as the amounts it sums.
        """
        # The labels get their own column wide enough for the longest of them
        # ("Net retained after refunds"), because a label that grows into the
        # amount beside it is how a total becomes unreadable.
        label_x = self.right - 210
        amount_x = self.right
        for label, amount, strong in entries:
            if strong:
                self.space(4)
                self.canvas.setStrokeColorRGB(*RULE)
                self.canvas.setLineWidth(0.75)
                self.canvas.line(label_x, self.y + 10, amount_x, self.y + 10)
                self.space(4)
            self.text(
                label,
                x=label_x,
                size=9.5 if not strong else 10.5,
                bold=strong,
                color=INK if strong else MUTED,
                max_width=amount_x - label_x - 95,
            )
            self.text(
                amount,
                x=amount_x,
                size=9.5 if not strong else 12,
                bold=True,
                color=INK,
                align="right",
            )
            self.space(18 if not strong else 22, keep=24)

    def fine_print(self, lines: list[str]) -> None:
        """Checksums, merchant-of-record statements, linked audit ids."""

        self.space(6)
        for line in lines:
            if not line:
                continue
            self.text(line, size=7.5, color=MUTED)
            self.space(11, keep=14)

    # -- finishing --------------------------------------------------------

    def _finish_page(self) -> None:
        """Rule, footer note and page number, at the foot of the page.

        Drawn on break and on save rather than up front, because the page count
        is not known until the document is finished -- and a footer written
        before the content can be overwritten by content that overflows.
        """
        baseline = self.margin + 18
        self.canvas.setStrokeColorRGB(*RULE)
        self.canvas.setLineWidth(0.5)
        self.canvas.line(self.left, baseline + 12, self.right, baseline + 12)
        self.canvas.setFont("Helvetica", 7.5)
        self.canvas.setFillColorRGB(*FAINT)
        if self.footer:
            self.canvas.drawString(
                self.left, baseline, self._fit(self.footer, "Helvetica", 7.5, self.content_width - 60)
            )
        self.canvas.drawRightString(self.right, baseline, f"Page {self._page}")

    def save(self) -> bytes:
        self._finish_page()
        self.canvas.showPage()
        self.canvas.save()
        return self._buffer.getvalue()
