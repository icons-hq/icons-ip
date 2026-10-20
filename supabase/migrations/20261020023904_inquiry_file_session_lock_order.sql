-- Match account/role mutation order before taking the profile/session locks.
begin;
create or replace function private.inquiry_file_session(p_actor uuid,p_session uuid,p_staff boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if p_actor is null or p_session is null then raise insufficient_privilege;end if;
 perform private.lock_account_action_subject(p_actor);
 perform private.assert_active_user(p_actor);
 if private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege;end if;
 if p_staff then perform private.require_actor_operator_capability(p_actor,'cs.manage');end if;
end $$;
revoke all on function private.inquiry_file_session(uuid,uuid,boolean) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.inquiry_file_session(uuid,uuid,boolean)'::regprocedure);
commit;
