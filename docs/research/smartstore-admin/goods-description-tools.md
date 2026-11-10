# 상품 상세 HTML 인용·구분선·링크 도구

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 현재 작업 트리와 별도 로컬 앱에서 구현·검증했다. 운영 배포·운영 DB 변경·네이버 등록은 실행하지 않았다.

## 원본과 현재 차이

원본 도구 모음 (`output/smartstore-reference-20261012/product-editor-01-toolbar.jpg`)에는 인용·구분선·링크·HTML 첨부가 있다. 인용 선택 (`output/smartstore-reference-20261012/product-editor-06-quote-styles.jpg`), 구분선 선택 (`output/smartstore-reference-20261012/product-editor-07-divider-styles.jpg`), HTML 변환 (`output/smartstore-reference-20261012/product-editor-05-html-embed.jpg`) 화면과 함께 직접 확인했다. 원본 저장·변환 실행 결과와 허용 태그 전체는 미확인이다.

ICONS는 기존 HTML 소스 편집에 인용·구분선·링크 입력을 추가했다. 이 문서의 초기 검수는 기본 한 종류 기준이다. 후속 [본문 서식](content-formatting-implementation-qa.md)에서 정렬·글자 크기·강조·인용 5종·구분선 8종과 HTML 선택 경계 검사를 추가했다. 자유로운 시각 편집기 전체·장소·글감·개인 에디터 템플릿까지 구현한 것으로 확대하지 않는다. 제목·문단·목록·표·HTML 이미지 도구는 그대로 사용한다.

## 입력·저장 계약

- 인용과 링크는 공용 대화창에서 일반 텍스트를 입력한다. `<`, `>`, `&`, 따옴표는 HTML 코드로 실행되지 않는다. 인용의 줄바꿈은 보존한다. 구분선은 버튼으로 넣는다.
- 상세설명 커서 위치에 넣고, 선택한 구간이 있으면 그 부분만 바꾼다. 창을 열 때의 입력 원문·선택 범위를 잡아두며 원문·입력 요소·폼이 바뀌면 적용하지 않는다. 취소는 원문을 유지하고 열기 버튼으로 포커스를 돌린다.
- 링크 도구와 저장 정제기는 같은 `safeGoodsDescriptionLink`를 사용한다. 기존 `https`, `http`, `mailto`, `tel`, `/` 내부 경로 계약을 유지한다. `//`, 공백·제어문자·역슬래시·URL 인증정보는 거부한다. `rel="noopener noreferrer"`는 기존 정제기가 붙인다. 링크 클릭의 외부 목적지 동작은 이번 검증 범위가 아니다.
- 원문 30,000자와 정리 후 30,000자 한도를 모두 검사한다. 초과 시 입력을 잘라내거나 바꾸지 않는다. 전체 문서의 저장·미리보기·공개 HTML은 기존 `sanitizeGoodsDescription`을 통과한다.
- 대화창은 상품의 실제 HTML form 밖에 놓는다. 링크 입력의 Enter는 대화창 적용만 수행하고 상품 저장·자동복구 이벤트를 발생시키지 않는다. 확정 후 `setRangeText`와 기존 `input` 이벤트로 상품 폼·미리보기·미저장 감지·임시저장에 연결한다.
- 상품 저장 중, 일반 텍스트 전환, 보관 상품, 폼 reset/submit/unmount, 계정·로그인 세션 변경은 열려 있던 작업을 무효화한다. 취소한 창의 오래된 callback도 새 창·새 폼을 바꾸지 않는다. 같은 로그인 세션의 토큰 갱신은 유지한다. 클라이언트 검사는 권한 부여가 아니며 실제 저장의 서버 권한 검증은 기존 경계를 따른다.

## 검증 결과

관련 5개 테스트 파일 105개, 변경 TypeScript 파일 ESLint, 전체 `tsconfig.test.json` TypeScript 검사, diff 공백 검사를 통과했다. 정제기 회귀·허용/거부 URL·문자 이스케이프·선택 범위·길이·취소/계정/세션/폼/저장 경계를 포함한다. 저장 계약과 DB 스키마는 바뀌지 않아 migration 검증은 추가하지 않았다. 전체 빌드는 담당자의 통합 검증과 구분하며 이 단위에서 재실행하지 않았다.

실제 Chrome은 `http://icons-export-qa.localhost:4350`의 독립 앱 복사본과 격리 Supabase `59621/59622`를 사용했다. 합성 상품 한 건과 합성 IP 한 건만 생성했다.

1. 인용 창 입력 후 취소 시 상품의 모든 named input 값이 그대로이고 열기 버튼에 포커스가 돌아왔다. 인용·구분선·링크 적용 후 전체 폼 비교에서 `description` 하나만 바뀌었다.
2. `setRangeText` 적용에 따라 편집기 요약이 12→82→87→175자로 바뀌고 미저장 상태와 공개 미리보기에 즉시 반영됐다. 로컬 임시저장→reload→복구로 175자 원문을 복구했다. 복구 전 DB는 처음 12자 그대로였다.
3. 링크 주소에 `javascript:alert(1)`을 넣고 Enter를 눌러 오류 안내를 확인했다. DB 저장은 발생하지 않았다. 안전한 내부 링크와 특수문자를 포함한 문구는 적용됐다. 실제 키보드로 `교체` 2글자만 선택해 mailto 링크로 바꾸고 앞뒤 HTML이 그대로인 것도 확인했다.
4. 상품 저장 버튼으로 저장 성공을 확인했다. DB는 정제된 HTML을 저장했고 가격 5,000원·공개 상태·KC `reviewed`, revision 1을 유지했다. 일반 텍스트↔HTML 전환은 원문을 보존했다. 검증용 후속 입력은 저장된 원문으로 되돌렸다.
5. 공개 상세에서 인용 1개·구분선 1개·링크 1개와 두 줄의 인용문, 특수문자, 정확한 `href`·`rel`을 재조회했다. PC와 390px에서 직접 화면을 확인했다. 390px 대화창은 내부/외부 폭 368px, 관리자 문서 폭 390px로 가로 넘침이 없었다. 공개 문서는 스크롤바를 제외한 380px 폭과 scrollWidth가 같았다.

화면은 위험 링크 거부 (`output/goods-description-tools-qa-20261014/01-link-invalid-desktop.png`), 390px 링크 입력 (`output/goods-description-tools-qa-20261014/02-link-mobile.png`), 저장 성공 (`output/goods-description-tools-qa-20261014/03-saved-mobile.png`), 공개 PC (`output/goods-description-tools-qa-20261014/04-public-desktop.png`), 공개 390px (`output/goods-description-tools-qa-20261014/05-public-mobile.png`)에 남겼다. 검증 manifest (`output/goods-description-tools-qa-20261014/manifest.json`)는 파일 해시·테스트 로그·DB 전후·입력/공개 readback을 연결한다.

콘솔에는 번역 확장이 `<html>`에 추가한 속성에 대한 hydration 경고와 해당 확장의 `startsWith` 오류가 있었다. 이 기능의 렌더·입력·저장 오류와 프레임워크 오류 화면은 관찰되지 않았다. Safari·실제 모바일 기기·네이버 최종 등록 결과는 이번에 검증하지 않았다.
