# 택배 추적 자동 배송완료 켜기·끄기 (QNA-028)

[ADR-0033](../adr/0033-shipment-extra-trackings-auto-delivery.md)의 택배 추적 자동 배송완료는 **DB 스위치를 끈 채 배포**한다(`20261112230100_delivery_tracking_auto_delivery`). 꺼져 있는 동안 `/api/cron/delivery-tracking`(10분마다)은 스위치를 한 번 읽고 끝나며, 외부 추적 서비스를 부르지 않고 배송 상태·화면을 바꾸지 않는다. 배송현황의 "자동 확인·수동 처리"와 추적 진행 표시도 그리지 않는다. 배송 건 추가 운송장(QNA-019)은 스위치와 관계없이 동작한다.

## 켜기 전 사람 게이트

1. 추적 서비스 선정과 계약, API 키(유료). 한진택배·우체국택배 지원과 조회 한도를 확인한다.
2. 추적 서비스에 운송장번호를 넘기는 개인정보 처리위탁 검토와 처리방침 고지.
3. 자동 판정 오류 정정 정책 승인 — 문앞 배송 분실·오배송처럼 추적이 "배달완료"인데 고객이 받지 못한 경우 배송완료(=청약철회·자동 구매확정 기산)를 어떻게 되돌리거나 연장할지. 지금은 되돌리는 화면이 없다.
4. 그 서비스의 어댑터 구현(`lib/fulfillment/tracking/adapter.server.ts`의 `PROVIDERS`에 등록). 서비스 응답을 `TrackingEvent`로 정규화하고(상태: 집화 접수·이동 중·배송 출발·배달 완료·배송 이상·반송·확인 중), 수령인 이름·전화 같은 개인정보는 `raw`에 남기지 않는다. 택배사 코드는 ICONS 레지스트리 코드(`hanjin`·`epost`)를 서비스 코드로 바꾼다.

## 켜는 순서

1. 어댑터가 든 변경을 main에 배포하고 `deploy-supabase`·`deploy-vercel`이 모두 성공했는지 확인한다.
2. Vercel production env에 `DELIVERY_TRACKING_PROVIDER`(서비스 이름, 예: `sweettracker`), `DELIVERY_TRACKING_API_URL`, `DELIVERY_TRACKING_API_KEY`를 넣는다. 서버 전용 값이며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. env만으로는 아무것도 켜지지 않는다.
3. 후속 migration(별도 PR)으로 DB 스위치를 켠다. 변경은 감사 기록 `system.delivery_tracking.settings_changed`에 남는다.

   ```sql
   begin;
   update private.delivery_tracking_settings
      set auto_delivery_enabled = true, provider = '<서비스 이름>', enabled_at = clock_timestamp(), updated_at = clock_timestamp()
    where singleton and not auto_delivery_enabled;
   commit;
   ```

   조회 간격(기본 120분, 10~1440)은 같은 표의 `poll_interval_minutes`다.
4. 켠 뒤 다음 cron 응답이 200이고 `polled`가 늘어나는지 확인한다. 503이면 응답의 칸으로 원인을 가른다(응답에는 건수와 코드만 있고 운송장번호·오류 본문은 없다).
   - `unavailable`: env 이름이 DB `provider`와 다르거나(`provider_mismatch`) 비어 있다(`provider_missing`).
   - `failed`: 조회 실패 — 서비스 한도·키를 본다.
   - `invalid`: DB가 형식이 틀렸다고 본 운송장 결과 수 — 어댑터 정규화와 DB 기준이 어긋난 것이다. 그 운송장만 조회 오류(`shipment_tracking_polls.last_error_code = 'invalid_event'`)로 남고 같은 회차의 나머지는 기록·판정된다.
   - `failedStages`: 실패한 단계 이름(`targets` 대상 고르기, `record` 기록, `complete` 판정). 한 단계가 실패해도 다음 단계는 돈다 — 기록이 실패해도 이미 받은 이벤트의 판정은 한다. 같은 단계가 계속 실패하면 Supabase 로그에서 그 RPC 오류를 본다.
   - `skipped`(200에서도 나올 수 있다): 운영자 처리 등이 잠금을 쥐고 있어 다음 회차로 넘긴 묶음 수다. 실패가 아니다.
5. 배송현황 배송중 탭에서 "택배 추적 … · 도착 n/m"이 보이고, 모든 운송장이 도착한 건이 다음 회차에 배송완료 탭으로 옮겨져 "자동 확인 · 택배 추적"으로 보이는지 확인한다. 주간 변경 기록도 이 주에 적는다.
6. 같은 PR에서 운영 가이드(`lib/admin/guide/topics/orders-shipping.ts`)에 아래 "켤 때 운영 가이드에 넣을 문장"을 넣는다. 꺼진 동안에는 가이드에 자동 배송완료를 적지 않는다.

## 동작 요약

