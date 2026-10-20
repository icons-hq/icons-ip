# 스마트스토어센터 조사·구현 대조

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

기준일: 2026-10-16. 사용자 요청은 네이버 전용 기능을 제외한 실제 쇼핑몰 운영 기능과 관리자 UI/UX의 이식이다. 페이지 처음/끝뿐 아니라 탭, 펼침, 선택창, 도움말, 미리보기, 작업 확인창의 독립 상태를 조사 대상으로 삼는다.

**전체 전수 조사와 이식은 아직 완료되지 않았다.** 아래 대조표의 완료는 적힌 기능 단위에 한정한다. 코드·SQL 검사, 격리 앱의 실제 화면 확인, 운영 배포를 구분한다. 원본의 저장/발송/환불/가입을 실행하지 않고 읽기와 실행 직전 상태까지만 확인했다.

2026-10-16~17 [전체 어드민 후속 구현](full-admin-implementation-20261016.md)에서 이전 판매5개·비판매13개 항목의 승인된 계약을 구현하고 로컬 검증했다. 구매확정·배송 중 접수·전체 주소/회수 정정·합포장·클레임비, 주문제작·수령 방식/설치비/보호 다운로드, 중복/배송비/지정 고객/카테고리 쿠폰, 등급·BEST 보상, 회원 행동 동의, 추가 리뷰, 메시지 쿠폰/본인 테스트를 포함한다. 상품·그룹 일괄 변경과 등록 화면의 최근 상품 복사 선택도 연결했다. 2026-10-19 [디지털 재다운로드·환불 심사와 선택 성별·10명 집계 정책](customer-demographics.md)도 구현·검증했다. 잠금 해제 후 원본 재조회와 Excel 실열람을 추가했으며 원본 모든 상태의 1:1 검증과 운영 배포는 별개다.

현재 통합 검증은 404개 migration·후속 SQL20개, 앱10,039개 테스트·타입검사·격리 빌드, 77개 메뉴의 PC/390px 총154개 렌더링이다. 아래351개 검증은 10월15일의 이전 기준선이며 후속 계약의 현재 상태와 구분한다. 메뉴 로드나 로컬 테스트를 모든 원본 저장 결과의 동일함 또는 운영 배포 완료로 해석하지 않는다.

2026-10-16 [REA 원본 캡처 기반 UI 정합화](ui-reproduction-20261016.md)는 셸·홈·상품 조회/수정·상품 등록·판매 목록·고객응대의 배치·서체·간격을 다루는 별도 후속이다. 이 후속의 검증 범위는 합성 fixture를 주입한 실제 컴포넌트의 PC 1440px/모바일 390px 표시와 로컬 검사·타입검사·격리 빌드이며, 실행별 결과와 한계는 해당 기록을 따른다. 이 UI 정합화 기록 자체는 실제 관리자 로그인·DB 저장·물류·운영 배포 검증이 아니다. 이후 실제 로그인과 새 업무 흐름의 검증은 위 전체 어드민 후속 기록에 별도로 모았다.

<!-- BEGIN final-local-verification-status -->
## 최종 검수 상태

2026-10-15 실제 UI 4개 범위와 검증용 데이터 은퇴·공유 실행 환경 정리를 완료했다. 각 결과의 미실행 범위와 관측 한계를 유지한다. **351 후속의 로컬 named 3대상 적용·재조회, 이번 독립 UI 후속 전 앱 검증과 새 빈 DB의 351개 순차 적용·지정 회귀 검증이 PASS**다. 개별 UI는 source350 실행 근거이며 이후 통합 검증을 대신하지 않는다.

