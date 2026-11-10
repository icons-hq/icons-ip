# 카테고리별 상품속성

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 현재 작업 트리와 격리된 로컬 Supabase·Chrome 검증 기준이다. 운영 적용·배포는 하지 않았다.

## 원본에서 확인한 범위

일반 상품 등록의 카테고리별 속성은 원본 속성 화면 (`output/smartstore-reference-20261012/product-form-50-category-attributes.jpg`)에서 확인했다. 그룹상품의 표준 판매옵션과 상품속성 연결은 별도 계약이다. 피규어 속성 잠금 (`output/smartstore-reference-20261013/group-attributes/01-figure-attributes-locked.png`), 판매옵션 안내 (`output/smartstore-reference-20261013/group-attributes/03-sales-option-guide.png`), 공통 속성 선택 제한 (`output/smartstore-reference-20261013/group-attributes/04-common-attribute-block.png`), 상품별 주요정보 (`output/smartstore-reference-20261013/group-attributes/05-per-product-major.png`)를 직접 읽었다. 원본 저장·일반상품 전환·그룹 전환은 실행하지 않았다.

ICONS에는 운영자가 직접 정의하는 범용 상품속성을 구현했다. 네이버 전체 카테고리 사전·추천값·고시 스키마·검색 노출 규칙을 가져오지 않으며, 이번 범위에 그룹상품을 포함하지 않는다. 그룹 대표상품은 검색어·정렬 기준에 따라 자동 선정된다는 원본 안내 (`output/smartstore-reference-20261013/group-attributes/07-group-exposure-contract.txt`)를 따른다. 이를 관리자가 임의로 대표상품을 고르는 기능으로 해석하지 않는다. 원본 30일 전환 제한도 ICONS 정책으로 도입하지 않았다. 원본 캡처의 SHA-256은 manifest (`output/smartstore-reference-20261013/group-attributes/manifest.json`)에 기록했다.

## ICONS 계약

- `/admin/catalog/attributes`에서 admin이 활성 말단 고객 카테고리별 항목명·유형·필수 여부·숫자 단위·선택값·항목 순서를 정의한다. 최대 30항목, 선택형은 항목당 최대 100선택값이다. 다른 카테고리의 정의를 불러올 때 항목·선택값 ID를 유지하므로 호환되는 항목의 상품 값을 연결할 수 있다.
- 대표 카테고리 하나의 정의를 사용한다. 추가 카테고리·ERP 분류·상위 카테고리 정의를 합치지 않는다. 상품 편집은 staff/admin 모두 가능하며 상품 기본 저장과 함께 속성을 반영한다.
- 단일 선택·복수 선택·텍스트·숫자를 지원한다. 텍스트는 500자, 숫자는 절댓값 10억 이하·소수점 6자리까지다. 정의와 값은 서버에서 다시 검증한다. 필수값이 미완성이면 기본 저장이 거부되며, 상품명만 필요한 개인 서버 임시저장에는 입력 원문을 보관할 수 있다.
- 상품값에는 입력 당시 항목 정의를 함께 보관한다. 카테고리·정의 변경으로 항목이 사라지거나 유형·단위·선택값이 맞지 않으면 기존 값을 자동 삭제하지 않는다. 편집기에 보관값과 명시적 삭제 버튼을 표시하며 현재 정의에 맞는 값만 공개 상세의 `굿즈 정보` 표에 표시한다. 아직 서버에 한 번도 저장하지 않은 이전 카테고리 값은 원래 카테고리에서 저장하거나 명시적으로 정리해야 한다.
- 필수 항목을 추가해도 기존 상품의 게시 상태·KC·결제 가능 여부를 일괄 변경하지 않는다. 이후 속성 입력이 포함된 상품 편집 저장에서 현재 필수 조건을 확인한다. 기존 엑셀 등 속성 payload가 없는 저장은 같은 대표 카테고리의 값을 보존하고, 신규 상품·대표 카테고리 변경은 필수 조건을 검사한다. 엑셀 속성 편집·속성별 검색 필터는 이번 범위에 없다.
- 정의 revision·상품값 revision을 대조해 동시 편집 충돌을 거부하고 입력을 보존한다. 최신 정의·저장값을 조회한 뒤 현재 입력을 유지할지 교체할지 선택한다. 정의 저장은 operation ID로 재시도하며 정의·값 변경의 감사 기록을 남긴다.

## 저장 경계

`catalog_category_attribute_schemas`와 `goods_attribute_values`는 RLS를 사용한다. staff 조회와 admin 정의 변경, 상품 기본 저장의 RPC 경계를 나누며 신규 public 함수의 기본 execute 권한을 봉인한다. 상품 기본 저장은 기존 계정·카테고리·상품 잠금 경계를 유지하고 속성 revision 확인·병합·필수 검증·상품 저장·속성 감사 기록을 같은 거래에서 처리한다. 상품 식별자 변경 시 속성 FK가 따라간다.

