-- 10/27 회의 후속(m27) D5② 랜덤 판매(CUST-1): 선물·정기배송은 랜덤 판매 굿즈를 받지 않는다.
--
-- 거래 런타임 계산(private.calculate_goods_transaction_locked)은 이미 랜덤 굿즈를 goods_unavailable로 막는다(20261028160100).
-- 그러나 그 판정은 결제 단계에서야 걸려서, 선물은 준비·수락까지 진행되고 그동안 선물 품목 표시(gift_items.item_display)에
-- 장바구니 키인 기본 옵션의 실제 이름이 남는다. 정기배송은 제안이 랜덤 굿즈를 내보이고 신청이 실제 이유와 다른 이슈로 막힌다.
-- 그래서 진입 시점에 이유 코드로 거절한다(고객 화면이 코드를 문구로 바꾼다).
--
-- 1. 선물: 선택 검증 private.gift_selection_display(create_my_gift의 생성, respond_to_gift의 수락이 함께 쓴다)가 랜덤 굿즈를
--    gift_random_option_unsupported(23514)로 거절한다. 품목 표시가 만들어지기 전이라 기본 옵션 이름이 선물에 남지 않는다.
-- 2. 정기배송: 제안 public.get_goods_subscription_offers에서 랜덤 굿즈를 빼고, 신청 public.prepare_my_goods_subscription은
--    견적 전에 subscription_random_option_unsupported(23514)로 거절한다. 기존 정기배송의 갱신·변경은 지금처럼 거래 런타임
--    계산이 막는다(goods_unavailable).
-- 함수는 현재 유효 본문에 앵커를 치환해 바꾸고, 봉인을 다시 적용한 뒤 내부 계약을 다시 등록한다.
begin;

do $patch$
declare definition text; anchor text;
  gift_display constant regprocedure:='private.gift_selection_display(jsonb)'::regprocedure;
  subscription_prepare constant regprocedure:='public.prepare_my_goods_subscription(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,bigint)'::regprocedure;
  subscription_offers constant regprocedure:='public.get_goods_subscription_offers(text[])'::regprocedure;
begin
  definition:=pg_get_functiondef(gift_display);
  anchor:=$old$if not found then raise no_data_found using message='gift_good_unavailable';end if;$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'gift_selection_random_anchor_changed'; end if;
  execute replace(definition,anchor,anchor||$new$
  -- 랜덤 판매 굿즈(D5②)는 선물로 준비·수락하지 않는다(받는 사람 화면에 배정 전 기본 옵션 이름이 남지 않게 한다).
  if good.option_sale_mode='random' then raise check_violation using message='gift_random_option_unsupported';end if;$new$);

  definition:=pg_get_functiondef(subscription_prepare);
  anchor:=$old$ source:=private.subscription_source(p_operation_id,terms_id::text);$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'subscription_prepare_random_anchor_changed'; end if;
  execute replace(definition,anchor,$new$ -- 랜덤 판매 굿즈(D5②)는 정기배송을 받지 않는다(회차마다 옵션을 배정하는 계약이 없다).
 if exists(select 1 from jsonb_array_elements(selection) line join public.goods g on g.id=line->>'goodId' where g.option_sale_mode='random') then
  raise check_violation using message='subscription_random_option_unsupported';end if;
$new$||anchor);

  definition:=pg_get_functiondef(subscription_offers);
  anchor:=$old$and g.allow_card_payment and exists($old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'subscription_offers_random_anchor_changed'; end if;
  execute replace(definition,anchor,$new$and g.allow_card_payment and g.option_sale_mode<>'random' and exists($new$);
end $patch$;

revoke all on function private.gift_selection_display(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.gift_selection_display(jsonb) to postgres;
revoke all on function public.prepare_my_goods_subscription(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.prepare_my_goods_subscription(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,bigint) to authenticated;
revoke all on function public.get_goods_subscription_offers(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_subscription_offers(text[]) to anon,authenticated;

select private.register_operator_internal_contract('private.gift_selection_display(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.prepare_my_goods_subscription(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,bigint)'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_subscription_offers(text[])'::regprocedure);

commit;
notify pgrst,'reload schema';
