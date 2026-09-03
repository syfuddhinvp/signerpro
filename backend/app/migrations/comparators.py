"""Autogenerate comparators shared by ``env.py`` and the drift check script.

Kept in its own module because ``env.py`` is loaded by alembic through a file
path, not as an importable package member, so nothing else can import from it.
"""

from sqlalchemy.types import TypeDecorator


def compare_type(context, inspected_column, metadata_column, inspected_type, metadata_type):
    """Compare a ``TypeDecorator`` on the type it actually stores.

    ``EncryptedString(765)`` widens itself to ``VARCHAR(2295)`` in its
    constructor. Alembic compares the decorator's nominal form against the
    reflected ``VARCHAR`` and reports a diff on every single run -- permanent
    noise that would hide real drift. Compare the compiled DDL of the type the
    decorator genuinely stores instead.

    Returning ``None`` means "no opinion"; alembic then applies its default.
    """
    if isinstance(metadata_type, TypeDecorator):
        dialect = context.dialect
        stored = metadata_type.load_dialect_impl(dialect)
        return stored.compile(dialect) != inspected_type.compile(dialect)
    return None
