# 상품 사이즈 안내표 · 템플릿 계약과 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 원본 조사 후 범용 사이즈 안내표와 재사용 템플릿을 로컬에 구현·검증했다. 착용 모델의 이름·사진·신체 정보는 이번 범위에 포함하지 않는다. 원본 네이버 계정에서는 저장·등록·업로드·노출설정 변경을 하지 않았으며 운영·Preview 배포도 실행하지 않았다.

## 원본에서 확인한 사실

| 근거 | 확인 내용 | 한계 |
| --- | --- | --- |
| [공식 사이즈 도움말](https://help.sell.smartstore.naver.com/faq/content.help?faqId=15349) · 본문과 화면 (`output/smartstore-size-reference-20261014/03-size-help.txt`) | 구매자가 치수를 확인하는 안내 정보다. 상품군별 측정 항목을 입력하면 상품 상세에 노출한다. 직접 입력·이미지 AI 추출·엑셀 입력을 안내하며, 착용 모델 정보는 추가 입력이다. | 단위, 소수 자릿수, 행 수 제한은 본문에 없다. |
| 신형 빈 양식 `일괄등록!CL2:CO5` · 원본과 해시 (`output/smartstore-blank-template-reference-20261014/sources.json`) | 상품군·사이즈명·상세 사이즈는 조건부 필수다. 사이즈명은 각 10자·최대 10개다. 측정 항목은 상품군의 정해진 이름을 사용하고 값은 0.1~99,999, 항목마다 사이즈명 수와 같은 개수를 입력한다. 모델명은 템플릿 관리에 등록된 착용 모델을 참조한다. | 파일의 안내 계약이며 실제 업로드 검증은 실행하지 않았다. 일반 상품 모델명이나 법정 고시 모델명과 구분한다. |
| 구형 빈 양식 `ver.2.1!A1:BY3` · 열 구조 (`output/smartstore-blank-template-reference-20261014/structure.json`) | 독립 사이즈 안내 열이 없다. `BM1`은 상품정보제공고시 모델명이다. | 신형 사이즈 기능을 구형에도 있다고 간주하지 않는다. |
| [상품 일괄등록 사이즈 찾기](https://sell.smartstore.naver.com/#/products/bulkadd) · 실제 화면 (`output/smartstore-size-reference-20261014/01-size-finder-tote.png`) | 상품군 목록과 토트백의 `너비, 높이, 폭` 항목을 확인했다. | 도해는 보이지 않는다. 이전 캡처 63의 설명에 있던 ‘도해’는 증거보다 넓은 표현이다. |
| 상품 등록의 노출설정 (`output/smartstore-size-reference-20261014/02-size-hidden-preference.png`) | 현재 계정은 선택항목 ‘사이즈’를 노출하지 않도록 설정돼 있다. | 이 설정을 저장해야 수동 입력 영역을 열 수 있으므로 실제 표 입력·저장 UI를 조사하지 않았다. 설정을 바꾸거나 숨겨진 내부 상태로 우회하지 않았다. |
| 기존 템플릿 관리 조사 (`output/smartstore-reference-20261012/catalog-cs/coverage.md`) | 배송·카테고리·A/S·이벤트·문의·고시·정기구독·모델 8개 탭을 확인했다. | 별도 ‘사이즈 템플릿’ 탭은 확인하지 못했다. 아래 재사용 템플릿은 ICONS 운영 편의를 위한 제안이다. |

신형의 샘플 사이즈·수치·착용 모델명은 구현 기본값이나 테스트 자료로 복제하지 않는다. 독립적인 합성 값으로 검증한다.

## 현재 ICONS 경계

- `noticeSize`/`goods.notice_size`는 [고시정보의 크기](../../../CONTEXT.md)이고 [공개 상세 로더](../../../lib/catalog.ts)의 `notice.size`로 나온다. 측정표를 여기에 직렬화하지 않으며 기존 필수 고시 검증도 바꾸지 않는다.
- [카테고리별 상품속성](../../../lib/goods-detail.ts)은 `{id, name, value}` 목록으로 공개된다. 표의 가변 행·열, 단위를 속성 하나에 감추거나 기존 속성 정의를 늘리지 않는다.
- [선택 옵션](../../../lib/goods-options.ts)은 가격·할당 재고와 장바구니 식별자를 가진다. 사이즈표의 사이즈명이 옵션명과 같아도 자동 연결하거나 주문 선택값으로 사용하지 않는다.
- [A/S 안내](../../../supabase/migrations/20261020085314_goods_after_sales_content.sql)는 별도 private 저장소, `catalog.manage`, revision, 감사 영수증, 공개 게이트, 템플릿 값 복사와 굿즈 복사 경로가 있다. 사이즈표는 이 기존 저장 경계를 따라 작은 독립 기능으로 만들 수 있다.

## 구현 계약

아래에서 원본에 없는 제한은 ICONS 자체 계약이다. 단위와 행 한도는 원본과 같다는 주장을 하지 않는다. [공통 파서](../../../lib/goods-size-chart.ts)와 [DB 검증](../../../supabase/migrations/20261020085325_goods_size_charts.sql)은 앞뒤 ASCII 공백·LF·CR·TAB만 정리한다. NBSP 같은 Unicode 공백은 이름·안내에서 그대로 한 글자로 취급하며 숫자에는 허용하지 않는다. 글자 수는 JS codepoint와 SQL `char_length`를 맞췄다.

| 요소 | 제안 |
| --- | --- |
| 화면 이름 | 상품 편집의 ‘사이즈 안내’, 템플릿 관리의 ‘사이즈 템플릿’, 공개 상세의 ‘사이즈 안내’. |
| 표 모양 | 열은 사이즈명 1~10개, 행은 측정 항목 1~10개. 입력과 공개 표의 순서를 동일하게 유지한다. |
| 이름 | 사이즈명은 각 1~10자, 측정 항목명은 각 1~20자. 앞뒤 공백을 정리하고 같은 축의 중복 이름·제어문자를 거부한다. HTML은 받지 않는다. |
| 단위 | 표 전체에 `cm` 또는 `mm`를 명시한다. 기본값 `cm`. 단위를 바꿔도 숫자를 자동 변환하지 않으며 변경 시 안내한다. |
| 값 | 모든 셀은 0.1~99,999, 소수 한 자리까지의 숫자다. 지수 표기·부호·쉼표·문자열 단위·빈 셀은 거부한다. 정규화한 십진 문자열로 전달해 저장·표시를 일치시킨다. |
| 측정 안내 | 선택 일반 텍스트 500자. 줄바꿈·탭 허용, HTML과 제어문자 거부. ‘측정 위치에 따라 다를 수 있음’ 같은 문구를 사실 확인 없이 기본 삽입하지 않는다. |
| 사용 상태 | ‘설정안함’은 공개 표시를 중지하고 저장된 표를 보존한다. 최초 빈 상태만 행·열이 모두 없는 값을 허용한다. 일부만 채운 표는 중지 상태에서도 저장하지 않는다. 별도 영구 삭제는 만들지 않는다. |
| 템플릿 | 내부 이름 1~50자와 유효한 표를 저장한다. 검색·20개씩 목록·생성·수정·보관·복원을 제공한다. 보관한 항목은 불러오기에서 제외한다. |
| 불러오기 | 템플릿의 현재 값을 편집 중 표에 복사한다. 상품에 적용하려면 ‘사이즈 안내 저장’을 누른다. 템플릿을 수정·보관·복원해도 복사한 상품은 바뀌지 않는다. 영구 참조 FK나 자동 동기화는 두지 않는다. |
| 상품 복사 | 기존 상품 복사 트랜잭션에서 안내표와 사용 상태를 독립 스냅샷으로 복사한다. 템플릿이나 원상품 변경이 새 상품을 바꾸지 않는다. |
| 신규 상품 | 상품 기본정보를 한 번 저장한 후 독립 패널에서 사이즈표를 저장한다. 기본 상품 저장과 별도인 상태를 화면에 명시한다. |

`private.goods_size_charts`와 `private.goods_size_templates`는 상품 표와 템플릿을 분리하고 `goods` FK의 ID 변경 cascade와 보관 보존을 유지한다. `catalog.manage` 권한을 서버와 RPC에서 확인한다. 직접 테이블 접근은 봉인하고 public 함수의 기본 execute를 `public, anon, authenticated, service_role` 전체에서 회수한 뒤 필요한 호출자에게만 연다.

상품 저장과 템플릿 저장은 각각 기대 revision, operation UUID, 정규화한 요청 전체를 받는다. 같은 operation의 같은 요청은 기존 영수증을 반환하고 다른 요청은 충돌시킨다. 상품 행 잠금 뒤 현재 표 revision을 비교한다. 결과 불명확 시 기존 operation과 입력을 고정하고 같은 요청의 결과를 확인한다. 충돌 시 편집 값을 남기며 최신 상태를 별도로 다시 읽는다. 브라우저 임시 입력은 계정·상품 경계를 가진 기존 복구 방식을 적용하되 자동 저장을 서버 저장으로 표시하지 않는다.

공개 읽기는 기존 공개 굿즈·상위 IP의 공개/미보관·판매 제한 없음 조건과 표 사용 여부를 모두 확인한다. 템플릿 이름·작성자·revision은 공개하지 않는다. 표는 상세설명/고시와 구분된 읽기 전용 영역에서, 어드민의 저장 전 미리보기와 같은 컴포넌트로 렌더한다. 모바일은 표 안에서만 가로 스크롤하고 헤더에 `scope`와 단위를 표시한다. 장바구니·주문·재고·KC 데이터는 읽거나 변경할 필요가 없다.

## 검증 범위와 후속 경계

1. TS/SQL의 이름·행렬·수치·단위·중복·빈 상태 검증을 같은 합성 사례로 확인한다.
2. 격리 DB에서 권한 거부, 공개 게이트, 저장과 재조회, CAS, 동일/변조 operation, 중지 보존·재개, 템플릿 보관/복원과 적용값 독립성, 상품 복사·ID 변경 보존을 확인한다. 운영 DB는 변경하지 않는다.
3. 실제 Chrome에서 표 입력→템플릿 저장→다른 상품 불러오기→독립 저장→새로고침, 저장 전 미리보기, 재조회 충돌 복구, 390px 공개 표를 확인한다. 두 상품의 옵션·가격·재고·고시·KC가 그대로인지 재조회한다.
4. 사이즈 엑셀 왕복은 후속 [상품 엑셀 v7](goods-guidance-workbook.md)에 연결해 실제 저장·충돌·재시도를 검증했다. 기존 v3~v6 해석을 유지하고 v7의 별도 안내 시트로 편집하며, 안내 시트·행 누락 시 기존 표를 보존한다.
5. 원본의 상품군 고정 사전 전체, 이미지 AI 추출, 착용 모델과 사진·신체 정보, 개인 신체치수 수집·추천은 이번 범위에 넣지 않는다. 원본 기능과 다르게 자유롭게 측정 항목을 구성하는 점을 내부 안내에 분명히 한다.

## 실제 결과

[상품 편집 패널](../../../components/admin/GoodSizeChartPanel.tsx), [템플릿 관리](../../../components/admin/screens/GoodsSizeTemplatesScreen.tsx), [공용 표](../../../components/shop/GoodSizeChart.tsx)를 연결했다. 상품 기본정보를 저장한 뒤 독립 패널에서 편집하며, 사용하지 않는 신규 상품에는 표를 만들지 않는다. 템플릿 경로는 `/admin/catalog/size-templates`다.

관련 6개 테스트 파일 81개가 통과했다. 십진 문자열과 Unicode 경계, 권한 선검사, 잘못된 저장 영수증의 결과 불명 처리, 미완성 입력 복구, 계정·상품 격리, 동일 요청 재시도, 늦은 조회 무시, 충돌 비교, 공개 표와 기존 굿즈 상세를 검사했다. 수정 파일 ESLint와 전체 타입검사를 통과했다.

[기능 SQL](../../../supabase/tests/goods_size_charts.sql)은 OWN·FRESH·59922 격리 DB에서 통과 후 롤백했다. ACL/RLS, 공개 게이트, CAS, 동일/변조 요청, 권한 회수 후 재시도, 중지 보존, 템플릿 보관·복원, 상품 복사·ID 변경, 가격·옵션·고시·KC 보존을 확인했다. 기존 A/S와 사은품의 상품 복사 회귀도 통과했다. OWN (`output/goods-size-chart-qa-20261014/sql-own.log`), FRESH (`output/goods-size-chart-qa-20261014/sql-fresh.log`), 59922 (`output/goods-size-chart-qa-20261014/sql-chain.log`), 복사 회귀 (`output/goods-size-chart-qa-20261014/sql-clone-regressions.log`).

[실제 경합 진입점](../../../supabase/tests/goods_size_charts_concurrency.sh)은 명시한 테스트 DB를 임시 DB로 복사한 뒤 두 세션을 겹쳐 실행한다. 같은 revision의 다른 저장은 하나만 성공하며, 같은 operation의 재시도는 revision·감사 기록을 중복 생성하지 않는다. 합성 레코드와 임시 DB를 모두 지웠다. 실행 로그 (`output/goods-size-chart-qa-20261014/concurrency-reusable.log`), 두 세션과 정리 결과 (`output/goods-size-chart-qa-20261014/concurrency-reusable.json`).

```bash
GOODS_SIZE_CHART_TEST_SCOPE=isolated-local \
SUPABASE_DB_CONTAINER=supabase_db_icons-ip-smartstore-20261012 \
bash supabase/tests/goods_size_charts_concurrency.sh
```

### 실제 Chrome · 합성 상품 2개

| 흐름 | 확인 결과 |
| --- | --- |
| 템플릿 작성·복구 | 표를 작성한 뒤 저장 전에 새로고침했다. 이름·단위·치수·안내가 복구됐고 공용 미리보기 (`output/goods-size-chart-qa-20261014/01-template-recovered-preview.png`)에서 확인했다. |
| 상품에 복사 | 템플릿을 A와 B에 각각 복사하고 B만 다른 치수로 저장했다. A 저장 (`output/goods-size-chart-qa-20261014/02-product-a-saved-preview.png`). |
| 템플릿 보관·복원 | 템플릿 안내를 바꾸고 보관한 뒤 두 상품의 복사본이 유지됨을 DB (`output/goods-size-chart-qa-20261014/readback-after-template-archive.json`)에서 확인했다. 복원 후 템플릿 revision은 3이다. |
| 유효하지 않은 소수 | `39.12`를 저장하려 하면 거부하고 입력 문자열을 유지했다. 자동 반올림·절삭은 없었다. 화면 (`output/goods-size-chart-qa-20261014/06-admin-invalid-decimal.png`). |
| 동시 수정 | 화면을 연 뒤 같은 합성 상품을 기존 RPC로 별도 저장했다. 오래된 저장은 거부됐고 작성표와 최신 저장본 (`output/goods-size-chart-qa-20261014/09-conflict-comparison.png`)을 비교한 후 작성표를 새 revision으로 저장했다. |
| 중지·재개 | 설정안함에서 네 열과 안내를 유지하고 공개 읽기는 null이 됐다. DB (`output/goods-size-chart-qa-20261014/readback-disabled.json`). 다시 설정함으로 바꿔 공개를 재개했다. |
| 공개 상세 | 데스크톱 (`output/goods-size-chart-qa-20261014/04-public-desktop.png`)과 390px (`output/goods-size-chart-qa-20261014/07-public-mobile-four-columns.png`)에서 단위·치수·안내를 표시했다. 모바일 문서 폭은 380px, 표 영역 346px/내용 491px이며 키보드로 오른쪽 열 (`output/goods-size-chart-qa-20261014/08-public-mobile-scrolled.png`)을 읽었다. |
| 관리자 모바일 | 최초 검수에서 숨김 라벨의 위치 기준 때문에 문서 폭이 559px로 늘어났다. 스크롤 영역에 `position: relative`를 넣어 380px로 수정 (`output/goods-size-chart-qa-20261014/10-admin-mobile-fixed.png`)했다. 표는 272px/내용 676px이며 오른쪽 열 (`output/goods-size-chart-qa-20261014/11-admin-mobile-scrolled.png`) 이동과 실제 저장 (`output/goods-size-chart-qa-20261014/12-admin-mobile-saved.png`)이 통과했다. |
| 최종 저장·정리 | A revision 1, B revision 7, 상품별 표·공개 응답과 가격·옵션·재고·고시 보존을 재조회 (`output/goods-size-chart-qa-20261014/final-readback.json`)했다. 합성 상품 2·IP 1·표 2·템플릿 1·관련 감사 기록·KC 합성 검토자를 지우고 모두 0건임을 확인 (`output/goods-size-chart-qa-20261014/cleanup.log`)했다. 임시 런타임·4350 서버·검증 탭·viewport와 합성 상품 브라우저 복구 기록도 정리했다. |

브라우저 콘솔에는 번역 확장이 `<html>`에 추가한 속성의 hydration 경고가 있었으며 기능의 저장·조회 오류나 프레임워크 오류 화면은 관찰하지 않았다. 콘솔 기록 (`output/goods-size-chart-qa-20261014/browser-console.json`). 자동 검증은 실제 판매 제품의 치수·KC 적합성·모델 정보를 판정하지 않는다. 원본 저장/업로드, AI 추출, 착용 모델 정보와 운영·Preview 배포는 이 표 편집 검증에 포함하지 않는다. 사이즈 엑셀 왕복은 당시 표 편집 검증과 분리한 [후속 v7 검증](goods-guidance-workbook.md#실제-chrome엑셀-왕복-검증)에서 완료했다.
