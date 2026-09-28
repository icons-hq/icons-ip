-- Presentation preference only. No price, coupon, credit, reservation or order
-- writer reads this column; existing goods retain their current display.
alter table public.goods add column show_discount_rate boolean not null default true;

create function private.apply_goods_discount_display(target_good_id text,target_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare previous_enabled boolean;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if target_enabled is null then raise invalid_parameter_value using message='invalid_discount_display'; end if;
  select show_discount_rate into previous_enabled from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if previous_enabled is not distinct from target_enabled then return; end if;
  update public.goods set show_discount_rate=target_enabled where id=target_good_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(auth.uid(),'admin.good.discount_display_saved','goods:'||target_good_id,
      jsonb_build_object('before',jsonb_build_object('show_discount_rate',previous_enabled),
        'after',jsonb_build_object('show_discount_rate',target_enabled)));
end $$;
revoke all on function private.apply_goods_discount_display(text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.apply_goods_discount_display(text,boolean) to postgres;

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_discount_display;
revoke all on function private.admin_save_good_before_discount_display(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_discount_display(jsonb) to postgres;

create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
  if auth.uid() is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  if target_good ? 'show_discount_rate' and jsonb_typeof(target_good->'show_discount_rate') is distinct from 'boolean' then
    raise invalid_parameter_value using message='invalid_discount_display';
  end if;
  -- The existing writer owns tree -> product locking, rename, validation and
  -- publication. Its transaction locks remain held while this field is applied.
  saved := private.admin_save_good_before_discount_display(target_good-'show_discount_rate');
  if target_good ? 'show_discount_rate' then
    perform private.apply_goods_discount_display(saved->>'id',(target_good->>'show_discount_rate')::boolean);
  end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

alter function public.admin_clone_good(uuid,text,text,text,text) set schema private;
alter function private.admin_clone_good(uuid,text,text,text,text) rename to admin_clone_good_before_discount_display;
revoke all on function private.admin_clone_good_before_discount_display(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_clone_good_before_discount_display(uuid,text,text,text,text) to postgres;

create function public.admin_clone_good(
  target_operation_id uuid,
  target_source_good_id text,
  target_new_id text default null,
  target_new_code text default null,
  target_new_name text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; replay boolean; source_enabled boolean;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  -- Take the exact existing operation lock before observing its receipt. A
  -- concurrent retry must not reset a clone that has already been edited.
  perform pg_advisory_xact_lock(hashtextextended('admin.goods.clone.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  saved := private.admin_clone_good_before_discount_display(target_operation_id,target_source_good_id,target_new_id,target_new_code,target_new_name);
  if not replay then
    select show_discount_rate into source_enabled from public.goods where id=saved->>'sourceGoodId';
    perform private.apply_goods_discount_display(saved->>'id',source_enabled);
  end if;
  return saved;
end $$;
revoke all on function public.admin_clone_good(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_clone_good(uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
