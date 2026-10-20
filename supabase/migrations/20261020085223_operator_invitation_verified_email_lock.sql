-- Keep the confirmed Auth email stable through the membership grant. Account
-- deletion already acquires the same account-action fence before Auth deletion.
do $$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('public.accept_operator_invitation(text,uuid)'::regprocedure);
  revised:=replace(definition,
    'select lower(email),email_confirmed_at into current_email,confirmed_at from auth.users where id=actor;',
    'select lower(email),email_confirmed_at into current_email,confirmed_at from auth.users where id=actor for share;');
  if definition=revised then raise exception 'invitation verified email contract changed'; end if;
  execute revised;
end $$;
revoke all on function public.accept_operator_invitation(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.accept_operator_invitation(text,uuid) to authenticated;
select private.register_operator_rpc_contract('public.accept_operator_invitation(text,uuid)','operators.manage','manual',true);
notify pgrst,'reload schema';
