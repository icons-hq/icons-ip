-- A user's global last_sign_in_at is updated by every browser. Account
-- deletion reauthentication must instead prove that the session presenting
-- the current JWT is itself recent and still belongs to the same subject.

create or replace function private.has_recent_account_authentication(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session_id_text text := auth.jwt() ->> 'session_id';
  v_session_id uuid;
begin
  if p_user_id is null
    or v_session_id_text is null
    or v_session_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  begin
    v_session_id := v_session_id_text::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return exists (
    select 1
    from auth.sessions as auth_session
    where auth_session.id = v_session_id
      and auth_session.user_id = p_user_id
      and auth_session.created_at >= pg_catalog.now() - interval '10 minutes'
      and (
        auth_session.not_after is null
        or auth_session.not_after > pg_catalog.now()
      )
  );
end;
$$;

revoke all on function private.has_recent_account_authentication(uuid)
  from public, anon, authenticated, service_role;
