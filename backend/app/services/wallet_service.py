"""Application credit held for an organization (BIL-12).

Value a tenant gives back -- the unused half of a plan they downgraded out of,
the remainder of a month when they switched to annual billing, seats they
released -- stays here as balance and is spent on their next invoice. It never
returns to a card or a bank account, and this module exposes no way for it to:
there is a ``credit`` and there is a ``spend``, and ``spend`` only targets an
`Invoice`.

The ledger (`WalletEntry`) is the truth and is append-only.
``WalletAccount.balance_cents`` is a cache maintained in the same transaction,
so a billing page does not have to sum a tenant's entire history.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.enums import WalletEntryKind
from app.models.invoice import Invoice
from app.models.wallet import WalletAccount, WalletEntry


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class WalletService:
    # ----------------------------------------------------------- accounts

    def get_account(self, db: Session, organization_id: str) -> WalletAccount | None:
        return db.scalar(
            select(WalletAccount).where(WalletAccount.organization_id == organization_id)
        )

    def get_or_create_account(
        self, db: Session, organization_id: str, *, currency: str = "USD"
    ) -> WalletAccount:
        account = self.get_account(db, organization_id)
        if account is not None:
            return account
        account = WalletAccount(
            organization_id=organization_id, currency=currency.upper(), balance_cents=0
        )
        db.add(account)
        try:
            db.flush()
        except IntegrityError:
            # Two concurrent first-time credits both found no row. The unique
            # index decided which one wins; the loser re-reads it.
            db.rollback()
            existing = self.get_account(db, organization_id)
            if existing is None:
                raise
            return existing
        return account

    def _locked_account(
        self, db: Session, organization_id: str, *, currency: str = "USD"
    ) -> WalletAccount:
        """The account, row-locked for the rest of the transaction.

        Every balance mutation goes through here. Without the lock, a renewal
        collecting an invoice and an admin paying one by hand can both read
        the same balance and each spend it, taking the wallet negative.
        """
        self.get_or_create_account(db, organization_id, currency=currency)
        account = db.scalar(
            select(WalletAccount)
            .where(WalletAccount.organization_id == organization_id)
            .with_for_update()
        )
        if account is None:  # pragma: no cover - created immediately above
            raise HTTPException(status_code=500, detail="Wallet account could not be opened")
        return account

    def balance_cents(self, db: Session, organization_id: str) -> int:
        account = self.get_account(db, organization_id)
        return int(account.balance_cents) if account else 0

    # ------------------------------------------------------------ writing

    def _append(
        self,
        db: Session,
        *,
        account: WalletAccount,
        amount_cents: int,
        kind: WalletEntryKind,
        description: str,
        invoice_id: str | None = None,
        charge_id: str | None = None,
        actor_user_id: str | None = None,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> WalletEntry:
        account.balance_cents = int(account.balance_cents) + amount_cents
        entry = WalletEntry(
            wallet_account_id=account.id,
            organization_id=account.organization_id,
            amount_cents=amount_cents,
            balance_after_cents=account.balance_cents,
            currency=account.currency,
            kind=kind,
            description=description,
            invoice_id=invoice_id,
            charge_id=charge_id,
            actor_user_id=actor_user_id,
            reason=reason,
            idempotency_key=idempotency_key,
            occurred_at=_utcnow(),
        )
        db.add(account)
        db.add(entry)
        db.flush()
        return entry

    def _replayed(self, db: Session, idempotency_key: str | None) -> WalletEntry | None:
        if not idempotency_key:
            return None
        return db.scalar(
            select(WalletEntry).where(WalletEntry.idempotency_key == idempotency_key)
        )

    def credit(
        self,
        db: Session,
        *,
        organization_id: str,
        amount_cents: int,
        kind: WalletEntryKind,
        description: str,
        currency: str = "USD",
        invoice_id: str | None = None,
        actor_user_id: str | None = None,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> WalletEntry | None:
        """Add balance. Returns ``None`` for a zero credit.

        A repeated ``idempotency_key`` returns the original entry without
        crediting again -- the events that credit a wallet (a redelivered
        webhook, a double-clicked downgrade) are exactly the events that
        arrive twice.
        """
        amount_cents = int(amount_cents)
        if amount_cents == 0:
            return None
        if amount_cents < 0:
            raise ValueError("credit() takes a positive amount; use spend_on_invoice to debit")

        replay = self._replayed(db, idempotency_key)
        if replay is not None:
            return replay

        account = self._locked_account(db, organization_id, currency=currency)
        if account.currency != currency.upper():
            # Converting here would bury an implicit FX rate inside the
            # billing ledger. A mismatch is a bug to surface, not to paper.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot credit {currency.upper()} to a {account.currency} wallet; "
                    "the organization's billing currency changed"
                ),
            )
        return self._append(
            db,
            account=account,
            amount_cents=amount_cents,
            kind=kind,
            description=description,
            invoice_id=invoice_id,
            actor_user_id=actor_user_id,
            reason=reason,
            idempotency_key=idempotency_key,
        )

    def spend_on_invoice(
        self,
        db: Session,
        *,
        invoice: Invoice,
        max_cents: int | None = None,
    ) -> int:
        """Draw balance down against ``invoice``. Returns the cents applied.

        Bounded by both the balance and the invoice's outstanding amount, so
        it can neither take the wallet negative nor overpay. Callers charge
        only what this leaves behind.
        """
        outstanding = invoice.amount_due_cents
        if max_cents is not None:
            outstanding = min(outstanding, max(0, int(max_cents)))
        if outstanding <= 0:
            return 0

        account = self._locked_account(db, invoice.organization_id, currency=invoice.currency)
        if account.currency != (invoice.currency or "USD").upper():
            # Spending across currencies has the same problem as crediting
            # across them, but here the safe answer is simply not to spend:
            # the invoice is still collectable by card.
            return 0
        applied = min(int(account.balance_cents), outstanding)
        if applied <= 0:
            return 0

        self._append(
            db,
            account=account,
            amount_cents=-applied,
            kind=WalletEntryKind.invoice_payment,
            description=f"Applied to invoice {invoice.number}",
            invoice_id=invoice.id,
            # Keyed on the invoice and the amount already paid, so retrying a
            # collection that failed at the card step does not draw twice.
            idempotency_key=f"invoice:{invoice.id}:draw:{invoice.amount_paid_cents}",
        )
        return applied

    def reverse(
        self,
        db: Session,
        *,
        organization_id: str,
        amount_cents: int,
        description: str,
        reason: str | None = None,
        actor_user_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> WalletEntry | None:
        """Undo an earlier credit with a matching negative entry.

        Entries are never edited or deleted, so this is the only way to
        correct one. It may take the balance below what a naive caller
        expects but never below zero.
        """
        amount_cents = abs(int(amount_cents))
        if amount_cents == 0:
            return None
        replay = self._replayed(db, idempotency_key)
        if replay is not None:
            return replay
        account = self._locked_account(db, organization_id)
        applied = min(int(account.balance_cents), amount_cents)
        if applied <= 0:
            return None
        return self._append(
            db,
            account=account,
            amount_cents=-applied,
            kind=WalletEntryKind.reversal,
            description=description,
            reason=reason,
            actor_user_id=actor_user_id,
            idempotency_key=idempotency_key,
        )

    # ------------------------------------------------------------ reading

    def history(
        self, db: Session, organization_id: str, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[WalletEntry], int]:
        total = int(
            db.scalar(
                select(func.count(WalletEntry.id)).where(
                    WalletEntry.organization_id == organization_id
                )
            )
            or 0
        )
        rows = list(
            db.scalars(
                select(WalletEntry)
                .where(WalletEntry.organization_id == organization_id)
                .order_by(WalletEntry.created_at.desc(), WalletEntry.id.desc())
                .limit(max(1, min(limit, 200)))
                .offset(max(0, offset))
            )
        )
        return rows, total

    def summary(self, db: Session, organization_id: str) -> dict[str, Any]:
        account = self.get_account(db, organization_id)
        return {
            "balance_cents": int(account.balance_cents) if account else 0,
            "currency": account.currency if account else "USD",
            # Stated in the payload rather than only in the UI: a client that
            # renders a balance should not have to guess whether it is
            # withdrawable.
            "withdrawable": False,
        }

    def verify_balance(self, db: Session, organization_id: str) -> dict[str, Any]:
        """Compare the cached balance with the ledger it summarises.

        A drift here means a write bypassed ``_append``. Used by tests and by
        the platform tenant view rather than by any tenant-facing path.
        """
        account = self.get_account(db, organization_id)
        ledger = int(
            db.scalar(
                select(func.coalesce(func.sum(WalletEntry.amount_cents), 0)).where(
                    WalletEntry.organization_id == organization_id
                )
            )
            or 0
        )
        cached = int(account.balance_cents) if account else 0
        return {"cached_cents": cached, "ledger_cents": ledger, "consistent": cached == ledger}


wallet_service = WalletService()
