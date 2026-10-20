# 배송비 묶음그룹 구현·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15 현재 코드와 단계별 증거 기준. 계산·관리자 설정·상품 배정·배송정보 템플릿 연결과 고객 장바구니 사전 조회 보완을 구현했고, 격리 DB·관련 앱 검사·로컬 OWN274/FRESH307/CANON342 적용 후 실제 PC/390px에서 그룹 설정·원상품/자식 배정·템플릿 유지/지정/해제·최소/최대/수량/착불/무료 우선/지역료 견적을 확인했다. 검증 중 발견한 장바구니 오류와 상품 편집기 변경 오판정을 수정·재검증했으며 합성 계정·상품의 정상 비활성화와 전용 런타임 정리도 완료했다. 해당 브라우저 결과는 `PASS_WITH_DOCUMENTED_LIMITS`로 보존한다. 운영·Preview 환경과 실제 주문·결제·물류·이메일 업무는 실행하지 않았다.

이후 별도 343 migration에서 합산군 자식의 사전 조회 구매정책 표시를 원상품 기준으로 보정했다. SQL 100개·실제 응답 9종→장바구니 렌더링 11개와 로컬 OWN275/FRESH308/CANON343 적용·재조회까지 통과했다. 이 후속 수정은 새 브라우저 검증을 실행하지 않았으며, 기존 342 브라우저 기록과 원본 PNG 21장은 수정하지 않았다.

## 원본 대응과 도메인 경계

원본의 이름·사용 여부·기본 그룹·최소/최대 부과·지역 추가료·상품 선택은 [원본 조사와 계산 제안](shipping-charge-groups-proposal.md)에 기록했다. 원본 계정에 저장하거나 주문을 만들지는 않았다. ICONS의 접합 결정은 [ADR-0023](../../adr/0023-shipping-charge-groups.md)를 따르며 원본 계정의 그룹명·운임·주소를 기본값으로 복사하지 않는다.

| 대상 | 현재 계약 |
| --- | --- |
| 배송비 묶음그룹 | 같은 주문·출고지에서 배송비를 함께 계산할 원상품을 명시 배정하는 설정이다. 재편성할 수 있으며 정책·배정의 이전 버전을 보존한다. |
| 그룹상품·구매 합산군 | 전시 편성과 기존 옵션의 경제적 정체성을 유지하는 합산 관계다. 합산군 자식은 원상품의 배송비 배정을 공유하고 직접 배정하지 않는다. |
| 배송 건 | 주문·출고지당 하나인 기존 물리 배송 단위를 유지한다. 요금 그룹 수로 포장·운송장·배송 건을 늘리지 않는다. 이미 생성한 별도 주문의 합포장은 포함하지 않는다. |
| 기본 그룹 표시 | 출고지마다 사용 중인 그룹 하나를 기본으로 표시한다. 신규·기존 상품 모두 자동 선택·자동 배정하지 않는다. 신규 상품은 기본 정보를 저장한 다음 별도 배정 절차를 거친다. |
| 미지정 상품 | 기존 상품·출고지의 배송비 규칙을 유지한다. 그룹을 해제해도 무료배송으로 바뀌지 않는다. |
| 과거 거래 | 확정 주문·품목·배송비 배분·착불 의무·환급은 당시 스냅샷을 유지한다. 그룹 편집으로 과거 주문을 다시 계산하지 않는다. |

## 계산과 지역 추가료

구매 합산군의 실제 선택을 원상품으로 먼저 모은 뒤 배송 계산용 그룹 수량 `Q`와 **기간 할인 후 소계 `S`**를 만든다. 복수구매 할인·쿠폰·적립금 차감 후 금액으로 조건부 무료를 다시 판단하지 않는다. 그룹 안에서 실제 구매하지 않은 상품이나 전시 형제 상품은 수량·금액에 넣지 않으며, 배송 그룹 합계를 구매 제한이나 복수구매 할인 범위로 사용하지 않는다.

