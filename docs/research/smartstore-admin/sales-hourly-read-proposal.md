# 시간대별 판매조회 구현·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 원본 117·119의 시간대/누적·선택 비교일·오늘/직전 1시간 상품순위 목적을 현재 ICONS 매출 계약으로 구현하고 격리 로컬 DB와 실제 브라우저에서 검증했다. 원본의 방문·검색·전환 수집이나 집계 알고리즘 전체를 복제한 기능은 아니다. 운영 DB 적용·배포는 실행하지 않았다.

## 원본 근거와 차이

- 117 시간대 화면 (`output/smartstore-reference-20261012/store/117-analytics-realtime-hourly.jpg`)은 비교일·분류, 지표 선택, 누적/시간대 전환을 제공한다. `16:31 (16:00 데이터까지 반영)`이라는 표시를 확인했다.
- 119 직전 1시간 (`output/smartstore-reference-20261012/store/119-analytics-realtime-last-hour.jpg`)은 오늘/직전 1시간 선택과 `15시~16시` 구간, 상품별 판매금액 TOP10을 실제로 보여준다. 상품·경로·검색어별 방문 TOP10은 별도 지표다.
- 두 캡처는 manifest (`output/smartstore-reference-20261012/store/manifest.json`)의 `accepted: true`이며 현재 이미지 SHA-256과 대조했다. 원본 백엔드 산식·현재 상태 보정·엑셀 결과·전체 분류 사전은 미확인이다.
- ICONS는 **주문 생성시각·현재 결제 유지 상태·주문 총액**을 그대로 사용한다. 원본의 상품 결제 건수나 승인시각 기준으로 이름만 바꾸지 않는다. 카테고리 사전을 복제하지 않고 기존 IP 조건을 상품순위에만 적용한다. 이번 단위에는 새 시간대 전용 XLSX/API·자동 갱신을 추가하지 않았다.

## 현재 계약

[기존 판매 RPC](../../../supabase/migrations/20261020085215_operator_capability_guards.sql)의 `admin_sales_report`와 같이, 현재 `private.revenue_order_statuses()`에 속하는 주문을 `orders.created_at`의 KST 시간으로 나눈다. 주문수는 주문 행 수이고 주문매출은 배송비·할인·적립금을 반영한 `orders.total`이다. 티켓은 별도 도메인으로 유지한다.

**IP 조건은 상품 TOP10에만 적용한다.** 전체 주문수·주문매출·시간별 추이는 전체 주문 기준이다. 혼합 IP 주문의 총액을 임의로 나누지 않는다. 상품은 주문 품목의 상품 ID·이름/IP 스냅샷과 `sum(qty)`, `sum(qty × unit_price)`를 사용한다. 상품금액 합계와 주문매출은 다르다.

상품순위는 현재 구간의 금액 내림차순·수량 내림차순·상품 ID 오름차순 TOP10이다. 비교값은 **그 같은 상품 ID**의 비교일 동일 구간 값이다. 비교일의 별도 순위를 현재 순위와 행 번호로 이어붙이지 않는다. 현재 구간에 상품이 없으면 빈 목록을 표시한다.

### 조회시각과 정시 경계

신규 [읽기 RPC](../../../supabase/migrations/20261020085336_admin_sales_hourly_report.sql)는 행·요약·누적·두 상품순위·비교값을 같은 DB 스냅샷에서 계산한다. `asOf`는 읽기 시각, `cutoff`는 포함하지 않는 KST 정시 경계다. 기본 cutoff는 asOf를 정시로 내린 값이다. 과거 주문 상태를 저장하거나 재현하지 않으므로 취소 후 다시 읽은 과거 시간 값도 바뀔 수 있다.