서버 임시저장의 허용 필드와 지문에 `productAttributes`, `productAttributeDraft`를 추가했다. 원문과 서버 제출값을 함께 보존하며, 불러온 초안의 이전 revision을 임의로 최신화하지 않는다. 기본 저장이 실패하면 상품과 임시저장 완료 처리도 롤백된다. 공개 읽기는 공개·미보관·판매제한 없음 상품과 공개 IP만 허용하고, 현재 정의 순서에 맞춘 안전한 표시값을 반환한다.

## 검증

격리 SQL은 [goods_dynamic_attributes.sql](../../../supabase/tests/goods_dynamic_attributes.sql)에서 4유형·경계값·Unicode 공백·권한·정의/값 충돌·기존 저장 경로·KC·카테고리 코드·미분류·식별자 변경·보존/삭제·공개 제외·서버 임시저장 실패 롤백/완료 재시도·정지 계정을 검증했다. 별도 검토자가 새 격리 DB에 migration을 적용해 통과했고 SQL 로그와 manifest (`output/smartstore-reference-20261012/verification-goods-attributes/manifest.json`)에 기록했다.

실제 Chrome에서는 다음을 확인했다. 검수 화면·DB readback·SHA-256 (`output/smartstore-reference-20261013/verification-attributes/manifest.json`)에 근거를 기록한다.

1. 4유형 정의 저장, 필수 공란 저장 거부, 텍스트·단일/복수 선택·숫자 12.345678 저장과 공개 4행 표시.
2. ID를 유지한 다른 카테고리 정의 복사와 숫자 항목 삭제 후 상품 카테고리 변경. DB의 이전 4개 값은 유지하고 공개에서는 3행만 표시했다. 이후 명시적 삭제로 DB도 3개가 됐다.
3. 두 탭에서 다른 값을 입력해 첫 탭 저장 후 두 번째 탭의 오래된 저장을 거부했다. 두 번째 입력이 보존됐고 최신 저장값 비교 후 현재 입력을 다시 저장해 revision 5를 확인했다.
4. 필수 공란·빨강 선택·숫자 원문 `12.`를 서버 임시저장하고 reload→불러오기로 원문을 복구했다. 상품 등록 시 필수 검증 실패를 확인한 뒤 값을 채워 신규 상품과 3개 속성 저장, 임시저장 완료 연결을 확인했다.
5. 미저장 공개 미리보기와 실제 공개 상세의 속성 표, 정의 화면·상품 편집·공개 상세 390px에서 가로 넘침 없음, 상품 저장 버튼 중심을 가리는 요소 없음.

관련 11개 테스트 파일 308개와 전체 typecheck를 통과했다. 상품속성 관련 변경 파일 ESLint도 통과했다. 실제 브라우저의 정의 충돌은 별도 강제 실행하지 않았고 SQL로 검증했다. 원본 모든 카테고리의 저장 오류·그룹상품 저장 결과는 미확인이다. Chrome에는 번역 확장이 `<html>`에 추가한 속성으로 인한 hydration 경고가 기록됐으며 상품속성 렌더링·저장 실패는 관찰되지 않았다.

## 상품 복사 보강 (2026-10-13)

일반 판매기간 회귀 중 필수속성 카테고리의 상품 복사가 `goods_attribute_required`로 거부되는 경로를 발견했다. 복사 내부 writer에 현재 정의와 호환되는 원본 값·조회 버전을 함께 전달해 해결했다. 이전 카테고리·변경된 유형/단위·제거된 선택값의 보관값도 새 초안에 보존하며 공개 표시에서는 기존 현재 정의 일치 검사를 따른다. 같은 ID의 `12.345678 g`를 `kg`나 텍스트로 다시 해석하지 않는다. 현재 정의에 새 필수값이 생겨 원본이 충족하지 못하면 원본 수정 안내와 함께 전체 복사를 거부한다.

재고 0·미공개·판매기간 없음·KC 재검토와 operation 멱등 계약은 유지한다. 원본 데이터는 변경하지 않는다. `goods_clone_attributes.sql`은 현재/보관값·새 정의 누락·유형/단위 변경·미분류·멱등 7개 assertion을 검증한다. 독립 검토에서 단위 재해석을 재현한 뒤 필터를 보강했고, 최종 DRAFT를 별도 트랜잭션으로 다시 검증했다. 최종 SQL 결과 (`output/goods-sale-period-qa-20261013/clone-attributes-regression.txt`), 독립 검토 (`output/smartstore-reference-20261012/verification-goods-sale-period-public/clone-attributes-fixed-review.log`).

실제 관리자 UI에서도 `qa-attribute-good-20261013`을 `QA-ATTR-COPY` 새 초안으로 복사했다. 필수 텍스트·단일 선택·복수 선택 3개 값, 속성 revision 1, 미공개·재고0·판매기간 없음의 DB readback을 확인했다. 복사 성공 화면 (`output/goods-sale-period-qa-20261013/clone-ui-created.png`), DB readback (`output/goods-sale-period-qa-20261013/clone-ui-readback.json`). 합성 원본과 복사본은 로컬 QA 전용이다.
