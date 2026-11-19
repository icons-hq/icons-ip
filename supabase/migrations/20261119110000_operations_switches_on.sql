-- 실운영 전 3차: 운영 스위치 네 가지를 켠다(2026-11-19 사용자 결정).
--
-- 사용자 원문(선택지 답):
--   - 부분 반품: "전부 다 구현하고 스위치도 전부 다 켜"
--   - 반품배송비 편도 금액: "편도 3,000원" (최초 무료배송 주문은 왕복 6,000원)
--   - 지연 안내 메일: "같이 켜기"
--   - 무료배송 주문 왕복 차감: "전부 바로 켜기(왕복 포함)" — 약관 제3조(불리한 변경 30일 공지) 다툼 위험을 감수한 결정이다.
--
-- 이 migration이 운영에 적용되는 시각이 각 스위치의 '켠 시각'이다. 반품배송비 차감은 그 뒤 접수된 단순 변심 반품부터
-- 적용된다(ADR-0031 보완, `return_fee_deduction_plan`). 이미 켜져 있는 칸은 켠 시각을 바꾸지 않는다(재실행·수동 선행 대비).
-- 직접 변경이므로 기존 시스템 감사(system.return_fee_deduction.settings_changed, system.order_delay_notice.delivery_changed)가
-- 남고 updated_by는 비워진다(운영 스위치 화면 저장과 구분). 끄는 것은 어드민 운영 스위치 화면에서 한다.
--
-- CI DB 단계는 reset 직후 이 값이 켜졌는지 확인한 뒤 스모크용으로 다시 끈다(.github/workflows/pipeline.yml) — 스위치를 끈
-- 전제로 쓰인 기존 시험을 지키고, 켠 동작은 각 시험이 자기 트랜잭션에서 켜고 검증한다.
begin;

update private.order_delay_notice_delivery_control
   set enabled = true,
       evidence = '2026-11-19 사용자 결정으로 켬: 12/2 예약 판매 일정 변경·지연 안내를 위해 지연 안내 메일 발송을 연다.',
       changed_at = clock_timestamp()
 where singleton and not enabled;

update private.return_fee_deduction_settings
   set enabled = true,
       one_way_amount = 3000,
       evidence = '2026-11-19 사용자 결정으로 켬: 단순 변심 반품배송비 편도 3,000원(최초 무료배송 주문은 왕복 6,000원)을 환불금에서 뺀다. 켠 시각 이후 접수분부터.',
       enabled_at = clock_timestamp()
 where singleton and not enabled;

update private.return_fee_deduction_settings
   set partial_cancel_enabled = true,
       partial_cancel_evidence = '2026-11-19 사용자 결정으로 켬: 재고 부족 시 고객 결정대로 품목·수량을 부분 취소하고 나머지를 출고한다(일부 발송 주문의 발송 전 몫 포함).',
       partial_cancel_enabled_at = clock_timestamp()
 where singleton and not partial_cancel_enabled;

update private.return_fee_deduction_settings
   set partial_return_enabled = true,
       partial_return_evidence = '2026-11-19 사용자 결정으로 켬: 고객 반품 신청·판매자 대리 접수에서 품목·수량 단위 부분 반품을 받는다.',
       partial_return_enabled_at = clock_timestamp()
 where singleton and not partial_return_enabled;

do $$
begin
  if not (select enabled from private.order_delay_notice_delivery_control where singleton)
    or not exists (
      select 1 from private.return_fee_deduction_settings s
       where s.singleton and s.enabled and s.one_way_amount = 3000
         and s.partial_cancel_enabled and s.partial_return_enabled
    ) then
    raise exception 'operations_switches_on_failed';
  end if;
end $$;

commit;
