-- QNA-035 반품 불량 재고 분리(T14b).
--
-- 반품 환불을 확정할 때 품목마다 '판매 재고 복원'(기본) 또는 '불량'을 고른다. 불량으로 고른 품목은 판매 재고
-- (goods_variants.stock_qty)에 넣지 않고 이 원장에 옵션별 수량·근거 클레임·처리자·시각으로 따로 남긴다.
--
-- 두 단계다.
--   1) 선택(planned): 환불 확정 전에 admin_plan_claim_defective_stock이 품목별 선택을 적는다. 이 행이 있는 품목은
--      private.restore_order_item_supply가 재고를 복원하지 않는다 — 복원한 뒤 빼면 stock_reconcile_flows(재고 대조)가
--      읽는 'order.option_stock_restored' 기록과 실제 재고 변화가 갈라져 이중 기록이 남는다. 처음부터 복원하지 않으면
--      대조 쪽은 '창고를 떠나 돌아오지 않은 수량'으로 그대로 읽는다.
--   2) 기록(recorded): 환불 확정이 끝난 뒤 admin_record_claim_defective_stock이 같은 클레임의 선택을 원장에 확정한다.
--      확정이 끝난 뒤 실패해도 확정은 되돌리지 않고 planned로 남아('불량 기록 필요') 같은 호출로 다시 시도한다. 멱등이다.
--
-- 재고는 이 원장으로 바뀌지 않는다. 재고 변경은 기존 private.change_goods_variant_stock 경로뿐이다(캐시 보호 규칙).

begin;

create table private.claim_defective_stock (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  qty integer not null check (qty > 0),
  state text not null default 'planned' check (state in ('planned','recorded')),
  planned_by uuid not null references public.profiles(id) on delete restrict,
  planned_at timestamptz not null default clock_timestamp(),
  -- 기록 시점에 정한다. 복원됐을 옵션(그룹상품 승계 반영)이다.
  good_id text,
  variant_id uuid references public.goods_variants(id) on delete restrict,
  good_name text,
  variant_name text,
  variant_code text,
  recorded_by uuid references public.profiles(id) on delete restrict,
  recorded_at timestamptz,
  constraint claim_defective_stock_item_once unique (order_item_id),
  constraint claim_defective_stock_recorded_complete check (
    (state = 'recorded') = (recorded_at is not null and recorded_by is not null and good_id is not null
      and variant_id is not null and good_name is not null and variant_name is not null and variant_code is not null)
  )
);
create index claim_defective_stock_claim on private.claim_defective_stock(claim_id);
create index claim_defective_stock_variant on private.claim_defective_stock(variant_id) where state = 'recorded';
create index claim_defective_stock_recent on private.claim_defective_stock(recorded_at desc, id) where state = 'recorded';

alter table private.claim_defective_stock enable row level security;
revoke all on private.claim_defective_stock from public, anon, authenticated, service_role;

-- 기록된 행은 불변이다. 선택(planned)만 바꾸거나 지울 수 있고 기록은 planned → recorded 한 번뿐이다.
create function private.guard_claim_defective_stock() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.state = 'recorded' then raise check_violation using message = 'defective_stock_ledger_immutable'; end if;
    return old;
  end if;
  if old.state = 'recorded' then raise check_violation using message = 'defective_stock_ledger_immutable'; end if;
  if new.claim_id <> old.claim_id or new.order_item_id <> old.order_item_id or new.qty <> old.qty
    or new.planned_by <> old.planned_by or new.planned_at <> old.planned_at then
    raise check_violation using message = 'defective_stock_plan_fields_immutable';
  end if;
  return new;
end $$;
revoke all on function private.guard_claim_defective_stock() from public, anon, authenticated, service_role;
create trigger claim_defective_stock_guard before update or delete on private.claim_defective_stock
  for each row execute function private.guard_claim_defective_stock();

