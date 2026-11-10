# 원산지 국가·지역 찾기 — 공식 사전·구현·검증

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

확인일: 2026-10-14. 공식 사전 검토 후 정적 데이터·검색창·상품 원산지 적용·엑셀용 복사를 구현했다. 의존성 설치·DB 스키마 변경·운영 상품값 변경은 없다.

## 구현 범위

CLDR의 한국어 국가·지역 이름을 고정 버전으로 묶어 **검색 → 명칭 확인 → 현재 입력에 적용 또는 엑셀용 복사**를 제공한다. 프리셋이 없는 MD도 사용할 수 있고 새 데이터베이스 모델이 필요 없다. 코드가 아닌 한국어 명칭을 기존 `noticeOrigin` 문자열에 저장한다. 네이버 원산지 코드 재현이나 원산지 판정 기능으로 부르지 않는다.

상품 작성 화면 버튼은 **원산지 국가·지역 찾기**, 엑셀 화면은 **제조국 찾기**로 제공한다. 공통 안내는 “국가·지역 이름을 찾아 원산지 입력에 사용할 수 있습니다. 엑셀에서는 제조국 칸에 붙여넣으세요.”다. 사전에 없는 상세 문구는 기존 자유 입력으로 작성한다.

## 현재 필드 정본과 의미

| 표면 | 현재 계약 | 구현 시 유지할 점 |
| --- | --- | --- |
| [CONTEXT](../../../CONTEXT.md) | 고시정보의 항목명은 원산지 | 도구 추가로 도메인 명칭을 바꾸지 않음 |
| [고시 공통 정의](../../../lib/goods-notice.ts) | `origin` / `noticeOrigin` / 표시명 원산지 / 예 대한민국 | 관리자와 공개 상세는 같은 정의를 사용 |
| [ICONS 엑셀](../../../lib/admin/goods-workbook.ts) | `noticeOrigin` 열 제목 제조국, `goods.notice_origin`과 그대로 매핑 | 기존 엑셀 헤더·파일 버전 변경 없음 |
| [사방넷 반입](../../../lib/admin/sabangnet-goods-format.ts) | 원산지(제조국)·원산지·제조국을 동일 필드로 연결 | 원산지 상세지역은 별도 지원 필드가 아님 |
| [편집/복구](../../../lib/admin/good-editor.ts) | 기존 고시 필드를 초안 allowlist와 preview에 포함 | 선택 후 같은 native input 경로를 통해 기존 보관·복구 사용 |
| [KC 저장 경계](../../../supabase/migrations/20260910091552_sales_goods_kc_compliance.sql) | 원산지는 제품 맥락 일부. 공개 중 변경 거부, 비공개 변경은 KC 재검토 대상 | 도우미가 공개 잠금·기존 writer를 우회하지 않음 |

이는 **현재 코드가 두 표시명을 같은 문자열 필드에 연결한다**는 사실이다. 원산지와 제조국이 모든 상품·거래에서 법적으로 같은 개념이라는 판단은 아니다. 국가명 사전은 MD가 확인한 표시문구를 입력하는 도구이며 브랜드·IP·출고지·수입사로 제조국을 자동 추론하지 않는다. `국산`, `대한민국(경기도)`, 복수 지역 등의 기존 문자열도 일괄 변경하거나 새 ISO 형식 검증으로 막지 않는다.

## 공식 원본과 라이선스

