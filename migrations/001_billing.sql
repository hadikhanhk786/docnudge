-- 001: subscription billing (Dodo Payments). Additive; safe to re-run.
alter table firms add column if not exists billing_customer_id text;
alter table firms add column if not exists billing_subscription_id text;
alter table firms add column if not exists current_period_end timestamptz;
alter table firms add column if not exists canceled_at timestamptz;
alter table firms add column if not exists billing_event_at timestamptz;

create table if not exists billing_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);
