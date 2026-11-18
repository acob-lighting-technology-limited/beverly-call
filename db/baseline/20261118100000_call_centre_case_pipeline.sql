-- Case pipeline: who raised a case is no longer the same thing as who holds it, and every hand-over is recorded.
-- Additive only: new nullable columns, a new append-only history table, no existing column or row is changed except the backfill below.

alter table call_centre.tickets
  add column if not exists created_by_crm_id  text,
  add column if not exists assigned_by_crm_id text,
  add column if not exists assigned_at        timestamptz,
  add column if not exists accepted_at        timestamptz;

-- Until now the person who opened a case was the person holding it, so that is who raised every existing case.
update call_centre.tickets set created_by_crm_id = agent_crm_id where created_by_crm_id is null and agent_crm_id is not null;

create index if not exists idx_cc_tickets_holder on call_centre.tickets (agent_crm_id, status);
create index if not exists idx_cc_tickets_creator on call_centre.tickets (created_by_crm_id, status);
create index if not exists idx_cc_tickets_queue on call_centre.tickets (status, sla_due_at) where agent_crm_id is null;

-- One row per step in a case's life: opened, assigned, reassigned, claimed, accepted, released. Comments and resolution stay in ticket_comments.
create table if not exists call_centre.ticket_events (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references call_centre.tickets (id) on delete cascade,
  kind          text not null check (kind in ('opened', 'assigned', 'reassigned', 'claimed', 'accepted', 'released')),
  actor_crm_id  text not null,
  actor_name    text not null,
  from_crm_id   text,
  to_crm_id     text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_cc_ticket_events on call_centre.ticket_events (ticket_id, created_at);

-- Same least-privilege pattern as every other call_centre table: only the API role, and the history cannot be edited or deleted.
alter table call_centre.ticket_events enable row level security;
drop policy if exists cc_ticket_events_api on call_centre.ticket_events;
create policy cc_ticket_events_api on call_centre.ticket_events for all to beverly_call_api using (true) with check (true);
revoke all on call_centre.ticket_events from anon, authenticated, public;
grant select, insert on call_centre.ticket_events to beverly_call_api;

notify pgrst, 'reload schema';