| 구간 | 동작 |
| --- | --- |
| 16:31 조회 | 오늘 `[00:00, 16:00)`, 완료 16시간. 15~16시 주문은 포함하고 정확히 16시 주문은 제외한다. |
| 선택 비교일 | 비교일도 `[00:00, 16:00)`의 같은 시간까지만 포함한다. 기본은 DB 오늘의 7일 전이고 오늘 이전의 유효 날짜를 선택한다. |
| 직전 1시간 | `[cutoff - 1시간, cutoff)`의 직전 완료 시간이다. 현재 시각에서 거꾸로 60분인 이동창이 아니다. |
| 오늘 00시 마감 | 완료 시간은 0개, 요약·시간값은 `—`/미관측이다. 오늘 상품순위도 완료 구간 없음으로 표시한다. |
| 00시 마감의 직전 1시간 | 전날 `[23:00, 오늘 00:00)`, 비교는 `[비교일 전날 23:00, 비교일 00:00)`이다. 양끝 날짜를 표시한다. |
| 마감 이후 | 값은 null/`—`이고 진행 중인 시간은 집계 대기, 미래 시간은 미도래다. 명시적으로 더 이른 마감을 선택했다면 이미 지난 시간도 마감 이후로 구분한다. 완료 시간에 주문이 없을 때만 관측값 `0`이다. |
| 누적 | 완료 시간의 완전 집계만 누적하며 미관측 시간에 직전 값을 연장하지 않는다. |

읽기 조건 `p_cutoff`는 DB 오늘 00시부터 현재 완료 정시 사이의 KST 정시만 허용한다. 미래 시각·분/초가 포함된 시각·이전 날짜 마감은 거부한다. 오래 열린 주소가 자정을 넘으면 최신 조회 안내를 제공한다. 화면의 조회·갱신은 명시 cutoff를 제거하고 현재 정시로 다시 읽는다.

## 화면과 권한

- `/admin/stats/sales/hourly`는 판매분석에서 진입한다. [기존 접두 경로 매핑](../../../lib/admin/navigation.ts)으로 `stats-sales` 메뉴와 `stats.read` 권한을 따르며 [page](../../../app/admin/(shell)/stats/sales/hourly/page.tsx)가 로더보다 먼저 권한을 확인한다.
- [화면](../../../components/admin/screens/StatsSalesHourlyScreen.tsx)은 비교일/IP, 조회·갱신, 주문매출/주문수와 비교값, 조회시각·마감시각·집계 기준을 제공한다. [차트·표](../../../components/admin/charts/StatsSalesHourlyTrend.tsx)는 시간별/누적·매출/주문수, 24시간 표, 오늘/직전 1시간 TOP10을 표시한다. 표는 390px에서 내부 가로 스크롤과 키보드 이동을 지원한다.
- [응답 검사](../../../lib/admin/stats-hourly.ts)는 날짜·조건·정시·24개 시간·미관측 null·누적·합계·TOP10 식별자와 행 수를 확인한다. 잘린 응답이나 읽기 실패는 정상 0건으로 바꾸지 않는다. 추가 고객/주문 식별자를 화면에 전달하지 않는다.
- 함수는 `auth.uid()`·`stats.read`를 확인하고 `SECURITY DEFINER`의 빈 search_path를 사용한다. PUBLIC/anon/authenticated/service_role execute를 봉인한 후 authenticated만 grant하고 운영자 read 계약을 등록했다. 기존 함수/테이블/금전 원장은 바꾸지 않았다.

## 2026-10-14 검증

