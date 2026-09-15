-- #524: preserve inactive editor values while keeping payable fees and order snapshots unchanged.
create or replace function private.guard_good_fulfillment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_at is not null then
    if new.origin_id is null then raise check_violation using message='fulfillment_origin_required'; end if;
    if tg_op='INSERT' or new.origin_id is distinct from old.origin_id or old.published_at is null then
      perform id from public.fulfillment_origins where id=new.origin_id and is_active for share;
      if not found then raise check_violation using message='fulfillment_origin_inactive'; end if;
    end if;
  end if;
  -- Keep the last input when its fee type is inactive; quoting still branches on fee type.
  return new;
end $$;
revoke all on function private.guard_good_fulfillment() from public,anon,authenticated,service_role;

create or replace function private.snapshot_order_item_fulfillment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.good_id is null then
    new.origin_id_snapshot:=coalesce(new.origin_id_snapshot,'00000000-0000-4000-8000-000000042201');
    new.shipping_fee_type_snapshot:=coalesce(new.shipping_fee_type_snapshot,'policy');
    new.individual_fee_snapshot:=coalesce(new.individual_fee_snapshot,0);
  else
    select origin_id,shipping_fee_type,case when shipping_fee_type='individual' then individual_fee else 0 end into new.origin_id_snapshot,new.shipping_fee_type_snapshot,new.individual_fee_snapshot
      from public.goods where id=new.good_id;
  end if;
  return new;
end $$;
revoke all on function private.snapshot_order_item_fulfillment() from public,anon,authenticated,service_role;