- 기준 시각: 운송장마다 그 배송 건에 쓰이기 시작한 시각 이후 이벤트만 근거로 본다 — 대표 운송장은 발송 시각, 추가 운송장은 붙은 시각과 발송 시각 중 늦은 쪽. 택배사가 다시 쓰는 번호·잘못 적은 번호의 옛 "배달완료" 이력은 근거가 아니며, 그런 운송장은 계속 조회 대상에 남는다(새 도착이 오지 않으면 사람이 처리한다).
- 대상: 최근 30일 안에 발송한 배송 중 택배 건의 대표·추가 운송장 가운데 기준 시각 이후 아직 배달완료가 아닌 것. 한 회차에 40개까지, 오래 조회하지 않은 것부터 조회한다.
- 판정: 대표·추가 운송장 모두의 기준 시각 이후 최근 이벤트가 배달완료여야 배송완료다. 시각은 그 가운데 가장 늦은 도착 시각(지금보다 늦으면 지금)이고 주문 배송완료·구매확정 기한이 그 시각을 따른다. 합포장은 묶음 전체가 함께 옮긴다.
- 기록: 결과나 이벤트 하나가 틀리면(형식 오류, 하루 넘게 미래인 시각) 그 운송장만 이벤트를 남기지 않고 조회 오류(`invalid_event`)로 기록한다. 원본이 8KB를 넘으면 원본 대신 `{"truncated": true}`만 남긴다.
- 바꾸지 못한 건(취소·반품 진행 등으로 전이가 거절)은 "자동 배송완료 보류"로 표시되고 6시간 뒤 다시 본다. 운영자는 지금처럼 선택해 배송완료할 수 있다.
- 잠금: 자동 처리는 운영자 일괄 처리와 같은 순서(주문 id → 배송 건 id)로 잠그되 기다리지 않는다. 운영자가 쥐고 있는 묶음은 보류 없이 다음 회차에 다시 보고(`skipped`), 운영자 쪽은 자동 처리 한 회차가 끝날 때까지만 기다린다. 둘이 교착하지 않는다.
- 원본 이벤트는 `private.shipment_tracking_events`에, 자동으로 바꾼 근거는 `private.shipment_auto_deliveries`와 감사 `system.shipment.tracking_delivered`에 남는다. 청약철회 기산 근거라 지우지 않는다.

## 켤 때 운영 가이드에 넣을 문장

스위치를 켜는 PR에서 `lib/admin/guide/topics/orders-shipping.ts`에 넣는다(주간 변경 기록도 그때 적는다).

- "발송지연 관리" 둘째 문단 끝: `택배 추적 자동 배송완료가 켜져 있어 같은 칸에 추적 진행("택배 추적 배송 출발 · 도착 1/2")과 자동 처리하지 못한 건의 "자동 배송완료 보류"가 함께 표시됩니다.`
- "배송완료" 추가 운송장 문단 다음: `대표·추가 운송장이 모두 발송 뒤 배달완료된 택배 배송 건은 다음 추적 때 가장 늦은 도착 시각으로 자동 배송완료되고, 배송현황의 배송·수령 확인 칸에 "자동 확인 · 택배 추적"과 "수동 처리"가 구분되어 표시됩니다. 발송 전 이력만 있는 번호(택배사가 다시 쓰는 번호 등)는 근거로 보지 않습니다. 자동 처리하지 못한 건은 지금처럼 선택해 배송완료합니다.`

## 끄기(긴급)

자동 판정이 틀리거나 서비스 장애로 잘못된 이벤트가 오면 바로 끈다. 꺼지면 다음 회차부터 아무것도 바꾸지 않고 화면 표시도 사라진다(이미 배송완료로 바뀐 건은 그대로다).

- 정상 경로: 후속 migration `update private.delivery_tracking_settings set auto_delivery_enabled = false, updated_at = clock_timestamp() where singleton;`
- 긴급(사람 게이트 — 운영 DB 직접 변경이라 승인 필요): 파이프라인을 기다릴 수 없으면 Supabase SQL 편집기에서 같은 문장을 실행한다. 변경은 감사 기록에 남는다.

## 격리 스택에서 시험하기(가짜 어댑터)

운영 배포(`VERCEL_ENV=production`)에서는 가짜 어댑터를 만들지 않는다. 격리 스택에서만:

1. 그 DB에서 `update private.delivery_tracking_settings set auto_delivery_enabled = true, provider = 'fake', enabled_at = now() where singleton;`
2. 앱 env: `DELIVERY_TRACKING_PROVIDER=fake`, `DELIVERY_TRACKING_FAKE_EVENTS_FILE=/절대/경로/events.json`, `CRON_SECRET=<임의 값>`.
3. 이벤트 파일(조회할 때마다 다시 읽는다):

   ```json
   { "hanjin:123456789012": [{ "eventKey": "d1", "status": "delivered", "occurredAt": "2026-11-12T15:00:00+09:00" }],
     "hanjin:223456789012": [{ "eventKey": "t1", "status": "in_transit", "occurredAt": "2026-11-12T11:00:00+09:00" }] }
   ```
4. `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:<포트>/api/cron/delivery-tracking` — 응답에는 건수만 있다. 한 운송장만 도착이면 배송 건은 배송 중에 남고, 파일에 두 번째 운송장의 `delivered`를 더한 뒤 다시 부르면 배송완료(자동)가 되며 시각은 늦은 쪽이다. 같은 운송장을 다시 조회하려면 `delete from private.shipment_tracking_polls;`로 조회 간격을 비운다(방금 조회한 운송장은 조회 간격 때문에 대상에서 빠진다).
5. 이벤트 시각은 기준 시각(발송, 추가 운송장은 붙은 시각) 이후로 적는다 — 그보다 이른 `delivered`는 근거로 보지 않아 배송완료가 되지 않는다. 틀린 이벤트(없는 상태, 달력에 없는 날짜, 하루 넘게 미래)는 그 이벤트만 버려지고 같은 파일의 다른 이벤트는 기록된다.
