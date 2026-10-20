# 배송정보 템플릿 대응 범위

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-12 원본 관찰과 2026-10-16 현재 코드 기준. 원본 계정의 상품·주소·고객 데이터는 아래 문서와 테스트에 복사하지 않았다. 10월 14일 확장 배송 정책 연결과 10월 15일 배송비 묶음그룹 연결의 실제 검증을 각 실행의 근거로 구분한다.

## 원본과 ICONS의 구분

원본 `#/products/template/delivery`의 ‘배송비 템플릿’은 안내 문구가 아니라 배송 수단·운임·묶음배송 그룹·출고 및 반품 주소·반품/교환 비용을 묶는 설정이다. 관찰 근거는 로컬 `output/smartstore-reference-20261012/catalog-cs/coverage.md`의 81–90 항목과 `87-template-delivery-*.jpg`부터 `90-template-delivery-bottom.jpg`까지의 화면이다. 등록·취소 화면을 읽었으며 네이버 계정에 설정을 저장하거나 적용하지 않았다.

ICONS에는 기존 `shipping_notice_templates`와 별도로 `shipping_settings_templates`를 구현했다. 전자는 고객 공개 안내 문구와 CS 연락처를 소유하는 **배송 안내 템플릿**, 후자는 현재 지원하는 배송 설정을 묶는 **배송정보 템플릿**이다.

| 원본 설정 | ICONS 대응 | 상태·경계 |
| --- | --- | --- |
| 이름·목록·조회/수정·사용 | 이름 검색, 사용 상태 검색, 최근 수정순 20개 페이지, 등록/수정 | 저장할 때 revision 증가. 삭제 대신 사용 중지 |
| 배송비 유형 | 출고지 정책 따름·무료배송·상품별 개별 배송비 | 기존 계산 함수 유지. 비활성 개별 배송비 입력은 보관하되 계산에는 해당 유형만 사용 |
| 출고지·기본 택배사·반송 주소 | 기존 `fulfillment_origins` 참조와 현재 정책 미리보기 | 템플릿이 출고지 자체를 수정하지 않음. 없는 출고지 또는 비활성 출고지로 적용할 수 없음 |
| 반품·교환 배송비와 조건 | 반품/교환 가능 안내, 제한 사유, 고객 귀책 반품 편도·무료배송 후 반품 왕복·교환 왕복 비용 | `null`=미확인, `0`=확인된 무료. 기존 안내 계약을 유지하며 실제 청구/환불 차감과 연결하지 않음 |
| 상품에 설정 적용 | 상품 검색·최대 100개 선택·상품별 변경 전/후 미리보기·원자적 적용 | 한 상품 또는 여러 상품이 동일 RPC를 사용. 상품/템플릿/출고지 충돌이면 전체 미적용 |
| 묶음배송 최소/최대 운임 그룹 | 같은 출고지의 명시 배정 원상품에 최소/최대 운임·무료 우선·그룹 수량 계산을 적용하고 템플릿에 유지/지정/해제를 연결 | [그룹 구현·검증](shipping-charge-groups-parity.md). 격리 검사·로컬 named 적용과 실제 그룹 지정/유지/해제·출고지 이동·고객 견적·정리 완료. 시각적·기존 표시 제한은 전용 기록 참조 |
| 수량 2/3구간 요금 | 기존 상품별 확장 배송 정책의 반복 수량·2/3구간을 템플릿에 저장하고 명시적으로 복사 | 기본값은 기존 정책 유지. 복사하면 선택 상품마다 새 불변 정책 버전을 만들며 기존 개별 배송비를 수량 요금으로 재해석하지 않음 |
| 선결제/착불/선택형 착불 | 확장 배송 정책 복사에 선결제·착불·구매자 선택을 포함 | 적용 후 출고지의 수납 계약과 활성화 조건을 검사. 수납 계약 자체나 온라인/별도 착불 계산은 변경하지 않음 |
| 템플릿의 택배/직접배송/화물/퀵/방문수령 선택 | 상품별 수령 방식 유지 또는 템플릿 방식으로 변경, 배송없음 직접전달도 지원 | 선택 상품의 수령 revision을 검사해 원자 적용. 출고지의 비택배 수령 절차 활성화가 주문의 별도 조건이며 기존 주문은 유지 |
| 도서산간 추가료 설정 | 기존 출고지·택배사별 지역 정책을 참조 | 정책 요약과 관리 링크 제공. 템플릿에서 지역표/추가료를 덮어쓰지 않음 |
| 별도 설치비·운임 | 방식별 상품당 1회/수량별 선결제 운임과 개당 설치비를 템플릿에 저장·상품 적용 | 고객 주문서의 실제 금액에 포함한다. 현장 추가 청구는 없고 지역 추가료는 기존 출고지 정책의 별도 계약 |

