# 리뷰 평점 3개월 전 비교 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15. 앱과 SQL DRAFT를 구현했고, source348 기준 실제 OWN280·CANON348의 폐기용 복제 DB에서 검증을 완료했다. 정식 migration과 로컬 named3개 적용 후 실제 PC/390px·합성 버전 cron HTTP·정상 fixture 은퇴를 완료했다. 초기 관측 오류와 실제 브라우저 미실행 범위는 아래에 유지하며 운영 배포와 운영 관측 수집은 수행하지 않았다.

## 구현 계약

현재 `admin_review_insights`의 본문·응답·owner·ACL과 상품별 평균의 평균 산식을 보존한다. 현재 공개·미보관 상품/IP, 판매 제한 없음, 한국시간 오늘 00:00 이전의 현재 공개 리뷰를 사용한다. 기존 검색·진단 주제·정렬·페이지는 스토어 평점 요약에 영향을 주지 않는다.

새 private 테이블은 계약 메타데이터와 일별 집계 관측 두 개다. 원장은 실제 관측일·그 전날인 기준일·실제 관측 시각·6개월 하한·반올림 전 평균·상품/리뷰 분모·지문만 저장한다. 개별 회원·주문·상품·리뷰 ID는 저장하지 않는다. 원본 reader와 전용 집계 helper 정의 SHA가 저장된 계약과 다르면 수집기와 과거 조회 모두 오류로 종료한다.

- 수집기는 service 전용 무인자 RPC다. 전역 advisory 잠금을 즉시 시도하고 점유 중이면 대기 없이 `busy`를 반환한다. 실제 한국시간 00:05 이후 그날 첫 성공만 INSERT하며 재호출은 원래 관측 시각과 지문을 반환한다.
- 기본 v1은 비활성이며 수집 시작 시각이 NULL이다. 최초 활성화 전에는 `수집 시작 전`으로 표시한다. 시작·중단·재개는 [운영 런북](../../runbooks/review-rating-history.md)의 승인된 운영 SQL만 사용한다.
- cron은 기존 `CRON_SECRET`을 검사하고 매시간 5분 호출한다. HEAD는 405로 거절하며 관측하지 않는다. 중단 중에도 이미 시작한 계약의 13개월 보존 정리는 계속한다. 정리 경계는 그 범위의 모든 날짜를 과거에 수집했다는 증거가 아니다.
- 과거 조회는 `cs.manage`를 검사하고 현재 `asOf`에서 달력 3개월을 뺀 정확한 날짜·같은 계약 버전만 읽는다. 가까운 날짜·다른 버전·현재 데이터로 대체하지 않는다. 현재 조회와 날짜가 어긋난 경우에만 현재·과거를 한 번 다시 읽는다.
- 두 자리로 반올림한 현재·과거 평점끼리 점수 차이를 표시한다. 각각의 NULL 평균은 `비교할 평점 없음`이며 0점으로 치환하지 않는다. 기록 없음의 원인과 조회 실패를 구별하고 과거 조회 오류가 현재 목록·요약을 막지 않도록 했다.

## 확인한 결과

최종 요약 (`output/review-rating-history-implementation-20261015/final-summary.json`)과 실행 결과 (`output/review-rating-history-implementation-20261015/clones-ebb07374d25046249a577f7e31399c2c/result.json`)에 입력과 결과를 결속했다. 실행 결과 SHA-256은 `98fc54060893c5008e91483b5889d1c1da9c24e490ff3a25f942a31181b67091`, DRAFT SHA-256은 `35baa404ee905da929bd93a567b6327bad826e20dd2a0a23c6af29be9fbf7eca`이다.