1. 원상품의 활성 수량 정책이 있으면 반복 수량·2/3구간 정책을 그룹 전체 `Q`로 평가한다. 활성 수량 정책이 없을 때 무료·개별 운임·출고지 정책을 사용하며, 출고지 정책의 무료 기준은 그룹 `S`로 판단한다.
2. 유효 후보 운임에 0원이 하나라도 있으면 최소·최대 설정 모두 그룹 기본료가 0원이다. 그 외에는 최소 또는 최대 후보 운임을 선택한다. 상품에 무료 기본값이 있더라도 활성 수량 정책을 건너뛰지 않는다.
3. 그룹 기본료를 원상품별 `S` 비중으로 정수 배분한다. 소계 합계가 0이면 수량 비중을 사용하며 기존 최대 나머지 방식과 안정적인 ID 동률 규칙을 따른다. 이후 같은 합산군의 실제 구매 상품으로 나누는 기존 배분을 유지한다.
4. 지역 추가료를 별도로 계산한 뒤 상품별 확정 선결제·착불 선택에 따라 온라인 배송비 `H`와 외부 수납 의무 `D`로 나눈다. 온라인 금액은 기존 `T = S - V - C - R + H`를 유지한다. 0원 착불도 출고지의 유효한 수납 계약이 필요하다.

| 지역 설정 | 계산·검증 경계 |
| --- | --- |
| 출고지 정책 상속 (`inherit`) | 같은 출고지의 상속 그룹과 미지정 상품을 기존 지역 정책으로 함께 판단한다. `per_shipment`를 그룹 수만큼 중복 부과하지 않는다. 출고지 무료 기준에 따른 면제는 상속 부분집합의 유효 정책 유형 소계로 판단하며 명시 그룹 지역표 대상 금액을 넣지 않는다. |
| 그룹 지역표 지정 (`override`) | 기존 출고지 지역료 대상에서 해당 원상품을 빼고 확인된 그룹 지역표로 그룹당 한 번 부과한다. 기본료의 반복 수량을 지역료에 곱하지 않는다. 그룹 지역료도 원상품의 `S`, 모두 0원이면 수량 비중으로 배분한다. |
| 정책 미확인·만료·배송 불가 | 택배사 일치·활성 상태, 확인 근거, 적용 기간, 주소 판정, 미기재 지역 처리와 명시적 0원을 검사한다. 계산할 수 없는 정책을 출고지 정책이나 0원으로 조용히 대체하지 않는다. |

그룹 지역표의 변경 또는 지정 지역표를 가진 그룹의 재활성화에는 현재 관리자 `platform.manage` 권한과 명시 확인이 필요하다. 기본료가 무료인 것과 지역료가 면제되는 것은 별개다. 기존 출고지의 지역표·금액을 복제하거나 자동 활성화하지 않는다.

그룹이 전혀 없는 입력과 다른 출고지의 미배정 부분은 기존 계산 경로를 유지한다. 새 그룹을 사용하는 주문은 확정 견적 경로에서 그룹·배정·배송·지역·수납 계약을 묶고 생성 직전 다시 확인한다. 구형 주문 경로가 그룹을 무시하는 우회는 차단한다. [배송비 절약 계산 연결](../../../supabase/migrations/20261020085411_shipping_charge_group_savings.sql)은 같은 기본료 계산을 사용하며 공개 응답에 비공개 지역표·계약 근거를 노출하지 않는다.

장바구니는 [상품 조건 사전 조회](../../../supabase/migrations/20261020085412_goods_sales_precheckout.sql) `quote_goods_sales_precheckout`로 현재 가격·구매 가능 여부와 수량 제한을 확인한다. 배송 상태는 `checkout_required`이며 배송비·쿠폰·적립금·최종 결제액은 주문서의 거래 견적에서 확정한다. 사전 조회 실패·미완료 상태에서는 주문서 진입을 막고 재확인을 제공한다. 새 경로는 구형 주문의 그룹 우회 차단을 풀지 않으며, 과거 쿠폰 비교·배송비 절약 계산의 계약을 유지한다.