## 적용 계약

- 저장: 이름, 사용 여부, 출고지 ID, 배송비 유형, 개별 배송비, 반품·교환 안내 조건과 확장 배송 정책의 유지/복사를 저장한다. 복사는 기존 상품 편집과 같은 상태·결제 방식·수량 요금 계약을 사용한다. 수정은 새 revision이며 기존 상품에 자동 전파하지 않는다.
- 배송비 묶음그룹: v3는 확장 배송 정책의 유지/복사와 별도로 그룹 `preserve`/`assign`/`clear`를 저장한다. 지시가 없는 기존 템플릿은 현재 배정을 유지한다. 출고지 변경과 명시 그룹 배정은 하나의 원자 적용이며, 유지한 그룹과 새 출고지가 다르면 전체 적용을 막는다. 그룹 해제는 무료배송 설정이나 확장 정책 삭제가 아니다. 새 계약의 구현·실제 검증과 남은 제한은 [전용 기록](shipping-charge-groups-parity.md)을 따른다.
- 수령 방식: `settings.fulfillment`의 기본은 `preserve`다. `replace`는 택배·퀵·방문수령·직접배송·화물 또는 무배송 직접전달의 방법·운임·설치비·고객 안내·적용 근거를 저장한다. 적용은 직접 선택한 상품에만 반영하며 기존 디지털 파일 연결을 새 주문에서 해제한다. 디지털 파일을 여러 상품에 지정하는 템플릿은 제공하지 않고 상품별 검증 업로드를 사용한다. 주문 당시 파일·수령 조건은 보존한다.
- 호환성: 기존 템플릿의 정책 지시가 없으면 기존 상품의 확장 배송 정책을 유지한다. 명시적 복사에서 비활성 정책을 저장하면 적용 시 비활성 새 버전을 만든다. `null`로 정책을 지우거나 과거 템플릿 값을 수량 요금으로 추정하지 않는다. 구형 적용 RPC는 새 정책 지시가 있는 템플릿을 거절한다.
- 미리보기: 서버가 상품별 변경 전/후 기본 설정과 실제 유지/복사될 확장 배송 정책을 함께 반환한다. 기본 배송비가 무료여도 활성 수량 정책이 유지되면 이를 표시한다. 출고지 기본 운임·무료 기준·택배사·반송 주소와 착불 수납 준비 상태도 표시한다. 지역 추가료와 최종 청구 운임은 주문 구성·주소에서 결정한다.
- 적용: 같은 템플릿 revision, 출고지 시각, 수납 계약 revision·version, 상품과 정책 소유 상품의 시각, 거래 설정 revision·배송 version, 합산 가족 구성을 검증한다. 최대 100개 대상의 잠금·검증을 모두 통과한 뒤 기존 반품·교환 정책 저장기와 `admin_save_good_transaction_terms`로 복사한다. 한 대상이라도 바뀌거나 활성화/수납 조건을 충족하지 못하면 전체 미적용이다. 복수구매 할인과 과거 정책 버전은 유지한다.
- 그룹상품: 별도 상품은 원상품이 소유하는 정책을 독립 변경할 수 없다. 미리보기에서 원상품과 영향받는 합산 상품 수를 표시한다. 원상품의 출고지·기본 배송비와 확장 배송 정책은 합산군 전체의 배송비 계산에 사용된다. 수령 방식·반품 및 교환 안내·템플릿 연결은 직접 선택한 상품에 저장한다. 선택하지 않은 원상품·합산 상품을 자동으로 적용 대상에 추가하지 않는다.
- 멱등성과 응답 유실: 저장·적용 UUID에 실행자, 로그인 세션, 대상 템플릿·기대 revision과 고정 입력을 묶는다. 같은 요청은 저장된 결과를 반환하며 다른 계정·세션·입력은 거절한다. 화면에 원래 입력이 있으면 같은 UUID와 입력으로만 재시도한다. 새로고침 후에는 메타데이터로 결과를 조회하고, 미확정이면 요청을 종료하여 늦은 저장을 막은 뒤 새 요청을 시작한다. 조회 결과 `null` 자체를 실패 확정으로 취급하지 않는다.
- 버전 근거: 상품에 적용 템플릿 ID·revision·설정 스냅샷을 저장한다. 기본 설정 또는 명시적으로 복사한 배송 정책을 개별 편집하면 연결을 해제한다. 기존 템플릿과 유지 모드는 독립 배송 정책 편집 때문에 연결을 해제하지 않으며, 복수구매 할인만 편집하거나 상품 ID·이름을 변경한 경우 연결을 유지한다. 이전 적용은 감사 기록에서 추적한다.
- 과거 거래: 기존 주문 품목의 출고지·운임 스냅샷, 주문 청구액, 승인된 클레임 회수 주소는 변경하지 않는다. 배송 안내 템플릿의 문구·버전도 변경하지 않는다.
- 권한: 새 조회·저장·미리보기·적용·결과 복구 RPC는 DB의 현재 `catalog.manage`와 실행자·로그인 세션을 검사한다. 일반 회원·익명·service role에는 새 RPC 실행 권한을 열지 않는다. 요청 결과 저장소는 private schema에서 RLS와 ACL로 봉인한다.

