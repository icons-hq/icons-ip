# 리뷰 평점 관측 수집

리뷰 분석의 현재 평점은 기존 `admin_review_insights`로 조회한다. 3개월 전 비교는 과거 날짜의 공개 상태를 그날 처음 성공한 관측으로 보존한 값이다. 일별 관측값은 13개월 보관하며 회원·주문·리뷰·상품 식별자는 저장하지 않는다.

## 배포와 최초 시작

기본 계약은 비활성이고 `collection_started_at`은 NULL이다. 이 상태의 화면은 `비교 기록 없음 · 수집 시작 전`을 표시한다. migration 적용만으로 운영 수집이 시작되지는 않는다.

앱과 DB를 같은 릴리스로 배포하고 기존 `CRON_SECRET`을 확인한다. `/api/cron/review-rating-history`는 매시간 5분에 실행되며 한국시간 당일 00:05 이후 첫 성공만 저장한다. Vercel 스케줄은 UTC로 해석된다. 추가 브라우저 활성화 UI는 제공하지 않는다. 운영 변경이 승인된 배포 경로에서만 다음 SQL을 owner 권한으로 실행한다.

```sql
begin;
set local search_path='';
do $$
declare current_version integer;
begin
  if not pg_try_advisory_xact_lock(1920168564,1) then
    raise exception 'review_rating_collection_busy';
  end if;
  select max(version) into strict current_version from private.review_rating_observation_contracts;
  perform private.assert_review_rating_contract(current_version);
  if exists(select 1 from private.review_rating_observation_contracts where enabled and version<>current_version) then
    raise exception 'review_rating_previous_version_still_enabled';
  end if;
  update private.review_rating_observation_contracts
  set enabled=true,collection_started_at=coalesce(collection_started_at,clock_timestamp())
  where version=current_version;
end $$;
commit;
```

시작 이후 실제 cron 인증 성공·`recorded` 응답·원장과 메타데이터 readback을 함께 확인한다. 비밀값은 명령 기록이나 증거 파일에 남기지 않는다. 처음 시작한 시점보다 앞선 기록을 현재 리뷰 데이터로 채우지 않는다. 3개월 전 대상일을 실제로 수집한 뒤에만 비교값이 생긴다.

## 읽기 전용 확인

아래 SQL은 owner의 운영 확인용이다. 앱의 authenticated/service 역할에는 테이블 직접 권한이 없다.

```sql
select version,enabled,collection_started_at,last_success_at,purged_before_as_of,last_purged_at
from private.review_rating_observation_contracts order by version;
select version,as_of,observation_day,observed_at,six_month_from,
       rated_product_count,six_month_rated_product_count,review_count,six_month_review_count,fingerprint
from private.review_rating_daily_observations order by observation_day desc limit 10;
```

`observation_day`는 실제 관측 시각의 한국 날짜, `as_of`는 그 전날이다. 늦은 성공도 실제 시각을 보존한다. API의 `recorded`는 새 관측 성공, `already_recorded`는 기존 첫 관측 반환, `too_early`는 00:05 전, `disabled`는 수집 중단, `busy`는 다른 수집 또는 운영 변경이 실행 중이라는 뜻이다. 잠금은 대기하지 않으며 다음 정규 호출로 재시도한다. DB/계약 오류와 잘못된 응답은 HTTP 503이다. HEAD 요청은 405이며 수집하지 않는다.

`last_success_at`이 오늘 관측을 가리키지 않으면 cron 실행·인증·DB 오류를 확인한다. 원장 없는 날을 임의로 성공으로 기록하지 않는다. 같은 날짜의 재호출은 관측 시각·값·지문을 변경하지 않는다.

## 중단과 재개

승인된 운영 경로에서 같은 잠금을 얻고 현재 계약의 `enabled`만 false로 변경한다. 시작 시각과 기존 관측을 지우지 않는다.

```sql
begin;
set local search_path='';
do $$
begin
  if not pg_try_advisory_xact_lock(1920168564,1) then
    raise exception 'review_rating_collection_busy';
  end if;
  update private.review_rating_observation_contracts set enabled=false where enabled;
end $$;
commit;
```

재개는 최초 시작 SQL을 그대로 사용한다. 같은 날의 기존 관측은 보존하고 중단 기간은 과거 데이터로 채우지 않는다. 중단 중에도 cron은 13개월 보존 정리를 수행하므로 정리를 유지하려면 cron을 끄지 않는다. 원본 함수 지문이 바뀌어 계약 검증에 실패하면 수집·과거 조회·보존 변경이 모두 실패한다. 이 경우 먼저 변경된 집계 계약을 검토한다.

## 집계 변경과 누락 해석

현재 reader와 전용 집계 helper의 정의 SHA가 저장된 계약과 같아야 수집과 과거 조회가 진행된다. 집계 구현 변경 전에 수집을 중단하고 영향과 호환성을 검토한다. 산식이 바뀌면 새 버전 migration, SQL 대조 테스트, 앱 DTO 검증을 함께 준비한다. 이전 버전의 값으로 새 버전 비교를 대체하거나 기존 행을 재계산하지 않는다.

비교 날짜는 현재 `asOf`에서 달력 3개월을 뺀 날짜다. 월말은 대상 월의 마지막 날로 보정한다. 현재·과거 각각 두 자리로 반올림한 평점끼리 차이를 점수로 표시하며 NULL을 0점으로 바꾸지 않는다.

- `수집 시작 전`: 최초 활성화 전 또는 대상 관측일이 수집 시작 날짜보다 이르다.
- `해당 날짜 미수집`: 시작 이후의 정확한 날짜에 같은 버전의 관측이 없다. 누락 원인을 단정하지 않는다.
- `보존 기간 외`: 실제 완료한 정리 경계 이전에 값이 없다. 해당 날짜를 과거에 수집했다거나 값이 삭제됐다고 단정하지 않는다.
- `과거 비교를 불러오지 못했습니다`: RPC·계약·DTO 오류다. 현재 평점과 상품 목록은 별도로 유지한다.

과거 합성값은 격리 clone·rollback 검증, 또는 검토된 OWN 전용 버전·소유 키·lease·전후 보존 증거·정상 은퇴를 갖춘 UI fixture에서만 사용한다. 운영 원장 backfill은 허용하지 않는다.
