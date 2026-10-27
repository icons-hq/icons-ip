-- 10/14 회의 A5: 품목별 쿠폰·적립금 배분 후 금액을 주문 상세·상품주문별 화면·엑셀에 표시한다.
-- 배분 규칙은 앱의 공통 함수(lib/admin/item-allocation.ts, 거래확정 엑셀과 같은 규칙) 하나다.
-- 이 RPC는 그 계산에 필요한 주문 당시 기록만 돌려준다 — 계산 버전, 주문 쿠폰·적립금·복수구매 합계,
-- 버전 1 주문의 첫 적용 쿠폰(대상·대상 품목 합계), 품목의 단가·수량·당시 정가·당시 IP와 버전 2 배분 원장.
-- 현재 상품가·쿠폰 정의는 읽지 않는다. 읽기 전용이며 주문 상세와 같은 sales.read 권한이다.
--
-- 쿠폰 대상 범위는 상품('selected_goods')·카테고리('selected_categories')·IP('selected_ips')·전체다.
-- 품목마다 그 쿠폰의 대상이었는지(couponEligible)를 주문 당시 사용 스냅샷(terms_snapshot)으로 판정한다.
--   IP: 주문 품목의 당시 IP(good_ip_id_snapshot). 상품: 대상 상품 또는 그 그룹상품(체크아웃과 같은 규칙).
--   카테고리: 주문 품목에 당시 카테고리 기록이 없어 현재 분류로 판정한다. 앱은 대상 품목 합계가 기록된
--   eligible_subtotal과 같을 때만 배분하므로 분류가 바뀐 주문은 추정하지 않고 빈칸으로 둔다.
-- 거래확정 엑셀 수집(collect_settled_export*)의 품목에도 같은 판정을 실어 두 화면·파일이 같은 규칙을 쓴다.
begin;

create function private.coupon_line_eligible_now(p_terms jsonb,p_good text,p_ip text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare scope text:=p_terms->>'goodsScope'; categories uuid[]; category_match boolean;
begin
  if p_terms is null or p_good is null or jsonb_typeof(p_terms)<>'object' then return null; end if;
  if scope='all' then return true; end if;
  if scope='selected_goods' then
    return coalesce(p_good in (select jsonb_array_elements_text(coalesce(p_terms->'targetGoodIds','[]'::jsonb))),false)
      or coalesce(private.goods_aggregation_owner(p_good) in (select jsonb_array_elements_text(coalesce(p_terms->'targetGoodIds','[]'::jsonb))),false);
  end if;
  if scope='selected_ips' then
    return p_ip is not null and coalesce(p_ip in (select jsonb_array_elements_text(coalesce(p_terms->'targetIpIds','[]'::jsonb))),false);
  end if;
  if scope is distinct from 'selected_categories' then return null; end if;
  categories:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_terms->'targetCategoryIds','[]'::jsonb)) value);
  -- private.coupon_good_matches의 카테고리 분기와 같은 판정이다(읽기 전용이라 체크아웃 잠금은 잡지 않는다).
  with recursive assigned as (
    select g.category_id as id from public.goods g where g.id=p_good and g.category_id is not null
    union select a.category_id from public.goods_additional_categories a where a.good_id=p_good
  ), ancestors(start_id,id,parent_id,active,matched,visited) as (
    select c.id,c.id,c.parent_id,c.archived_at is null,c.id=any(categories),array[c.id]
      from public.catalog_categories c join assigned a on a.id=c.id
    union all select a.start_id,c.id,c.parent_id,a.active and c.archived_at is null,a.matched or c.id=any(categories),a.visited||c.id
      from public.catalog_categories c join ancestors a on a.parent_id=c.id
      where cardinality(a.visited)<4 and not c.id=any(a.visited)
  ) select exists(select 1 from ancestors where parent_id is null and active and matched) into category_match;
  return category_match;