1. **DB**: 검토된 함수는 먼저 기존 308개 migration 상태의 폐기용 clone에만 309번째 증분으로 적용했다. 신규 [SQL 검사](../../../supabase/tests/admin_sales_hourly_report.sql), 기존 `admin_stats_reports`, capability coverage/guards를 통과했다. 기존 1,087개 함수의 정의·소유자·ACL과 135개 정책, 308개 ledger가 정확히 보존됐다. 원본 59922 정의·ledger도 전후 동일했고 clone/dump는 제거했다(clone 결과 (`output/sales-hourly-read-qa-20261014/clone-result.json`)). 전체 빈 DB의 309개 재실행으로 부르지 않는다.
2. **지정 로컬 대상**: 승인 후 OWN59622·FRESH59722·CANON59922에 같은 소스를 적용하고 신규 검사·coverage를 통과했다. FRESH/CANON은 global guard도 통과했다. 설정 완료된 OWN의 기존 권한 상태나 다른 작업 fixture는 바꾸지 않았다. 새 함수의 본문·소유자·ACL은 승인 clone과 일치한다(대상별 결과 (`output/sales-hourly-read-qa-20261014/named-targets-summary.json`)).
3. **숫자·경계**: 1,001주문 전체 집계, 정시 양끝·00시·직전 1시간의 날짜 변경, 현재 유효 주문 상태·미결제/취소/환불 제외, 혼합 IP의 주문 총액/품목금액, 스냅샷 이름/IP, 동점 정렬·같은 상품 비교, null/0 구분, 잘못된 날짜/cutoff, 권한 미보유·회수·익명/service_role 거부, 실제 읽기 전용 트랜잭션을 확인했다. 실제 KST 00시에 실행하면 오늘 양수 시간 경로는 검증할 수 없어 테스트가 NOTICE로 구분한다. 이번 07시 실행에서는 그 경로도 통과했다.
4. **실제 브라우저**: 기존 주매니저 로그인에서 7개 완료 시간의 3주문/19,500원과 비교일 1주문/7,777원을 확인했다. 시간별→누적·키보드 주문수 전환·오늘/직전 1시간·다른 비교일·IP 변경과 합계 유지·빈 순위·자정 미관측/전날 23~00시·DB의 잘못된 마감 거부 후 최신 조회 복구·기존 판매분석 진입을 검증했다. 12개 상태의 표 2,095셀을 같은 조건의 authenticated DB 응답과 대조했다(대조 결과 (`output/sales-hourly-ui-qa-20261014/browser-db-verification.json`)).
5. **390px**: 반응형 전환 종료 후 문서380px/뷰포트390px로 가로 넘침이 없었다. 내부 시간표 폭820px/표시274px에서 키보드 이동이 0→546px로 동작했고 지표 버튼도 Enter로 전환됐다(누적 화면 (`output/sales-hourly-ui-qa-20261014/hourly-cumulative-390.png`), 표 스크롤 (`output/sales-hourly-ui-qa-20261014/hourly-table-keyboard-390.png`)).
6. **코드와 정리**: 전용·표면 계약 32개 검사, 범위 ESLint, 설치 Next 16.3.8 문서 확인 후 route typegen 및 `tsconfig.test.json` 타입 검사를 통과했다. 마지막 빈 구간 문구 변경 후 화면/page 8개와 해당 lint/타입 검사를 재확인했다. 전용 일반고객 1명·13상품·2IP·11주문 fixture는 본인 prefix만 제거했다. 기존 사용자66명·주문원장 지문·함수정의가 baseline과 같고 잔여 prefix는 0이다(정리 결과 (`output/sales-hourly-ui-qa-20261014/cleanup-result.json`)). 탭과 임시 viewport도 정리했다.
7. **독립 검토**: 다른 에이전트가 신규 TS/TSX·SQL·회귀 검사·기존 guard/navigation/Grid·증거를 읽어 실제 P1/P2가 없음을 확인했다. 원본 서비스의 알고리즘 전체 동등성은 검토 결과에 포함하지 않았다.

실제 브라우저 콘솔에는 기존 번역 확장이 `<html>`에 추가한 `data-immersive-translate-page-theme`의 hydration 경고가 있었다. 이를 새 기능 오류나 경고 0건으로 기록하지 않는다. Supabase CLI security advisors는 지정 FRESH 로컬 대상의 연결 방식을 명시한 재시도에서 warning/error 0건이었다. 기존 CI direct SQL 목록에도 시간대 회귀 검사를 연결했으며 새 job이나 권한 registry 경계를 추가하지 않았다. 전체 앱의 최신 통합 build는 상위 작업의 최종 결과를 따른다.
