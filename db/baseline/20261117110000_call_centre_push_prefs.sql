-- Per-device push preferences, so a muted category or a silenced device is honoured when the app is closed
-- (the browser cannot be asked while it is not running). Defaults match the app: nothing muted, sounds on.
alter table call_centre.push_subscriptions
  add column if not exists mute_esc boolean not null default false,
  add column if not exists mute_cb  boolean not null default false,
  add column if not exists mute_sys boolean not null default false,
  add column if not exists sounds   boolean not null default true;

notify pgrst, 'reload schema';
