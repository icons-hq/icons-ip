# 반품 자동 회수 접수·반품입고 파일 반영 켜기·끄기 (QNA-032·QNA-034)

[ADR-0034](../adr/0034-return-pickup-intake.md)의 두 기능은 **DB 스위치를 끈 채 배포**한다(`20261113130000_return_pickup_queue`, `20261113130100_claim_return_intake_import`). 꺼져 있는 동안:

- `/api/cron/return-pickups`(5분마다)는 스위치를 한 번 읽고 `{ ok: true, enabled: false }`로 끝난다. 큐를 만들지 않고 택배사를 부르지 않는다.
- 반품·교환 목록 위 "자동 수거 실패"·"반품입고 회신 업로드" 칸, 클레임 상세의 "자동 회수 접수", 고객 회수 정보의 회수 송장이 보이지 않는다. 상품 상세는 "착불로 보내주세요", 주문 상세 수거중 안내는 지금 문장 그대로다.
- 미리보기·확정·재접수 RPC는 `return_pickup_disabled`·`claim_return_intake_disabled`로 거절한다.

두 기능은 따로 켠다. 자동 회수 접수는 출고지마다 회수 계약을 켠다.

## 켜기 전 사람 게이트

### 자동 회수 접수(QNA-032)

1. 출고지별 반품 회수 계약 — 김포(한진)·남양주(우체국) 각각의 반품 회수(방문 수거) 계약, API 키, 회수 운임. 원송장 필요 여부와 멱등 키(주문 번호 중복 거절)·취소 API 지원을 확인한다.
2. 개인정보 처리위탁 — 택배사에 고객 이름·연락처·주소를 넘긴다. 처리위탁 계약(서원 G5 포함)과 개인정보처리방침의 수탁자·위탁 업무 고지(아래 초안). 처리방침 개정 공지는 법정 문서 절차를 따른다.
3. 배송·반품 정책 문서(`/legal/shipping`)의 "이용자가 착불로 반송합니다" 문장 개정 — 방문 회수 출고지의 반송 방법. 법정 문서 개정·공지는 사람 게이트다(앱의 상품 상세 문장은 스위치가 바꾼다).
4. 그 택배사의 어댑터 구현(`lib/fulfillment/pickup/adapter.server.ts`의 `PROVIDERS`). 받은 API 문서대로 `ReturnPickupRequest`(최소 필드)를 보내고, 응답에서 회수 송장·예약 번호만 꺼낸다. 이름·연락처·주소를 로그·오류 코드·결과에 남기지 않는다. 멱등 키를 택배사 주문 번호로 보내고, 취소는 접수 응답을 못 받았어도 멱등 키로 찾아 취소한다(없으면 `not_found`).

### 반품입고 파일 반영(QNA-034)

1. 서원 반품입고 회신 파일 양식(열 이름·입고일 표기·회수 송장 칸 유무)과 주기. 김포 E4 회신.
2. 그 양식의 열 이름을 대응표에 넣는다(아래 SQL). 화면 코드는 바꾸지 않는다.

## 켜는 순서 — 자동 회수 접수

1. 어댑터가 든 변경을 main에 배포하고 `deploy-supabase`·`deploy-vercel` 성공을 확인한다.
2. Vercel production env에 `RETURN_PICKUP_PROVIDER`(서비스 이름), `RETURN_PICKUP_API_URL`, `RETURN_PICKUP_API_KEY`를 넣는다. 서버 전용이며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. 회수 주소 정정(암호문)을 열려면 클레임 연락처 키(`ICONS_CLAIM_CONTACT_ENABLED=1`·`ICONS_CLAIM_CONTACT_KEYRING_JSON`)가 같은 서버에 있어야 한다 — 없으면 정정한 주소의 접수는 '회수지(고객 주소)를 읽지 못했습니다' 실패로 남는다.
3. 후속 migration(별도 PR)으로 스위치와 출고지 계약을 켠다. 켠 **뒤** 승인한 회수 묶음만 접수한다.

   ```sql
   begin;
   update private.return_pickup_settings
      set pickup_enabled = true, provider = '<서비스 이름>', pickup_evidence = '<계약·처리위탁 고지 근거>', pickup_enabled_at = clock_timestamp()
    where singleton and not pickup_enabled;
   insert into private.return_pickup_origins(origin_id, carrier, evidence)
   values ('<출고지 id>', '<회수 계약 택배사 코드: hanjin|epost>', '<회수 계약 근거>');
   commit;
   ```

   자동 재시도 상한·간격은 같은 표의 `max_attempts`(기본 5, 1~20)·`retry_minutes`(기본 30, 5~1440)다. 변경은 감사 기록 `system.return_pickup.settings_changed`에 남는다.
4. 켠 뒤 반품 하나를 승인하고 5분 안에 상세 회수 칸에 "회수 접수됨 · 회수 송장"이 보이는지, 고객 주문 상세 회수 정보에도 같은 송장이 보이는지 확인한다. 크론 응답이 503이면:
   - `unavailable`: env 이름이 DB `provider`와 다르거나(`provider_mismatch`) 비어 있다(`provider_missing`).
   - `failedStages`: DB 호출 실패(`work`·`record`).
   - `invalid`: DB가 넘긴 일이나 결과의 형식이 틀렸다 — 어댑터 결과 정규화를 본다.
   택배사가 거절한 접수는 200 응답의 `failed`로 세고, 반품·교환 목록 위 "자동 수거 실패"와 상세에 이유가 보인다.

