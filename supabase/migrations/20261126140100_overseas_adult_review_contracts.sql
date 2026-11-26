begin;

-- 접수번호는 고객과 담당자가 함께 쓰는 업무 번호다. 저장·정리용 UUID는 화면에 표시하지 않는다.
alter table private.overseas_adult_requests add column request_no bigint generated always as identity unique;
alter table private.overseas_adult_requests alter column challenge drop not null;

create or replace function public.my_overseas_adult_request() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('open', private.overseas_intake_open(), 'domesticVerified', private.adult_verification_valid(auth.uid()), 'goods', coalesce((
    select jsonb_agg(g.name order by g.name) from private.overseas_adult_goods a
    join public.goods g on g.id=a.good_id join public.ips i on i.id=g.ip_id
    where g.sale_restriction='adult' and g.published_at is not null and g.archived_at is null
      and i.published_at is not null and i.archived_at is null and (select private.adult_goods_storefront_enabled())
  ),'[]'::jsonb), 'request', (
    select jsonb_build_object('id',r.id,'number',r.request_no,'state',r.state,'outcome',case when r.state='closed' then r.outcome end,
      'challenge',case when r.state='draft' then r.challenge end,'expiresAt',r.expires_at,'validUntil',case when r.valid_until>now() then r.valid_until end)
    from private.overseas_adult_requests r where r.user_id=(select auth.uid()) order by r.created_at desc limit 1));
$$;

create or replace function public.overseas_review_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.overseas_reviewer(actor) then raise insufficient_privilege; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'number',q.request_no,'submittedAt',q.submitted_at) order by q.submitted_at) from
    (select id,request_no,submitted_at from private.overseas_adult_requests where state='pending' and expires_at>now()
      and user_id<>actor and private.overseas_member_active(user_id) order by submitted_at limit 100) q),'[]'::jsonb);
end $$;

create or replace function public.overseas_adult_management() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.overseas_policy_manager(actor) then raise insufficient_privilege; end if;
  return jsonb_build_object('goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'enabled',a.good_id is not null) order by g.name)
    from public.goods g left join private.overseas_adult_goods a on a.good_id=g.id where g.sale_restriction='adult' and g.archived_at is null),'[]'::jsonb),
    'operators',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.nickname,'enabled',r.user_id is not null) order by p.nickname)
    from public.profiles p left join private.overseas_adult_reviewers r on r.user_id=p.id where r.user_id is not null or (private.has_operator_capability(p.id,'platform.manage',true)
      and exists(select 1 from auth.mfa_factors f where f.user_id=p.id and f.status='verified'))),'[]'::jsonb));
end $$;

create or replace function private.overseas_queue_destruction(p_id uuid, p_outcome text) returns void
language sql volatile security definer set search_path='' as $$
  update private.overseas_adult_requests set state='purging', outcome=p_outcome, decided_at=clock_timestamp(),
    cleanup_after=greatest(clock_timestamp(), upload_until), key_share=null, challenge=null, token_digest=null, review_session=null
  where id=p_id and state not in ('closed','purging');
$$;

-- 본인 주문은 내려간 상품도 보강하지만, 성인 상품의 사진은 해당 상품을 볼 수 있을 때만 제공한다.
drop function public.my_order_line_goods(text[]);
create function public.my_order_line_goods(p_good_ids text[])
returns table (
  id text,
  ip_id text,
  image_path text,
  bg text,
  sale_restriction public.goods_sale_restriction,
  adult_readable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise insufficient_privilege using message = 'auth required';
  end if;
  if p_good_ids is null or cardinality(p_good_ids) > 1000 then
    raise invalid_parameter_value using message = 'invalid_order_line_goods';
  end if;
  return query
  select good.id, good.ip_id, case when access.readable then good.image_path end, case when access.readable then good.bg end,
    good.sale_restriction, access.readable
  from public.goods good
  cross join lateral (select private.good_sale_restriction_visible(good.sale_restriction,actor,good.id) as readable) access
  where good.id = any(p_good_ids)
    and good.id in (
      select item.good_id
      from public.orders parent
      join public.order_items item on item.order_id = parent.id
      where parent.user_id = actor
        and item.good_id = any(p_good_ids)
    )
  order by good.id;
end;
$function$;

comment on function public.my_order_line_goods(text[]) is
  '본인 주문(선물로 보낸 주문 포함)에 담긴 상품의 품목 줄 보강 값. 공개 상태와 무관하게 돌려준다(MD-0036).';

revoke all on function public.my_order_line_goods(text[]) from public, anon, authenticated, service_role;
grant execute on function public.my_order_line_goods(text[]) to authenticated;

-- 선행 migration에서 상품 ID를 넘기게 된 기존 함수만 새 본문으로 등록한다. 권한 종류는 유지한다.
select private.register_operator_rpc_contract('public.goods_variant_pricing(public.goods_variants)'::regprocedure,'catalog.read','mixed',false);
select private.register_operator_internal_contract(signature::regprocedure) from unnest(array[
  'private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)',
  'private.category_display_matching_goods(jsonb)',
  'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)',
  'private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)',
  'private.goods_group_public_good(text)',
  'private.goods_relation_document(uuid)',
  'private.goods_sales_conditions_core(jsonb)',
  'private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)',
  'private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)',
  'public.add_cart_selection(text,jsonb)',
  'public.get_good_after_sales_content(text)',
  'public.get_good_announcements(text)',
  'public.get_good_benefit_content(text)',
  'public.get_good_media(text)',
  'public.get_good_other_compositions(text)',
  'public.get_good_relation_compositions(text)',
  'public.get_good_shipping_policy(text)',
  'public.get_good_size_chart(text)',
  'public.get_goods_listing_appearance(text[])',
  'public.get_goods_transaction_offers(text[])',
  'public.get_my_product_detail_interests()',
  'public.get_product_detail_experience(text)',
  'public.get_product_detail_presentation(text)',
  'public.get_product_shipping_savings(text,uuid,integer)',
  'public.goods_sale_period(public.goods)',
  'public.goods_variant_pricing(public.goods_variants)'
]) as changed(signature);

-- 심사 전용 권한과 현재 AAL2 세션을 함께 확인하므로 일반 capability 하나만으로 허가되는 read/write와 구분한다.
select private.register_operator_rpc_contract(signature::regprocedure,capability,'manual',true) from (values
  ('public.overseas_adult_management()','operators.manage'),
  ('public.configure_overseas_adult_review(text,text,boolean)','operators.manage'),
  ('public.overseas_review_queue()','platform.manage'),
  ('public.open_overseas_adult_review(uuid,text)','platform.manage'),
  ('public.deliver_overseas_adult_review(uuid,text)','platform.manage'),
  ('public.overseas_adult_review_live(uuid,text)','platform.manage'),
  ('public.decide_overseas_adult_review(uuid,text,date,boolean)','platform.manage')
) as guarded(signature,capability);
commit;
