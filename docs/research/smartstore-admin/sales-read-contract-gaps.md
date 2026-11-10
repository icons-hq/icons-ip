# 판매 목록 조회 조건 보완

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 구현·격리 로컬 검증 완료. 주문통합검색·미결제·발주/발송·배송현황·거래확정·취소/반품/교환 목록을 기존 원장과 대조해 확인한 세 누락을 보완했다.

## 원본과 적용 범위

2026-10-12에 로그인된 스마트스토어센터에서 읽어 둔 다음 컨트롤 원본을 다시 대조했다. 여덟 파일의 SHA-256은 당시 채택한 `sales/manifest.json`과 일치한다.

| 확인한 원본 | 확인한 차이 | ICONS 적용 |
| --- | --- | --- |
| 취소·반품·교환 관리 `06-cancel`, `07-return`, `08-exchange-controls.json`의 결제일(`PAY_COMPLETED`) | 기존 ICONS 날짜 기준은 접수·입고 확인·완료일뿐이었다. | 세 목록에 기존 결제 승인·입금 확인 시각을 사용하는 결제일 기준을 추가했다. |
| 구매확정 내역 `05-purchase-decision-controls.json`의 상세 검색 대상 | 기존 통합 검색은 여러 필드를 검색했지만 대상을 선택할 수 없었다. | 거래확정에 주문번호·구매자명·이메일·수취인·운송장·연락처·상품명/옵션과 전체 선택을 추가했다. |
| 발주/발송·배송현황 `03-dispatch`, `04-shipping-controls.json`의 구매자명·수취인명 열 | 기존 DB 응답과 엑셀에는 두 값이 있으나 화면은 수취인만 보여 줬다. | 두 화면에 구매자명 열을 별도로 표시했다. 수취인 미기록은 구매자명으로 대체하지 않는다. |

