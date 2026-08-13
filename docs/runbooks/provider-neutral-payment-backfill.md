# Provider-neutral payment backfill runbook

이 runbook은 `payments.provider` additive migration의 Production 증거를 남긴다. 채팅이나
issue에 결제 식별자·raw payload를 복사하지 않고 **집계만** 기록한다.

## 배포 전 readback

Production schema 변경 전에 service-only SQL 경로에서 다음 집계를 읽는다.

```sql
select count(*) as legacy_payment_count
from public.payments;
```

승인 시점의 기대값은 기존 Toss 유료 결제 **2건**이다. 실제 값이 2가 아니면 migration을
실패시키거나 임의 행을 수정하지 말고, 배포를 중단한 뒤 차이를 조사한다. 확인한 count,
실행 시각, 대상 project ref의 masked suffix, 배포 전 SHA를 #204에 기록한다.

## migration과 배포 후 검증

Migration은 실행 시점의 전체 행 수와 null provider 수를 snapshot하고, 수정 행 수·전체 행
수 보존·모든 기존 행의 `provider=toss`·null 0을 같은 transaction에서 검증한다. 불변식이
어긋나면 migration 전체가 rollback된다.

배포 후에는 Production 전용 기대값 2를 고정한 readback을 실행한다.

```sh
supabase db query --linked \
  --file supabase/tests/payment_provider_production_readback.sql
```

출력에서 `payment_count=2`, `toss_count=2`, `korpay_count=0`을 확인한다. 이어서 기존 known
Toss 거래 두 건의 조회·취소·웹훅 경로가 `provider=toss` 행만 선택하는 테스트와 Production
canary를 확인한다. 새로운 Korpay 거래를 만들거나 실제 결제를 수행하지 않는다.

## 기록할 증거

- 배포 SHA와 migration 이름
- pre/post 집계와 실행 시각
- masked Supabase project ref
- main Actions URL과 SQL 결과
- 기존 known Toss 거래 회귀 결과(식별자·PG 응답 원문 제외)

어느 값이든 기대와 다르면 #204를 닫거나 Project를 `Done`으로 바꾸지 않는다.
