"""refresh rotation tracking: user_sessions.rotated_at, replaced_by_id

Rotation revoked the presented refresh token on first use, with nothing
recording *why* a row was revoked or what replaced it. Two consequences:

1. The loser of a concurrent refresh -- two tabs refreshing a 15-minute access
   token on a 30s skew -- got a 401 and the user was signed out at random.
2. A spent refresh token replayed by an attacker was indistinguishable from
   that same benign race, so it was silently tolerated forever.

``rotated_at`` separates "retired by rotation" from "revoked by logout or an
admin", and ``replaced_by_id`` makes the rotation chain walkable so it can be
revoked as a unit when replay is detected.

Revision ID: a3c1d5e79b20
Revises: f2b7c81e4a90
"""

from alembic import op
import sqlalchemy as sa

revision = "a3c1d5e79b20"
down_revision = "f2b7c81e4a90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_sessions", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_sessions", sa.Column("replaced_by_id", sa.String(length=36), nullable=True))


def downgrade() -> None:
    op.drop_column("user_sessions", "replaced_by_id")
    op.drop_column("user_sessions", "rotated_at")