## 구현과 검증

2026-10-16 수령 방식·설치비 연결은 [403 migration](../../../supabase/migrations/20261020085519_shipping_template_fulfillment.sql)과 [404 공개 RPC 계약 갱신](../../../supabase/migrations/20261020085520_shipping_fulfillment_operator_contracts.sql)으로 적용했다. 수령 revision은 미리보기와 실제 영수증에 포함되고, 직접 변경하면 수령 방식 복사를 지정한 템플릿만 연결을 해제한다. 유지/구형 템플릿은 독립 수령 설정을 보존한다.

- [SQL 계약](../../../supabase/tests/shipping_template_fulfillment.sql): 기존 디지털 파일 유지/명시 해제, 구형 요청 호환, 최신 미리보기 요구, 수령 설정 단독 변경 충돌, 두 번째 상품 오류 시 전체 롤백, 주문·자산 보존, 합산군 자식 제한·권한을 검증했다. 전체 후속 SQL 20개는 404 결과 (`output/smartstore-full-admin-20261016/full-admin-sql-404/result.json`)를 따른다.
- 실제 경합 (`output/smartstore-full-admin-20261016/shipping-template-fulfillment-concurrency.json`): 같은 요청12회는 상품별 버전1개, 서로 다른8개 요청은 1개 적용/7개 거절, 수동 수령 편집과 템플릿 적용의 충돌, 종료/적용12회 경합을 확인했다. 수동 변경의 템플릿 연결 해제가 공통 잠금을 보유할 수 있으므로 즉시 재시도 오류 또는 대기 뒤 최신 상태 충돌 모두 정상 거절이며 부분 저장이 없다.
- 브라우저 (`output/smartstore-full-admin-20261016/shipping-template-fulfillment-browser.json`): 등록·재열람·2상품 미리보기·적용을 PC/390px에서 확인했다. 실제 응답을 커밋 뒤 끊고 새로고침한 다음 결과 조회로 복구했으며 적용 요청1개·상품별 감사2개·수령 버전1·원 재고10개가 유지됐다. 화면9개 상태의 배치 오류·페이지 오류는0이다.
- 고객 주문서에서 상품40,000원+직접배송5,000원+설치비2,000원=47,000원을 확인했다. 별도 방문수령 상품은0원이다. 처음에는 새 합성 출고지에 수령 절차가 없어 정상 차단됐으며, 그 출고지의 합성 절차를 공개 설정 RPC로 활성화한 뒤 다시 확인했다. 주문이나 실제 결제는 생성하지 않았다.
- 최초 통합 검사의 공개 RPC 지문 누락은 새404 migration으로 보정했다. 적용한403 원문과 실패 로그는 보존했다. 기존 배송 템플릿/묶음그룹/출고지 회귀6개와 자체 권한 fixture를 쓰는 주문서 회귀1개도 통과했다. 후자의 첫 실패는 구형 fixture wrapper를 잘못 중첩한 실행기 조건이며 별도 실행 결과를 기록했다.


