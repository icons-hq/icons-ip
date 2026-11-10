begin;
-- Protect account state without blocking FK key-share reads in claim intake.
create or replace function private.purchase_confirmation_identity(p_actor uuid,p_session uuid,p_admin boolean) returns uuid
language plpgsql security definer set search_path='' as $$begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then
  raise insufficient_privilege using message='purchase_confirmation_auth_changed';end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='purchase_confirmation_auth_changed';end if;
 if p_admin then perform private.require_operator_capability('sales.manage',false);
 else perform 1 from public.profiles where id=p_actor for no key update;perform private.assert_active_user(p_actor);
  if private.is_account_write_fenced(p_actor) then raise insufficient_privilege using message='account_write_fenced';end if;
 end if;return p_actor;
end $$;
revoke all on function private.purchase_confirmation_identity(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create or replace function public.settle_delivered_orders() returns integer language plpgsql security definer set search_path='' as $$
declare item record;confirmation private.order_purchase_confirmations;at_value timestamptz;n integer:=0;
begin
 if not (select auto_enabled from private.purchase_confirmation_policy where singleton) then return 0;end if;
 for item in select o.id,o.user_id from public.orders o join private.order_purchase_confirmations pc on pc.order_id=o.id
  where o.status='delivered' and not pc.held and pc.confirmed_at is null and pc.auto_due_at<=clock_timestamp()
   and private.purchase_confirmation_eligible(o.id)
  order by o.user_id,pc.auto_due_at,o.id limit 1000 loop
  perform 1 from public.profiles where id=item.user_id and suspended_at is null for no key update skip locked;
  if not found then continue;end if;
  perform 1 from public.orders where id=item.id and status='delivered' for no key update skip locked;
  if not found then continue;end if;
  select * into confirmation from private.order_purchase_confirmations where order_id=item.id for update;
  at_value:=clock_timestamp();
  if not (select auto_enabled from private.purchase_confirmation_policy where singleton) or confirmation.held or confirmation.confirmed_at is not null
   or confirmation.auto_due_at is null or confirmation.auto_due_at>at_value or not private.purchase_confirmation_eligible(item.id) then continue;end if;
  update private.order_purchase_confirmations set revision=revision+1,confirmed_at=at_value,confirmation_kind='automatic' where order_id=item.id;
  insert into private.purchase_confirmation_events(id,order_id,kind,note,request,created_at)
   values(gen_random_uuid(),item.id,'automatic','',jsonb_build_object('policy',confirmation.policy_snapshot,'dueAt',confirmation.auto_due_at),at_value);
  update public.orders set status='done',done_at=at_value where id=item.id and status='delivered';
  n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.settle_delivered_orders() from public,anon,authenticated,service_role;
grant execute on function public.settle_delivered_orders() to service_role;

commit;
