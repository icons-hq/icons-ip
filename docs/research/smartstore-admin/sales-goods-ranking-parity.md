# 판매상품 전체 순위·페이지·엑셀

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 승인된 로컬 구현·DB 적용·브라우저 검증을 완료했다. 운영·Preview 배포와 원격 DB 적용은 수행하지 않았다.

## 원본 근거와 범위

원본 판매 표 125 (`output/smartstore-reference-20261012/store/125-analytics-sales-table.jpg`)는 상품행·엑셀 만들기·페이지·처음/이전/다음/마지막 이동을, 277 (`output/smartstore-reference-20261012/store/277-sales-page-two.png`)은 실제 2페이지와 달라진 상품행을 보여준다. 두 캡처는 manifest (`output/smartstore-reference-20261012/store/manifest.json`)의 채택 근거다. 원본 전체 상품수·마지막 페이지·실제 엑셀 결과를 확인한 것은 아니다. 원본의 상품명·금액 등 비공개 운영값을 테스트 데이터로 옮기지 않았다.

ICONS의 같은 기간·IP 조건으로 21위 이후 상품을 조회하고 전체 XLSX를 받는 경로를 추가했다. 275c (`output/smartstore-reference-20261012/store/275c-sales-daily-expanded.png`)에서 펼쳐진 날짜별 행은 전체 합계다. 개별 상품 `+`의 결과는 미확인이므로 상품별 일별 펼침·네이버 전체 지표/채널/브랜드 열은 이번 범위가 아니다.

## 계산과 권한

- [새 읽기 RPC](../../../supabase/migrations/20261020085333_admin_sales_goods_page.sql)는 기존 `admin_sales_report`의 상품 계산식을 보존한다. 조회 시점에 `paid/confirmed/shipping/delivered/done`인 주문의 `orders.created_at`을 KST 날짜에서 변환한 `[from,to)`로 필터한다. 취소·환불 완료 주문은 해당 상태 집합 밖이며 결제 승인시각으로 바꾸지 않는다.
- 상품명/IP는 주문 품목 스냅샷의 기존 `max` 규칙, 수량은 `sum(qty)`, 금액은 `sum(qty::bigint * unit_price::bigint)`다. 주문 할인·적립금·배송비를 반영한 주문 합계와 구분한다. IP 조건은 상품 순위에만 적용하고 기존 매출/주문 요약을 바꾸지 않는다.
- 금액 내림차순 → 수량 내림차순 → 상품 ID 순으로 정렬한다. 전체 건수와 페이지 행은 하나의 SQL 스냅샷에서 반환한다. 0건은 1페이지, 범위를 넘긴 페이지는 실제 마지막 페이지로 보정한다. 화면 크기는 20/50/100개다.
- 사용자 선택은 최대 366일이다. 전년 비교에서 파생되는 367일을 보존하도록 새 RPC는 367일까지 받는다. 예: `2025-02-28~2026-02-28`의 비교는 `2024-02-28~2025-02-28`이다.
- 화면·엑셀의 선행 게이트와 RPC는 현재 `stats.read`를 검사한다. 신규 함수의 PUBLIC/anon/authenticated/service_role 기본 권한을 모두 회수한 뒤 authenticated에만 실행을 허용하고 read 계약을 등록했다. 읽기 전용 트랜잭션에서도 실행되며 기존 보고서 함수·정책을 교체하지 않는다.

## 화면과 파일

[상품 표](../../../components/admin/screens/StatsSalesGoods.tsx)의 전체 건수·연속 순위·처음/이전/다음/마지막 이동은 날짜·IP·비교·일/주/월 조건을 유지한다. 조건을 바꾸면 첫 페이지에서 조회한다. 비교 활성 시 별도 20행 조회의 전체 건수만 사용해 비교기간 파일 상한도 미리 안내한다. 개별 상품 비교표를 새로 제공하는 것은 아니다.

[기존 종합 XLSX](../../../lib/admin/stats-workbook.server.ts)의 상품 시트는 `상품 전체`, 비교 시트는 `비교 상품 전체`다. 현재 페이지와 관계없이 각각의 기간/IP에 해당하는 모든 상품을 내보내고 이벤트·회차는 기존 TOP20을 유지한다. 상품번호는 기존 `goodId`이며 현재 카탈로그의 `goods.code`로 바꾸지 않았다. 메타데이터에 전체 건수·상품 집계시각·상한을 기록한다.

