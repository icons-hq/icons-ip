# 직접입력형 옵션의 엑셀 편집 계약

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 로컬 구현·검증 완료. [빈 원본 양식 확인](blank-product-workbook-comparison.md)의 신형 `일괄등록!R2:R5`에서 직접입력 항목 5개를 확인했다. ICONS에 이미 있는 직접입력형 정의를 상품 엑셀로 편집하며, 네이버 샘플 값은 앱 양식·테스트에 사용하지 않는다. 운영·Preview 배포는 실행하지 않았다.

현재 다운로드는 [A/S·사이즈 안내를 추가한 v7](goods-guidance-workbook.md)이며, 아래의 직접입력형 계약과 기존 v6 입력 호환을 유지한다. 이 문서의 실제 브라우저 검증은 도입 당시 v6 파일에 대한 기록이다.

## 현재 저장 경계

- v5 상품 시트에는 직접입력형 열이 없다. `admin_goods_import_records`의 상품 JSON에는 `custom_inputs_enabled`, `custom_input_fields`, `custom_inputs_revision`이 이미 포함된다.
- 현재 `admin_save_good`의 위임 경로는 `custom_inputs`와 `custom_inputs_expected_revision`을 처리한다. 상품 행 잠금과 기대 버전 확인 후 기본 상품과 정의를 같은 거래에서 저장한다. 실제 값이 변할 때만 revision을 올리고 `admin.good.custom_inputs_saved` 감사 기록을 남긴다.
- 현재 import fingerprint에 직접입력 revision이 포함된다. `admin_commit_goods_import_group`는 미리보기 이후 변경을 잠금 안에서 확인하고 상품 하나의 오류만 롤백한 뒤 결과를 기록한다. 다른 상품의 성공은 유지하며 같은 배치·인덱스 재시도는 저장된 결과를 반환한다.
- 필드 ID는 장바구니 문구 식별자이고 기존 주문의 정의·문구는 변경할 수 없는 스냅샷이다. 엑셀에서도 이름으로 ID를 다시 만들거나 다른 상품의 ID를 가져오지 않는다.
- 위 내용은 2026-10-14 OWN 로컬 DB의 실제 함수 정의와 저장소 코드를 읽어 확인했다. 기존 조회·writer·fingerprint를 그대로 재사용했으며 신규 migration은 없다.

## 파일 계약

1. 새 다운로드는 v6로 올리고 상품의 기존 85열과 KC 시트 열은 유지한다. 새 `직접입력형 옵션` 시트에 `상품코드`, `변경 방식`, `전체 사용`, `항목 ID`, `항목명`, `항목 처리`, `정의 버전` 7열을 둔다. 시트 A1은 파일 버전, 4행은 제목, 5행부터 항목 한 개당 한 행이다. 표시 순서는 같은 상품의 시트 행 순서다.
2. `변경 방식`은 `편집`/`전체 해제`, `전체 사용`은 `예`/`아니오`, `항목 처리`는 `사용`/`중지`/`삭제`다. 같은 상품의 변경 방식·전체 사용·버전은 모두 같아야 한다. ID·버전은 회색 안내와 텍스트 형식으로 내보내며 기존 ID를 바꾼 파일은 거부한다.
3. 상품 시트에 있는 명시적 상품코드로만 연결한다. 자동코드가 비어 있는 새 상품은 먼저 초안 저장 후 다시 내려받는다. 코드가 명시된 새 상품에는 버전 `0`과 빈 ID로 새 정의를 등록할 수 있다. 상품 시트에 없는 코드, 다른 상품/알 수 없는 ID, 중복 ID·이름, 잘못된 버전·형식은 오류다.
4. `편집`에는 기존 모든 ID를 포함해야 한다. 빠진 기존 ID는 실수로 지우지 않고 오류로 표시한다. 기존 ID의 이름 변경·순서 변경·사용/중지와 명시적 `삭제`를 지원한다. 새 항목은 빈 ID와 이름·사용 상태로 입력하며 검증 시 서버가 UUID를 한 번 만들어 저장할 plan에 고정한다. 삭제 후 최종 정의는 최대 5개, 이름 25자, 사용 중인 전체 설정에는 활성 항목이 하나 이상이어야 한다. 기존 5개를 지우고 새 5개를 넣을 수 있도록 편집 입력은 상품당 최대 10행, 파일은 최대 5,000행으로 제한한다.
5. `전체 사용=아니오`는 필드·ID·이름을 보존하고 고객 입력만 끈다. `항목 처리=중지`는 해당 항목을 보존한다. `전체 해제`는 상품당 한 제어 행으로 `전체 사용=아니오`, ID·이름·항목 처리 공란을 요구하고 정의를 빈 배열로 저장한다. 전체 해제와 편집 행의 혼합을 거부한다. 모든 항목을 지우려면 전체 해제를 명시한다.
6. 시트가 없거나 특정 상품 행이 없으면 해당 상품의 정의를 유지한다. v3·v4·v5 파일은 기존 열 해석과 보존 동작을 유지한다. 예전 버전에 새 시트를 붙이면 조용히 무시하지 않고 v6 재다운로드를 안내한다. 기존 배치 plan에 새 필드가 없어도 정상 처리한다.

