-- 10/27 회의 D5②(R24) 보강 — 랜덤 판매 굿즈의 재입고 인앱 알림을 굿즈 단위로 남긴다(T7 리뷰 RV-7).
--
-- 20261028160200부터 랜덤 굿즈의 새 재입고 신청은 굿즈 단위(variant_id null)다. 그러나 랜덤으로 바꾸기 전에 옵션 단위로
-- 신청해 둔 알림은 그대로 남고, 그 옵션 재고가 늘면 private.wake_restock_alerts가 '굿즈 · 옵션 옵션이 다시 판매를 시작했어요.'와
-- /shop/<id>?variant=<옵션> 링크를 남겼다. 상세는 랜덤 굿즈의 ?variant=를 무시하고 '랜덤'으로 팔므로, 고객이 고를 수 없는
-- 옵션의 재입고를 알리는 셈이었다. 랜덤 굿즈는 옵션 신청도 굿즈 단위 문구·링크로 알린다. 신청 행·dedupe 키(옵션 id 포함)는
-- 그대로라 같은 사용자의 굿즈 단위 신청과 서로 지우지 않는다. 메일(lib/email/transactional.server.ts)도 같은 규칙으로 그린다.
begin;

-- 재입고 인앱 알림: 랜덤 굿즈는 굿즈 단위 문구·링크 ------------------------------------------------------------
do $patch$
declare definition text; anchor text;
  target constant regprocedure:='private.wake_restock_alerts(public.goods,uuid)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$  woken integer := 0;
$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'wake_restock_random_declare_anchor_changed'; end if;
  definition:=replace(definition,anchor,anchor||$new$  -- 랜덤 판매 굿즈(D5②)는 고객이 옵션을 고르지 않는다 — 옵션 신청도 굿즈 단위 문구·링크로 알린다.
  random_good boolean := exists(select 1 from public.goods as good where good.id = target_good.id and good.option_sale_mode = 'random');
$new$);
  anchor:=$old$when flipped.variant_id is null or variant.name is null$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'wake_restock_random_body_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$when flipped.variant_id is null or variant.name is null or random_good$new$);
  anchor:=$old$case when flipped.variant_id is null then '' else '?variant=' || flipped.variant_id::text end$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'wake_restock_random_link_anchor_changed'; end if;
  execute replace(definition,anchor,$new$case when flipped.variant_id is null or random_good then '' else '?variant=' || flipped.variant_id::text end$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

commit;