원본 위치는 [판매 관리](https://sell.smartstore.naver.com/#/naverpay/manage/order)이며, 비공개 캡처는 `output/smartstore-reference-20261012/sales/`에 있다. 주문통합검색 `01-order-controls.json`, 미결제 `02-unpayment-controls.json`도 비교 범위에 포함했다. 빈 미결제 원본에서 확인하지 못한 후속 기능은 추정하지 않았다.

## 조회·엑셀 계약

[클레임 필터](../../../lib/admin/claims.ts)의 `dateField=paid`는 [공유 주문 날짜 helper](../../../supabase/migrations/20261020085131_admin_sales_console_search.sql)가 사용하는 PG 승인·무통장 입금 확인 근거를 재사용한다. 결제 행 생성일을 승인 시각으로 대신하지 않는다. KST 기간 경계, 목록·총건수·단계 집계·정렬·페이지·목록 복귀·조건 전체 엑셀에 같은 기준을 적용한다. 요청 상태나 환불 기한·처리 정책은 바꾸지 않았다.

[거래확정 필터](../../../lib/admin/settled.ts)는 주문 목록의 검색 대상 정의를 [공유 모듈](../../../lib/admin/sales-list.ts)에서 재사용한다. 선택값을 목록 RPC와 링크, 상세에서 목록으로 돌아가기, [엑셀 생성 요청](../../../app/admin/settled-export-actions.ts)에 전달한다. 허용되지 않은 대상·중복 폼 입력은 엑셀 요청으로 받아들이지 않는다.

[새 migration](../../../supabase/migrations/20261020085312_admin_sales_read_contract_gaps.sql)은 거래확정 엑셀의 검색 대상을 영수증 필터·스냅샷·감사 기록에 함께 보존한다. 같은 요청 ID로 다른 검색 대상을 보내면 충돌로 거절한다. `all` 또는 검색 대상이 없던 기존 영수증의 재시도는 유지한다. 생성한 담당자와 현재 `sales.manage` 권한을 검사하며, 권한 철회 후 영수증 재조회·재시도는 허용하지 않는다. 새 private helper는 공개 역할·익명·로그인 사용자·service role에서 직접 실행할 수 없고, 기존 `postgres` 소유 공개 RPC의 실행 권한만 추가했다.

[엑셀](../../../lib/admin/settled-workbook.server.ts)의 두 시트에 검색 대상을 표시한다. 기존 주문 1,000건·품목 10,000행 상한, 보존된 원장·금액 계산·미기록 표현을 유지한다. 엑셀 주문 집합은 목록 필터와 같으며 행 순서는 기존 스냅샷 정렬을 따른다. 화면에서 검색 대상을 바꾸면 이전 영수증 링크를 비우고 새 조건으로 생성한다. 이 과정에서 발견한 결과 도구 모음의 중복 React 키도 수정했다.

[배송 목록](../../../components/admin/screens/ShipmentConsoleScreen.tsx)의 구매자명 열은 기존 응답의 `buyerName`을 표시한다. 열 표시·숨기기 설정과 새로고침 후 설정 보존을 지원한다. 기존 엑셀은 구매자와 수취인 열을 이미 분리하고 있어 엑셀 열을 추가하지 않았다.

## 검증

- 독립 검토에서 확인한 `postgres` 소유 RPC와 새 private helper 사이의 실행 권한 누락을 적용 전에 수정했다. migration SHA-256 `41273ea3a2128e081762e5ff7517ee21029b067e8358d1cfed7d5973f5aa178e`를 OWN/FRESH 두 격리 DB에 적용하고 각 migration 원문과 대조했다.
- [기능 SQL](../../../supabase/tests/admin_sales_read_contract_gaps.sql): PG·무통장 근거, KST 시작·종료 경계, 승인 근거 없는 결제 제외, 단계 집계·페이지·동률 정렬, 거래확정 검색 대상 8개와 엑셀 주문 집합, 요청 충돌·기존 영수증 재사용·원본 변경 후 스냅샷 보존·타인 접근·현재 권한·ACL·금전 원장 무변경을 검증했다. OWN/FRESH에서 모두 통과했다.
- [동시성 검사](../../../supabase/tests/admin_sales_read_contract_gaps_concurrency.sh)는 명시한 로컬 컨테이너를 임시 DB로 복제해 같은 요청/조건, 같은 요청/다른 조건, 권한 철회와 영수증 재시도를 실제 잠금 대기로 교차 실행했다. 허용된 요청당 영수증·감사 1건을 확인했고 임시 DB를 제거했다.
- 두 DB의 operator capability coverage와 로컬 Supabase security advisor를 통과했다. 브라우저 합성 자료를 넣은 뒤에도 OWN 기능 SQL을 다시 실행해 식별자 충돌 없이 통과했다.
- 마지막 수정 후 관련 Vitest 13파일 142개(12파일 139개와 기존 서버 계약 1파일 3개), 전체 `tsconfig.test.json` TypeScript 검사, 변경 화면 ESLint를 통과했다. 이전 변경 파일 전체의 ESLint도 통과했다.
- Chrome에서 결제일 2026-10-02인 반품 26건(접수 25·입고 확인 1), 페이지 20/6건, 오래된순 정렬을 확인했다. 같은 기간 접수일 기준은 0건이다. 실제 다운로드한 엑셀 26행의 주문번호 순서와 날짜 기준·건수·다운로드 감사가 DB 결과와 일치했다.
- 거래확정 `GAPUI1530` 통합 검색 6건, 수취인 1건, 상품명/옵션 2건을 확인했다. 실제 내려받은 두 영수증의 주문 집합·검색 조건과 두 시트의 메타데이터가 일치했고 생성 감사는 각각 1건이었다. 필터 변경 후 기존 링크 제거와 새 파일 생성도 확인했다.
- 발주/발송과 배송현황에서 구매자·수취인 분리, 구매자명 열 숨김/복원과 새로고침 후 보존을 확인했다. 390×844에서 필터·엑셀 생성·열 설정을 실제 조작했고 문서 전체 가로 폭은 390px이었다. 임시 뷰포트를 복원하고 소유 탭을 닫았다.

로컬 증거는 `output/smartstore-reference-20261014/sales-read-contract-gaps/`의 `verification.json`, DB readback, 브라우저 캡처, 실제 XLSX 세 파일에 있다. 합성 자료만 사용했으며 운영 DB·NAVER 데이터·실제 결제·환불·배송 처리·고객 메시지·운영 배포는 실행하지 않았다. 원래 금액 계산과 수식은 변경하지 않았고 이번 검증에서 네이티브 Excel 재계산은 실행하지 않았다.

CI에서 기능 SQL과 함께 실행할 동시성 명령은 다음과 같다.

```bash
SUPABASE_DB_CONTAINER="$test_db_container" SALES_READ_GAP_TEST_SCOPE=ci \
  bash supabase/tests/admin_sales_read_contract_gaps_concurrency.sh
```