| 검증 | 결과 |
| --- | --- |
| 앱 DTO·날짜·표시·자정 경계의 1회 재조회·cron 인증/실패 | 집중6파일 42테스트, 타입 검사, 변경 TS/TSX 린트 통과 |
| [상설 SQL](../../../supabase/tests/review_rating_history.sql) | OWN/CANON 각각98 assertions 통과. 같은 문장 스냅샷의 기존 reader·독립 상품 평균 oracle 대조, 공개/숨김/평점/보관, 권한·원장 직접 접근 차단, 누락·다른 버전·NULL, 보존과 실패 원자성 확인 |
| [실제 경합](../../../supabase/tests/review_rating_history_concurrency.py) | 각6개 그룹 통과. 즉시 busy, 동시 첫 성공·응답 유실 재시도, 첫 transaction rollback 후 재시도, 중단·재개 순서, 수집 후 현재 리뷰 변경, 원본 정의 변경 시 양 RPC 거절 |
| 실제 SQL→앱 DTO | 기존 현재 응답·별도 synthetic 버전의 과거 응답·수집기 응답을 production parser에 전달. 정확한 날짜/버전·관측 시각·반올림·독립 NULL 분모 통과 |
| 보존 | 기존 모든 함수 정의·owner/ACL, 테이블/RLS, 사업/Auth/Storage 행, registry와 전체 ledger 보존. 추가는 private 테이블2개·함수4개·read RPC 계약1개·internal 계약4개뿐 |
| 정리 | source 전후 전체 snapshot 동일. 소유 UUID/OID/lease 복제 DB, 자식 프로세스, 임시 dump/list/디렉터리 정리 통과 |

busy 응답은 잠금 보유 transaction을 닫기 전에 완료됐으며 호출 측 측정값은 OWN 약189ms, CANON 약222ms였다. Docker·프로세스 호출 비용이 포함되어 있어 DB 자체 또는 실제 HTTP 지연으로 해석하지 않는다. 자정·00:05·월말·윤일은 고정된 시각/날짜의 PostgreSQL 및 앱 계산을 확인했고, 실제 벽시계 자정 통과를 기다려 실행한 것은 아니다.

기본 v1을 변경하지 않고 별도 synthetic 버전7721·7722로 테스트했다. 상설 테스트는 전체 rollback이며 경합/DTO fixture는 폐기 clone에만 남았다. 이후 실제 OWN 화면 검수에는 전용 `cs-history`의 별도 버전1262588488과 정확한 관측 키2개를 사용했고 전후 보존·정상 은퇴를 확인했다. 앞선 clone 버전7721·7722의 검증과 구분한다.

## 초기 오류와 남은 단계

검토 단계에서 상품 재고가 남은 상태의 보관과 미보관 자식이 남은 IP 보관을 발견했다. fixture를 소유 variants 재고0→상품 캐시0 확인→소유 상품 보관→IP 보관 순서로 고쳤다. 기존 보관 trigger를 끄거나 바꾸지 않았다.

첫 실행 (`output/review-rating-history-implementation-20261015/clones-1b77a0eab4614af6a183782611a053fe/result.json`)은 DRAFT·기존 전체 보존 검증을 통과한 뒤, fixture의 직접 숨김 UPDATE가 `reviews_hidden_state_check`에 걸려 중단됐다. 실제 authenticated `admin_set_review_status`를 사용하도록 fixture 두 곳을 고쳤다. 실패 실행의 원본 보존·복제 DB/임시 파일 정리도 통과했고 로그와 승인 plan을 보존했다. 앱·DRAFT 변경 없이 재실행한 최종 결과가 위 증거다.

정식 [350 migration](../../../supabase/migrations/20261020085421_review_rating_history.sql)은 검증 DRAFT와 첫 주석 외 본문이 같다. 문의 만족도349와 하나의 outer transaction으로 묶은 exact 적용 검증 (`output/cs-metrics-named-qa-20261015/runner-clones-bdf6b8a49da84ede9dbcb1da46d1ede1/result.json`)에서 OWN/CANON 각각22개 변조 거절·만족도40/이력98 SQL·실제 DTO4/1을 통과했다. 첫 migration 뒤 실패해도 신규 객체·trigger·ledger 첫 행까지 전부 롤백됨을 확인했고, 별도로 trigger 실행 활성 상태도 보호했다. ROOT가 승인 계획과 named readback (`output/cs-metrics-named-qa-20261015/plan-ee9457b252464501b5b37be2cf754c73/named-summary.json`)에 따라 OWN282·FRESH315·CANON350 적용을 완료했다. 기본 v1은 비활성·수집 시작 NULL이고 기존 전체 행/함수/권한/registry/ledger를 보존했다.