기간별 상한은 **10,000개 상품**이다. DB에서 10,001행까지 한 번에 받아 상한을 검사하며 페이지별 결과를 이어 붙이지 않는다. 전체 건수/반환행 불일치·누락·중복·순위 불일치·안전한 정수 범위 밖의 값은 정상 파일로 처리하지 않는다. 현재 또는 비교기간이 상한을 넘으면 상품 영역과 상단의 엑셀 링크를 모두 조건축소 안내로 바꾸고, API도 별도로 거절한다.

## 검증

| 대상 | 확인 결과 |
| --- | --- |
| SQL 회귀 | 기존 TOP20과 행·정렬·금액 완전 일치, 45상품의 21위·동점·마지막·0건·IP 스냅샷·KST 경계·5유효상태·취소/환불 제외, 10,001행·마지막 페이지, 367일 파생 비교, ACL·권한 회수·실제 read-only 트랜잭션 통과. [SQL](../../../supabase/tests/admin_sales_goods_page.sql) |
| 격리 적용 | disposable clone에서 신규/기존 판매 보고서·권한 coverage/guard 통과 후 OWN59622·FRESH59722·canonical59922에 적용했다. 기존 1,085함수의 정의/owner/ACL과 135정책, 각 DB의 기존 ledger 원문을 보존했다. canonical은 305→306이며 처음부터 빈 DB에 306개를 순차 적용한 검증이라고 부르지 않는다. 적용 결과 (`output/sales-goods-ranking-qa-20261014/named-targets-summary.json`) |
| 실제 페이지 | 45개 상품의 1/2/3페이지·처음/이전/다음/마지막·20/50/100개·기간/IP 변경, 10,001번째 상품의 501페이지, 결과가 10,000개로 줄어든 뒤 500페이지 보정 확인. PC (`output/sales-goods-ranking-qa-20261014/04-desktop-last-page.png`) |
| 실제 파일 | 0건, 현재45/비교2, IP1/비교0, 정확히10,000상품, 366일 조회/367일 비교의 XLSX 5개를 재열었다. 10,000행의 ID·순위·수량·금액을 전수 대조했다. 상한 파일 검산 (`output/sales-goods-ranking-qa-20261014/13-exact-limit-readback.json`), 윤년 검산 (`output/sales-goods-ranking-qa-20261014/14-derived-367-readback.json`) |
| 상한 UI | 현재·비교기간 각각 10,001상품일 때 두 다운로드 링크가 모두 사라지고 해당 기간의 조건축소 안내가 표시됐다. 현재기간 (`output/sales-goods-ranking-qa-20261014/12-current-limit.png`), 비교기간 (`output/sales-goods-ranking-qa-20261014/11-comparison-limit.png`) |
| 반응형·접근 | 실제 1440px/390px 확인. 390px에서 문서 폭380px, 보이는 버튼 높이44px, 표만 내부 가로 스크롤을 사용했다. 비로그인 화면·엑셀 API는 로그인으로 이동했다. 390px (`output/sales-goods-ranking-qa-20261014/07-mobile-last-page.png`), API 게이트 (`output/sales-goods-ranking-qa-20261014/16-anonymous-api.json`) |

브라우저 로그에는 번역 확장이 `<html>`에 넣은 `data-immersive-translate-page-theme` 속성의 hydration 경고가 있었고, 그 외 앱 오류는 관측되지 않았다. 확장 설정을 변경하지 않았다. 테스트 소유 상품10,047개·주문9건·일반고객1명·IP3개와 전용 런타임/탭을 정리했다. 정리 직전/직후 비소유 원본 지문은 같다. 최초 지문과의 차이는 병행된 다른 작업의 승인된 상품/IP/감사와 기존 QA 계정의 auth 행 갱신으로 분리했다. 초기 auth 증거는 행 전체 해시여서 정확한 변경 열은 확정하지 않았고 기존 사용자 필드를 되돌리지 않았다. 정리 결과 (`output/sales-goods-ranking-qa-20261014/ui-cleanup-result.json`).