## 검증·적용·실패 복구

- 기존 상품은 내보낸 정의 버전을 현재 값과 먼저 비교한다. 일치하는 내용은 `keep`으로 처리한다. 직접입력만 바뀐 상품을 기존 상품열 비교의 `unchanged` 분기가 건너뛰지 않게 한다.
- v6 파일의 구조·시트 제목·연결할 상품이 없는 행은 파일 단계에서 거부한다. 특정 상품의 정의 값 오류는 해당 상품의 오류로 합쳐 다른 정상 상품을 검증·적용할 수 있게 한다. 미리보기에는 새 항목/이름 변경/중지/삭제/전체 해제와 기존 장바구니 재확인 가능성을 표시한다.
- 변동 payload만 `custom_inputs`와 `custom_inputs_expected_revision`으로 기존 상품 저장기에 전달한다. 가격·재고·옵션·고시·KC와 같은 상품 거래에서 성공하거나 함께 실패한다. 주문 문구 스냅샷은 수정하지 않는다.
- 실패 파일에 실패 상품의 원본 직접입력 행을 함께 넣고 성공 상품은 제외한다. 실패 재다운로드에서도 빈 새 ID는 원본대로 남기며 새 미리보기에서 한 번 발급한다. 버전 충돌은 최신 파일 재다운로드를 안내한다. 잘못된 버전이나 ID를 실패 파일에서 자동 갱신하지 않는다.
- 빈 양식, 일반 내보내기, 실패 파일은 현재 v7을 생성하며 직접입력형 시트의 열 구조는 v6와 같다. 사용 중지 항목도 내보내어 복구할 수 있게 한다. 정의가 없는 상품은 직접입력 시트의 행 없이 내보낸다.

## 실제 검증

### 코드·DB

관련 7파일 99테스트와 운영 연습 스크립트 1파일 2테스트가 통과했다. v3/v4/v5 호환·v6 왕복, 누락 시트/상품 유지, 기존 ID·버전, 서버 새 ID 발급과 준비된 plan 재열기, 중지·재개·삭제·전체 해제, 고아 코드·중복·행 상한·숫자 식별자·수식 거부, 직접입력만 바뀐 경우, 실패 파일 보존을 검증했다. 현재 양식 버전이 v5로 고정돼 있던 연습 파일 생성기도 v6로 맞추고 KC·직접입력 시트의 버전/헤더/틀 고정 보존을 검증했다. 수정 파일 ESLint와 전체 타입검사가 통과했다.

[SQL 테스트](../../../supabase/tests/goods_custom_input_workbook.sql)를 OWN/FRESH에서 각각 실행하고 전체를 롤백했다. 기본 상품과 정의의 동시 저장, 한 번의 revision 증가, 같은 배치 결과 재시도, 다른 상품 실패 시 성공 보존, 정의 최종 검증 실패 시 앞서 변경된 상품명까지 롤백, 미리보기 이후 fingerprint 충돌, 오래된 정의 버전 충돌, 구형 plan의 정의 보존, 기존 주문 필드 ID·이름·revision·문구 스냅샷 보존을 확인했다. OWN 로그 (`output/goods-custom-input-workbook-qa-20261014/sql-own.log`), FRESH 로그 (`output/goods-custom-input-workbook-qa-20261014/sql-fresh.log`).

