-- Run once in the Neon SQL editor (or: psql "$DATABASE_URL" -f schema.sql). Safe to re-run.

create table if not exists firms (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  text not null unique,                 -- Clerk user id
  name           text not null default 'My firm',
  region         text not null default 'us' check (region in ('us','au','ae')),
  language       text not null default 'en' check (language in ('en','ar')),
  -- Billing is not wired up yet. While you validate, flip this by hand:
  --   update firms set plan = 'active' where owner_user_id = 'user_...';
  plan           text not null default 'trial' check (plan in ('trial','active','past_due','canceled')),
  notify_email   text,                                 -- told when a client finishes uploading
  reply_to       text,                                 -- where client replies to reminders go
  -- Billing (Dodo Payments). plan above stays the single source of what a firm may do.
  billing_customer_id      text,
  billing_subscription_id  text,
  current_period_end       timestamptz,
  canceled_at              timestamptz,               -- client links keep working for 30 days after this
  billing_event_at         timestamptz,               -- timestamp of the newest applied webhook (ignore older ones)
  created_at     timestamptz not null default now()
);

create table if not exists requests (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references firms(id) on delete cascade,
  client_name      text not null,
  client_email     text,
  client_phone     text,                               -- digits only, with country code (for WhatsApp)
  language         text not null default 'en' check (language in ('en','ar')),
  template_id      text not null,
  title            text not null,
  due_date         date,
  link_version     integer not null default 1,         -- bump to revoke old client links
  status           text not null default 'open' check (status in ('open','complete','archived')),
  initial_sent_at  timestamptz,
  reminders_sent   integer not null default 0,
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists requests_firm_idx on requests (firm_id, created_at desc);
create index if not exists requests_due_idx on requests (next_reminder_at) where status = 'open' and next_reminder_at is not null;

create table if not exists request_items (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  position    integer not null,
  key         text not null,
  label_en    text not null,
  label_ar    text,
  required    boolean not null default true,
  status      text not null default 'pending' check (status in ('pending','received','approved','rejected')),
  note        text,
  unique (request_id, key)
);
create index if not exists items_request_idx on request_items (request_id, position);

create table if not exists files (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references requests(id) on delete cascade,
  item_id        uuid not null references request_items(id) on delete cascade,
  r2_key         text not null,
  original_name  text not null,
  content_type   text not null,
  size_bytes     bigint not null,
  uploaded_at    timestamptz not null default now()
);
create index if not exists files_request_idx on files (request_id);
create index if not exists files_item_idx on files (item_id);

create table if not exists email_log (
  id          bigserial primary key,
  request_id  uuid references requests(id) on delete set null,
  to_email    text not null,
  kind        text not null,                           -- initial | reminder | complete
  provider    text not null,
  sent_at     timestamptz not null default now()
);
create index if not exists email_log_sent_idx on email_log (sent_at);

-- Webhook deliveries already handled (Dodo's webhook-id), so retries are ignored.
create table if not exists billing_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);
