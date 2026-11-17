alter table call_centre.push_subscriptions
  drop column if exists mute_esc, drop column if exists mute_cb, drop column if exists mute_sys, drop column if exists sounds;

notify pgrst, 'reload schema';
