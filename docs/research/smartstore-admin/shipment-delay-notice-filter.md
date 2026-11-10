# 발송지연 안내여부 필터

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 원본 대조·격리 로컬 검증. `/admin/sales/dispatch`의 안내 결과를 기존 발송 원장에서 조회한다. 안내를 보내거나 재시도하는 동작은 바꾸지 않는다.

## 원본 의미와 적용 범위

원본 [발주(주문)확인/발송관리](https://sell.smartstore.naver.com/#/naverpay/sale/delivery)의 `발송지연 안내여부`는 전체·처리(`COMPLETE`)·미처리(`NOTREAT`)다. 비공개 증거는 `output/smartstore-reference-20261012/sales/03-dispatch-controls.json`과 `03-dispatch-top.jpg`다.

같은 원본의 `details/dispatch-help-10.txt`는 결제일로부터 3영업일 내 발송 불가 시 예정일·사유 입력, 신규주문/발주확인해제 단계, 1회 안내와 구매자 문자 전송을 설명한다. 실제 원본 발송·저장·문자 결과는 확인하지 않았다. 이 Npay의 기한·단계·채널 정책을 ICONS에 새로 적용하지 않는다.

ICONS는 [기존 지연 안내 원장](../../../supabase/migrations/20260910235736_sales_order_delay_notices.sql)의 앱 알림과 이메일을 사용한다. 원본의 이진 처리 여부를 그대로 전송 성공으로 해석하면 이메일 실패·대기·결과 불명을 숨기므로 다음과 같이 구분한다.

| 표시 | URL 값 | 실제 판단 |
| --- | --- | --- |
| 전체 | 값 없음 | 안내 결과로 제한하지 않음 |
| 발송 처리 | `sent` | 앱 알림이 기록됐고 이메일 공급자 접수·발송 근거가 있음 |
| 일부 채널 실패·제외 | `partial_failed` | 앱 알림은 기록됐고 이메일이 실패·반송·신고·발송 제외 상태 |
| 대기·처리 중 | `pending` | 요청한 이메일이 대기·처리 중이며 아직 성공 근거가 없음 |
| 결과 확인 필요 | `unknown` | 공급자 결과 불명·수동 확인 필요 또는 일관되지 않은 채널 기록 |
| 미발송 | `not_sent` | 해당 배송 건에 발송 요청된 안내가 없음. 미리보기만 저장한 경우도 포함 |

`발송 처리`는 고객 수신·열람 완료가 아니다. 공급자의 `accepted`, `sent`, `delivered`, `delayed`를 기존 안내 이력의 발송 분류에 맞춰 사용한다. `unknown`·`needs_review`, `queued`·`dispatching`은 target 반영이 늦어도 공급자 원장을 우선해 결과 불명·대기·처리 중으로 표시한다.

## 조회와 권한 계약

[읽기 migration](../../../supabase/migrations/20261020085309_shipment_delay_notice_filter.sql)의 `private.shipment_delay_notice_summary`는 배송건 ID가 안내 대상 배열에 있고 주문 ID도 일치하는 기록만 읽는다. `requested_at`이 있는 가장 최근 요청을 사용하며, 동률은 안내 ID·대상 ID로 결정한다. 나중에 만든 미리보기는 이전 발송 결과를 가리지 않는다. 같은 주문의 다른 출고지 배송 건은 자동으로 처리된 것으로 세지 않는다.

새 `admin_search_shipments_notice_console`은 현재 `sales.manage` 권한을 검사한다. private 원장·helper는 공개 역할, 익명, 로그인 사용자, service role의 직접 접근을 봉인하며 공개 읽기 RPC만 로그인 역할에 허용한다. 수신 이메일·메시지 본문·공급자 식별자는 목록에 추가하지 않는다.

[URL 계약](../../../lib/admin/shipment-dispatch.ts)의 `delayNotice`는 발주·발송 화면에서만 허용한다. 검색·출고지·배송방법·결제수단·날짜·정렬과 함께 DB 필터에 적용한 뒤 전체 건수, 단계별 건수와 페이지를 계산한다. 잘못된 값이나 복수 파라미터는 필터로 채택하지 않는다. 검색과 탭 변경은 첫 페이지로 돌아가고, 페이지 이동·정렬·목록 수·[주문 상세의 돌아가기](../../../lib/admin/orders.ts)는 조건을 보존한다.

[화면](../../../components/admin/screens/ShipmentConsoleScreen.tsx)은 결과와 앱/이메일 상태, 최근 요청 시각을 표시한다. 응답 누락은 미발송으로 채우지 않고 [서버 로더](../../../lib/admin/shipment-dispatch.server.ts)에서 실패 처리한다. 배송현황 화면은 기존 RPC를 유지한다. 발주확인·출고지시 파일·운송장 입력·메모 저장·고객 안내 전송·재시도는 기존 계약을 따른다.

## 엑셀

[엑셀 로더](../../../lib/admin/list-export-data.server.ts)는 화면과 같은 파서·RPC로 조건 전체를 읽는다. 현재 페이지만 내보내지 않으며 기존 10,000행 제한을 유지한다. 안내 결과·최근 요청 시각·앱 알림·이메일을 별도 열에 표시하고, 안내여부 조건을 안내 시트와 다운로드 감사에 남긴다.

DB는 조건 전체의 배송건 ID와 안내 결과로 fingerprint를 만든다. 각 페이지 및 연락처 수집 후 마지막 재조회에서 같은 값이어야 파일을 만든다. 페이지 밖 안내 결과가 바뀌거나 같은 건수로 대상이 교체돼도 내보내기를 중단한다. 이는 안내 결과를 읽는 동안의 변경 검출이며, 이후 외부 콜백까지 정지시키는 불변 원장은 아니다. 배송현황·창고용 출고지시 내보내기는 이 추가 검사를 적용하지 않는다.

## 검증

- DRAFT 독립 검토 뒤 OWN/FRESH 격리 DB에서 기능 검증을 ROLLBACK으로 완료하고 동일 파일을 적용했다. SHA-256은 `ac7d37249b9cb6197843894e26b8c9d6a289300283f99882b4cdd659c04c6989`이며 양쪽 migration 원문과 일치한다.
- [SQL 회귀](../../../supabase/tests/shipment_delay_notice_filter.sql): 실제 상태별 집계, 미리보기 제외, 최신 요청 우선, 같은 주문의 다른 배송건, 공급자 결과 우선, 검색·집계·페이지, 페이지 밖 변경 fingerprint, 직접 접근 차단·현재 권한 철회, 주문·금액·안내 원장 무변경을 검증했다. 새 GIN 인덱스의 Bitmap Index Scan도 확인했다.
- OWN/FRESH operator capability coverage 통과. 로컬 Supabase security advisor는 경고·오류가 없었다.
- 관련 Vitest 7파일 93개, 전체 TypeScript 검사와 변경 파일 ESLint를 통과했다.
- Chrome의 소유 격리 환경에서 발송 처리 1건, 일부 실패·제외 2건, 대기·처리 중 1건, 결과 확인 필요 1건, 미발송 56건을 합성 자료로 확인했다. 미발송 50/6 페이지 이동과 조건 보존을 확인했다.
- 실제 다운로드한 XLSX 두 파일을 다시 열어 일부 실패 2행과 미발송 전체 56행, 모든 행의 상태·안내 시트 조건을 검증했다. 감사 원장에도 각각 같은 필터·건수·현재 담당자가 기록됐다.
- 390×844에서 필터 선택·검색 버튼 클릭·결과·가로 스크롤을 확인했다. 문서 전체 폭은 390px이며 임시 뷰포트는 복원하고 소유 탭을 닫았다. 앱 오류 오버레이는 없었다. 개발 콘솔에는 기존 번역 확장의 `data-immersive-translate-page-theme` 삽입에 따른 hydration 경고만 관찰됐다.

로컬 증거는 `output/smartstore-reference-20261013/shipment-delay-notice-filter/`의 원본 해시 manifest, migration readback, PC/390px 이미지, XLSX readback과 감사 기록에 남겼다. 실제 메시지나 이메일을 보내지 않았으며 로컬 이메일 게이트도 꺼진 상태를 유지했다. 운영 DB·운영 배포·NAVER 데이터 변경은 수행하지 않았다.