## 실제 UI·HTTP 후속

최종 결과 (`output/cs-history-browser-qa-20261015/browser-result.json`)와 증거 manifest (`output/cs-history-browser-qa-20261015/browser-evidence-manifest.json`)는 초기 관측 오류·미실행 범위를 명시한 PASS다. PC1440/390px에서 수집 시작 전, 정확한3개월 전 값, 해당 날짜 미수집, NULL 평균, 과거 조회 실패를 구분했다. NULL/실패에서도 현재4.38과 목록20행을 유지했고, 미수집 상태의 검색6개·저평점 주제1개에서도 스토어 현재 평점은 바뀌지 않았다. 숫자 비교가 available인 모든 필터 조합을 별도로 실측한 것은 아니다.

기준일2026-10-14·비교일2026-07-14, 과거 관측시각2026-07-15 00:05 KST와 분모를 확인했다. 원값4.375→4.38, 과거4.125→4.13이고 차이는 표시값 기준+0.25다. 최근6개월 과거4.75와 현재 표시4.38의 차이는−0.37이며 원값 차이를 반올림한 결과로 설명하지 않는다. 현재 공개리뷰59건·평점상품8개·대상상품22개와 페이지20행을 구분한다. 독립 계산 (`output/cs-history-browser-qa-20261015/independent-display-math.json`)을 함께 보존했다.

실제 cron HTTP7개는 HEAD405·잘못된 인증401·disabled/busy/recorded/already_recorded/중단 후disabled200을 확인했다. 재호출의 관측 시각과 fingerprint가 정확히 같고 모든 응답은 private/no-store다. 실제 advisory lock 경합은 ROOT가8초 유지하며 관측했고 파일에는 busy 응답·lock transaction 종료를 남겼다. 과거 reader 실패 UI는 확인했으나 해당 HTTP503 원문은 기록하지 않았다.

초기 캡처에서는 input의 caret-color transparent 스타일 불일치 hydration 오류가 있었다. 기본 caret 숨김이 hydration에 영향을 줬을 가능성과 일치하지만 원인을 확정하지 않는다. 앱 코드를 바꾸지 않고 새 탭·networkidle·caret initial로 관측한 뒤 console error와 pageerror는0이었으며 폰트 preload 경고30건은 남았다. 04/05와 전환 표기가 있는07은 최종 배치 판정에서 구분하고 최종 모바일10/11을 우선한다.

정상 은퇴 (`output/cs-history-browser-qa-20261015/retirement.json`)는 합성 관측2개·계약1개를 제거하고 자기 운영자와 세션·자격 증명을 종료했다. 기존 상품/리뷰·현재 집계·334개 테이블의 비소유 행·Auth/Storage·원장·migration 소스를 외부 Auth 예외 없이 보존했고 실제 기본v1은 비활성·수집 전을 유지했다. 별도 v1 원문 전후DTO를 새로 확보한 것으로 확대하지 않는다. 전용 Chrome 종료 후 공유 runtime 전체 정리 (`output/shared-local-browser-qa-20261015/runtime-cleanup.json`)도 완료했다.

달력 월말/윤일·보존기간·모든 권한 조합은 앞선 SQL/단위 검증 영역이며 실제 브라우저에서 반복하지 않았다. 모든 키보드 경로·브라우저 엔진을 검수한 것도 아니다. 운영 scheduler·기본v1 수집·운영 배포는 실행하지 않았다.