-- restore_order_item_supply: 불량으로 고른 품목은 재고를 복원하지 않는다.
-- 앵커 치환으로 최소 변경한다(T12b도 이 함수를 고친다 — 앵커 한 줄만 더한다).
do $patch$
declare definition text; anchor text; patch text;
begin
  definition := pg_get_functiondef('private.restore_order_item_supply(uuid,text)'::regprocedure);
  anchor := E'\n affected:=target.hop_count>0';
  patch := E'\n -- 반품 불량 재고(QNA-035): 불량으로 고른 품목은 판매 재고로 되돌리지 않는다. 선택 행은 기록 뒤에도 남아 재호출에도 같다.\n'
    || E' if exists(select 1 from private.claim_defective_stock d join public.order_cancellation_requests c on c.id=d.claim_id\n'
    || E'  where d.order_item_id=item.id and c.stage not in (''rejected'',''withdrawn'')) then\n'
    || E'  if item.supply_source=''preorder'' then\n'
    || E'   update private.goods_preorder_reservations set state=''returned'',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value where order_item_id=item.id;\n'
    || E'  end if;\n'
    || E'  return;\n'
    || E' end if;';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'restore_order_item_supply anchor must match once';
  end if;
  execute replace(definition, anchor, patch || anchor);
end $patch$;

-- 선택 저장. 환불 확정(재고 복원) 전에만 부를 수 있다. 비어 있으면 모두 복원으로 되돌린다.
create function public.admin_plan_claim_defective_stock(p_claim_id uuid, p_order_item_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; claim public.order_cancellation_requests; ids uuid[]; item record; planned_count integer;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_claim_id is null or p_order_item_ids is null or cardinality(p_order_item_ids) > 200 then
    raise invalid_parameter_value using message = 'invalid_defective_stock_plan';
  end if;
  ids := coalesce(array(select distinct x from unnest(p_order_item_ids) x order by x), '{}');
  if exists(select 1 from unnest(ids) x where x is null) then raise invalid_parameter_value using message = 'invalid_defective_stock_plan'; end if;
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  perform 1 from public.orders where id = claim.order_id for update;
  if claim.claim_type <> 'return' then raise check_violation using message = 'defective_stock_return_only'; end if;
  if claim.stage in ('completed','rejected','withdrawn') then
    raise check_violation using message = 'defective_stock_claim_closed';
  end if;
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.order_items oi where oi.id = x and oi.order_id = claim.order_id)) then
    raise check_violation using message = 'defective_stock_item_not_in_order';
  end if;
  -- 거절·철회된 다른 클레임의 낡은 선택은 이 품목을 막지 않는다.
  delete from private.claim_defective_stock d using public.order_cancellation_requests c
  where c.id = d.claim_id and d.state = 'planned' and d.order_item_id = any(ids) and d.claim_id <> p_claim_id and c.stage in ('rejected','withdrawn');
  if exists(select 1 from private.claim_defective_stock d where d.order_item_id = any(ids) and d.claim_id <> p_claim_id) then
    raise unique_violation using message = 'defective_stock_item_in_other_claim';
  end if;
  delete from private.claim_defective_stock d where d.claim_id = p_claim_id and d.state = 'planned' and not (d.order_item_id = any(ids));
  for item in select oi.id, oi.qty from public.order_items oi where oi.id = any(ids) order by oi.id loop
    insert into private.claim_defective_stock(claim_id, order_item_id, qty, planned_by) values (p_claim_id, item.id, item.qty, actor)
    on conflict (order_item_id) do nothing;
  end loop;
  select count(*) into planned_count from private.claim_defective_stock where claim_id = p_claim_id;
  if planned_count <> cardinality(ids) then raise sqlstate 'PT409' using message = 'defective_stock_plan_conflict'; end if;
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.order.claim_defective_stock_planned', 'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_claim_id, 'orderItemIds', to_jsonb(ids)));
  return jsonb_build_object('claimId', p_claim_id, 'planned', planned_count);
