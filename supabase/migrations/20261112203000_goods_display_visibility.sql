-- QA1 MD 후속: 전시 구성(홈 전시·카테고리 전시·쇼핑스토리·캠페인 상품 묶음)에 담은 상품이 고객 화면에 보이지 않는 이유를
-- CONTEXT.md '게시 상태'(초안·공개·보관) 말로 나눈다. 지금까지 어드민은 상품·IP 공개, 보관, 판매 제한을 한 값(published)으로만 받아
-- '비공개'라는 피해야 할 말로 묶어 보였다.
--
-- 1. private.goods_display_visibility(상품, IP 공개, IP 보관) — 이유 하나를 돌려준다. 순서는 상품 보관 > IP 보관 > 상품 초안 >
--    IP 초안 > 판매 제한(성인 19금 등) > 공개. 고객 화면 판정(published)과 같은 조건을 나눈 것이라 공개면 published도 참이다.
-- 2. private.shopping_story_admin_good — 관련상품 찾기·쇼핑스토리·여러 줄 추가 후보 행에 'visibility'를 더한다. 다른 변경과
--    겹치지 않게 현재 유효 본문(20261020085233)에 앵커 치환하고 내부 계약을 같은 자리에서 다시 등록한다. 키를 더할 뿐이라
--    기존 읽기(앱 파서·RPC)는 그대로다.
-- 3. public.admin_goods_display_visibility(상품번호[]) — 저장된 전시 구성을 다시 열 때 이름·판매자상품코드·이유만 돌려주는 가벼운 읽기.
--    여러 줄 추가용 admin_resolve_goods_references는 담기용 후보(가격·재고·판매 지표·배송비)를 함께 계산해 격리 스택에서
--    상품번호 1,000개에 5.6~5.8초가 걸렸다(결제 완료 주문 3,000건). 다시 열기에는 그 값이 필요 없다.
begin;

create function private.goods_display_visibility(p_good public.goods,p_ip_published boolean,p_ip_archived boolean) returns text
language sql immutable set search_path='' as $$
  select case
    when p_good.archived_at is not null then 'archived'
    when p_ip_archived then 'ip_archived'
    when p_good.published_at is null then 'draft'
    when not p_ip_published then 'ip_draft'
    when p_good.sale_restriction<>'none' then 'restricted'
    else 'public' end;
$$;
revoke all on function private.goods_display_visibility(public.goods,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function private.goods_display_visibility(public.goods,boolean,boolean) to postgres;
comment on function private.goods_display_visibility(public.goods,boolean,boolean) is
  '전시 구성에 담은 상품이 고객 화면에 보이지 않는 이유(archived·ip_archived·draft·ip_draft·restricted) 또는 public.';

do $patch$
declare definition text; anchor text;
  target constant regprocedure:='private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$'published',p_good.published_at is not null and p_ip_published and p_good.archived_at is null and not p_ip_archived and p_good.sale_restriction='none',$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'shopping_story_admin_good_visibility_anchor_changed';
  end if;
  definition:=replace(definition,anchor,anchor||$new$
  'visibility',private.goods_display_visibility(p_good,p_ip_published,p_ip_archived),$new$);
  execute definition;
end $patch$;
revoke all on function private.shopping_story_admin_good(public.goods,boolean,boolean) from public,anon,authenticated,service_role;

create function public.admin_goods_display_visibility(p_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null
    or exists(select 1 from unnest(p_ids) id where id<>btrim(id) or char_length(id) not between 1 and 200) then
    raise invalid_parameter_value using message='invalid_goods_display_ids';
  end if;
  -- 상품번호로만 찾는다(저장된 구성의 값이다). 없는 상품번호는 빠지고, 화면은 그 값을 '찾을 수 없음'으로 보인다.
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,
      'visibility',private.goods_display_visibility(g,ip.published_at is not null,ip.archived_at is not null)) order by refs.ordinality)
    from unnest(p_ids) with ordinality refs(id,ordinality)
    join public.goods g on g.id=refs.id
    join public.ips ip on ip.id=g.ip_id),'[]'::jsonb);
end $$;
revoke all on function public.admin_goods_display_visibility(text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_display_visibility(text[]) to authenticated;

select private.register_operator_internal_contract('private.goods_display_visibility(public.goods,boolean,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_goods_display_visibility(text[])'::regprocedure,'catalog.read','read',false);
notify pgrst,'reload schema';
commit;
