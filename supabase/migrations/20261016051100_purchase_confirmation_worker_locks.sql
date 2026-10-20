begin;
-- The worker follows the customer profile -> order lock order. Busy subjects
-- and orders are skipped without waiting; a later run evaluates them again.
create or replace function public.settle_delivered_orders() returns integer language plpgsql security definer set search_path='' as $$
declare item record;confirmation private.order_purchase_confirmations;at_value timestamptz;n integer:=0;
begin
 if not (select auto_enabled from private.purchase_confirmation_policy where singleton) then return 0;end if;
 for item in select o.id,o.user_id from public.orders o join private.order_purchase_confirmations pc on pc.order_id=o.id
  where o.status='delivered' and not pc.held and pc.confirmed_at is null and pc.auto_due_at<=clock_timestamp()
   and private.purchase_confirmation_eligible(o.id)
  order by o.user_id,pc.auto_due_at,o.id limit 1000 loop
  perform 1 from public.profiles where id=item.user_id and suspended_at is null for update skip locked;
  if not found then continue;end if;
  perform 1 from public.orders where id=item.id and status='delivered' for update skip locked;
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
