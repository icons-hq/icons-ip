-- The original additive gate was already applied to the shared Preview
-- database. Deepen its duplicated post/comment trigger functions in a new
-- migration so migration history stays immutable while the live schema has one
-- guarded write seam.

create function private.guard_community_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_enabled boolean := false;
  moderation_hide_only boolean := false;
begin
  if private.is_community_write_maintenance() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    moderation_hide_only := new.status = 'hidden'
      and (pg_catalog.to_jsonb(new) - 'status' - 'updated_at')
        is not distinct from
        (pg_catalog.to_jsonb(old) - 'status' - 'updated_at');

    if moderation_hide_only then
      return new;
    end if;
  end if;

  select case
    when tg_relid = 'public.posts'::regclass and tg_op = 'INSERT'
      then control.post_create_enabled
    when tg_relid = 'public.posts'::regclass and tg_op = 'UPDATE'
      then control.post_edit_enabled
    when tg_relid = 'public.comments'::regclass and tg_op = 'INSERT'
      then control.comment_create_enabled
    when tg_relid = 'public.comments'::regclass and tg_op = 'UPDATE'
      then control.comment_edit_enabled
    else false
  end
    into selected_enabled
  from private.community_write_control as control
  where control.singleton;

  if not coalesce(selected_enabled, false) then
    raise exception 'community_writes_disabled' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_community_write()
  from public, anon, authenticated, service_role;

drop trigger trg_community_write_gate_posts on public.posts;
drop trigger trg_community_write_gate_comments on public.comments;

create trigger trg_community_write_gate_posts
before insert or update on public.posts
for each row execute function private.guard_community_write();

create trigger trg_community_write_gate_comments
before insert or update on public.comments
for each row execute function private.guard_community_write();

drop function private.guard_community_post_write();
drop function private.guard_community_comment_write();