2026-10-15 배송비 묶음그룹·템플릿 v3와 장바구니 상품 조건 사전 조회 보완은 [별도 구현 검증](shipping-charge-groups-parity.md)을 따른다. 그룹 SQL104개·실제 DTO17개·경합15개·관련 앱278개, 후속 사전 조회69개/DTO9개와 상품 편집기64개/최종9개·타입·대상 ESLint·최종 격리 빌드를 통과했다. 로컬 OWN274/FRESH307/CANON342 적용 뒤 실제 관리자/고객 화면을 검증하고 합성 계정·상품·전용 런타임을 정리했다.

후속 실제 UI 기록 (`output/shipping-cart-precheckout-browser-qa-20261015/browser-evidence.json`)은 `PASS_WITH_DOCUMENTED_LIMITS`다. 템플릿으로 출고지와 그룹을 함께 지정했고, 유지 모드에서는 개별 배송비3,000→3,200 변경 중 기존 배정 version/revision이 정확히 같았다. 해제 모드 적용 후에는 그룹만 비워지고 개별료3,200·출고지는 유지됐다. 고객 견적에서 같은 그룹의 기본료3,000+지역료1,200을 한 번 부과해24,200을 확인했다. 원상품 배정/해제와 자식 읽기 전용·부매니저 지역 정책 제한,390px 모달·일반 스크롤 뒤 필수 동작 접근·Escape 포커스 복귀도 확인했다. 전체 focus trap이나 이번에 반복하지 않은100/101 경계·동시 수정 충돌·페이지 이동을 실제 UI 통과로 확대하지 않는다.