## 관리자·상품·템플릿 연결

그룹 관리는 `/admin/settings/origins#shipping-charge-groups`에 있다. 출고지·이름·사용 상태 검색과 20개 페이지, 생성·수정·최소/최대 부과·기본 표시·지역 정책을 제공한다. 생성한 그룹의 출고지는 바꿀 수 없다. 배정 원상품이 남아 있으면 사용 중지·보관을 막으며, 먼저 명시적으로 이동·해제한 뒤 처리한다. 보관은 정책 이력의 삭제가 아니다.

상품 단건 패널과 최대 100개 대량 배정은 선택·서버 미리보기·명시 적용 절차를 사용한다. 원상품·합산군 범위, 전후 그룹, 상품·거래·배송·배정·그룹 revision과 출고지 기준을 함께 검사하며 한 대상이라도 바뀌면 전체 미적용이다. 기본 상품 폼 저장이나 자동저장이 그룹 배정을 제출하지 않는다. 자식 상품은 원상품 링크와 읽기 요약만 제공하고, 미리보기·결과 재조회 중에는 다른 저장 패널과 상호 잠금을 유지한다. 비활성 출고지·수납 미준비 등의 배정을 정리하는 명시 해제는 가능하지만 자식 직접 배정과 거래 계약 미준비 차단은 유지한다.

[배송정보 템플릿](shipping-template-parity.md)의 v3 연결은 확장 배송 정책의 `delivery: preserve/replace`와 그룹의 `chargeGroup: preserve/assign/clear`를 독립적으로 다룬다.

| 그룹 지시 | 상품 적용 결과 |
| --- | --- |
| 없음 또는 `preserve` | 현재 배정을 유지한다. 기존 템플릿도 이 규칙을 따른다. 출고지만 바꿔 기존 그룹의 출고지와 달라지면 전체 적용을 막는다. |
| `assign` | 템플릿의 출고지에 속한 사용 가능한 그룹을 명시 배정한다. 출고지 변경과 그룹 배정은 하나의 원자 적용으로 확정한다. |
| `clear` | 배정을 명시 해제한다. 반품·교환 조건과 확장 배송 정책은 각각의 템플릿 지시에 따르며 그룹 해제만으로 삭제하지 않는다. |

템플릿 저장만으로 기존 상품을 변경하지 않는다. 적용 미리보기는 기존 그룹과 적용 후 그룹, 공유 합산군 범위와 직접 선택한 상품을 구분한다. 선택하지 않은 상품을 직접 적용 대상에 추가하지 않으며, 새 그룹 계약이 있는 상품·템플릿은 구형 미리보기·적용 경로로 처리하지 않는다.

## 저장 충돌과 응답 유실

그룹 저장·배정은 현재 `catalog.manage`, 실행자·로그인 세션, 요청 UUID·입력 해시, 기대 revision과 잠금으로 확정한다. 같은 요청은 기존 영수증을 반환하고 다른 계정·세션·입력의 복구를 거절한다. 쓰기와 결과 조회·미처리 요청 종료는 DB 계약을 공유한다.

브라우저의 그룹 요청 기록은 `operationId`, `command`, `groupId`, `expectedRevision`, `expectedActorId`, `expectedSessionId` 6개 메타데이터만 보관한다. 정책 원문·주소·지역 근거는 기록하지 않는다. 전송 후 오류 또는 응답 유실이 생기면 같은 요청의 결과 조회(`read`)와 미처리 요청 종료(`seal`)로 해소한다. 화면에 입력이 남아 있어도 자동 재전송하거나 새 UUID를 만들지 않는다. 조회 결과가 없다는 사실만으로 실패를 확정하지 않으며, 종료 요청 전에 저장이 확정됐으면 저장 영수증을 반환한다. 종료는 이미 확정된 변경의 취소가 아니다.