## 켜는 순서 — 반품입고 파일 반영

1. 대응표를 서원 양식에 맞추고 스위치를 켠다(후속 migration). 한 머리글이 두 칸에 대응하면 DB가 거절한다.

   ```sql
   begin;
   update private.return_pickup_settings
      set intake_columns = jsonb_build_object(
            'trackingNumber', jsonb_build_array('<회수 송장 열 이름>'),
            'orderNumber', jsonb_build_array('<주문번호 열 이름>'),
            'phone', jsonb_build_array('<연락처 열 이름>'),
            'receivedOn', jsonb_build_array('<입고일 열 이름>')),
          intake_enabled = true, intake_evidence = '<서원 양식 수령 근거>', intake_enabled_at = clock_timestamp()
    where singleton and not intake_enabled;
   commit;
   ```

2. 실제 회신 파일 하나로 "등록 전 확인"을 눌러 매칭·못 찾음 수가 창고 회신과 맞는지 보고 확정한다. 확정한 회수 묶음의 근거에는 파일 SHA-256과 행 번호가 남는다.

## 끄기

- 자동 회수 접수: `update private.return_pickup_settings set pickup_enabled = false where singleton;`(SQL 편집기 또는 migration). 꺼지면 크론은 아무것도 하지 않는다 — **이미 접수된 수거의 취소도 멈춘다.** 끄기 전에 접수됨(`requested`)·취소 대기 행을 확인하고, 철회·거절된 요청의 수거는 택배사에 직접 취소한다.

  ```sql
  select p.claim_id, p.state, p.carrier, p.tracking_number, p.cancel_reason from private.claim_return_pickups p
   where p.state in ('pending','failed','requested','cancel_pending','cancel_failed') order by p.updated_at;
  ```

- 출고지 하나만: `update private.return_pickup_origins set enabled = false where origin_id = '<출고지 id>';`
- 반품입고 파일 반영: `update private.return_pickup_settings set intake_enabled = false where singleton;`

## 격리 스택 시험(가짜 어댑터)

운영 배포에서는 가짜 어댑터를 만들지 않는다(`VERCEL_ENV=production`이면 `fake_in_production`).

1. 격리 DB에서 `pickup_enabled=true, provider='fake'`, 출고지 하나를 `return_pickup_origins`에 넣는다.
2. 앱 env `RETURN_PICKUP_PROVIDER=fake`, `CRON_SECRET`. 실패를 흉내 내려면 `RETURN_PICKUP_FAKE_FILE=/절대경로/fake.json`에 `{"request":"error","errorCode":"fake_carrier_closed"}`(취소는 `"cancel":"error"|"not_found"`)를 쓴다. 파일은 호출마다 다시 읽는다. 가짜 회수 송장은 `FAKE` + 숫자 10자리이고 같은 묶음은 같은 송장이다.
3. 반품을 승인한 뒤 `curl -H "Authorization: Bearer $CRON_SECRET" localhost:<포트>/api/cron/return-pickups`.

## 개인정보처리방침 고지 초안(사람 검토 필요)

> **개인정보 처리업무의 위탁** — 회사는 반품·교환 상품의 방문 회수를 위해 아래와 같이 개인정보 처리업무를 위탁합니다.
>
> | 수탁자 | 위탁 업무 | 위탁하는 개인정보 | 보유·이용 기간 |
> | --- | --- | --- | --- |
> | 한진(주식회사 한진) | 반품·교환 상품 방문 회수 | 회수지 받는 분 이름, 연락처, 주소 | 회수 완료 후 위탁 계약 종료 시까지(관계 법령에 따른 보존 기간 제외) |
> | 우정사업본부(우체국택배) | 반품·교환 상품 방문 회수 | 회수지 받는 분 이름, 연락처, 주소 | 위와 같음 |
>
> 실제 수탁자 이름·업무 범위는 계약서대로 고친다. 서원(남양주 물류) 위탁 항목에 반품입고 처리가 포함되는지 G5 계약과 대조한다.

## 켤 때 주간 변경 기록(`lib/admin/guide/changes.ts`)에 넣을 문장

- 자동 회수 접수를 켜는 주: "반품·교환을 승인하면 몇 분 안에 출고지의 회수 계약 택배사에 방문 회수를 자동으로 접수합니다. 클레임 상세 회수 칸에 '회수 접수됨'과 회수 송장이 보이고, 고객 주문 상세 회수 정보에도 같은 회수 송장이 보입니다. 택배사가 받지 않으면 반품·교환 목록 위 '자동 수거 실패'에 세어지고 상세의 '회수 다시 접수'로 다시 보낼 수 있습니다. 요청이 철회·거절되면 접수한 수거를 자동으로 취소합니다."
- 반품입고 파일 반영을 켜는 주: "반품·교환 목록 위 '반품입고 회신 업로드'에서 창고 반품입고 파일을 올리면 회수 송장 또는 주문번호·연락처로 요청을 찾아 미리 보여 주고, 확정하면 반품지마다 입고완료로 기록합니다. 실제 입고일은 파일의 입고일이고 근거에 파일과 행 번호가 남습니다."