### 실제 Chrome · 합성 상품 2개

| 항목 | 확인한 결과 |
| --- | --- |
| 내보내기와 파일 열기 | 앱의 상품 2개를 v6로 실제 다운로드했다. 새 시트의 7열·긴 UUID·안내·행 높이를 원본 렌더 (`output/goods-custom-input-workbook-qa-20261014/01-exported-custom-input-sheet.png`)에서 직접 확인했다. |
| 항목만 변경한 저장 | 미리보기 (`output/goods-custom-input-workbook-qa-20261014/02-edit-preview.png`)에 추가·이름 변경·중지를 구분했다. 두 기존 ID 유지, 새 UUID 2개, revision 2/1과 두 상품 저장 성공을 DB (`output/goods-custom-input-workbook-qa-20261014/readback-after-edit.json`)에서 확인했다. 가격·재고·상품명은 그대로였다. |
| 미리보기 이후 충돌 | 미리보기 뒤 같은 기존 writer로 첫 상품 정의를 별도 저장했다. 이전 전체 해제는 충돌로 거절됐고 둘째 상품 변경은 성공했다. 화면 (`output/goods-custom-input-workbook-qa-20261014/04-conflict-partial-success.png`), DB (`output/goods-custom-input-workbook-qa-20261014/readback-after-conflict.json`). |
| 실패 파일 | 실제 다운로드한 실패 파일에는 첫 상품만 포함됐고 `전체 해제`·이전 revision 2가 보존됐다. 성공 상품이나 서버가 임의로 갱신한 버전이 섞이지 않았다. 내용 검사 (`output/goods-custom-input-workbook-qa-20261014/failure-file-check.json`). |
| 최신 파일로 재개 | 현재 revision 3/2를 다시 내보냈다. 재다운로드 렌더 (`output/goods-custom-input-workbook-qa-20261014/06-latest-custom-input-sheet.png`)에서 중지 항목·서버 새 UUID도 유지됐다. 최신 버전의 첫 상품 전체 해제를 적용해 enabled=false·정의=[]·revision 4를 확인했다. 직접입력 시트에서 제외한 둘째 상품은 정의·revision 2가 그대로였다. 저장 완료 (`output/goods-custom-input-workbook-qa-20261014/07-clear-saved.png`), DB (`output/goods-custom-input-workbook-qa-20261014/readback-after-clear.json`). |
| 모바일 | 390px에서 문서 폭 380px로 가로 넘침 없음. 결과 표는 자체 가로 스크롤하며 오른쪽 결과 열 (`output/goods-custom-input-workbook-qa-20261014/09-mobile-results-right.png`)에서 해제 안내·저장 완료를 확인했다. |
| 정리 | QA 앱 4350·임시 복사본·탭·viewport를 정리했다. 합성 상품 2개·IP 1개·배치 4개·Storage 파일 4개를 제거하고 모두 0건임을 재조회 (`output/goods-custom-input-workbook-qa-20261014/cleanup.log`)했다. |

서버 plan과 저장 결과 (`output/goods-custom-input-workbook-qa-20261014/batch-readbacks.json`), 최종 검증·소스 해시 (`output/goods-custom-input-workbook-qa-20261014/verification.json`).

### 검증 중 도구 호환 문제

검증용 복사본을 편집한 Artifact Tool이 쓰는 `x:` XML 요소 접두사와 절대 관계 경로를 설치된 ExcelJS가 읽지 못했다. QA 파일의 동등한 XML 표기만 정규화했고 셀 값과 서식의 의미를 바꾸지 않았다. 기록 (`output/goods-custom-input-workbook-qa-20261014/qa-file-packaging.json`). 앱이 직접 내려준 원본은 처음부터 정상적으로 읽혔다. 이번 변경은 기존 XLSX 파서가 지원하는 범위를 넓히지 않는다.

브라우저 콘솔에는 번역 확장이 `<html>`에 넣은 속성의 hydration 경고가 있었다. 애플리케이션의 정의 저장·조회 실패는 관찰하지 않았다. Excel 데스크톱 앱 자체를 실행한 검증과 네이버 원본 업로드·등록은 수행하지 않았다.