오래된 revision 충돌 뒤에는 원래 요청을 해소하고 최신 저장본을 명시 확인한 다음 새 요청을 시작한다. 계정·세션 변경과 늦은 응답은 입력·선택·미리보기·결과 재조회를 새 세션에 이관하지 않는다. 이 동작은 [그룹 요청 훅](../../../components/admin/shipping-charge-groups/useShippingChargeGroupOperation.ts)과 엄격한 [입력·응답 계약](../../../lib/admin/shipping-charge-groups.ts)으로 구현했다. 실제 브라우저에서는 그룹 저장이 확정된 뒤 응답만 유실시키고 새로고침 후 같은 요청의 영수증을 회수하는 흐름을 확인했다. 다른 계정의 수정 충돌 등 미수행 흐름은 아래에 구분한다.

## 검증 상태와 근거

최초 구현 검증 (`output/shipping-charge-groups-qa-20261015/implementation-validation.json`)의 `LOCAL_CODE_AND_ISOLATED_DB_PASSED_UI_PENDING`과 첫 브라우저 기록 (`output/shipping-charge-groups-browser-qa-20261015/browser-evidence.json`)의 `PARTIAL_CUSTOMER_BUG_FOUND`는 해당 시점의 기록으로 보존한다. 첫 실행에서 발견한 고객 오류를 보완한 뒤 새 합성 fixture로 실행한 최종 브라우저 기록 (`output/shipping-cart-precheckout-browser-qa-20261015/browser-evidence.json`)은 `PASS_WITH_DOCUMENTED_LIMITS`다. 실제 UI 수행과 원본 PNG 21장 직접 검토, 7개 DB 재조회, 정상 비활성화·런타임 정리를 이 최종 기록에 결속했다.

