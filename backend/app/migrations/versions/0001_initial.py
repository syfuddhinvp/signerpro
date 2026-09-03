"""initial schema

The literal baseline. This revision used to be ``Base.metadata.create_all``,
which meant the "initial schema" was whatever the models happened to be at the
moment you ran it (C10). Two databases bootstrapped from different commits got
different schemas while both reporting the same ``alembic_version``, revisions
0002..e1a9c3b45d10 were dead code on a fresh database, and ``compare_metadata()``
was guaranteed to return zero diffs no matter how far the models had drifted --
so drift detection was vacuous by construction.

The DDL below was generated from the model metadata as of commit 8d3316e -- the
exact schema the old ``create_all`` produced -- so any database already stamped
at any revision in this chain is byte-identical to it and needs no rewrite. It
is now frozen: from here on, every schema change is an explicit revision, and
``compare_metadata()`` returning empty actually means something.

See ``app/migrations/README.md`` for the re-stamp procedure.

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Columns backed by EncryptedString are declared here as plain
    # sa.String of the width they actually occupy. EncryptedString(n)
    # widens itself to max(n*3, n+120) in its constructor, so rendering the
    # decorator into a migration re-applies that widening and creates a column
    # three times too wide. A migration describes storage; the decorator is an
    # application-layer concern.
    op.create_table('billing_webhook_events',
    sa.Column('provider', sa.String(length=50), nullable=False),
    sa.Column('event_id', sa.String(length=255), nullable=False),
    sa.Column('event_type', sa.String(length=100), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('processed', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_billing_webhook_events_provider_event', 'billing_webhook_events', ['provider', 'event_id'], unique=True)
    op.create_table('certifications',
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('status', sa.String(length=20), server_default='certified', nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_certifications_name', 'certifications', ['name'], unique=True)
    op.create_table('organizations',
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=True),
    sa.Column('region', sa.String(length=40), nullable=True),
    sa.Column('company_size', sa.String(length=30), nullable=True),
    sa.Column('seats_licensed', sa.Integer(), server_default='0', nullable=False),
    sa.Column('accent_color', sa.String(length=9), nullable=True),
    sa.Column('logo_url', sa.String(length=1024), nullable=True),
    sa.Column('owner_user_id', sa.String(length=36), nullable=True),
    sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('suspension_reason', sa.String(length=255), nullable=True),
    sa.Column('autopay', sa.Boolean(), server_default='1', nullable=False),
    sa.Column('billing_email', sa.String(length=320), nullable=True),
    sa.Column('tax_id', sa.String(length=60), nullable=True),
    sa.Column('billing_cycle', sa.String(length=20), server_default='monthly', nullable=False),
    sa.Column('default_payment_method_id', sa.String(length=36), nullable=True),
    sa.Column('allowed_origins', sa.JSON(), nullable=True),
    sa.Column('default_return_url', sa.String(length=1024), nullable=True),
    sa.Column('live_mode_enabled', sa.Boolean(), server_default='1', nullable=False),
    sa.Column('smtp_host', sa.String(length=255), nullable=True),
    sa.Column('smtp_port', sa.Integer(), nullable=True),
    sa.Column('smtp_username', sa.String(length=255), nullable=True),
    sa.Column('smtp_password', sa.String(length=765), nullable=True),
    sa.Column('smtp_from_email', sa.String(length=255), nullable=True),
    sa.Column('sms_provider', sa.String(length=50), nullable=True),
    sa.Column('twilio_account_sid', sa.String(length=255), nullable=True),
    sa.Column('twilio_auth_token', sa.String(length=765), nullable=True),
    sa.Column('twilio_from_number', sa.String(length=50), nullable=True),
    sa.Column('telnyx_api_key', sa.String(length=765), nullable=True),
    sa.Column('telnyx_from_number', sa.String(length=50), nullable=True),
    sa.Column('subscription_tier', sa.String(length=50), nullable=False),
    sa.Column('subscription_status', sa.String(length=50), nullable=False),
    sa.Column('subscription_expires_at', sa.DateTime(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)
    op.create_table('plans',
    sa.Column('code', sa.String(length=50), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=True),
    sa.Column('price_cents', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('billing_interval', sa.String(length=20), nullable=False),
    sa.Column('trial_days', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('is_public', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('external_price_id', sa.String(length=255), nullable=True),
    sa.Column('entitlements', sa.JSON(), nullable=False),
    sa.Column('tag', sa.String(length=60), nullable=True),
    sa.Column('marketing_lines', sa.JSON(), nullable=True),
    sa.Column('seat_price_cents', sa.Integer(), nullable=True),
    sa.Column('is_seat_based', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_plans_code'), 'plans', ['code'], unique=True)
    op.create_table('cloud_targets',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('path', sa.String(length=512), nullable=True),
    sa.Column('enabled', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_cloud_targets_org_provider', 'cloud_targets', ['organization_id', 'provider'], unique=True)
    op.create_table('contact_groups',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_contact_groups_org_key', 'contact_groups', ['organization_id', 'key'], unique=True)
    op.create_table('integrations',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('detail', sa.String(length=255), nullable=True),
    sa.Column('connected', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('credentials', sa.String(length=6144), nullable=True),
    sa.Column('config', sa.JSON(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_integrations_org_provider', 'integrations', ['organization_id', 'provider'], unique=True)
    op.create_table('invoices',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('number', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('subtotal_cents', sa.Integer(), nullable=False),
    sa.Column('tax_cents', sa.Integer(), nullable=False),
    sa.Column('total_cents', sa.Integer(), nullable=False),
    sa.Column('amount_paid_cents', sa.Integer(), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('line_items', sa.JSON(), nullable=True),
    sa.Column('provider', sa.String(length=50), nullable=True),
    sa.Column('provider_invoice_id', sa.String(length=255), nullable=True),
    sa.Column('hosted_url', sa.String(length=1024), nullable=True),
    sa.Column('provider_payment_intent_id', sa.String(length=255), nullable=True),
    sa.Column('payment_method_label', sa.String(length=80), nullable=True),
    sa.Column('period_label', sa.String(length=30), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_invoices_number', 'invoices', ['number'], unique=True)
    op.create_index('ix_invoices_organization_id', 'invoices', ['organization_id'], unique=False)
    op.create_index('ix_invoices_status', 'invoices', ['status'], unique=False)
    op.create_table('payment_methods',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('type', sa.String(length=20), server_default='card', nullable=False),
    sa.Column('brand', sa.String(length=30), nullable=True),
    sa.Column('last4', sa.String(length=4), nullable=True),
    sa.Column('exp_month', sa.Integer(), nullable=True),
    sa.Column('exp_year', sa.Integer(), nullable=True),
    sa.Column('holder_name', sa.String(length=255), nullable=True),
    sa.Column('country', sa.String(length=2), nullable=True),
    sa.Column('label', sa.String(length=120), server_default='', nullable=False),
    sa.Column('meta', sa.String(length=255), nullable=True),
    sa.Column('po_number', sa.String(length=60), nullable=True),
    sa.Column('provider', sa.String(length=50), nullable=True),
    sa.Column('provider_payment_method_id', sa.String(length=255), nullable=True),
    sa.Column('is_default', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_payment_methods_organization_id', 'payment_methods', ['organization_id'], unique=False)
    op.create_table('subscriptions',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('plan_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('canceled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False),
    sa.Column('provider', sa.String(length=50), nullable=True),
    sa.Column('provider_customer_id', sa.String(length=255), nullable=True),
    sa.Column('provider_subscription_id', sa.String(length=255), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_subscriptions_organization_id', 'subscriptions', ['organization_id'], unique=False)
    op.create_index('ix_subscriptions_plan_id', 'subscriptions', ['plan_id'], unique=False)
    op.create_index(op.f('ix_subscriptions_provider_subscription_id'), 'subscriptions', ['provider_subscription_id'], unique=False)
    op.create_table('system_logs',
    sa.Column('organization_id', sa.String(length=36), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('level', sa.String(length=10), server_default='info', nullable=False),
    sa.Column('source', sa.String(length=20), server_default='api', nullable=False),
    sa.Column('message', sa.String(length=1024), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('request_id', sa.String(length=64), nullable=True),
    sa.Column('actor_email', sa.String(length=320), nullable=True),
    sa.Column('ip_address', sa.String(length=80), nullable=True),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_system_logs_occurred_at', 'system_logs', ['occurred_at'], unique=False)
    op.create_index('ix_system_logs_org_source_level', 'system_logs', ['organization_id', 'source', 'level'], unique=False)
    op.create_table('teams',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_teams_organization_id', 'teams', ['organization_id'], unique=False)
    op.create_table('users',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('admin', 'sender', name='userrole'), nullable=False),
    sa.Column('is_platform_admin', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('mfa_method', sa.String(length=20), nullable=True),
    sa.Column('mfa_secret', sa.String(length=765), nullable=True),
    sa.Column('mfa_enrolled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('mfa_recovery_codes', sa.JSON(), nullable=True),
    sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('locale', sa.String(length=20), nullable=True),
    sa.Column('timezone', sa.String(length=60), nullable=True),
    sa.Column('avatar_url', sa.String(length=1024), nullable=True),
    sa.Column('status', sa.String(length=20), server_default='active', nullable=False),
    sa.Column('preferences', sa.JSON(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_organization_id'), 'users', ['organization_id'], unique=False)
    op.create_table('webhook_endpoints',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('url', sa.String(length=2048), nullable=False),
    sa.Column('secret', sa.String(length=128), nullable=False),
    sa.Column('event_types', sa.JSON(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_webhook_endpoints_organization_id', 'webhook_endpoints', ['organization_id'], unique=False)
    op.create_table('api_keys',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('mode', sa.String(length=10), server_default='test', nullable=False),
    sa.Column('prefix', sa.String(length=16), nullable=False),
    sa.Column('last_four', sa.String(length=4), server_default='', nullable=False),
    sa.Column('key_hash', sa.String(length=64), nullable=False),
    sa.Column('scopes', sa.JSON(), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'], unique=True)
    op.create_index('ix_api_keys_organization_id', 'api_keys', ['organization_id'], unique=False)
    op.create_table('charges',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('invoice_id', sa.String(length=36), nullable=True),
    sa.Column('amount_cents', sa.Integer(), server_default='0', nullable=False),
    sa.Column('currency', sa.String(length=3), server_default='USD', nullable=False),
    sa.Column('status', sa.String(length=20), server_default='succeeded', nullable=False),
    sa.Column('provider', sa.String(length=50), nullable=True),
    sa.Column('provider_payment_id', sa.String(length=255), nullable=True),
    sa.Column('method_label', sa.String(length=80), nullable=True),
    sa.Column('decline_code', sa.String(length=60), nullable=True),
    sa.Column('dunning_step', sa.Integer(), nullable=True),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_charges_organization_id', 'charges', ['organization_id'], unique=False)
    op.create_index('ix_charges_status', 'charges', ['status'], unique=False)
    op.create_table('contacts',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('company', sa.String(length=255), nullable=True),
    sa.Column('title', sa.String(length=120), nullable=True),
    sa.Column('phone', sa.String(length=30), nullable=True),
    sa.Column('default_role', sa.String(length=20), server_default='sign', nullable=False),
    sa.Column('group_key', sa.String(length=40), server_default='customers', nullable=False),
    sa.Column('source', sa.String(length=20), server_default='manual', nullable=False),
    sa.Column('tags', sa.JSON(), nullable=True),
    sa.Column('color', sa.String(length=9), nullable=True),
    sa.Column('last_signed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('external_id', sa.String(length=255), nullable=True),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_contacts_group', 'contacts', ['group_key'], unique=False)
    op.create_index('ix_contacts_organization_id', 'contacts', ['organization_id'], unique=False)
    op.create_index('uq_contacts_org_email', 'contacts', ['organization_id', 'email'], unique=True)
    op.create_table('custom_reports',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('fields', sa.JSON(), nullable=False),
    sa.Column('filters', sa.JSON(), nullable=True),
    sa.Column('group_by', sa.String(length=60), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_custom_reports_organization_id', 'custom_reports', ['organization_id'], unique=False)
    op.create_table('feature_flags',
    sa.Column('key', sa.String(length=120), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=True),
    sa.Column('environment', sa.String(length=20), server_default='prod', nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('rollout_pct', sa.Integer(), server_default='0', nullable=False),
    sa.Column('updated_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_feature_flags_key', 'feature_flags', ['key'], unique=True)
    op.create_table('folders',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('parent_id', sa.String(length=36), nullable=True),
    sa.Column('team_id', sa.String(length=36), nullable=True),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['parent_id'], ['folders.id'], ),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_folders_organization_id', 'folders', ['organization_id'], unique=False)
    op.create_table('impersonation_sessions',
    sa.Column('admin_user_id', sa.String(length=36), nullable=False),
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('justification', sa.String(length=255), nullable=False),
    sa.Column('scopes', sa.JSON(), nullable=True),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['admin_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_impersonation_sessions_organization_id', 'impersonation_sessions', ['organization_id'], unique=False)
    op.create_index('ix_impersonation_sessions_token_hash', 'impersonation_sessions', ['token_hash'], unique=True)
    op.create_table('invitations',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('role', sa.Enum('admin', 'sender', name='userrole'), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('invited_by_user_id', sa.String(length=36), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['invited_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index('ix_invitations_email', 'invitations', ['email'], unique=False)
    op.create_index('ix_invitations_organization_id', 'invitations', ['organization_id'], unique=False)
    op.create_index('ix_invitations_token_hash', 'invitations', ['token_hash'], unique=True)
    op.create_table('notification_preferences',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('event_key', sa.String(length=60), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='1', nullable=False),
    sa.Column('extra_recipients', sa.JSON(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_notif_pref', 'notification_preferences', ['user_id', 'event_key'], unique=True)
    op.create_table('notifications',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('detail', sa.String(length=512), nullable=True),
    sa.Column('tone', sa.String(length=10), server_default='info', nullable=False),
    sa.Column('screen', sa.String(length=40), nullable=True),
    sa.Column('target_id', sa.String(length=64), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_user_unread', 'notifications', ['user_id', 'read_at'], unique=False)
    op.create_table('password_reset_tokens',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'], unique=True)
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'], unique=False)
    op.create_table('platform_audit_entries',
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('actor_user_id', sa.String(length=36), nullable=True),
    sa.Column('actor_email', sa.String(length=320), nullable=True),
    sa.Column('organization_id', sa.String(length=36), nullable=True),
    sa.Column('detail', sa.String(length=512), nullable=True),
    sa.Column('ip_address', sa.String(length=80), nullable=True),
    sa.Column('metadata', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_platform_audit_entries_created_at', 'platform_audit_entries', ['created_at'], unique=False)
    op.create_index('ix_platform_audit_entries_organization_id', 'platform_audit_entries', ['organization_id'], unique=False)
    op.create_table('report_exports',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('requested_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('report_key', sa.String(length=40), nullable=False),
    sa.Column('range_key', sa.String(length=10), nullable=True),
    sa.Column('format', sa.String(length=10), server_default='csv', nullable=False),
    sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
    sa.Column('file_path', sa.String(length=1024), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['requested_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_report_exports_organization_id', 'report_exports', ['organization_id'], unique=False)
    op.create_table('saved_signatures',
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('recipient_email', sa.String(length=320), nullable=True),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('signature_type', sa.String(length=20), server_default='drawn', nullable=False),
    sa.Column('signature_text', sa.String(length=255), nullable=True),
    sa.Column('type_face', sa.String(length=60), nullable=True),
    sa.Column('image_path', sa.String(length=1024), nullable=True),
    sa.Column('is_passkey_bound', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('adopted_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_saved_signatures_recipient_email', 'saved_signatures', ['recipient_email'], unique=False)
    op.create_index('ix_saved_signatures_user_id', 'saved_signatures', ['user_id'], unique=False)
    op.create_table('security_posture',
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=160), nullable=False),
    sa.Column('detail', sa.String(length=255), nullable=True),
    sa.Column('enabled', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('updated_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_security_posture_key', 'security_posture', ['key'], unique=True)
    op.create_table('team_members',
    sa.Column('team_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=20), server_default='member', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_team_members', 'team_members', ['team_id', 'user_id'], unique=True)
    op.create_table('user_sessions',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('refresh_token_hash', sa.String(length=64), nullable=False),
    sa.Column('device', sa.String(length=120), nullable=True),
    sa.Column('browser', sa.String(length=80), nullable=True),
    sa.Column('os', sa.String(length=80), nullable=True),
    sa.Column('ip_address', sa.String(length=80), nullable=True),
    sa.Column('location', sa.String(length=120), nullable=True),
    sa.Column('user_agent', sa.String(length=512), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_sessions_refresh_hash', 'user_sessions', ['refresh_token_hash'], unique=True)
    op.create_index('ix_user_sessions_user_id', 'user_sessions', ['user_id'], unique=False)
    op.create_table('webhook_deliveries',
    sa.Column('endpoint_id', sa.String(length=36), nullable=False),
    sa.Column('event_id', sa.String(length=36), nullable=False),
    sa.Column('event_type', sa.String(length=80), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.Column('attempt', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['endpoint_id'], ['webhook_endpoints.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_webhook_deliveries_endpoint_id', 'webhook_deliveries', ['endpoint_id'], unique=False)
    op.create_index('ix_webhook_deliveries_next_retry_at', 'webhook_deliveries', ['next_retry_at'], unique=False)
    op.create_index('ix_webhook_deliveries_status', 'webhook_deliveries', ['status'], unique=False)
    op.create_table('documents',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('sender_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('status', sa.Enum('draft', 'prepared', 'sent', 'viewed', 'partially_completed', 'completed', 'declined', 'expired', 'voided', name='documentstatus'), nullable=False),
    sa.Column('workflow_type', sa.Enum('parallel', 'sequential', name='workflowtype'), nullable=False),
    sa.Column('original_file_path', sa.String(length=1024), nullable=True),
    sa.Column('final_file_path', sa.String(length=1024), nullable=True),
    sa.Column('original_sha256', sa.String(length=64), nullable=True),
    sa.Column('is_template', sa.Boolean(), nullable=False),
    sa.Column('field_config_sha256', sa.String(length=64), nullable=True),
    sa.Column('final_sha256', sa.String(length=64), nullable=True),
    sa.Column('page_count', sa.Integer(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('owner_user_id', sa.String(length=36), nullable=True),
    sa.Column('folder_id', sa.String(length=36), nullable=True),
    sa.Column('source_template_id', sa.String(length=36), nullable=True),
    sa.Column('doc_type', sa.String(length=30), nullable=True),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reminder_cadence', sa.String(length=10), server_default='48h', nullable=False),
    sa.Column('expires_in_days', sa.Integer(), server_default='14', nullable=False),
    sa.Column('invite_subject', sa.String(length=255), nullable=True),
    sa.Column('invite_message', sa.Text(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['folder_id'], ['folders.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['source_template_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_documents_archived_at', 'documents', ['archived_at'], unique=False)
    op.create_index('ix_documents_deleted_at', 'documents', ['deleted_at'], unique=False)
    op.create_index('ix_documents_folder_id', 'documents', ['folder_id'], unique=False)
    op.create_index('ix_documents_org_deleted_status', 'documents', ['organization_id', 'deleted_at', 'status'], unique=False)
    op.create_index(op.f('ix_documents_organization_id'), 'documents', ['organization_id'], unique=False)
    op.create_index('ix_documents_organization_status', 'documents', ['organization_id', 'status'], unique=False)
    op.create_index('ix_documents_sender_id', 'documents', ['sender_id'], unique=False)
    op.create_index('ix_documents_source_template_id', 'documents', ['source_template_id'], unique=False)
    op.create_table('feature_flag_overrides',
    sa.Column('flag_id', sa.String(length=36), nullable=False),
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='1', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['flag_id'], ['feature_flags.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_flag_override', 'feature_flag_overrides', ['flag_id', 'organization_id'], unique=True)
    op.create_table('report_schedules',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('custom_report_id', sa.String(length=36), nullable=True),
    sa.Column('report_key', sa.String(length=40), nullable=True),
    sa.Column('cadence', sa.String(length=20), server_default='weekly', nullable=False),
    sa.Column('format', sa.String(length=10), server_default='csv', nullable=False),
    sa.Column('recipients', sa.JSON(), nullable=False),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['custom_report_id'], ['custom_reports.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_report_schedules_organization_id', 'report_schedules', ['organization_id'], unique=False)
    op.create_table('document_favorites',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_document_favorites', 'document_favorites', ['user_id', 'document_id'], unique=True)
    op.create_table('document_versions',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('version_type', sa.Enum('original', 'prepared', 'final', name='documentversiontype'), nullable=False),
    sa.Column('file_path', sa.String(length=1024), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_document_versions_document_id', 'document_versions', ['document_id'], unique=False)
    op.create_table('embed_sessions',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('landing', sa.String(length=20), server_default='builder', nullable=False),
    sa.Column('external_id', sa.String(length=255), nullable=True),
    sa.Column('return_url', sa.String(length=1024), nullable=True),
    sa.Column('allowed_origins', sa.JSON(), nullable=True),
    sa.Column('contact_ids', sa.JSON(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_embed_sessions_organization_id', 'embed_sessions', ['organization_id'], unique=False)
    op.create_index('ix_embed_sessions_token_hash', 'embed_sessions', ['token_hash'], unique=True)
    op.create_table('recipients',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('role_name', sa.String(length=120), nullable=True),
    sa.Column('role', sa.String(length=20), server_default='sign', nullable=False),
    sa.Column('color', sa.String(length=9), nullable=True),
    sa.Column('contact_id', sa.String(length=36), nullable=True),
    sa.Column('signing_order', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('waiting', 'sent', 'viewed', 'completed', 'declined', 'expired', name='recipientstatus'), nullable=False),
    sa.Column('viewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('declined_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decline_reason', sa.Text(), nullable=True),
    sa.Column('phone_number', sa.String(length=30), nullable=True),
    sa.Column('otp_enabled', sa.Boolean(), nullable=False),
    sa.Column('otp_code_hash', sa.String(length=64), nullable=True),
    sa.Column('otp_attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('otp_locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('otp_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('otp_verified', sa.Boolean(), nullable=False),
    sa.Column('consent_accepted', sa.Boolean(), nullable=False),
    sa.Column('consent_accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contact_id'], ['contacts.id'], ),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_recipients_contact_id', 'recipients', ['contact_id'], unique=False)
    op.create_index('ix_recipients_document_id', 'recipients', ['document_id'], unique=False)
    op.create_index('ix_recipients_email', 'recipients', ['email'], unique=False)
    op.create_index('ix_recipients_status', 'recipients', ['status'], unique=False)
    op.create_table('support_tickets',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('reference', sa.String(length=30), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('category', sa.String(length=60), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('priority', sa.String(length=20), nullable=False),
    sa.Column('created_by_user_id', sa.String(length=36), nullable=True),
    sa.Column('assignee_user_id', sa.String(length=36), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('tags', sa.JSON(), nullable=True),
    sa.Column('sla_due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('requester_name', sa.String(length=255), nullable=True),
    sa.Column('requester_email', sa.String(length=320), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['assignee_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('reference')
    )
    op.create_index('ix_support_tickets_organization_id', 'support_tickets', ['organization_id'], unique=False)
    op.create_index('ix_support_tickets_status', 'support_tickets', ['status'], unique=False)
    op.create_table('usage_events',
    sa.Column('organization_id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('event_type', sa.String(length=50), nullable=False),
    sa.Column('quantity', sa.BigInteger(), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('metadata', sa.JSON(), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_usage_events_org_type_time', 'usage_events', ['organization_id', 'event_type', 'occurred_at'], unique=False)
    op.create_table('audit_logs',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('recipient_id', sa.String(length=36), nullable=True),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('event_type', sa.String(length=80), nullable=False),
    sa.Column('event_message', sa.Text(), nullable=False),
    sa.Column('ip_address', sa.String(length=80), nullable=True),
    sa.Column('user_agent', sa.String(length=512), nullable=True),
    sa.Column('metadata', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['recipient_id'], ['recipients.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_logs_document_id', 'audit_logs', ['document_id'], unique=False)
    op.create_index('ix_audit_logs_recipient_id', 'audit_logs', ['recipient_id'], unique=False)
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'], unique=False)
    op.create_table('fields',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('recipient_id', sa.String(length=36), nullable=False),
    sa.Column('type', sa.Enum('signature', 'initials', 'full_name', 'date', 'text', 'email', 'phone', 'checkbox', 'dropdown', 'title', 'company', 'address', 'currency', 'number', 'radio', 'stamp', 'attachment', 'formula', 'datetime', name='fieldtype'), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=False),
    sa.Column('required', sa.Boolean(), nullable=False),
    sa.Column('page_number', sa.Integer(), nullable=False),
    sa.Column('x', sa.Numeric(precision=12, scale=4), nullable=False),
    sa.Column('y', sa.Numeric(precision=12, scale=4), nullable=False),
    sa.Column('width', sa.Numeric(precision=12, scale=4), nullable=False),
    sa.Column('height', sa.Numeric(precision=12, scale=4), nullable=False),
    sa.Column('placeholder', sa.String(length=255), nullable=True),
    sa.Column('default_value', sa.Text(), nullable=True),
    sa.Column('value', sa.Text(), nullable=True),
    sa.Column('options', sa.JSON(), nullable=True),
    sa.Column('is_locked', sa.Boolean(), nullable=False),
    sa.Column('validation', sa.String(length=20), server_default='none', nullable=False),
    sa.Column('validation_pattern', sa.String(length=255), nullable=True),
    sa.Column('condition', sa.JSON(), nullable=True),
    sa.Column('merge_tag', sa.String(length=120), nullable=True),
    sa.Column('read_only', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['recipient_id'], ['recipients.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_fields_document_id', 'fields', ['document_id'], unique=False)
    op.create_index('ix_fields_recipient_id', 'fields', ['recipient_id'], unique=False)
    op.create_table('signing_tokens',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('recipient_id', sa.String(length=36), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['recipient_id'], ['recipients.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index('ix_signing_tokens_document_id', 'signing_tokens', ['document_id'], unique=False)
    op.create_index('ix_signing_tokens_recipient_id', 'signing_tokens', ['recipient_id'], unique=False)
    op.create_index('ix_signing_tokens_token_hash', 'signing_tokens', ['token_hash'], unique=True)
    op.create_table('ticket_messages',
    sa.Column('ticket_id', sa.String(length=36), nullable=False),
    sa.Column('author_user_id', sa.String(length=36), nullable=True),
    sa.Column('author_name', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('is_staff', sa.Boolean(), nullable=False),
    sa.Column('is_internal', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['author_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['ticket_id'], ['support_tickets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ticket_messages_ticket_id', 'ticket_messages', ['ticket_id'], unique=False)
    op.create_table('signatures',
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('recipient_id', sa.String(length=36), nullable=False),
    sa.Column('field_id', sa.String(length=36), nullable=False),
    sa.Column('signature_type', sa.Enum('drawn', 'typed', name='signaturetype'), nullable=False),
    sa.Column('signature_text', sa.Text(), nullable=True),
    sa.Column('signature_image_path', sa.String(length=1024), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['field_id'], ['fields.id'], ),
    sa.ForeignKeyConstraint(['recipient_id'], ['recipients.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_signatures_document_id', 'signatures', ['document_id'], unique=False)
    op.create_index('ix_signatures_field_id', 'signatures', ['field_id'], unique=False)
    op.create_index('ix_signatures_recipient_id', 'signatures', ['recipient_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_signatures_recipient_id', table_name='signatures')
    op.drop_index('ix_signatures_field_id', table_name='signatures')
    op.drop_index('ix_signatures_document_id', table_name='signatures')
    op.drop_table('signatures')
    op.drop_index('ix_ticket_messages_ticket_id', table_name='ticket_messages')
    op.drop_table('ticket_messages')
    op.drop_index('ix_signing_tokens_token_hash', table_name='signing_tokens')
    op.drop_index('ix_signing_tokens_recipient_id', table_name='signing_tokens')
    op.drop_index('ix_signing_tokens_document_id', table_name='signing_tokens')
    op.drop_table('signing_tokens')
    op.drop_index('ix_fields_recipient_id', table_name='fields')
    op.drop_index('ix_fields_document_id', table_name='fields')
    op.drop_table('fields')
    op.drop_index('ix_audit_logs_user_id', table_name='audit_logs')
    op.drop_index('ix_audit_logs_recipient_id', table_name='audit_logs')
    op.drop_index('ix_audit_logs_document_id', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index('ix_usage_events_org_type_time', table_name='usage_events')
    op.drop_table('usage_events')
    op.drop_index('ix_support_tickets_status', table_name='support_tickets')
    op.drop_index('ix_support_tickets_organization_id', table_name='support_tickets')
    op.drop_table('support_tickets')
    op.drop_index('ix_recipients_status', table_name='recipients')
    op.drop_index('ix_recipients_email', table_name='recipients')
    op.drop_index('ix_recipients_document_id', table_name='recipients')
    op.drop_index('ix_recipients_contact_id', table_name='recipients')
    op.drop_table('recipients')
    op.drop_index('ix_embed_sessions_token_hash', table_name='embed_sessions')
    op.drop_index('ix_embed_sessions_organization_id', table_name='embed_sessions')
    op.drop_table('embed_sessions')
    op.drop_index('ix_document_versions_document_id', table_name='document_versions')
    op.drop_table('document_versions')
    op.drop_index('uq_document_favorites', table_name='document_favorites')
    op.drop_table('document_favorites')
    op.drop_index('ix_report_schedules_organization_id', table_name='report_schedules')
    op.drop_table('report_schedules')
    op.drop_index('uq_flag_override', table_name='feature_flag_overrides')
    op.drop_table('feature_flag_overrides')
    op.drop_index('ix_documents_source_template_id', table_name='documents')
    op.drop_index('ix_documents_sender_id', table_name='documents')
    op.drop_index('ix_documents_organization_status', table_name='documents')
    op.drop_index(op.f('ix_documents_organization_id'), table_name='documents')
    op.drop_index('ix_documents_org_deleted_status', table_name='documents')
    op.drop_index('ix_documents_folder_id', table_name='documents')
    op.drop_index('ix_documents_deleted_at', table_name='documents')
    op.drop_index('ix_documents_archived_at', table_name='documents')
    op.drop_table('documents')
    op.drop_index('ix_webhook_deliveries_status', table_name='webhook_deliveries')
    op.drop_index('ix_webhook_deliveries_next_retry_at', table_name='webhook_deliveries')
    op.drop_index('ix_webhook_deliveries_endpoint_id', table_name='webhook_deliveries')
    op.drop_table('webhook_deliveries')
    op.drop_index('ix_user_sessions_user_id', table_name='user_sessions')
    op.drop_index('ix_user_sessions_refresh_hash', table_name='user_sessions')
    op.drop_table('user_sessions')
    op.drop_index('uq_team_members', table_name='team_members')
    op.drop_table('team_members')
    op.drop_index('ix_security_posture_key', table_name='security_posture')
    op.drop_table('security_posture')
    op.drop_index('ix_saved_signatures_user_id', table_name='saved_signatures')
    op.drop_index('ix_saved_signatures_recipient_email', table_name='saved_signatures')
    op.drop_table('saved_signatures')
    op.drop_index('ix_report_exports_organization_id', table_name='report_exports')
    op.drop_table('report_exports')
    op.drop_index('ix_platform_audit_entries_organization_id', table_name='platform_audit_entries')
    op.drop_index('ix_platform_audit_entries_created_at', table_name='platform_audit_entries')
    op.drop_table('platform_audit_entries')
    op.drop_index('ix_password_reset_tokens_user_id', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_token_hash', table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
    op.drop_index('ix_notifications_user_unread', table_name='notifications')
    op.drop_table('notifications')
    op.drop_index('uq_notif_pref', table_name='notification_preferences')
    op.drop_table('notification_preferences')
    op.drop_index('ix_invitations_token_hash', table_name='invitations')
    op.drop_index('ix_invitations_organization_id', table_name='invitations')
    op.drop_index('ix_invitations_email', table_name='invitations')
    op.drop_table('invitations')
    op.drop_index('ix_impersonation_sessions_token_hash', table_name='impersonation_sessions')
    op.drop_index('ix_impersonation_sessions_organization_id', table_name='impersonation_sessions')
    op.drop_table('impersonation_sessions')
    op.drop_index('ix_folders_organization_id', table_name='folders')
    op.drop_table('folders')
    op.drop_index('ix_feature_flags_key', table_name='feature_flags')
    op.drop_table('feature_flags')
    op.drop_index('ix_custom_reports_organization_id', table_name='custom_reports')
    op.drop_table('custom_reports')
    op.drop_index('uq_contacts_org_email', table_name='contacts')
    op.drop_index('ix_contacts_organization_id', table_name='contacts')
    op.drop_index('ix_contacts_group', table_name='contacts')
    op.drop_table('contacts')
    op.drop_index('ix_charges_status', table_name='charges')
    op.drop_index('ix_charges_organization_id', table_name='charges')
    op.drop_table('charges')
    op.drop_index('ix_api_keys_organization_id', table_name='api_keys')
    op.drop_index('ix_api_keys_key_hash', table_name='api_keys')
    op.drop_table('api_keys')
    op.drop_index('ix_webhook_endpoints_organization_id', table_name='webhook_endpoints')
    op.drop_table('webhook_endpoints')
    op.drop_index(op.f('ix_users_organization_id'), table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
    op.drop_index('ix_teams_organization_id', table_name='teams')
    op.drop_table('teams')
    op.drop_index('ix_system_logs_org_source_level', table_name='system_logs')
    op.drop_index('ix_system_logs_occurred_at', table_name='system_logs')
    op.drop_table('system_logs')
    op.drop_index(op.f('ix_subscriptions_provider_subscription_id'), table_name='subscriptions')
    op.drop_index('ix_subscriptions_plan_id', table_name='subscriptions')
    op.drop_index('ix_subscriptions_organization_id', table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index('ix_payment_methods_organization_id', table_name='payment_methods')
    op.drop_table('payment_methods')
    op.drop_index('ix_invoices_status', table_name='invoices')
    op.drop_index('ix_invoices_organization_id', table_name='invoices')
    op.drop_index('ix_invoices_number', table_name='invoices')
    op.drop_table('invoices')
    op.drop_index('uq_integrations_org_provider', table_name='integrations')
    op.drop_table('integrations')
    op.drop_index('uq_contact_groups_org_key', table_name='contact_groups')
    op.drop_table('contact_groups')
    op.drop_index('uq_cloud_targets_org_provider', table_name='cloud_targets')
    op.drop_table('cloud_targets')
    op.drop_index(op.f('ix_plans_code'), table_name='plans')
    op.drop_table('plans')
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_table('organizations')
    op.drop_index('ix_certifications_name', table_name='certifications')
    op.drop_table('certifications')
    op.drop_index('uq_billing_webhook_events_provider_event', table_name='billing_webhook_events')
    op.drop_table('billing_webhook_events')