Unicode의 [공식 배포 목록](https://cldr.unicode.org/index/downloads)은 CLDR 48.2와 JSON 48.2.0을 연결하며, 버전별 배포를 고정된 참조 자료로 설명한다. 이번에는 해당 버전을 후보로 읽었다. `main` 브랜치 또는 실행 환경의 `Intl.DisplayNames` 결과를 제품의 저장 문자열 정본으로 사용하지 않고, 승인된 버전의 필요한 항목만 고정한다.

- 한국어 기본명·단축/변형명: [CLDR JSON 48.2.0 ko/territories.json](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-localenames-full/main/ko/territories.json)
- 영어 이름·검색 별칭: [같은 버전 en/territories.json](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-localenames-full/main/en/territories.json)
- 유효성 상태: [CLDR 48.2 region.xml](https://raw.githubusercontent.com/unicode-org/cldr/release-48-2/common/validity/region.xml)
- 코드 매핑: [CLDR JSON 48.2.0 codeMappings.json](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-core/supplemental/codeMappings.json)

CLDR는 국가뿐 아니라 특별 지역과 대륙 같은 상위 지역 이름도 담는다. 단순히 영문 두 글자 키라는 이유만으로 모두 국가로 취급하면 안 된다. [공식 이름 지침](https://cldr.unicode.org/translation/displaynames/countryregion-territory-names), [LDML 지역 코드·특수 코드 설명](https://unicode.org/reports/tr35/#unicode_region_subtag)을 따른다.

[동일 버전 LICENSE](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/LICENSE)는 `Unicode-3.0`이며 데이터의 사용·수정·배포를 허용하되 저작권 및 허가문을 사본 또는 관련 문서에 포함하도록 한다. 원문 LICENSE와 원본 URL·버전·SHA-256·추출 조건을 [vendor manifest](../../../vendor/unicode-cldr/48.2.0/source.json)에 함께 넣었다. 브라우저 배포용 라이선스는 `/licenses/unicode-cldr-48.2.0.txt`에 두고 검색창에서 연결한다. Unicode가 ICONS를 보증하는 것처럼 표시하지 않는다. [Unicode 라이선스 정책](https://unicode.org/policies/licensing_policy.html)도 같은 데이터 라이선스를 안내한다.

ISO는 [국가 코드의 무료 사용](https://www.iso.org/iso-3166-country-codes.html?content_language=English)을 허용한다고 안내하며, 자동 갱신되는 파일 제공 서비스는 별도로 구분한다. 이 제안은 ISO 유료 코드집을 복제하지 않고 Unicode가 배포한 명칭 데이터만 사용한다.

## 추출 조건과 실측

사용하는 목록은 `region.xml`의 `regular` 두 글자 항목 중 `codeMappings`에 alpha-3와 900 미만 숫자 매핑이 있는 항목이다. 해당 버전 원본을 메모리에서 읽어 계산한 결과 **257개 → 249개**, 한국어 기본명 누락은 0개였다. 이는 CLDR 원본으로부터 계산한 결과이며 ISO 공식 전체목록과 별도 전수 대조를 마쳤다는 주장은 아니다. 지역을 포함하므로 UI에서는 **국가·지역**이라고 표시한다.

제외되는 regular 항목은 `AC CP CQ DG EA IC TA XK`다. 추가로 macroregion·deprecated·reserved·private-use·unknown·테스트 항목을 넣지 않는다. 특히 CLDR는 `XK`를 별도의 산업 관행에 따른 private-use 코드로 설명하므로 이를 공식 ISO 할당 코드라고 표시하면 안 된다. 사전 밖의 명칭도 기존 직접 입력은 가능하다. [코드 상태 원본](https://raw.githubusercontent.com/unicode-org/cldr/release-48-2/common/validity/region.xml), [특수 코드 설명](https://unicode.org/reports/tr35/#unicode_region_subtag)

| 검색 가능한 값 예시 | 목록 기본명 / 실제 적용·복사 값 | 저장하지 않는 검색 코드 |
| --- | --- | --- |
| 대한민국, 한국, South Korea, KR, KOR | 대한민국 | KR |
| 중국, China, CN, CHN | 중국 | CN |
| 일본, Japan, JP, JPN | 일본 | JP |
| 홍콩, Hong Kong SAR China, HK, HKG | 홍콩(중국 특별행정구) | HK |

기본명은 CLDR 기본값을 그대로 쓰고, 제공된 단축명·변형명은 검색 별칭으로만 쓴다. 예를 들어 한국으로 검색해도 적용값은 대한민국이다. 자체 약칭을 조용히 추가하거나 지역 명칭을 임의로 바꾸지 않는다. UI에서 선택한 최종 문자열을 미리 보여주므로 상품별 상세 문구가 필요하면 MD가 적용 후 직접 편집할 수 있다. [한국어 원본](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-localenames-full/main/ko/territories.json), [영어 원본](https://raw.githubusercontent.com/unicode-org/cldr-json/48.2.0/cldr-json/cldr-localenames-full/main/en/territories.json)

이번에 읽은 원본 SHA-256:

| 원본 | SHA-256 |
| --- | --- |
| 한국어 | `47b2f98d9cbf823068b0594074fe5db7fde80f9baf6a8038bd24ed81aefe7829` |
| 영어 | `158c1d575308f7e46912edbeda435c8fe2ef5dad280798231f3a432e406b1807` |
| 매핑 | `0d1ef50b92c1140e5847d22d96faf1a9c35543b0dedf8e9a2fcb87e4c51b9ed6` |
| 유효성 | `e751e0eedd46b52c38f3cdb72b0fab61ac8b48e052e8b28ba74b6ac26c4c8cb1` |
| JSON 저장소 LICENSE | `220ba0e1c43b99530d2d5bdb892a99dca0989414f51ab695ecd90163eaa1ec3b` |

## 화면·구현 계약

1. 정적 목록 하나를 두 화면에서 재사용한다. 한국어/영어/제공된 별칭/2·3자리 코드 검색, 20건 페이지, 선택값 표시, 키보드 이동·닫기·초점 복귀를 제공한다. 실행 중 외부 요청이나 API 키는 필요 없다.
2. 상품 폼에서는 비교할 현재 원산지와 선택할 명칭을 보여준 뒤 **현재 입력에 적용**한다. 선택만으로 바꾸지 않고 기존 필드 하나에만 넣는다. 적용은 공개 중·보관 상태·저장 중에는 불가하며 최종 저장은 기존 상품 저장 버튼으로 한다. 모달은 폼 바깥 portal로 두어 검색 Enter가 상품을 제출하지 않게 한다.
3. 일괄등록에서는 **제조국 값 복사**만 제공한다. 클립보드 거부 시 읽기 전용 입력을 직접 복사할 수 있다. `KR`이나 `410`을 엑셀 제조국에 쓰지 않는다. 기존 엑셀 파일을 자동 수정하거나 상품을 일괄 저장하지 않는다.
4. 적용 이후 로컬/서버 임시저장·미리보기·엑셀 반입/출력은 기존 `noticeOrigin` 계약을 사용한다. 국가명 목록은 편의 기능이며 기존 자유 입력을 제한하지 않는다.
5. 고정 원본 버전과 파생 결과의 개수·식별자 중복·명칭 누락·특수 코드 제외를 테스트한다. 검색에서 한국/KR/KOR과 대소문자, 페이지 끝, 복사 거부, 취소 무변경, 한 필드만 적용, 공개 잠금, 새로고침 복구를 검증한다. 실제 검증 결과는 아래 표를 따른다.

변경은 신규 정적 데이터/검색 함수/도우미 컴포넌트/라이선스 및 테스트, `GoodEditor`의 원산지 도움 버튼, `GoodsImportScreen`의 열기 버튼이다. 새 migration·RPC·국가 FK·정규화 배치·의존성 설치는 필요 없다. 네이버 원산지 코드 finder와 완전히 동일한 기능으로 완료 처리하지 않는다.

## 국내 상세지역과 착용모델

국내 상세지역은 1차 국가명 도우미 이후 별도 조사·승인을 거쳐 구현했다. [국내 상세지역 계약·검증](domestic-origin-region-proposal.md)을 따른다. 이용허락범위 제한 없음이 명시된 국토교통부 공식 CSV에서 시·도 16개와 시·군·구 후보 268개를 결정론적으로 추출했다. 도우미 안에서 국가·지역과 국내 상세지역을 구분하며, 시·도만 또는 시·군·구까지 명시 선택한 문구를 기존 원산지 입력에 적용하거나 엑셀 제조국용으로 복사한다. 세종의 중복 하위 단계는 없고 기존 자유문구·과거 지역명은 자동 변환하지 않는다. 전체 읍·면·동·리 데이터와 네이버 원산지 코드는 제공하지 않는다.

원본 모델 등록 화면 (`output/smartstore-reference-20261012/catalog-cs/106-template-model-create.jpg`)은 착용인물 사진·이름·키·몸무게·상의/하의/신발 치수와 동의 안내를 포함한다. 기존 상품의 제조국 입력 도구와 별개로, 인물 정보/사진의 보관·동의·삭제·상품 연결 정책을 정하는 후속으로 남긴다.


## 2026-10-14 실제 검증

전용 로컬 앱 4350과 합성 상품 두 개를 사용했다. 검증 체크 (`output/country-finder-qa-20261014/verified-checks.json`), 브라우저 읽기 결과 (`output/country-finder-qa-20261014/browser-readbacks.json`), DB 저장 전 (`output/country-finder-qa-20261014/before.json`)·저장 후 (`output/country-finder-qa-20261014/after.json`)에 근거를 남겼다.

| 검증 | 결과 |
| --- | --- |
| 고정 원본·파생 데이터 | 5개 공식 원본의 SHA 일치, 249행·명칭 누락/중복 없음. 로컬 생성기 재실행의 생성 SHA `12f1326197a64f7c2d75655a13408f1cac4b94209b0b60a72ceb0253c86e92e5` 일치 |
| 전체 목록·검색 | 첫 페이지20개, 13페이지 마지막9개. 한국 → 대한민국, JP → 일본, KOR → 대한민국을 실제 검색·선택 |
| 취소·폼 격리 | 검색창의 상위 form 없음. 검색 Enter와 일본 선택 후 취소해 상품의 모든 named 입력값 불변, 열기 버튼으로 초점 복귀 |
| 한 필드 적용 | 홍콩 선택 후 상품 전체 입력에서 `noticeOrigin`만 `홍콩(중국 특별행정구)`로 변경. 모바일 적용 전 (`output/country-finder-qa-20261014/02-country-selection-390.png`) |
| 복구·미리보기 | 적용 후 reload, 상품속성 비동기 조회 완료 후에도 복구 후보 유지. 명시 복구로 선택한 원산지 복원. 이후 별도 미저장 대한민국 적용은 실제 공개 화면 미리보기 고시 표에 반영. 복구 (`output/country-finder-qa-20261014/03-country-recovered.png`), 미리보기 (`output/country-finder-qa-20261014/06-country-preview.png`) |
| 기존 상품 저장 | 홍콩 명칭 저장 성공. 제조사·소재·크기·기준가5,000·정가6,000·재고0 불변. KC reviewed revision1 → unreviewed revision2. 저장 완료 (`output/country-finder-qa-20261014/04-country-saved.png`) |
| 공개·보관 | 공개 상품과 보관된 합성 상품 모두 찾기 버튼 비활성 |
| 엑셀 복사·왕복 | 실제 클립보드 값 대한민국(코드 KR 아님). XLSX 생성→파싱→반입 계획에서 대한민국과 기존 자유문구 각각 변경 없음. 클립보드 거부 시 직접 복사값 보존은 클라이언트 테스트로 확인. 복사 화면 (`output/country-finder-qa-20261014/05-workbook-copy.png`) |
| 모바일 | 390px에서 문서390/390·모달368/368, 긴 한국어·영어 이름과 현재 자유문구 표시 정상 |
| 라이선스 | HTTP 읽기 결과 (`output/country-finder-qa-20261014/license-readback.json`) 200·배포 파일과 고정 원본 SHA 동일. 자동 브라우저의 txt 직접 탐색은 확장 차단 오류가 있어 HTTP 읽기로 검증 |

관련 7파일 73테스트, 수정 파일 ESLint, 전체 타입검사가 통과했다. 기존 writer를 사용해 새 migration 검증과 전체 빌드는 실행하지 않았다. 배포는 하지 않았다. QA 과정의 브라우저 확장 `startsWith` 오류와 번역 확장의 html 속성 주입 경고를 제품 코드 오류와 구분했다. 전용 합성 상품/IP·복구 초안·4350 앱/임시 사본·브라우저 탭은 정리했으며 공용 4320은 변경하지 않았다.
