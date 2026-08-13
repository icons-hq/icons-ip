# Provider-neutral payment backfill runbook

이 runbook은 `payments.provider` additive migration의 Production 증거를 남긴다. 채팅이나
issue에 결제 식별자·raw payload를 복사하지 않고 **집계만** 기록한다.

## 배포 전 readback

Production schema 변경 전에 workflow가 service-only SQL 경로에서 schema-aware preflight를
실행한다.

```sh
node scripts/payment-provider-backfill-preflight.mjs --linked
```

`payments.provider`가 아직 없을 때만 기존 Toss 유료 결제 **정확히 2건**을 요구한다. 실제
값이 2가 아니면 migration 전에 process를 non-zero로 끝내고 배포를 중단한다. 이미 provider
column이 있으면 이후 배포를 위해 preflight를 안전하게 건너뛰고, 아래 immutable migration
evidence readback이 계속 계약을 검증한다. 확인한 count, 실행 시각, 대상 project ref의 masked
suffix, 배포 전 SHA를 #204에 기록한다.

## migration과 배포 후 검증

Migration은 실행 시점의 전체 행 수와 null provider 수를 snapshot하고, 수정 행 수·전체 행
수 보존·모든 기존 행의 `provider=toss`·null 0을 같은 transaction에서 검증한다. 불변식이
어긋나면 migration 전체가 rollback된다.

배포 후 workflow는 Production 전용 기대값 2를 migration evidence에 고정한 readback을
자동 실행한다.

```sh
supabase db query --linked \
  --file supabase/tests/payment_provider_production_readback.sql
```

최초 배포 출력에서 `payment_count=2`, `toss_count=2`, `korpay_count=0`을 확인한다. 이후
결제 행이 늘어도 immutable evidence의 `before_total=2`, `updated_count=2`, `after_toss=2`가
계속 진실원이다. 이어서 기존 known Toss 거래 두 건의 조회·취소·웹훅 경로가
`provider=toss` 행만 선택하는 테스트와 Production canary를 확인한다. 새로운 Korpay 거래를
만들거나 실제 결제를 수행하지 않는다.

## 기록할 증거

- 배포 SHA와 migration 이름
- pre/post 집계와 실행 시각
- masked Supabase project ref
- main Actions URL과 SQL 결과
- 기존 known Toss 거래 회귀 결과(식별자·PG 응답 원문 제외)

어느 값이든 기대와 다르면 #204를 닫거나 Project를 `Done`으로 바꾸지 않는다.

## Toss compatibility 종료 계약

#205·#206이 checkout을 provider seam으로 옮기기 전에는 Toss 승인이 local pending 기록보다
먼저 도착할 수 있어 웹훅이 `unknown_compatibility` payment key를 한시적으로 재조회한다. 이
예외는 `LegacyTossPaymentRepository` 한 곳에만 둔다. 두 checkout 전환 뒤에는 같은 fixture가
provider 조회·취소·원장 write를 모두 0회로 유지하는 known-only 회귀 테스트로 바뀌어야 하며,
그 증거 없이는 Toss runtime을 legacy-only로 표시하지 않는다.
