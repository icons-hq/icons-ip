# 일반 굿즈 판매기간

일반재고 굿즈의 판매 시작·종료를 상품 편집의 **판매기간**에서 설정한다. 기본은 `설정안함`이다. 할인 기간, 수동 판매 중지, 공개 여부와 별개이며 예약판매 옵션은 자체 예약 접수 기간을 사용한다.

## 운영 계약

- 입력·표시는 한국시간이다. 시작 시각은 포함하고 종료 시각부터 신규 구매를 차단한다. 3·5·7·15·30·60·90·120일 버튼은 오늘을 첫날로 계산한다. 예를 들어 10월 13일의 3일은 13일 00:00부터 **16일 00:00 직전까지**다.
- 기간 밖에도 공개 상품과 상세는 유지한다. 고객에게 `판매 시작 전` 또는 `판매 종료`를 표시하며 장바구니 추가·신규 주문·결제 준비·아직 시작하지 않은 결제 승인 요청을 차단한다. 실제 재고, 공개 상태와 수동 판매 중지는 시계 때문에 바뀌지 않는다.
- 장바구니에서 종료된 상품을 삭제할 수 있다. 할인·배송비·쿠폰·적립금의 계산 계약은 유지한다. 상품·견적의 다음 변경 시각으로 고객 화면을 갱신하고, 최종 구매 허용은 DB가 판단한다.
- 이미 승인 요청을 시작한 결제와 승인 여부를 조회하는 재정합화는 기간 종료만으로 무효화하지 않는다. 기존 주문 금액·기한·재고 예약과 provider 조회 근거로 확정한다. 이미 만들어진 무통장입금 주문도 기존 입금 기한을 따른다. 종료 뒤 새 주문이나 새 결제 준비는 받지 않는다.
- 일반 판매기간과 선택된 예약판매 정책은 함께 저장할 수 없다. 예약판매를 일반재고로 전환한 후 일반 판매기간을 설정하거나, 판매기간을 해제한 후 예약판매로 전환한다.
- 기본 상품 저장이 기간을 함께 저장한다. 동시에 다른 탭에서 기간을 바꾸면 먼저 저장된 버전만 반영하고, 나중 탭의 입력은 오류와 함께 유지한다. 개인 서버 임시저장·브라우저 복구에도 기간과 조회 버전을 보존한다.
- 상품 복사본은 **판매기간 없음·미공개·재고 0·KC 재검토**로 시작한다. 판매기간 필드를 보내지 않는 기존 API·엑셀 편집은 원래 상품의 기간을 보존한다.

## 저장·구매 경계

`goods.sale_starts_at / sale_ends_at / sale_period_revision`과 `admin_save_good.sale_period`가 계약이다. 시작·종료는 둘 다 없거나, 유한한 시각이고 시작이 종료보다 앞서야 한다. 새 상품의 예상 버전은 0이다. 변경은 감사 로그에 남는다. 공개 계산 필드 `goods_sale_period`는 전달받은 합성 행을 믿지 않고 실제 공개 상품 행을 다시 읽는다.

일반재고의 `resolve_goods_variant_supply`는 기간 밖에서 가용 수량을 0으로 계산한다. 카트·주문 품목의 쓰기 가드와 주문 생성 마지막 검사, 결제 준비·최초 승인 claim은 상품 행 잠금을 기다린 **후** `clock_timestamp()`로 검사한다. 여러 상품의 결제는 모두 잠근 뒤 하나의 공통 시각으로 재검사한다. 중간에 기간이 끝나면 주문·재고·카트·결제 시도의 변경을 함께 롤백한다. 같은 checkout key의 기존 주문 재시도와 terminal callback은 원래 멱등 계약을 유지한다.

## 원본 근거와 차이

2026-10-13 스마트스토어 등록 화면에서 일반 판매기간의 설정함/설정안함, 3·5·7·15·30·60·90·120일, 별도 전시상태를 확인했다. 3일은 `2026.10.13 00:00`–`2026.10.15 23:59`로 표시됐다. 예약구매일 때 이 일반 판매기간 영역은 표시 대상에서 제외됐다. [원본 화면](../../output/goods-sale-period-qa-20261013/source-period-3-days.png), [원본 DOM](../../output/goods-sale-period-qa-20261013/source-period-dom.txt).

[스마트스토어 공식 도움말](https://help.sell.smartstore.naver.com/faq/content.help?faqId=12503)은 기간 종료 후 구매 불가와 재판매 시 설정안함 저장을 안내한다. 원본 상품의 저장·등록과 실제 공개 경계 전환은 실행하지 않았다. ICONS는 분 단위 시각 입력을 제공하고 마지막 날 전체를 포함하기 위해 종료를 다음 날 00:00의 제외 경계로 저장한다. 공개 탐색 유지와 이미 승인된 결제 보존은 ICONS의 별도 계약이다.

## 검증

- `supabase/tests/goods_sale_period.sql`: 구버전 보존·CAS·복사 초기화·예약판매 양방향 충돌·시작 포함/종료 제외·공개 탐색·견적·멱등 주문·종료 후 결제 재정합화·신규 prepare/claim 거부·권한 봉인.
- `supabase/tests/goods_sale_period_concurrency.sh`: 명시적으로 선택한 로컬 DB의 폐기용 복제본에서 카트·주문·prepare·claim 잠금 대기 중 종료, 다중 상품 공통 시각, 주문 품목 생성 뒤 최종 검사, 기간 CAS와 예약판매 양방향 경합 9종을 실행하고 DB를 정리한다.
- 실제 관리자 UI: 3일 설정 → 개인 임시저장 → 신규 상품 저장 → 재조회, 5일/15일 두 탭 저장 충돌과 입력 보존, 390px. [저장값](../../output/goods-sale-period-qa-20261013/product-save-readback.json), [충돌 readback](../../output/goods-sale-period-qa-20261013/stale-tab-readback.json), [충돌 화면](../../output/goods-sale-period-qa-20261013/admin-stale-period-preserved.png), [390px](../../output/goods-sale-period-qa-20261013/admin-period-mobile-390.png).
- 실제 공개 UI: 상세 390px과 검색 목록에서 수동 새로고침 없이 시작 전 → 구매 가능 → 판매 종료로 전환했다. 종료 후 고정 구매바 문구·대비를 확인했고, 검증 후 해당 합성 상품은 기간 없음·재고10으로 복원했다. [자동 경계 readback](../../output/smartstore-reference-20261012/verification-goods-sale-period-public/automatic-boundary-readbacks.json), [수락 화면·해시](../../output/smartstore-reference-20261012/verification-goods-sale-period-public/screenshots.json), [최종 DB](../../output/smartstore-reference-20261012/verification-goods-sale-period-public/final-database-readback.json).
- 모든 DB 적용·저장·구매 경계 검증은 격리된 로컬 합성 데이터에서 수행했다. 운영/Preview 반영과 실제 결제·외부 메시지 전송은 실행하지 않았다.
