-- 1014-109 리뷰 후속: 상품 목록·IP의 '기간 할인 중지'(goods_bulk discount_stop) 확정이 state='active'인 이미 끝난 기간 할인
-- 행까지 disabled로 바꿔, 끝까지 진행된 할인(할인 프로모션이 건 할인 포함)의 이력이 '중지'로 바뀌었다.
-- 미리보기의 꺼질 할인(ends_at>현재)·admin_stop_discount_promotion과 같은 조건으로 진행 중·예정 행만 끈다.
-- 다른 변경과 겹치지 않게 현재 유효 본문(20261027150100)에 앵커 치환하고, 운영자 계약을 같은 자리에서 다시 등록한다.
begin;
do $patch$
declare definition text; anchor text;
  target constant regprocedure:='public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$for p in select * from private.goods_variant_price_periods where good_id=g.id and state='active' order by id loop$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'goods_bulk_discount_stop_anchor_changed';
  end if;
  definition:=replace(definition,anchor,
    $new$for p in select * from private.goods_variant_price_periods where good_id=g.id and state='active' and ends_at>clock_timestamp() order by id loop$new$);
  execute definition;
end $patch$;
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
commit;