| 범위 | 실제 검증 근거 | 결과와 남은 한계 |
| --- | --- | --- |
| 일반 리뷰 암호화 XLSX | [구현·SQL·로컬 적용](review-encrypted-export-implementation-qa.md), 실제 브라우저 결과 (`output/review-export-browser-qa-20261015/browser-result.json`) | PC/390px·실제 HTTP 파일5개·독립 복호화·16열 전체값·감사 대조·키보드·연결 실패 후 명시 재시도 완료. 실제 늦은 응답·409·비인가 발급·사진/BEST 행·사용자 Excel 열기는 미실행 |
| 자체 사진 장식 13종 | [구현·검증](product-photo-decorations-implementation-qa.md), 실제 브라우저 결과 (`output/product-photo-decorations-browser-qa-20261015/browser-result.json`) | 13종1280px 미리보기, PC/390px·저장/재열기·native4MP 합성1개·후보/저장16,000,000 RGBA 바이트 일치·실제 업로드 취소/늦은 결과 폐기 완료. 모든 장식의 native 저장·모든 실패 분기까지 검증한 것은 아니며 명시된 외부 Auth 변경 예외 유지 |
| 문의 답변 만족도 | 앱·SQL·DTO·경합 (`output/inquiry-satisfaction-implementation-20261015/implementation.md`), 로컬 적용 (`output/cs-metrics-named-qa-20261015/final-summary.json`), 실제 브라우저 결과 (`output/cs-satisfaction-browser-qa-20261015/browser-result.json`) | 고객 저장/변경/철회·관리자 필터/집계/이력·서버 도착 전 연결 차단과 동일 요청 재시도·두 탭 충돌·새 답변 초기화 완료. 커밋 뒤 응답 유실은 미실행. 공통 FAQ 겹침·로컬 실시간 재연결 안내를 기록하고 자동 실시간 갱신 통과로 세지 않음 |
| 리뷰 평점 3개월 전 비교 | [앱·SQL·로컬 적용](review-rating-history-implementation-qa.md), 실제 브라우저 결과 (`output/cs-history-browser-qa-20261015/browser-result.json`) | PC/390px·과거값/미수집/NULL/실패 구분·현재 목록 유지·합성 버전 cron HTTP7개 완료. 초기 hydration 오류와 이후 폰트 경고30건을 보존. 운영 v1 수집·월말/보존기간의 새 실제 브라우저 실행은 미실행 |
| 351 기준선 앱 검증 · 독립 UI 후속 전 | 통합 기록 (`output/final-smartstore-app-validation-20261015/final-validation.json`), 최종 빌드 (`output/final-smartstore-app-validation-20261015/build-final-351-copy-verified-npm/result.json`) | 문구 보완 전 전체 1,036 suite·9,845 tests PASS/5 skip. 이후 문구4파일 보완에 대해 집중32 tests·전체 typecheck·4파일 lint·새 빌드177페이지 PASS. 마지막 문구 수정 후 전체 suite를 다시 실행한 것은 아님 |
| 반품 1건 작업영역 | 구현·집중 검증 (`output/claim-return-workspace-implementation-20261015/manifest.json`), 실제 브라우저 결과 (`output/claim-return-workspace-browser-qa-20261015/browser-result.json`) | 기존 검토·회수·선택적 보류·환불 입력을 같은 인스턴스로 재배치했다. 초기 72개 검사와 철회 후 조작 차단 수정 뒤 48개 검사는 별도 실행이며 합산하지 않는다. PC/390px·명시 보기 포커스·활성 입력 보존·취소/교환 회귀의 실제 확인 범위와 한계: 1440/390px 네 단계 이동·키보드 포커스·운영 메모와 보류 사유의 미저장 입력 유지·취소/교환 배치 확인. 실제 회수·환불·보류 확정은 제출하지 않았다. 연락처 정정은 제한된 검증 서버의 기능 비활성 안내만 확인. 원본의 한 번 제출·자동 환불·비용 청구/공제 완료로 표시하지 않는다. |
| 회원별 방문 데이터 안내 | 문구 보완·43개 기존 검사·범위 lint (`output/smartstore-remaining-scope-audit-20261015/visit-data-copy-verification.json`), 목록·편집 실화면 (`output/claim-return-workspace-browser-qa-20261015/browser-result.json`) | 4파일·7문구에서 선택 동의한 익명 방문 집계와 회원별 방문 데이터 미연결을 구분했다. 숫자·세그먼트·RPC·수집·동의 변경은 없다. 실제 화면 확인 범위와 한계: 목록은 PC, 새 편집 화면은 PC/390px에서 확인. 선택 동의한 익명 방문 집계와 회원 데이터 미연결 설명을 확인했으며 저장·대상 계산은 실행하지 않음. |
| 이번 독립 UI 후속의 새 빌드·보존·정리 | 새 복사 앱 빌드 (`output/claim-return-workspace-browser-qa-20261015/build-result.json`), 기존 데이터 보존 (`output/claim-return-workspace-browser-qa-20261015/preservation-after-retirement.json`), 임시 운영자 회수 (`output/claim-return-workspace-browser-qa-20261015/operator-retirement.json`), 실행 환경 정리 (`output/claim-return-workspace-browser-qa-20261015/runtime-cleanup.json`) | 새 빌드 PASS·소스/의존성 보존·원래 `.next` 불변을 확인했다. 기존 사업행/Auth 보존: PASS, 기존 업무·Auth 행의 변경 0건, Auth 필드 무시 없음. 사전 기준선에 없던 신규 검증 운영자 1개의 소유 행만 별도 집계. 신규 검수 운영자 1개 회수: PASS. 소유 runtime·4363 정리: PASS. 이후 전체 9,845개 검사나 351개 DB 체인을 재실행했다는 뜻은 아니다. |
| 351 후속과 빈 DB 전체 검증 | [정식 migration](../../../supabase/migrations/20261020085422_operator_rpc_entry_guards.sql), named OWN283 (`output/operator-entry-guards-named-qa-20261015/plan-201e3600b4214d6eacaefa256e70610f/own-apply-result.json`)·FRESH316 (`output/operator-entry-guards-named-qa-20261015/plan-201e3600b4214d6eacaefa256e70610f/fresh-apply-result.json`)·CANON351 (`output/operator-entry-guards-named-qa-20261015/plan-201e3600b4214d6eacaefa256e70610f/canonical-apply-result.json`)·새 빈 DB 최종 감사 (`output/final-ordered-chain-351-qa-20261015/final-summary.json`) | 로컬3대상 실제 commit·readback PASS. 새 빈 DB의 migration351개 순서·SQL 원문·ledger와 직접 SQL66개·문의 만족도 전용 회귀를 모두 확인했다. 총67단계 PASS이며 문의 회귀는40 SQL assertions·실제 DTO4개·경합9개를 포함한다. 전체 CI workflow와 다른 개별 경합 harness를 모두 다시 실행한 것은 아님 |

첫 빈 DB 실행은 migration351개와 ledger 대조 후 59번째 통계 fixture에서 멈췄다. 기존 fixture가 운영자 취소·송금 증거 없이 환불 finalizer를 직접 호출해 정상 거절된 것이 원인이었다. 진단과 보정 (`output/store-analytics-refund-diagnostic-20261015/diagnosis-summary.json`)에서 해당 fixture만 정상 공개 RPC 흐름으로 고치고 직접 호출 거절 검사는 유지했다. 독립 clone의 RED→GREEN·후속60~67 검증 후, 새 lease에서 migration351개와 지정67단계를 처음부터 다시 실행해 모두 통과했다. ROOT 최종 감사 (`output/final-ordered-chain-351-qa-20261015/final-summary.json`)는 실제 적용 순서·현재 SQL 원문·ledger·저장 로그 해시, CANON baseline·원본 소스 보존, 기존 named 컨테이너 수명 유지와 소유 컨테이너·볼륨·네트워크·작업 디렉터리 정리를 확인했다. 최초 실패 기록과 fixture 보정 근거는 보존한다.

5개 scope의 은퇴 검토 (`output/shared-local-browser-qa-20261015/root-all-scopes-retirement-review.json`)와 공유 실행 환경 정리 (`output/shared-local-browser-qa-20261015/runtime-cleanup.json`)는 PASS다. 소유 자격 증명·fixture 폴더·runtime을 정리하고 포트4362 종료를 확인했다. 홈/다른 구성과 사진의 관측된 외부 Auth 변경 예외는 원본 실패·baseline과 함께 보존하며, 전 scope의 모든 Auth 행이 줄곧 같았다고 주장하지 않는다. 로컬 구현·검증은 운영 DB 적용·운영 배포·운영 관측 수집·라이브 결제/PG 자동결제 검증·실제 남양주/김포 WMS 인수 완료를 뜻하지 않는다. 이 운영 단계들은 별도 승인·실행·인수 근거가 필요하다.
<!-- END final-local-verification-status -->

## 상세 대조표