| 단계 | 확인한 결과 |
| --- | --- |
| 그룹·템플릿 SQL 계약 | 격리 DB에서 104개 assertion과 실제 SQL 응답→TypeScript 파서 17개 통과. 최초 결과 (`output/shipping-charge-groups-qa-20261015/ff97178556254f4f8b65e571251147cb/result.json`)의 후속 경합 실행기 OID assertion 실패는 그대로 보존한다. |
| 경합 후속 검증 | 실행기를 보완한 별도 소유 clone에서 실제 경합15개 (`output/shipping-charge-groups-qa-20261015/869ac86c69e24ef8963779bb391ad12f/shipping-charge-concurrency-result.json`) 통과·deadlock 없음과 clone 정리를 확인했다. |
| 그룹 관련 앱 검사 | 최종 22개 suite·278개와 타입 검사 통과. 초기 전체 실행은9,531개 통과·1개 실패·4개 제외였고 공개 용어 실패를 수정해 관련 검사를 통과했다. 전체 suite 재통과로 확대하지 않는다. |
| 상품 조건 사전 조회 보완 | 앱 검사 (`output/goods-sales-precheckout-qa-20261015/application-validation.json`)69개·타입 검사·대상 ESLint와 소유 clone (`output/goods-sales-precheckout-qa-20261015/044a867eb14c4c5cab8d8f294e807c4c/result.json`)의 SQL 회귀·실제 DTO3종/파서9개를 통과했다. 기존341개 migration·업무 행·전체 원장·owner/ACL/RLS 보존과 clone 정리를 확인했다. |
| 합산군 구매정책 표시 후속 보정 | [343 migration](../../../supabase/migrations/20261020085413_goods_sales_family_policy_projection.sql)은 공통 상품 조건 함수의 수량·회원 한도 표시만 원상품 정책으로 맞춘다. 격리 검증 (`output/goods-sales-precheckout-family-qa-20261015/validation.json`) SQL100개·실제 DTO9종→장바구니 서버 렌더링11개에서 기존 잔여9개·표시 누락을 재현하고 원상품 한도5개/기존 구매1개에 잔여4개를 확인했다. 비회원 null·원상품 한도 해제·최소/최대·회원 한도 초과 차단과 선택 상품/수량·가격·재고·PDP 배송비 절약 응답 보존을 확인했다. 새 브라우저 실행은 없다. |
| 상품 편집기 보완 | 비동기 잠금 중 빈 FormData로 초기값·변경 여부를 오판정하던 문제를 수정했다. 관련 검사 (`output/goods-sales-precheckout-qa-20261015/editor-capture-validation.json`)64개, 최종 테스트 정리 후9개·타입·대상 ESLint 통과. 이 기록의 `browserVerified=false`는 코드 검사 당시 상태이며 실제 단건 배정 재검증은 아래 최종 UI 근거다. 기본 상품 폼 저장으로 우회하지 않았다. |
| 최종 격리 빌드 | 최종 결과 (`output/shipping-cart-precheckout-browser-qa-20261015/build-editor-capture-final/result.json`) `PASS`. 배정 수 CSS와 상품 편집기 보완을 포함한2,975개 소스의 불변 SHA를 확인했다. 설치된 의존성 복사·신규 설치 없음, 로컬 Supabase 전용·제공자 비밀값 없음·telemetry 비활성, 소유 빌드 폴더 제거를 확인했다. |
| 로컬 named DB 적용 | 그룹3개 migration (`output/shipping-charge-groups-named-qa-20261015/plan-0ddc056f143941349f8ba8fc84a80955/named-summary.json`)은 OWN270→273/FRESH303→306/CANON338→341, 사전 조회1개 migration (`output/goods-sales-precheckout-qa-20261015/plan-7297d80ebc89483db2f3bd68f64a5a1b/named-summary.json`)은 OWN273→274/FRESH306→307/CANON341→342, 구매정책 표시 보정1개 migration (`output/goods-sales-precheckout-family-qa-20261015/plan-c87d3e2ce2904048b3f7491ab85be812/named-summary.json`)은 OWN274→275/FRESH307→308/CANON342→343을 적용하고 commit 후 재조회를 통과했다. 마지막 버전은 `20261015030552`이며 기존 migration 원문·업무 행·전체 원장·owner/ACL/RLS·미변경 registry·런타임 행을 보존했다. 각 적용 시점의 런타임 보존 근거는 UI fixture의 임시 활성 상태와 구분한다. |
| 이전 관리자 UI 근거 | 빈 목록·0건 검색·초기화, 최소 그룹 생성·활성/기본 지정·최대 그룹 생성·기본 그룹 원자 교체를 확인했다. 자동 배정이 없었고, commit 후 응답 유실·reload·같은 요청 복구에서 중복 없이 revision1을 회수했다. 원상품4개 명시 배정·자식 선택 금지·합산 상품 수2·390px 미리보기 표 가로 스크롤과44px 적용 버튼 접근도 확인했다. 이 실행의 정상 비활성화 (`output/shipping-charge-groups-browser-qa-20261015/retirement-result.json`)·런타임 정리 (`output/shipping-charge-groups-browser-qa-20261015/runtime-cleanup.json`)는 모두 `PASS`다. |
| 후속 장바구니·고객 견적 UI | 상품 조건 사전 조회 성공, 요청1회 중단 시 오류/재확인·주문 진입 비활성, 재확인 후 복구를 확인했다. 최소 배송비2,500/온라인32,300, 최대6,000/35,800, 선불2,000+별도 착불4,000/온라인31,800, 수량5 최소5,000/54,600, 무료 상품 포함 수량6 배송비0/59,600을 실제 주문서와 DB로 대조했다. 주문은 제출하지 않았다. |
| 후속 단건·템플릿·지역료 UI | 원상품 배정→자식 읽기 전용→원상품 명시 해제, 템플릿 출고지 이동+그룹 지정·배정 유지·명시 해제를 확인했다. 유지 모드는 개별료3,000→3,200 변경 중 배정 version/revision이 같았고, 해제 후에도 개별료3,200을 유지했다. 그룹 지역료는 두 상품의 기본료3,000+지역1,200을 한 번만 부과해 온라인24,200이었으며 상품별 기본1,500/지역600으로 배분됐다. 부매니저 지역 정책 입력 비활성도 확인했다. |
| 최종 재조회·정리 | 최종 재조회 (`output/shipping-cart-precheckout-browser-qa-20261015/readback-final-before-retirement.json`), 정상 비활성화 (`output/shipping-cart-precheckout-browser-qa-20261015/retirement-result.json`), 런타임 정리 (`output/shipping-cart-precheckout-browser-qa-20261015/runtime-cleanup.json`) 모두 `PASS`. 합성 계정3개·상품9개 정상 비활성화, 템플릿2개 중지·그룹2개 보관·배정 해제·수납 계약2개 중지·출고지3개 비활성화와 전역 설정 복원을 완료했다. 기존329개 표의 업무·저장소 행과 기존 Auth 행, 금전52개 표·재고·전체 원장·불변 정책을 보존했다. 주문·결제·환급·배송 생성0, 재고 변화0, 업로드0이며 소유 프로세스·포트4349·임시 폴더·자격 증명을 제거했다. |

