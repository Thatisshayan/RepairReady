-- CALL-E's own webhook docs: "Webhook delivery is at least once... Store the webhook event id
-- before processing side effects so duplicate deliveries are ignored safely." This table is
-- exactly that store -- calle-webhook inserts the event id here before doing any work, and a
-- primary-key conflict on a retried delivery means "already handled, skip."
--
-- RLS is enabled with no policies: only the service-role client (calle-webhook itself) ever
-- touches this table.

create table if not exists public.webhook_events_seen (
  event_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.webhook_events_seen enable row level security;