| 범위 | 정본 | 남은 기능·계약 경계 |
| --- | --- | --- |
| 상품·옵션·공지·문의·리뷰 | [상품·CS 대조표](catalog-cs-parity.md) | 사진 자동 수평·색조/강도·추가 도형의 실제 저장 검증 완료. 장식 자산과 고시 분류의 차이를 구분하며, 그룹상품은 옵션별 전환·영구 합산·공통 수정·공개 탐색/후기의 DB·실제 화면 검증 완료 |
| 주문·배송·클레임·정산 | [판매·정산 대조표](sales-parity.md) · [후속 분류](sales-remaining-scope.md) | 선물·복수구매 할인·착불/수량배송·정기배송은 공통 거래 모델과 로컬 SQL·실제 관리자/고객 화면 검증 완료. 무통장 송금 대기·완료와 회수/재배송 연락처3필드 정정·최종 재출고 주소 결속도 후속 검증 완료. 전체 주소/회수 정정·합포장·구매확정·배송 중 접수·클레임비는10/16 후속 검증 완료. 실제 PG 수집·은행 입금·세무 원본과 운영 활성화는 별도 |
| 스토어·혜택·마케팅·분석 | [스토어 대조표](store-parity.md) | 상품분류와 독립된 전시 트리의 실제 저장·공개/보관·충돌·복원과 다른 구성 상품의 실제 편성·공개 PC/390px 검증 완료. 회원 방문/검색어·외부 마케팅 계약과 집계 차이는 개별 문서에 구분 |
| 적립금 | [적립금 대조표](store-credit-parity.md) | 원본 Npay 지갑과 범용 적립금 계약의 차이 |
| 혜택 리포트 | [혜택 리포트 대조표](benefit-report-parity.md) | 쿠폰 실적과 적립금 실적의 별도 집계, 원본 필터 전체 동등성 |
| 배송정보 템플릿 | [배송 템플릿 대조표](shipping-template-parity.md) | 수량 구간·착불 정책의 명시적 복사/유지, 그룹 지정·유지·해제와 출고지 이동을 구현하고 실제 PC/390px·DB 재조회·정리까지 완료. 10/16 수령 방식·운임·설치비의 명시 적용과 고객 선택도 구현·검증 완료. 디지털 파일은 상품별 검증 업로드로 관리 |
| 배송비 묶음그룹 | [그룹 구현·검증](shipping-charge-groups-parity.md) | SQL104개·DTO17개·경합15개와 후속 사전 조회·편집기 검사, OWN274/FRESH307/CANON342 적용·최종 빌드 통과. 실제 관리자 배정/템플릿·고객 최소/최대/수량/착불/무료/지역료 견적과 정리 완료. 시각적·기존 표시 제한 및 미반복 범위는 전용 기록 참조 |
| 창고 출고 파일·운송장 회신 | [출고지시·회신 런북](../../runbooks/warehouse-export.md) | 남양주·김포가 양식 엑셀을 내려받아 자체 WMS에 입력한다. 운송장 발급·회수 접수·배송추적 API 자동화는 사용자 결정으로 제외. 기존 출력·회신 등록의 코드 검증과 두 창고의 실제 WMS 수용 확인은 구분 |
| 취소·반품 단위 | [확정 정책](partial-claims-contract.md) | 부분취소/부분반품은 사용자 지시에 따라 구현 대상에서 제외 |

## 후속 구현과 검증 문서

2026-10-15 물류 운영 결정에 따라 ICONS는 창고별 양식에 맞춘 엑셀을 제공한다. 운송장 발급·회수 접수·배송추적 API와 운송사 이벤트 기반 배송완료 자동 동기화는 구현 범위에서 제외하며, 공급자 API 확인 대기로 남기지 않는다. 기존 일반·김포·서원 양식과 회신 등록의 구현 상태는 위 런북을 따르고, 실제 남양주·김포 WMS의 입력 성공·업무 인수는 별도 확인 사항으로 남긴다.

[배송비 묶음그룹](shipping-charge-groups-parity.md)은 구현·격리 DB·관련 앱 검사·로컬 named 적용과 실제 PC/390px 후속 검증을 마쳤다. 첫 실행의 장바구니 구형 견적 오류와 후속 상품 편집기 변경 오판정을 수정하고, 원상품/자식 배정·템플릿 그룹 지정/유지/해제·고객 운임 견적을 재검증했다. 최종 기록 (`output/shipping-cart-precheckout-browser-qa-20261015/browser-evidence.json`)은 `PASS_WITH_DOCUMENTED_LIMITS`로21장 캡처·7개 재조회·정상 비활성화/런타임 정리를 포함한다. 주문·결제 생성과 재고 변화는0이고 후속 fixture의 기존 Auth 행은 예외 없이 보존했다. 첫 fixture의 localhost4320 정상 refresh 예외는 역사 기록으로 별도 보존한다. FAQ 설명 일부 겹침, 기존 자식 구매정책 표시 제한과 실제 UI에서 반복하지 않은 경계는 전용 기록에 남겼다.

초기 조사에서 미구현으로 적었던 아래 항목은 후속 구현·격리 검증을 마쳤다. 링크의 검증 범위와 미확인 상태를 함께 읽으며 원본의 모든 조합이나 운영 실행까지 완료한 것으로 확대하지 않는다.