end $$;
revoke all on function private.coupon_line_eligible_now(jsonb,text,text) from public,anon,authenticated,service_role;

create function public.admin_order_item_allocation_inputs(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  -- STABLE 조회는 PostgREST가 읽기 전용 트랜잭션으로 부르므로 잠금을 잡는 require_* 대신 잠금 없는 판정을 쓴다
  -- (20261020085358_goods_order_readers_readonly_authorization과 같은 관례).
  if not coalesce(private.has_operator_capability(auth.uid(),'sales.read',false),false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 1000 or array_position(p_order_ids,null) is not null then
    raise invalid_parameter_value using message='invalid_order_allocation_ids';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'orderId',o.id,'calculationVersion',o.calculation_version,
      'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,'volumeDiscount',o.volume_discount_total,
      'coupon',case when coupon.redemption_id is null then null else jsonb_build_object('discountAmount',coupon.discount_amount,
        'eligibleSubtotal',coupon.eligible_subtotal,'terms',coupon.terms_snapshot) end,
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'goodId',i.good_id,'ipId',i.good_ip_id_snapshot,'qty',i.qty,'unitPrice',i.unit_price,
          'regularUnitPrice',i.regular_unit_price_snapshot,
          'couponEligible',case when coupon.redemption_id is null then null else private.coupon_line_eligible_now(coupon.terms_snapshot,i.good_id,i.good_ip_id_snapshot) end,
          'allocation',case when a.order_item_id is null then null else jsonb_build_object('volumeDiscount',a.volume_discount,
            'couponDiscount',a.coupon_discount,'storeCreditDiscount',a.store_credit_discount,'paidGoodsTotal',a.paid_goods_total) end)
          order by i.id)
        from public.order_items i
        left join private.order_price_allocations a on a.order_item_id=i.id and a.order_id=o.id
        where i.order_id=o.id),'[]'::jsonb)
    ) order by o.id),'[]'::jsonb)
    from public.orders o
    left join lateral (
      select r.id as redemption_id,r.discount_amount,r.eligible_subtotal,r.terms_snapshot from public.coupon_redemptions r
      where r.order_id=o.id and r.status='applied' and r.benefit_kind='goods' and o.calculation_version=1
      order by r.application_index limit 1
    ) coupon on true
    where o.id=any(p_order_ids)
  );
end $$;

revoke all on function public.admin_order_item_allocation_inputs(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_item_allocation_inputs(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_order_item_allocation_inputs(uuid[])'::regprocedure,'sales.read','read',false);

-- 거래확정 엑셀 수집: 품목에 당시 IP와 쿠폰 대상 판정을 싣는다(이전 수집본은 이 두 값이 없어도 그대로 읽는다).
do $patch$
declare target text; definition text;
  anchor constant text:=$old$'id',item.id,'goodId',item.good_id,$old$;
  replacement constant text:=$new$'id',item.id,'goodId',item.good_id,'ipId',item.good_ip_id_snapshot,
    'couponEligible',private.coupon_line_eligible_now((select r.terms_snapshot from public.coupon_redemptions r
      where r.order_id=o.id and r.status='applied' and r.benefit_kind='goods' and o.calculation_version=1 order by r.application_index limit 1),
      item.good_id,item.good_ip_id_snapshot),$new$;
begin
  foreach target in array ARRAY['private.collect_settled_export(date,date,text)','private.collect_settled_export_for_date(date,date,text,text)',
    'private.collect_settled_export_for_search(date,date,text,text,text)'] loop
    definition:=pg_get_functiondef(target::regprocedure);
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 or position('from selected o' in definition)=0 then
      raise exception 'settled_export_item_anchor_changed: %',target;
    end if;
    execute replace(definition,anchor,replacement);
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target::regprocedure) then
      perform private.register_operator_internal_contract(target::regprocedure);
    end if;
  end loop;
end $patch$;

commit;
notify pgrst,'reload schema';
