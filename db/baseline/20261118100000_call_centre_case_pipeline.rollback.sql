drop table if exists call_centre.ticket_events;
drop index if exists call_centre.idx_cc_tickets_holder;
drop index if exists call_centre.idx_cc_tickets_creator;
drop index if exists call_centre.idx_cc_tickets_queue;
alter table call_centre.tickets
  drop column if exists created_by_crm_id, drop column if exists assigned_by_crm_id,
  drop column if exists assigned_at, drop column if exists accepted_at;

notify pgrst, 'reload schema';