- 상품: [동적 속성](goods-attributes-parity.md), [연관상품 편성](goods-relations-parity.md), [사진 보관함](photo-library-parity.md), [엑셀 카테고리 코드 찾기](category-code-finder.md), [원산지 국가·지역 찾기](origin-country-finder-proposal.md)와 [국내 상세지역](domestic-origin-region-proposal.md), [사은품·이벤트 안내/템플릿](product-benefits-parity.md), [옵션만 불러오기](goods-option-import.md), [직접입력형 옵션 엑셀 v6](goods-custom-input-workbook.md), [상품 사이즈 안내·템플릿](goods-size-chart-proposal.md), [A/S·사이즈 안내의 상품 엑셀 v7](goods-guidance-workbook.md). 판매기간과 복사 시 속성 보존은 [상품·CS 대조표](catalog-cs-parity.md)에 기록한다.
- 홈·상세 전시: [공통·상품목록](store-presentation-implementation-qa.md), [카테고리별 상품·배너·영상·추천상품](category-display-composition-proposal.md), [상세 표시](product-detail-presentation-implementation-qa.md), [구매유도·배송비 절약·관심모음](product-detail-experiences-implementation-qa.md), [영상·숏클립](product-detail-media-implementation-qa.md), [PDP 선정 BEST](product-detail-review-best-implementation-qa.md). 홈 상품형 베스트리뷰와 PDP 선정 BEST의 계약은 다르다.
- 쇼핑스토리·마케팅: [스토리 운영 계약](../../runbooks/shopping-stories.md)과 실제 검증 (`output/shopping-stories-qa-20261013/result.json`), [마케팅 링크](marketing-links-implementation-qa.md), [고객 세그먼트](target-segment-parity.md), [인앱 메시지·예약/반복](marketing-message-parity.md), [별도 선택 동의 기반 방문·결제 귀속](traffic-attribution-parity.md).
- 고객응대: [1:1 문의 이동·초안 복구](inquiry-navigation-drafts.md), [공유 답변 템플릿 관리](inquiry-reply-template-management.md), [리뷰이벤트](review-events-parity.md), [리뷰 6개 정렬과 모바일](review-sorting-parity.md). [공개 Q&A·리뷰·세 종류 템플릿 초안 복구](cs-editor-drafts.md)는 24시간·계정/로그인 세션 분리와 실제 Chrome 검증을 완료했다. [단건 답변의 원자 저장·미확인 요청 복구](cs-single-reply-cas.md)도 실제 충돌·오프라인 복구·API·공개 반영을 확인했다.
- 판매·정산: [주소 변경](order-address-changes.md), [상품주문별 목록](order-item-console.md), [클레임 철회](claim-withdrawal.md), [반품·교환 전환](claim-type-conversion.md), [보류/해제](claim-hold-contract.md), [교환 사유 정정](exchange-reason-change-contract.md), [발송지연 안내 필터](shipment-delay-notice-filter.md), [PG 정산 원장](pg-settlement-parity.md). PG 실제 운영 수집·실입금·세무 자료는 [후속 계약](pg-settlement-followups.md)으로 구분한다.
- 혜택·권한: [고객등급 정책](loyalty-policy-parity.md), [혜택 리포트](benefit-report-parity.md), [적립금 지급/원장](store-credit-parity.md), [매니저 권한·초대](manager-implementation-qa.md). 쿠폰 기간 분리와 상대 만료의 후속 검증은 아래 기록을 따른다.
- 고객 구매 분석: [180일 신규/재구매 집계·마감 주/월·13개 추이](customer-purchase-analysis-plan.md)를 기존 고객현황과 별도로 구현했다. 실제 Chrome의 월간·주간·390px와 3종 다운로드 파일 전체2,025셀 대조를 완료했다. 성/연령 조합·원본 엑셀과의 동일성은 포함하지 않는다.
- 상품·스토리 본문: [인용·구분선·링크 도구](goods-description-tools.md)와 [상품 HTML 서식](content-formatting-implementation-qa.md)의 선택 위치·한도·URL 검사·실제 저장/공개 PC/390px를 확인했다. [스토리 서식·개인 본문 템플릿](body-format-templates-implementation-qa.md)도 문단/선택 서식, 계정별 50개·보관/복구, 선택 삽입·확인 후 전체 교체·원문 되돌리기, 상품/스토리의 서로 다른 링크 규칙과 실제 저장·공개 표시를 검증했다. 제목·기간·관련상품은 템플릿 적용 대상이 아니다.
- 상품 사진: [자르기·회전·반전·색온도·모자이크·일반 텍스트](product-photo-editor-implementation-qa.md)를 실제 PC/390px와 저장·재조회로 확인했다. 공유 원본·alpha 보존, 미리보기/저장 픽셀, 네트워크 실패·업로드 취소·늦은 응답 차단·폰트 실패 복구를 검증했다. [선명도·중앙 원형/선형 블러·비네팅](product-photo-effects-implementation-qa.md)도 자체 계산 계약으로 구현했으며 독립2D 계산·행 버퍼 검산과 실제 검증 범위를 별도 기록한다. [자동 명암·단색 안쪽 테두리·원형/둥근 사각 마스크](product-photo-presentation-implementation-qa.md)는 구현·회귀를 마쳤으며 실제 Canvas·저장·4MP 검수 상태는 별도 기록한다. [로컬 로고·이미지 서명 한 장](product-photo-logo-implementation-qa.md)은 단일 후보 교체·실패 보존·배치와 실제 PC/390px·저장/재열기·4MP 합성을 검증했다. 독립 source-over 검산의 부분투명 양자화/보간 경계 한계는 해당 QA에 기록한다. 원본 알고리즘·수치 범위의 동등성을 뜻하지 않는다.
- 클레임 상세: [처리 현황 요약](claim-progress-summary.md)에서 처리·보류·회수·환불/교환 배송을 별도 기록으로 표시하고 기존 영역으로 연결한다. 실제 세 유형과390px·키보드 이동을 확인했으며 새 DB/거래 액션은 없다.
- 기존 통계: [판매·클레임·고객현황의 전년 동일 날짜 비교](stats-year-comparison.md)를 추가했다. 2026-10-14 개별 검증에서 66테스트, 실제 PC/390px, 다운로드 6개·58시트·3,858셀을 확인했다. 비교 없음·직전 링크·KST·IP·주/월·조회366일과 기존 산식을 유지하고 윤일 보정·파생367일을 화면/엑셀에 같은 날짜로 표시한다. 이 기록의 코드 15파일 SHA-256은 2026-10-14 06:02 KST에 일치했으며, 전체 작업 트리의 최종 통합 검증과 구분한다.