첫 실행의 유효 수량 진단 (`output/shipping-charge-groups-browser-qa-20261015/cart-price-readonly-diagnostic-valid-qty.json`)은 상품 조건 조회가 구형 주문/배송 견적 경로에 들어가 `checkout_contract_upgrade_required`로 차단됐음을 보여준다. 당시 구매 버튼은 활성 상태였으며 이 실패 기록을 수정하지 않았다. 후속 사전 조회 분리와 실패 시 주문 진입 차단, 정상 복구가 최종 기록의 별도 증거다.

390px에서 관찰한 고객 요약·템플릿 모달·원상품 패널의 문서 폭과 스크롤 폭은390px였다. 원상품 하단 동작이 초기 자동 스크롤 위치에서 고정 막대와 일부 겹쳤지만 일반 추가 스크롤로44px 버튼 접근·hit-test·실제 그룹 선택기 클릭을 확인했다. Escape 닫기와 호출 버튼 포커스 복귀도 확인했다. native 모달의 마지막 Tab이 브라우저 UI로 이동하고 다음 Tab이 모달로 돌아오는 동작은 [WHATWG 순차 포커스 절차](https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation)의 범위이며 배경 페이지 포커스 누출로 판정하지 않는다. 전체 키보드 이동·엄격한 focus trap·접근성 인증을 통과했다는 뜻은 아니다.

남은 제한은 다음과 같다.

- 모바일 펼친 계산 내역의 설명 끝부분에 FAQ 플로팅 버튼이 일부 겹친다(캡처08·13). 신규 금액은 읽히며 필수 동작 접근 불가를 확인한 것은 아니다. 전체 페이지 캡처06·07·09의 중간 고정 헤더/내비게이션 흔적은 실제 레이아웃 결함 근거로 사용하지 않는다.
- 대문자가 들어간 합성 `otherOrigin` 상품 ID는 PDP 정규식에서404가 돼 같은 템플릿을 적용한 소문자 `fixed`와 `unassigned`로 고객 지역료를 검증했다. 원래 대문자 ID의 PDP 성공으로 기록하지 않는다.
- 342 당시 자식 구매정책 표시 제한 (`output/goods-sales-precheckout-qa-20261015/child-policy-display-evidence.json`)은 후속343에서 사전 조회 공통 함수에 한해 해결했다. 기존 문서의 잘못된 잔여 숫자 예시는 소스 기반이었고, 후속 격리 SQL·장바구니 서버 렌더링에서 실제9개→4개를 확인했다. 별도 레거시 `quote_goods_sales`의 표시 경로는 그대로이며 새 브라우저 검증은 하지 않았다. 같은 합산군을 여러 상품으로 선택하면 동일한 공유 잔여 수량이 각 행에 표시되며 서로 별도 한도가 아니다. 수량 허용 판정은 기존과 같이 원상품 정책과 합산 수량을 검사한다.
- 100/101개 선택 경계는 기존 SQL·클라이언트 근거를 유지하고 이번 브라우저에서 반복하지 않았다. 다른 운영자의 동시 수정 충돌·20개 초과 페이지 이동도 이번 UI 통과로 주장하지 않는다. 기본 그룹 교체·응답 유실 복구는 이전 실행의 성공 근거를 유지한다.

