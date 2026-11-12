-- QA 라운드 1(물류) m3·m4 — 배송 방식을 바꾼 배송 건을 고객이 처음 고른 방식과 구별해 보이고, 누가 바꿨는지에 맞게 안내한다.
--
-- m3: 발주·발송 목록에서 발송처리 화면으로 방식을 바꾼 행이 고객이 처음부터 그 방식을 고른 행과 똑같이 보였다.
--     배송 방식 요약에 고객이 주문서에서 고른 방식(customerMethod = order_shipments.fulfillment_partition)을 싣는다.
-- m4: 운영자가 발송처리 화면에서 바꾼 건에도 고객·주문 화면이 '고객 요청으로 배송 방식을 변경했으며…'라고 안내했다.
--     마지막 방식 변경 기록의 출처를 changedBy로 싣는다 — 발송처리 화면(evidence.source='dispatch_console')이면 'store',
--     주문 상세의 고객 요청 경로(evidence에 고객 요청 근거 customerRequestReference)면 'customer', 기록이 없거나 알 수 없으면 null.
--
-- 요약은 고객 주문 화면(public.shipment_delivery_summary 계산 열)·주문 상세·발송 목록이 함께 쓴다. 두 값 모두 고객 자신의 선택과
-- 변경 주체뿐이라 고객에게 보여도 되고, 사유·담당자·고객 응대 메모는 싣지 않는다. 기존 키는 그대로라 옛 앱은 새 키를 무시한다.
begin;

do $patch$
declare
  target constant regprocedure := 'private.shipment_delivery_summary(uuid)'::regprocedure;
  body text;
  anchor constant text := $a$jsonb_build_object('method',shipment.delivery_method,$a$;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'qa1_logistics_delivery_summary_anchor_changed';
  end if;
  execute replace(body, anchor, $a$jsonb_build_object('method',shipment.delivery_method,'customerMethod',shipment.fulfillment_partition,
    'changedBy',(select case when operation.evidence->>'source'='dispatch_console' then 'store'
        when operation.evidence ? 'customerRequestReference' then 'customer' end
      from private.shipment_delivery_operations operation where operation.shipment_id=shipment.id and operation.kind='method_selected'
      order by operation.recorded_at desc,operation.id desc limit 1),$a$);
end $patch$;

commit;
