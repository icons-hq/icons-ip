---
status: accepted
---

# 무통장 환불은 운영자 증빙으로 finalize를 먼저 하고, 계좌 송금은 그 뒤 원장에 기록한다

무통장 입금([ADR-0007](./0007-bank-transfer-payments.md)) 주문의 클레임 환불에는 PG 왕복이 없어서, 재고 복원·카드팩 회수(finalize)와 실제 계좌 송금의 순서를 정해야 한다. 기존 원장 규율은 finalize → 환불 filed → 환불 completed 순서를 강제한다(`admin_record_order_claim_refund`가 completed 기록에 클레임 종결을 선행 요구). 결정: **finalize의 증빙은 운영자의 취소 확정 기록이며, 송금 완료가 아니다.** 재고는 운영자가 취소를 확정한 순간 복원되고, 송금은 그 뒤 filed→completed로 `refunds` 원장에 기록된다. 환불 완료의 정의는 송금 증빙(처리자·시각·근거)과 함께 원장에 기록한 순간이다(`CONTEXT.md`의 **환불**).

## Considered Options

- **송금 완료를 finalize 선행 조건으로 요구** — "돈이 나가기 전에 재고가 풀리는" 창을 없애지만, completed 기록이 finalize를 선행 요구하는 기존 원장 규율과 교착한다. 규율 재설계는 Korpay·legacy Toss 경로까지 흔든다. 폐기.
- **운영자 취소 확정 기록을 finalize 증빙으로 인정 (채택)** — 입금 확인(어드민 액션이 증빙을 기록하고 DB 멱등 finalizer를 호출)과 거울 대칭이라 운영 규율이 하나로 통일된다. 재고 복원 후 송금 지연 리스크는 `refunds.completed_at` 공백을 미송금 큐로 가시화해 관리한다.

## Consequences

- finalize 함수가 `provider = 'bank_transfer'` 결제를 provider 취소 증빙의 등가물(운영자 증빙)로 인정해야 한다 — DB 마이그레이션 필요. TS에서 가짜 증빙을 주입하는 우회는 게이트 우회라 금지.
- ADR-0007의 "클레임 접수 시 환불계좌 수집 필수"가 이 결정의 선행 조건이 된다(현재 미구현) — 접수 시 필수화 + 어드민 사후 기입·정정 경로를 함께 만든다.
- 미송금 큐(finalize 완료·`completed_at` 공백)가 운영 절차에 추가된다. 뱅크다류 연동이 송금 확인을 보조할 수 있지만 기록 주체는 여전히 운영자다.
