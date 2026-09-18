from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import WalletEntryKind
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class WalletAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An organization's spendable balance with this application.

    Money reaches a wallet when a tenant gives back time or capacity they had
    already paid for -- an immediate downgrade, a mid-period interval switch,
    a seat release. It leaves only by paying an invoice *here*. There is no
    payout path and no refund-to-card path, by design: this is application
    credit, not money held on a tenant's behalf.

    ``balance_cents`` is a cache of the ledger, not the source of truth. It
    exists so that rendering a billing page does not have to sum every entry
    an organization has ever accrued, and every write updates it inside the
    same transaction that appends the entry.
    """

    __tablename__ = "wallet_accounts"
    __table_args__ = (
        # One wallet per organization. Two would let a concurrent credit and
        # debit each pick a different row and silently diverge.
        Index("uq_wallet_accounts_organization_id", "organization_id", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    #: Single currency per wallet. A credit in another currency is refused
    #: rather than converted -- an implicit FX rate inside a billing ledger
    #: is a bug that only surfaces as a reconciliation mismatch months later.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")
    balance_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class WalletEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One movement of an organization's balance. Append-only.

    Entries are never updated and never deleted. An erroneous credit is
    undone by a ``reversal`` entry, so the history a tenant (or an auditor)
    reads is what actually happened rather than what the current code
    believes should have happened.

    ``balance_after_cents`` is recorded on each row so the ledger can be
    verified against the cached balance without replaying it, and so a
    statement line reads the way a bank statement does.
    """

    __tablename__ = "wallet_entries"
    __table_args__ = (
        Index("ix_wallet_entries_account_created", "wallet_account_id", "created_at"),
        Index("ix_wallet_entries_organization_id", "organization_id"),
        Index("ix_wallet_entries_invoice_id", "invoice_id"),
        # Replay protection. The events that credit a wallet -- a webhook
        # redelivery, a double-submitted downgrade -- are exactly the events
        # that arrive twice, and a credit applied twice is money invented.
        Index("uq_wallet_entries_idempotency_key", "idempotency_key", unique=True),
    )

    wallet_account_id: Mapped[str] = mapped_column(
        ForeignKey("wallet_accounts.id", ondelete="CASCADE"), nullable=False
    )
    #: Denormalised from the account so a tenant's history can be queried
    #: without a join, and so an entry remains attributable if the account
    #: row is ever rebuilt.
    organization_id: Mapped[str] = mapped_column(String(36), nullable=False)

    #: Signed: a credit is positive, a debit negative. One column rather than
    #: a direction flag plus a magnitude, so a balance is a SUM and cannot be
    #: got wrong by reading the flag the wrong way round.
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")

    kind: Mapped[WalletEntryKind] = mapped_column(Enum(WalletEntryKind), nullable=False)
    #: Tenant-facing. Printed verbatim on the billing page, so it names the
    #: plan and period rather than an internal identifier.
    description: Mapped[str] = mapped_column(String(255), nullable=False)

    #: SET NULL, not CASCADE: a voided or purged invoice must not take the
    #: record of the balance it consumed with it.
    invoice_id: Mapped[str | None] = mapped_column(
        ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True
    )
    charge_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    #: Set for a ``platform_grant``: who issued it.
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    #: Required for a grant, optional otherwise.
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