남은 항목은 **기존 계약 안의 일반 기능**, **정책·거래·수집 계약을 먼저 정할 기능**, **네이버 제공자 전용 제외**로 나눈다. 사진의 [자동 수평](product-photo-straighten-implementation-qa.md)과 [색조 필터·강도·추가 도형](product-photo-filters-implementation-qa.md)은 실제 저장·재열기·400만 픽셀 합성·취소 검증까지 마쳤다. 자체 액자2종·말풍선2종·텍스트 서명3종·스티커6종은 [사진 장식13종](product-photo-decorations-implementation-qa.md)으로 구현하고 집중 검증을 마쳤다. 실제 PC/390px·저장/재열기·native4MP 합성1개와 최종 후보/저장 이미지 검수까지 마쳤으며 [최종 검수 상태](#최종-검수-상태)의 실행 범위·보존 한계를 유지한다. 원본 자산·서체·전체 디자인의 복제는 포함하지 않으며 자동 얼굴 모자이크는 사용자 결정으로 제외한다. 색온도·수동 모자이크·일반 텍스트·선명도·원형/선형 블러·비네팅·자동 명암·단색 테두리·원형/둥근 사각 마스크·로컬 로고 한 장은 구현된 도구로 분리한다. [사진 잔여 제안](product-photo-remaining-tools-proposal.md)은 일반 도구와 원본 전용 자산을 구분하며, 자동 얼굴 모자이크는 미확인/승인대기가 아닌 확정 제외로 기록한다. [대표이미지](store-profile-parity.md)와 [적립금 CSV/XLSX 파일 입력](store-credit-parity.md)의 실제 PC/390px 검수는 마쳤다. 측정항목 재사용은 기존 사이즈 템플릿으로 가능하며, 속성 엑셀·보관함 폴더/태그는 원본에서 확인된 필수 누락으로 세지 않는다([현재 모델 재대조](remaining-general-work-reclassification.md)). [고객센터 노출위치 안내](store-profile-parity.md)는 원본의 안내창을 재확인하고 PC/390px에서 검증했다. 국가·지역 명칭 검색과 [홈 배너 세부 표시](home-promotion-banner-parity.md)와 [자유상품 리스트·풀이미지](home-free-products-contract.md)는 구현·격리 검증을 마쳤다. 2026-10-14 사용자가 선물 주문·복수구매 할인·착불/수량별 배송비·정기배송을 모두 포함해 설계·구현을 계속하도록 확정했다. 해당 공통 거래 모델과 SQL·실제 로컬 고객/관리자 화면 검증을 마쳤고 검증용 계정·상품과 런타임을 정리했다. [설계](goods-transaction-module-proposal.md)와 [운영 절차](../../runbooks/goods-transactions.md)를 따르고 운영 배포와 실제 결제 실행은 별도 승인 경계로 유지한다. 부분취소·부분반품의 확정 제외는 유지한다.

2026-10-14 사용자는 [그룹상품](group-product-conversion-contract.md)을 기존 옵션별로 별도 상품을 만드는 방식으로 확정했다. 기존 주문·옵션 정체성·재고·ERP 이력과 원상품의 합산 조건을 유지하는 전환을 구현했다. 공통 편집·해제/재구성·목록 펼침·공개 상세 이동/후기와 합산 주문서 금액·한도 차단을 SQL와 실제 PC/390px에서 검증했다. 합성 상품은 재고를 보존한 비공개 초안으로 남기고 임시 계정·서버·전역 설정을 정리했다. 운영 적용·배포는 실행하지 않았다.

카테고리·A/S 템플릿은 [카테고리](product-category-templates-parity.md)와 [A/S 안내](product-after-sales-parity.md)에 구현·검증 결과를 기록했다. 판매 조회의 결제일·검색 대상·구매자 열은 [후속 대조](sales-read-contract-gaps.md)를 따른다.

[회수·재배송 연락처 정정](claim-contact-correction-proposal.md)은 이름·전화·상세주소의 암호화 저장, 변경 이력, 응답 유실 복구와 최종 재출고 주소 결속을 구현했다. 실제 관리자·구매자·선물 수령인/발신자의 PC·390px 화면과 발신자 응답의 개인정보 비노출을 확인했다. 검증 계정4개와 전용 서버·키를 정리하고 기존 주문·결제·배송 원본과 재고를 보존했다. 기존 로그인 세션의 토큰 갱신은 별도 근거로 구분하며, 전체 주소 변경·물류 연동·운영 활성화는 포함하지 않는다.

[시간대별 판매조회](sales-hourly-read-proposal.md)는 완료 KST 정시까지 주문수·매출과 누적·비교일, 오늘/직전 1시간 상품TOP10을 제공한다. 실제 12개 상태의 2,095셀을 DB와 대조했다. 기존 주문 생성시각·현재 유효 상태를 유지하며 IP는 상품순위에만 적용한다. 전용 엑셀과 미수집 방문 지표는 포함하지 않는다.

[쿠폰 발급 건별 읽기 상세](coupon-issuance-read-detail-proposal.md)는 구현·격리 로컬 검증을 완료했다. 기존 발급 원장과 현재 결제 사용 집계 여부를 같은 권한·기간·조건으로 페이지와 엑셀에서 확인한다. 원본의 지급현황/상세 진입 안내와, 조회 결과가 없어 확인하지 못한 실제 상세 열은 계속 구분한다. 운영 적용·배포는 별도다.

[홈 프로모션 배너](home-promotion-banner-parity.md)는 10개 한도·선택형 문구·대체텍스트·링크 없음·동시 수정 충돌과 공개 PC/모바일 재조회를 검증했다. [이미지 딤/텍스트색·배너 삭제와 비노출 복구](home-banner-style-archive-parity.md)도 실제 PC/390px와 DB 경합을 검증했다. [신규/재구매 분석](customer-purchase-analysis-plan.md)은 별도 집계로 구현하고 실제 Chrome·모바일·전체 엑셀 대조를 마쳤다.

[다른 상품 옵션 불러오기](goods-option-import.md)는 원본/대상 변경 재확인·기존 재고/ERP/주문 보존·신규 재고0·옵션가 선택·로컬/서버 초안 복구·실제 저장을 검증했다. [클레임 상세검색](claim-detailed-search.md)은 수취인·품목/상품번호 조건을 목록·단계 건수·전체 품목 엑셀에 같은 기준으로 적용한다.

[상품공지 중요기간·홈 팝업](goods-announcement-period-popup-proposal.md)은 실제 PC/390px 저장·공개 홈/PDP 반영·자동 종료·오늘 숨김·동시 선택 충돌·오프라인 요청 복구를 확인했다. [스토어 대표 이미지](store-profile-parity.md)는 실제 파일 선택·정사각형/크기 오류·저장·삭제·정상 복원과 공개 PC/390px 표시를 검증했다. 원본의 모든 저장 분기·네이티브 앱 검증과 구분한다.

## 공통 UI와 홈

| 표면 | 현재 연결 | 남은 확인 |
| --- | --- | --- |
| 전체 셸 | 55px 짙은 상단, 210px 메뉴/64px 접힘, 본문 패딩 12px 24px, 모바일 메뉴, 메뉴 검색·즐겨찾기·계정 메뉴, 화면 제목/위치 | [10/16 REA 정합화](ui-reproduction-20261016.md)의 표면별 범위와 모든 메뉴·상태의 전수 검수를 구분 |
| 운영 목록 | 검색 라벨 행, 빠른 기간, 상태 집계, 결과 도구, 공통 열 표시·순서·폭·고정, 내부 스크롤/페이지 | 각 원본 목록의 전체 열 및 모든 필터 조합 |
| 버튼·색상·가독성 | 로컬 Pretendard 1.3.9, 원본 실측 검색색 `#00c73c`·테두리 `#00ae34`, 판매 요약·선택 글자와 상품 설정 선택 라벨의 대비 보정, 900px 이하 CS 조작 최소 44px | [현재 스타일 규율](../../../DESIGN.md#판매자센터-기준-2026-10-16)과 신규 기능별 실제 화면 검수를 구분 |
| 상품 입력 | 74px 섹션 머리·34px 펼침 표시·180px 라벨 열, 섹션 접기/요약, 오류 이동, 고정 저장, 미저장 입력 복구, 미리보기 | 원본의 모든 독립 입력 분기와 저장 후 상태 |
| 상품 조회·상품 문의 | 상품 상세검색은 검색/초기화 하단 영역에서 펼침. 상품 문의는 검색 조건 펼침과 목록형/표형 전환(기본 목록형)을 제공 | 기존 조회조건·열 설정·답변 동작은 유지하며 모든 조건 조합과 실제 답변 저장의 재검증은 별도 |
| 홈 | 60px 공지 행, 6열 요약의 첫 행 4:2·다음 행 3:3, 64px 카드 머리·18px 제목·32px 아이콘. 실제 주문/매출·응대 집계, 문의/리뷰 작업 진입, 데이터 실패 구분. 제한 역할은 허용 업무 바로가기와 CS만 조회 | 일반 아이콘 4개의 [출처·해시](../../../public/admin/seller-icons/source.json) 유지. 기존 역할별 실제 Chrome 검수와 10/16 합성 UI 검수는 별도이며 원본 진단 전체 축은 대조표에 남김 |
| 오른쪽 업무 도구 | 72px 레일·40px 너비/최소 70px 높이 버튼, 알림 읽음/숨김/복원·개인 설정·페이지 조회, 실시간 할 일 수, 현재 화면 도움말 검색/본문 | 2026-10-13 실제 Chrome: 검색/본문, 30→60개 추가조회, 유형별21건 읽음, 숨김/복구, 설정 저장/reload, Escape 포커스 복귀, 390px 패널 확인. 10/16 배치 변경의 근거는 별도 기록 |

일반 콘솔과 전시 편집기를 같은 폼으로 취급하지 않는다. 전시 편집기는 구성 목록·입력 패널·모바일/PC 미리보기·노출 순서를 별도로 구현하고 검수한다. 공개 쇼핑몰의 White Catalog 스타일은 관리자 레퍼런스 색을 전역으로 전파하지 않는다.

## 쿠폰 기간 확장

- 발급기간과 사용기간을 분리하고, 고정 사용기간 또는 발급일+N일의 KST 마지막 시각까지 쓰는 1~365일 만료를 지원한다. 365일은 ICONS의 입력 상한이며 원본의 검증되지 않은 상한과 동일하다고 주장하지 않는다.
- 사용 시작 전에도 쿠폰함에서 코드로 발급받는다. 카트 선택과 발급을 분리한다. 발급 종료 후에도 보유 쿠폰의 사용기간은 유지한다.
- 분리형 쿠폰의 보유 시작/만료를 스냅샷으로 저장하므로 발급기간 수정·기간형/상대형 전환이 기존 보유분을 바꾸지 않는다. 중지는 기존처럼 사용도 중단한다.
- 기존 쿠폰·고객 대상·등급·취소 복구·발급 한도 경합을 SQL로 회귀 검증했다. 2026-10-13 실제 Chrome에서 기간 유형 전환의 입력 보존, 고정·상대형 저장, 사용 시작 전 쿠폰함 발급, 발급 후 정의 기간 변경에도 보유 시작/만료 유지, 3일 상대형의 KST 만료를 확인했다. 쿠폰함에는 시작·종료 시각을 KST로 표시한다.

## 증거와 검증 경계

원본 캡처/DOM/해시는 로컬 `output/smartstore-reference-20261012/`에 보관한다. 원본의 개인·주문·계좌정보를 코드, 테스트 데이터, 이 문서에 복제하지 않는다. `accepted: false` 캡처와 로딩 중 화면은 해당 동작의 완료 근거에서 제외한다. 캡처 파일 수를 독립 기능의 조사 완료 수로 환산하지 않는다.

일부 초기 홈 탭·알림 탭 캡처는 선택 상태만 확인했고 본문 로딩 완료를 확인하지 못했다. 해당 캡처를 전체 내용 확인의 증거로 사용하지 않는다. 원본에 결과가 없는 목록, 파일 입력이 필요한 화면, 최종 저장 뒤에만 열리는 상태도 미확인으로 남긴다.

실제 앱 검수는 합성 회원·상품·주문을 사용하는 별도 Supabase와 로컬 앱에서 수행한다. 기존 개발 DB를 초기화하지 않았고 운영 DB·배포·외부 메시지 발송을 실행하지 않았다. 2026-10-13 사용자가 Mac 잠금과 확장 팝업을 해제한 뒤 실제 화면 검증을 재개했다. 파일 업로드 권한도 사용자가 직접 허용했고, 소유한 격리 프로젝트의 데이터를 보존하며 Storage를 기동했다. SQL/단위 검사로 실제 화면 검증을 대체 완료 처리하지 않는다.

## 이전 통합 검증 기록 (2026-10-12)

아래 수치는 2026-10-12 당시 코드 기준이다. 이후 기능의 검증은 위 개별 문서를 따르며, 이 이전 실행을 현재 작업 트리 전체의 최종 통합 검사나 운영 반영 근거로 사용하지 않는다.

| 검사 | 결과와 범위 |
| --- | --- |
| 전체 Vitest | 6,208 통과·3 건너뜀. 기존 비공개 커뮤니티 조건 2개와 별도 opt-in 결제 HTTP 통합 1개는 기본 실행에서 제외됨 |
| 타입 | `npm run typecheck` 통과 |
| 린트 | 오류 0. 기존 `hong-sil-downloader.mjs`의 미사용 변수 경고 1개. 이후 변경한 파일의 개별 린트도 통과 |
| 빌드 | 운영 `.env` 없이 별도 복사본·격리 DB 설정에서 기본 `npm run build` 통과. 빌드 입력과 당시 코드 해시 일치 |
| DB 순차 적용 | 검증용으로 새로 만든 별도 프로젝트에서 당시 전체 migration+seed 적용 통과. 당시 신규 migration 20개 포함 |
| 신규 SQL | 새 DB에서 19개 파일 전부 통과. 기존 쿠폰/등급/대상/복구/주문 기대값 회귀 6개와 마지막 1장 동시 발급 경합도 별도 통과 |
| 실제 앱 서버 | 합성 관리자 로그인으로 메뉴·신규 등록·업무 API 58개 대상 HTTP 200 확인. 결과 (`output/smartstore-reference-20261012/verification-root/http-readback.json`). UI 동작·시각 검증을 의미하지 않음 |
| 실제 Chrome | 잠금 전 저장·읽기·모바일을 확인한 범위만 상세 대조표에 기록. 기존 검수 이미지/해시 (`output/smartstore-reference-20261012/verification-root/manifest.json`)는 후속 변경의 화면 검증을 대신하지 않음 |

## 2026-10-13 재개 후 확인

- 업무 도구: 도움말 검색과 상세 링크, 알림 30→60개 조회, 상품문의21건 일괄 읽음과 다른 유형52건 보존, 개인 숨김/복구·건수표시 설정 저장/reload, 닫기/Escape 포커스 복귀를 실제 앱에서 확인했다. 모바일 스크롤바로 좌측10px가 가려지는 결함을 수정하고 390px에서 패널 시작56px·폭334px·내부 넘침없음을 재검수했다.
- 쿠폰: 고정 기간과 발급일+3일 저장·발급, 미래 사용 시작 전 발급, 관리자 정의 변경과 보유 기간 분리를 실제 UI/DB로 확인했다. 10월13일 발급한 상대형은 10월16일 23:59:59.999 KST 만료다. 화면과 SHA-256 (`output/smartstore-reference-20261013/verification-root/manifest.json`).
- 배송정보 템플릿: 실제 저장/재조회, v1 미리보기 중 v2 저장 충돌 시 선택 보존과 미적용, 최신 v2 재선택 후 2상품 적용을 확인했다. 구매제한은 복수등록 미리보기의 중복·운영계정·미존재 제외, 해제와 동일 요청 재실행 시 재제한되지 않음을 확인했다. 복수등록 UUID를 해제 입력에서 잘못 거절하던 검증을 수정했다.
- 브랜드·BEST·베스트리뷰: 텍스트/SNS 저장·공개/숨김, 판매기간 탭/기본값, 리뷰3개일 때 숨김·4개 순서·리뷰탭 연결, 전체 순서/숨김은 실제 검증했다. 이미지 로고의 Storage 업로드·공개 PC/모바일 선택과 CS 템플릿/페이지 경계/50건 답글·실패 복구도 실제 검증했다.
- 사진 보관함은 공용 업로드·두 상품 재사용·보관/복구·참조 차단·390px 검수를 완료했다. 판매자 반품·교환 대리접수는 실제 저장·실패 입력 보존·모바일 및 DB 멱등 재조회 검수를 완료했다. 주문·결제 상태와 환불 원장이 접수만으로 변하지 않음을 확인했다.
- 상품 등록 임시저장: 개인별 최근40건·이미지 보존·검색/불러오기·삭제/복구·동시 수정 충돌·등록 완료 소비를 구현하고 SQL·실제 UI·390px를 검증했다. [범위와 근거](catalog-cs-parity.md#상품-등록-서버-임시저장-2026-10-13).
- 공개 메뉴는 노출/순서/이름 설정·기능 게이트·PC/모바일 재조회를 완료했다. 20자 긴 메뉴명의 넘침도 수정했다.
- 리뷰 분석은 신규/평균·내부 사진 비중·배송완료 작성률·저평점/미답글 진단을 구현했다. 집계·권한·시간 경계·검색/페이지 SQL과 독립 검토를 통과하고 실제 Chrome 필터·해당 상품 리뷰 연결·390px 화면을 확인했다. [범위와 남은 차이](catalog-cs-parity.md#리뷰-분석-구현검증-2026-10-13).
- 리뷰이벤트는 등록/대상·기간·배너, 신규 구매 리뷰 자동 응모, 별점과 무관한 수동 선정, 원자적 발표/적립금 지급, 회수와 공개 이력을 구현했다. 실제 UI에서 부매니저 등록·선정, 고객 1점 리뷰, 정매니저 1,000원 지급/회수와 잔액 1,001→2,001→1,001원을 확인했다. 목록/응모 XLSX는 같은 필터·정렬의 전체 결과, 개인정보 최소화·10,000행 한도·변경 재검사·감사를 적용하고 PC/390px 다운로드와 파일 재열기를 확인했다. [계약과 검증](review-events-parity.md). 네이버 포인트 자동 지급과 원본 엑셀 열의 동일함은 완료로 세지 않는다.

원본 고객등급 하위 조사를 추가했다. 금액 기준 프리셋(1·5·10·20·30·50·100만원/직접설정), 횟수 기준(1·2·3·5·10회), 실버의 중복/장바구니/배송비 쿠폰·적립금 분기와 정률/정액, 도움말3개와 적립 기준을 확인했다. 원본의 횟수는 주문 건수가 아니라 상품주문번호 기준이다. GOLD→SILVER, VIP→GOLD, VVIP→VIP 선행 조건도 확인했으나 선행 정책 확정 없이 상위 등급 본문은 열 수 없어 미확인으로 남긴다. 원본 최종 저장은 하지 않았고 reload로 미저장 선택 폐기를 확인했다. 추가 원본 증거 (`output/smartstore-reference-20261013/root/manifest.json`).

위 항목의 확인은 전체 전수 조사·전체 이식 완료를 뜻하지 않는다. 남은 원본 하위 상태와 각 대조표의 범용 미구현 기능을 계속 처리한다.

## 매니저 권한 구현·검증 (2026-10-13)

통합 매니저·계정 주매니저·계정 부매니저·인플루언서·대행사·물류출고관리의 업무 권한을 메뉴·홈·도움말·로더·액션·RPC·테이블/Storage 정책에 연결했다. 최초 역할 지정은 기존 운영자 전원을 명시적으로 배정하며, 신규 raw staff/admin은 호환 권한을 받지 않는다. 실제 합성 계정으로 부매니저 상품·분류·브랜드 저장, 인플루언서 주문 읽기, 물류 상품공지 저장, 대행사 CS 알림만 노출, 주문 URL 차단, 주매니저 등급 정책 저장을 확인했다. 역할별 검수 (`output/admin-manager-mixed-qa-20261013/result.json`), 홈·알림·기존 세션 회수 (`output/smartstore-reference-20261013/verification-operator-access/manifest.json`).

이메일 초대는 7일 유효기간, 일괄 최대10명·유효 대기 포함1000명, 확인된 동일 이메일 수락, 재초대 시 이전 링크 무효화, 발송 재시도, 역할 변경·회수·승계를 별도 기록한다. 격리 앱에서 최초 활성화→초대 저장→로그인 복귀→수락→역할 변경→승계 왕복→담당업무 변경→회수→기존 세션 차단을 실제 확인했다. 공급자 외부 발송은 0건이며, 운영 활성화·초대 발송을 수행한 결과가 아니다.

회원 상세의 제재 가능 여부와 실제 등급은 전용 최소 조회로 읽는다. 타회원 프로필 직접 읽기 실패를 WELCOME으로 표시하던 경로는 제거했으며, 회원 제재는 통합/주매니저에게 승계·역할 변경을 선행하도록 요구한다. [결정](../../adr/0020-store-manager-capabilities.md), [운영 절차](../../runbooks/operator-access.md).

## 고객 요청 철회와 주문 후속 보완 (2026-10-13)

[배송지 변경](order-address-changes.md), [상품주문별 목록](order-item-console.md), [고객 요청 철회](claim-withdrawal.md), [반품·교환 전환](claim-type-conversion.md)을 각각 독립 계약으로 구현·검증했다. 철회는 거절과 다른 종결 단계로 고객/관리자 실제 저장 및 PC/390px 이력, 12개 실제 DB 잠금 경합을 통과했다. 20:30 전체 앱 테스트는 6,723개 통과·통계 가이드 coverage 1개 실패였으며, 가이드 수정 후 18개 관련 검사가 통과했다. 20:35 전체 빌드도 통과했다. 이후 유형 전환은 17개 실제 잠금 경합, 관련 73개 앱 테스트, PC/390px의 두 방향 저장·고객 이력과 계좌 파기 경합을 추가 검증했다. 이 기록은 남은 물류 후속 처리·선물·PG 운영 수집/실입금/세무 계약을 포함한 전체 이식 완료나 운영 배포를 뜻하지 않는다.

## 암호화 엑셀의 검증 상태 (2026-10-14)

[판매 목록·거래확정 엑셀 암호화](encrypted-xlsx-plan.md)는 현재 권한/소유권·감사 해시·실제 HTTP와 Chrome 다운로드 3개를 검증했다. 파일의 독립 암호/HMAC 검증, 반품 105행, 다른 비밀번호로 재발급한 거래확정 2주문의 기록 내용 일치를 확인했다. 390px 암호 창과 Mac Excel16.113.3에서 같은 다운로드3개 열기, 잘못된 암호 거부, 시트·행수·합계와 저장 없이 닫은 뒤 파일 SHA 보존까지 확인했다. 네이티브 검증 (`output/smartstore-reference-20261014/encrypted-xlsx/native-excel-verification.json`)의 세 파일 범위이며 모든 양식·Excel 플랫폼의 호환성을 뜻하지 않는다.

## 2026-10-14 중간 통합 검증

검증 스냅샷과 파일 해시 (`output/integrated-verification-20261014/patched-baseline.json`)는 고객 구매분석·자유상품·제조국 찾기·직접입력형 엑셀 v6·암호화 엑셀까지 포함한다. 이후 교환 사유 정정·배너 후속 변경은 이 결과에 포함하지 않는다.

- 독립 앱 사본에서 845개 테스트 파일·7,173개 검사 통과, 기본 조건상 3개 검사 건너뜀. 타입 검사·145페이지 생성 빌드 통과. 린트 오류0·기존 다운로드 스크립트의 미사용 변수 경고1이다.
- 새 독립 DB에서 `20261013175522`까지 296개 migration을 순서대로 적용하고 전체 ledger 원문·SHA를 대조했다. 기능/권한 SQL13종과 보안 advisor 오류0·경고0을 확인했다. 기존 DB의 reset은 하지 않았다. DB 스냅샷 (`output/final-migration-chain-qa-20261014/current-result.json`).
- 기존 의존성의 보안 패치를 적용했다. Next.js·eslint-config-next16.3.8, sharp0.35.5, Vitest4.1.11, js-yaml4.3.2와 허용 범위의 brace-expansion/source-map-js 패치다. [Next 공식 릴리스](https://github.com/vercel/next.js/releases/tag/v16.3.8), [Vitest 공식 권고](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), [js-yaml 공식 권고](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
- 실제 설치 후 운영 의존성 감사0건이다. 개발 의존성은 ESLint의 `braces <=3.0.3` 문제 하나가 상위 패키지까지 5개로 보고되며 호환 가능한 수정 버전이 없어 남겼다. 자동 권고의 Next14 계열 강등은 적용하지 않았다. 운영 감사 (`output/smartstore-reference-20261014/encrypted-xlsx/npm-audit-production-patched-installed.json`), 개발 포함 lock 감사 (`output/smartstore-reference-20261014/encrypted-xlsx/npm-audit-full-patched-lock.json`).

운영 자격 증명이 없는 별도 빌드 사본과 합성 로컬 DB에서 확인한 결과다. 운영 배포·운영 데이터 검증·최종 사용자 인수를 의미하지 않는다.

## 2026-10-14 05:27 통합 검증 스냅샷

현재 검사 결과와 원문 로그 (`output/integrated-verification-20261014/current-baseline.json`)는 국내 원산지 도우미·공지 기간/홈 팝업·CS 단건 답변 복구까지 포함한다. 별도 사본에서 863개 테스트 파일의 7,303개 검사가 통과하고 3개를 기본 조건상 건너뛰었다. 타입 검사·146페이지 생성 빌드와 린트 오류0을 확인했다. 기존 다운로드 스크립트 경고1은 유지한다. 운영 환경 파일·자격 증명·원격 제공자 실행은 포함하지 않았다. 이후 전년 비교 등 후속 변경에는 개별 검증을 적용하며 이 스냅샷을 전체 이식 완료로 표시하지 않는다.

새 빈 DB 전체 304개 순차 적용 (`output/final-ordered-chain-304-qa-20261014/final-result.json`)도 완료했다. migration 원문·실제 순서·ledger SHA와 직접 SQL52개/기존 회귀167개(총219개)를 검증했다. 상품 임시저장의 선택 revision 기본값 손상을 후속 migration으로 고쳤으며 기존 적용 파일은 유지했다. 기존 로컬 DB를 초기화하지 않았고 이 검증용 새 컨테이너·볼륨은 제거했다. DB lint 오류는 없었고 기존 73개 함수의 warning124개는 별도 기록으로 남긴다. 이 통합 실행에서 개별 동시성 스크립트나 브라우저 검증을 반복한 것은 아니다.