end $$;

-- 확정 직후 기록. 클레임이 처리완료(재고 복원 단계 끝)일 때만 선택을 원장으로 확정한다. 멱등이다.
create function public.admin_record_claim_defective_stock(p_claim_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; claim public.order_cancellation_requests; row_ private.claim_defective_stock; item public.order_items;
  physical record; target record; target_variant public.goods_variants; target_good public.goods;
  recorded_now integer := 0; recorded_total integer;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_claim_id is null then raise invalid_parameter_value using message = 'invalid_defective_stock_record'; end if;
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  if claim.claim_type <> 'return' then raise check_violation using message = 'defective_stock_return_only'; end if;
  if exists(select 1 from private.claim_defective_stock where claim_id = p_claim_id and state = 'planned') then
    if claim.stage <> 'completed' then raise check_violation using message = 'defective_stock_claim_not_completed'; end if;
    for row_ in select * from private.claim_defective_stock where claim_id = p_claim_id and state = 'planned' order by order_item_id for update loop
      select * into item from public.order_items where id = row_.order_item_id;
      select * into physical from private.order_item_physical_unit(item.id);
      select * into target from private.resolve_goods_stock_successor(physical.good_id, physical.variant_id);
      select * into target_variant from public.goods_variants where id = target.variant_id;
      select * into target_good from public.goods where id = target.good_id;
      update private.claim_defective_stock set state = 'recorded', good_id = target.good_id, variant_id = target.variant_id,
        good_name = target_good.name, variant_name = target_variant.name, variant_code = target_variant.code,
        recorded_by = actor, recorded_at = clock_timestamp() where id = row_.id;
      insert into public.audit_log(actor_id, action, target, diff) values (actor, 'order.claim_defective_stock_recorded', 'order:' || claim.order_id::text,
        jsonb_build_object('claimId', p_claim_id, 'orderItemId', item.id, 'goodId', target.good_id, 'variantId', target.variant_id,
          'qty', row_.qty, 'physicalStockDelta', 0));
      recorded_now := recorded_now + 1;
    end loop;
  end if;
  select count(*) into recorded_total from private.claim_defective_stock where claim_id = p_claim_id and state = 'recorded';
  return jsonb_build_object('claimId', p_claim_id, 'recorded', recorded_now, 'total', recorded_total,
    'pending', (select count(*) from private.claim_defective_stock where claim_id = p_claim_id and state = 'planned'));
end $$;

-- 클레임별 품목과 지금의 선택. 일괄 확인창과 환불 단계가 쓴다.
create function public.admin_claim_defective_items(p_claim_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_operator_capability('sales.read', false) then raise insufficient_privilege using message = 'operator_capability_required'; end if;
  if p_claim_ids is null or cardinality(p_claim_ids) > 200 then raise invalid_parameter_value using message = 'invalid_defective_stock_claims'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claimId', c.id,
      'pending', (select count(*) from private.claim_defective_stock d where d.claim_id = c.id and d.state = 'planned'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'orderItemId', oi.id, 'name', oi.good_name_snapshot, 'variantName', oi.variant_name_snapshot, 'qty', oi.qty,
          'defective', d.id is not null, 'state', d.state) order by oi.good_id, oi.id), '[]'::jsonb)
        from public.order_items oi left join private.claim_defective_stock d on d.order_item_id = oi.id and d.claim_id = c.id
        where oi.order_id = c.order_id)
    ) order by c.id)
    from public.order_cancellation_requests c where c.id = any(p_claim_ids) and c.claim_type = 'return'), '[]'::jsonb);
end $$;