Auth 보존은 실행별로 구분한다. 첫 fixture `dc7025a3-83ca-4e2f-a56e-9882f71a7c91`에서는 localhost4320의 정상 refresh1회를 정확한 변경·요청 시각 증거 (`output/shipping-charge-groups-browser-qa-20261015/auth-refresh-proof-20261015-011915.json`)의 SHA-256 `fda117ec046f6b730e445fc9df476e70cd039e88b192fb048e8ee99f64492c6f`에 한정해 검토했다. 기존3행의 지정 필드 변경과 새 refresh token1행을 구분했고 다른 기존 Auth 행은 기준과 같았다. 원래 baseline을 유지했으며 기존 Auth를 되돌리는 쓰기나 추가 drift 허용은 없었다. 후속 fixture `bdfacb48-595f-4a68-90c6-d545b2ec3311`는 기존 Auth 행이 모두 정확히 같고 예외가 없다. 신규 Auth 행 소유권 검사는 `auth.users`·`auth.sessions`·`auth.refresh_tokens` 세 표에 한정하며 Auth 전체 schema에 신규 행이 없다는 주장으로 확대하지 않는다.

합성 상품·정책·배정·감사 이력과 참조 공용 사진은 보존한다. 후속 실행은 기존 합성 사진을 읽기 전용으로 재사용했고 새 업로드가 없다. 정리 시 남아 있던 견적5개를 삭제하지 않았지만, 이전7개 견적이 후속 조회에서0개가 된 것은 만료 시각과 기존5분 정리 계약에 부합한다. 자동 정리 원인은 추정이며 cron 실행 로그를 직접 확인하지 않았다. 견적의 영구 불변과 정책 버전의 불변을 혼동하지 않는다. 자격 증명·전용 서버 제거를 모든 합성 행·파일 삭제로 표현하지 않는다.

핵심 구현은 [그룹 migration](../../../supabase/migrations/20261020085408_shipping_charge_groups.sql), [템플릿 v3 migration](../../../supabase/migrations/20261020085410_shipping_settings_charge_groups.sql), [SQL 계약](../../../supabase/tests/shipping_charge_groups.sql), [템플릿 SQL 계약](../../../supabase/tests/shipping_settings_charge_groups.sql), [경합 검사](../../../supabase/tests/shipping_charge_groups_concurrency.py), [서버 조회](../../../lib/admin/shipping-charge-groups.server.ts), [서버 액션](../../../app/admin/shipping-charge-group-actions.ts), [그룹 관리](../../../components/admin/screens/ShippingChargeGroupsPanel.tsx), [상품 단건 배정](../../../components/admin/GoodShippingChargeGroupPanel.tsx), [대량 배정](../../../components/admin/shipping-charge-groups/ShippingChargeGroupAssignmentDialog.tsx)에 있다.

운영 배포·Preview 활성화, 실제 주문·결제·환급·물류사 호출, 원본 네이버의 모든 혼합 운임 조합과 동등성은 이 결과에 포함하지 않는다. 완료 근거가 없는 UI 항목을 SQL 검사만으로 실제 화면 통과로 표시하지 않는다.