후속 fixture는 기존 업무·저장소·Auth 행과 금전52개 표·재고·불변 정책·전체 원장을 보존했고 전역 설정을 복원했다. 주문·결제·환급·배송 생성0, 업로드0이며 정상 비활성화 (`output/shipping-cart-precheckout-browser-qa-20261015/retirement-result.json`)·런타임 제거 (`output/shipping-cart-precheckout-browser-qa-20261015/runtime-cleanup.json`) 모두 `PASS`다. 첫 그룹 fixture의 localhost4320 정상 refresh1회 예외는 [역사 기록](shipping-charge-groups-parity.md#검증-상태와-근거)에 남기고 새 fixture의 예외 없는 보존과 구분한다. FAQ 설명 일부 겹침과 기존 자식 구매정책 표시 제한 역시 전용 기록에 남긴다. 아래10월14일 근거는 당시 확장 정책 연결의 결과로 유지한다.

2026-10-14 확장 배송 정책 연결은 [거래 모델](goods-transaction-module-proposal.md), [관리자 설정](goods-transaction-admin-implementation-qa.md), [운영 절차](../../runbooks/goods-transactions.md)의 기존 계산·활성화 계약을 재사용한다. 소유 격리 DB 검증, 승인된 로컬 OWN·FRESH·CANON 적용, 실제 PC·390px 화면 확인과 합성 계정·전용 런타임 정리를 완료했다. 통합 결과 (`output/shipping-settings-integration-20261014/combined-result.json`)는 `PASS`이며 운영·Preview 환경은 변경하지 않았다.

- [DB migration](../../../supabase/migrations/20261020085144_admin_shipping_settings_templates.sql)
- [확장 정책 연결 migration](../../../supabase/migrations/20261020085407_shipping_settings_delivery_policies.sql), [SQL 계약·100개 원자 적용](../../../supabase/tests/shipping_settings_delivery_policies.sql), [실제 동시 요청 검증](../../../supabase/tests/shipping_settings_delivery_concurrency.py), [SQL 응답과 TypeScript 파서 대조](../../../supabase/tests/shipping_settings_delivery_contract.live.ts)
- 확장 연결은 2026-10-14 격리 검증 (`output/shipping-settings-delivery-qa-20261014/ee3aff0e86f8475b91f0ea28918d2c6d/result.json`)에서 기존 템플릿·상품 거래 정책 회귀, 유지/복사·활성화/수납 조건·그룹 원상품·100개 경계, SQL→TypeScript 응답 5종과 실제 경합 21건을 통과했다. 같은 요청, 다른 실행자·세션, 템플릿/상품/정책/수납 계약/합산 구성 변경, 구형 저장기, 계정 정지·세션 폐기를 포함한다. migration 적용은 기존 행·불변 정책·전체 원장 본문과 기존 스키마·owner/ACL/RLS를 보존했으며 소유 clone 삭제 후 원본 전체 해시가 같았다.
- 로컬 named 적용 결과 (`output/shipping-settings-delivery-named-qa-20261014/plan-495b637999934a53816f13428719bacc/named-summary.json`): OWN 269→270, FRESH 302→303, CANON 337→338이며 마지막 버전은 `20261014104425`다. 대상마다 기존 전체 행·원장 본문·권한·RLS·미변경 registry hash와 새 함수의 현재 hash를 commit 전후 대조했다. 기존 거래·연락처 런타임은 모두 `false`를 유지했다. migration 원문은 적용 후 변경하지 않는다.
- Local advisors 분류 (`output/shipping-settings-delivery-named-qa-20261014/local-advisors-ef6cceb85ce64a68ae67bf144a6ac5a4/classification.json`): OWN 명시 연결과 읽기 전용 기본 트랜잭션으로 검사하고 전후 전체 해시가 같음을 확인했다. 신규 public 함수 6개 지적은 없으며 신규 private 요청 원장의 `RLS Enabled No Policy` INFO는 클라이언트 접근을 봉인한 설계에 해당한다. 기존 객체의 WARN 10건과 INFO는 별도 기록했으며 전체 DB에 경고가 없다는 의미가 아니다.
- [입력 계약](../../../lib/admin/shipping-settings-templates.ts), [서버 조회](../../../lib/admin/shipping-settings-templates.server.ts), [액션](../../../app/admin/shipping-settings-template-actions.ts)
- [목록](../../../components/admin/screens/ShippingSettingsTemplatesScreen.tsx), [등록/수정](../../../components/admin/screens/ShippingSettingsTemplateForm.tsx), [상품 선택·미리보기·적용](../../../components/admin/screens/ShippingSettingsApplyDialog.tsx)
- [SQL 검증](../../../supabase/tests/admin_shipping_settings_templates.sql): 소유 격리 DB에서 합성 데이터 100개 적용과 101개 거부, 중복 대상/누락 대상 거부, 동일 요청 재실행, 다른 실행자 재실행 거부, 상품·출고지 충돌 시 전체 미적용, 비활성/누락 출고지 거부, 버전 변경 비전파, 직접 수정 시 연결 해제, 주문/출고지 불변, RLS와 실행 권한을 검증했다. 모든 테스트 데이터는 `ROLLBACK`했다.
- 입력·서버 응답·액션·SSR 렌더 검증과 타입 검사·ESLint를 통과했다. 2026-10-13 Chrome과 소유 격리 DB에서 비활성 출고지 저장 거부 시 입력 보존, 템플릿 v1/v2 저장, 두 합성 상품의 변경 전/후 미리보기를 확인했다. 다른 탭에서 템플릿을 수정한 뒤 오래된 미리보기 적용이 전체 거절되고 선택이 보존됐다. 최신 버전을 적용한 뒤 상품 두 개의 배송비·안내 비용의 0원/미확인·적용 버전을 UI와 DB에서 재조회했다.
- 390px 모바일에서 문서 폭과 스크롤 폭은 모두 390px였으며, 수정 대화상자 내부도 가로 넘침이 없었다. 증거는 `output/smartstore-reference-20261013/verification-shipping-settings/manifest.json`에 기록했다. 기존 주문 불변과 100개 경계·권한은 앞선 SQL 검증 범위이며 브라우저에서 거래를 생성하지 않았다.
- 2026-10-14 앱 통합 검사 (`output/shipping-settings-integration-20261014/app-check-result.json`)에서 9,371개 테스트·타입 검사·lint·로컬 빌드를 통과했다. 제외된 테스트 4개와 기존 lint 경고 3개는 결과에 구분했다. 이후 안내 문구 두 곳과 운영 가이드만 수정했으며 최종 관련 검사 (`output/shipping-settings-integration-20261014/final-guidance-result.json`) 43개 테스트와 ESLint를 통과했다.
- 확장 정책의 실제 브라우저 검증 (`output/shipping-settings-browser-qa-20261014/browser-result.json`)에서 기존 수량별·착불 정책 유지, 3구간·구매자 선택 저장, 수납 조건 미준비 시 전체 적용 차단, 합산군 자식 선택 금지, 오래된 미리보기 거절·요청 종료, 확정 응답 유실 후 새로고침·결과 복구, 확장 정책의 명시적 비활성화를 확인했다. DB 재조회 (`output/shipping-settings-browser-qa-20261014/final-browser-db-readback.json`)에서 요청·감사·정책 버전의 중복 생성이 없고 자식 상품은 원상품의 운임 정책을 참조함을 확인했다. PC와 390px 화면은 가로 넘침 없이 검토했다.
- 빈 DB의 338개 순서 적용 결과 (`output/final-ordered-chain-338-qa-20261014/final-result.json`)는 `PASS_WITH_RUNNER_RECOVERY`다. migration은 한 번에 모두 적용됐으나 실행기가 CLI의 프로젝트명 축약을 반영하지 못해 리소스 탐색·정리 단계에서 실패했다. 실제 소유 리소스를 다시 식별해 전체 원장과 SQL 원문·권한 계약을 검증하고 컨테이너·볼륨·네트워크를 정리했다. 최초 실패와 잘못된 정리 완료 기록을 보존·정정했으며 338개 원본 migration과 CANON의 기존 상태는 변경하지 않았다.
- 정상 정리 (`output/shipping-settings-browser-qa-20261014/retirement-result.json`)와 런타임 제거 (`output/shipping-settings-browser-qa-20261014/runtime-cleanup.json`)를 완료했다. 합성 계정 2개를 비활성화하고 템플릿·수납 계약·출고지의 사용을 중지했으며 전역 설정을 복원했다. 기존 업무 데이터·정책 버전·재고를 보존하고 전용 프로세스·포트·자격 증명을 제거했다. 기존 세션의 백그라운드 갱신으로 바뀐 Auth 3행과 새 토큰 1행은 정확한 변경·시각 근거 (`output/shipping-settings-browser-qa-20261014/auth-refresh-proof-addendum.json`)를 검토해 한정된 예외로 기록했으며, 기존 Auth를 복원·삭제하거나 정리 중 추가로 변경하지 않았다.
- 이번 화면 검증은 관리자 설정과 정본 운임 계산 범위이며 주문·결제·운송사 호출을 만들지 않았다. OWN에 남아 있는 기존 출고지의 불완전한 합성 지역 정책 (`output/goods-transaction-design-20261014/shipping-summary-existing-fixture-diagnosis.json`)은 수정하지 않았고 지역 배송 요약의 경고·미확인 상태를 유지했다. 이를 지역 추가료 0원이나 운영 준비 완료로 해석하지 않는다.