-- 불량 재고 목록: 옵션별 합계와 최근 기록, 기록이 필요한 클레임.
create function public.admin_list_defective_stock(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare limit_value integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not public.has_operator_capability('catalog.read', false) then raise insufficient_privilege using message = 'operator_capability_required'; end if;
  return jsonb_build_object(
    'variants', coalesce((select jsonb_agg(row order by row->>'goodName', row->>'variantName', row->>'variantId') from (
      select jsonb_build_object('goodId', d.good_id, 'goodName', d.good_name, 'variantId', d.variant_id, 'variantName', d.variant_name,
        'variantCode', d.variant_code, 'qty', sum(d.qty), 'entries', count(*), 'lastRecordedAt', max(d.recorded_at)) as row
      from private.claim_defective_stock d where d.state = 'recorded'
      group by d.good_id, d.good_name, d.variant_id, d.variant_name, d.variant_code) grouped), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(row order by (row->>'recordedAt') desc, row->>'id') from (
      select jsonb_build_object('id', d.id, 'claimId', d.claim_id, 'claimReference', c.reference, 'orderItemId', d.order_item_id,
        'goodName', d.good_name, 'variantId', d.variant_id, 'variantName', d.variant_name, 'variantCode', d.variant_code, 'qty', d.qty,
        'recordedAt', d.recorded_at, 'recordedByName', coalesce(p.nickname, '')) as row
      from private.claim_defective_stock d join public.order_cancellation_requests c on c.id = d.claim_id
      left join public.profiles p on p.id = d.recorded_by
      where d.state = 'recorded' order by d.recorded_at desc, d.id limit limit_value) recent), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(row order by row->>'claimReference') from (
      select jsonb_build_object('claimId', c.id, 'claimReference', c.reference, 'stage', c.stage, 'qty', sum(d.qty), 'items', count(*)) as row
      from private.claim_defective_stock d join public.order_cancellation_requests c on c.id = d.claim_id
      where d.state = 'planned' and c.stage = 'completed' group by c.id, c.reference, c.stage) waiting), '[]'::jsonb));
end $$;

-- 재고 대조 화면의 참고 칸: 옵션별 불량 수량(판매 재고에 들어 있지 않다).
create function public.admin_defective_stock_by_variant(p_variant_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_operator_capability('catalog.read', false) then raise insufficient_privilege using message = 'operator_capability_required'; end if;
  if p_variant_ids is null or cardinality(p_variant_ids) > 2000 then raise invalid_parameter_value using message = 'invalid_defective_stock_variants'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('variantId', d.variant_id, 'qty', d.qty) order by d.variant_id) from (
    select x.variant_id, sum(x.qty)::integer as qty from private.claim_defective_stock x
    where x.state = 'recorded' and x.variant_id = any(p_variant_ids) group by x.variant_id) d), '[]'::jsonb);
end $$;

revoke all on function public.admin_plan_claim_defective_stock(uuid,uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.admin_record_claim_defective_stock(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_claim_defective_items(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_defective_stock(integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_defective_stock_by_variant(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_plan_claim_defective_stock(uuid,uuid[]) to authenticated;
grant execute on function public.admin_record_claim_defective_stock(uuid) to authenticated;
grant execute on function public.admin_claim_defective_items(uuid[]) to authenticated;
grant execute on function public.admin_list_defective_stock(integer) to authenticated;
grant execute on function public.admin_defective_stock_by_variant(uuid[]) to authenticated;
revoke all on function private.restore_order_item_supply(uuid,text) from public, anon, authenticated, service_role;
grant execute on function private.restore_order_item_supply(uuid,text) to postgres;

select private.register_operator_rpc_contract('public.admin_plan_claim_defective_stock(uuid,uuid[])'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_record_claim_defective_stock(uuid)'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_claim_defective_items(uuid[])'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_list_defective_stock(integer)'::regprocedure, 'catalog.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_defective_stock_by_variant(uuid[])'::regprocedure, 'catalog.read', 'read', false);
select private.register_operator_internal_contract('private.restore_order_item_supply(uuid,text)'::regprocedure);

commit;
notify pgrst, 'reload schema';
