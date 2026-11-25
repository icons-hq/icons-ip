# 어드민 화면 규칙

어드민(`/admin/**`) 화면의 입력 방식·도움말·선택창에 적용한다. 문구 자체의 규칙은 [admin-copy-guide.md](admin-copy-guide.md)다. 읽는 사람은 처음 보는 운영팀·MD이고, 합격 기준은 **"누구에게도 묻지 않고 맞게 입력할 수 있는가"**다.

계기: 2026-11-25 상품등록 화면을 직접 써 본 결과, 화면마다 방식이 달랐다. 대상을 고르는 칸이 드롭다운·인라인 검색·모달·콤보박스·번호 직접 입력 다섯 가지였고(어드민 전체 드롭다운 약 320곳, 공용 선택창 없음), 설명이 없는 칸(진열 순서·확장 배송비 상태·목록 색상칩)과 함께 쓸 수 없는데 나란히 열려 있는 설정(판매기간·예약판매), 고를 수 없는데 목록에 나오는 항목(옵션 없는 상품)이 있었다. 원인은 공통 규칙과 공용 부품이 없다는 것이었다.

## 먼저: 글보다 화면

설명 글이 필요하다는 것은 화면이 스스로 말하지 못한다는 뜻이다(2026-11-25 사용자 결정 — "문구로 설명하기보다 화면이 자연스럽게 이끌게"). 칸 하나를 다룰 때 아래 순서로 해결하고, 앞 단계에서 풀리면 뒤 단계로 가지 않는다.

1. **뺀다.** 쓰지 않는 칸, 운영자가 할 일이 없는 내부 값, 같은 말을 되풀이하는 안내를 지운다.
2. **구조로 이끈다.** 하나를 고르면 그에 필요한 입력만 열린다. 고를 수 없는 것은 보이지 않는다. 대부분이 쓰는 값이 기본값이다. 순서가 있는 일은 그 순서대로 놓는다.
3. **결과를 보여 준다.** 설명하는 대신 미리보기·예시·자동 요약을 보인다. "할인율을 숨기면 취소선이 사라집니다"라고 쓰지 않고 두 모습을 나란히 보여 고르게 한다. 입력한 날짜·수량은 "12월 1일부터 7일까지 주문받고 20일에 보냅니다"처럼 한 줄로 되읽어 준다.
4. **이름을 고친다.** 이름만 읽고 알 수 있게 한다('확장 배송비 상태' → '이 상품만의 배송비 규칙'). 버튼은 누르면 일어나는 일을 말한다('옵션목록으로 적용' → '옵션 6개 만들기').
5. **그래도 남는 것만 글로 쓴다.** 화면에 보이지 않는 결과(돈·재고·되돌릴 수 없음)는 칸 아래 한 줄로, 개념 자체가 낯선 것은 "?"로. 한 화면에서 정리 전보다 글이 늘면 다시 본다.

## 규칙

1. **대상을 고르는 칸은 모두 같은 선택창을 쓴다.** 상품·카테고리·템플릿·그룹처럼 다른 대상을 골라 넣는 칸은 공용 선택창 `AdminPickerDialog`(상품은 `AdminGoodsPicker`)를 쓴다: 검색 → 20개씩 목록(상품은 사진) → 줄마다 [선택]. 인라인 검색 목록, 전체를 늘어놓는 드롭다운, 번호·코드를 글자로 적게 하는 칸을 새로 만들지 않는다. 고정된 선택지 몇 개(판매상태, 사용/사용 안 함)만 드롭다운·라디오로 둔다.
2. **고를 수 없는 항목은 목록에 넣지 않는다.** 조회 단계에서 빼고, 선택창에 "○○은 목록에서 뺐습니다" 한 줄(`excludedNote`)로 알린다. 목록에 보여 주고 눌렀을 때 거절하지 않는다. 화면에서 걸러 총 개수·페이지가 어긋나게 하지 않는다.
3. **설명은 마지막 수단이고, 쓸 때는 "?" 한 곳에 쓴다.** 위 '글보다 화면' 1~4로 풀리지 않는 개념에만 이름 옆 "?" 도움말을 단다(모든 칸에 달지 않는다). `AdminField`·`Field`·`SelectField`·`TextArea`의 `help`, 제목은 `GoodEditorSubsection`·`GoodOperationSection`·`GoodChoiceGroup`의 `help`, 그 밖에는 `AdminHelpTip`을 쓴다. 문구는 `lib/admin/help/<화면>.ts`에 모으고 `lib/admin/help/index.ts`에 등록한다.
   - 한두 문장이 기본이다. 무엇인지(`what`)만으로 충분하면 그것만 쓰고, 꼭 필요할 때만 언제 쓰나요(`when`)·어디에 보이나요(`where`)·예시(`example`)·주의(`caution`)를 더한다.
   - 칸 아래에 늘 보이는 글(`hint`)은 **돈·되돌릴 수 없는 결과·필수 조건** 한 줄만 둔다.
   - 말은 자연스러운 한국어로 쓴다. 번역투를 쓰지 않는다([admin-copy-guide.md](admin-copy-guide.md) 원칙 10).
   - "?"는 마우스를 올리거나, 누르거나(터치), 키보드 포커스 뒤 Enter·Space로 열린다.
4. **같은 것은 이름 하나, 입력 방식 하나.** 한 상태를 두 이름으로 부르지 않는다(옵션의 '사용 중지'를 '보관'·'중지'로 부르지 않는다. '보관'은 상품·IP의 상태다). 시각 칸의 표기는 `이름 (KST)`, 날짜+시각은 `datetime-local`로 통일한다.
5. **함께 쓸 수 없는 설정은 고를 때 막는다.** 둘 다 열어 두고 저장할 때 오류로 알리지 않는다. 하나를 고르면 다른 쪽 입력은 닫고, 왜 못 고르는지와 푸는 방법을 그 자리에 적는다(예: 판매 시기의 판매기간·예약판매).
6. **여러 대상에 같은 값은 한 번에 넣는다.** 옵션이 여러 개인 상품의 같은 일정·수량은 한 번 입력해 전체에 적용하고, 대상마다 다르게 넣는 방식은 필요할 때만 펼친다.
7. **내용을 지우거나 바꾸는 버튼은 누르기 전에 무엇이 사라지는지 말한다.** 입력한 값을 버리거나 줄을 지우는 동작은 `adminConfirm`으로 사라지는 것(개수·이름)을 보여 주고 확인받는다. 저장 전이라 되돌릴 수 있더라도, 다시 입력해야 하는 값이 있으면 묻는다.
8. **내부 값을 화면에 내보이지 않는다.** 내부 번호(id)·저장 버전·코드@버전 같은 값은 운영자가 할 일이 없다. 이름과 상태로 보인다.

## 부품

| 쓰임 | 부품 | 위치 |
|---|---|---|
| 대상 선택창 | `AdminPickerDialog`, `AdminPickerPanel` | `components/admin/console/AdminPickerDialog.tsx` |
| 사진처럼 모양으로 고르는 선택창 | `AdminPickerPanel`의 `layout="grid"`(같은 검색·20개씩·[선택]을 격자로) | 같은 파일. 쓰는 곳 `GoodsPhotoPicker`(`components/admin/screens/GoodsPhotoLibraryScreen.tsx`) |
| 여러 개를 이어서 고르기 | `AdminPickerPanel`의 `multiple`·`selectedKeys`·`onDeselect`(닫기 버튼이 [완료]). 고른 줄에 들어간 자리를 보이려면 `selectedLabel`, 일부 줄만 뺄 수 없게 하려면 `deselectBlocked`. 주 동작이 `footer`에 따로 있으면 `closeLabel="닫기"`로 닫는 버튼을 보조 모양으로 둔다 | 같은 파일. 쓰는 곳 `GoodsPhotoPicker`·`CategoryTemplatesScreen` |
| 줄마다 같은 검색을 되풀이하지 않기 | `AdminPickerPanel`의 `initialQuery`(창을 열 때의 검색어). 조건(`filterOptions`)은 바꾸면 [검색] 없이 바로 다시 조회한다 | 같은 파일. 쓰는 곳 `ErpItemPickButton`(고른 뒤 아래의 빈 옵션으로 이어서 고른다) |
| 상품 선택창 | `AdminGoodsPicker` | `components/admin/AdminGoodsPicker.tsx` |
| 이미 가진 목록을 선택창으로 | `adminPickerLocalLoader` | `lib/admin/picker.ts` |
| 폼 안에서 하나를 골라 넣는 칸(고른 이름 상자 + [○○ 고르기] + 숨은 제출 칸) | `AdminPickedBox`, `useAdminPickedValue` | `components/admin/AdminPickedValue.tsx`. 쓰는 곳 `GoodIpField` |
| 템플릿 선택창(고르기 전에 적어 둔 값이 있으면 묻는다) | `GoodsSizeTemplatePicker`, `GoodsAfterSalesTemplatePicker`, `GoodsEventTemplatePicker` | `components/admin/` |
| 원산지·ERP 품목·카테고리 코드 선택창 | `CountryNamePicker`, `ErpItemPickButton`, `CategoryCodeFinder` | `components/admin/` |
| 저장 결과를 모를 때·닫을 때의 말(버튼·문장·확인창) | `SAVE_CHECK_LABEL`, `SAVE_UNKNOWN_MESSAGE`, `TEMPLATE_CLOSE_DIRTY_CONFIRM` | `lib/admin/goods-template-save.ts` |
| 등록 팝업(적은 내용이 있으면 닫기 전에 묻기) | `AdminCreateDialogButton`의 `confirmDiscard` | `components/admin/console/AdminCreateDialogButton.tsx` |
| "?" 도움말 | `AdminHelpTip`, `AdminLabelWithHelp` | `components/admin/console/AdminHelpTip.tsx` |
| 도움말 문구 | `lib/admin/help/<화면>.ts` + `index.ts` | `lib/admin/help/` |

이름은 같은 말로 쓴다: 선택창을 여는 버튼과 창 제목은 `○○ 고르기`, 줄 버튼은 `선택`, 저장 결과를 모를 때는 `저장됐는지 확인`, 보관을 되돌리는 버튼은 `복원`. 화면에 보이는 낱말의 정본은 `lib/admin/vocabulary.ts`(판매상태 값은 `ADMIN_STOCK_LABELS`)다.

## 검사

- `lib/admin/help/help-contract.test.ts`: 도움말 형식(마침표·길이), 쓰지 않는 표현·개발 용어·내부 값 이름.
- `lib/admin/screen-rules-contract.test.ts`: 규칙 1의 전환 현황과 규칙 8의 옛 이름.
  - 자체 선택창(`components/admin`에서 `CustomerServiceDialog`와 `ConsolePagination`을 함께 쓰거나, 검색칸과 `ConsolePagination`을 함께 가진 파일)은 허용 목록 `LEGACY_PICKERS`에 있는 화면뿐이다. 새 화면이 옛 방식을 쓰면 실패하고, 공용 선택창으로 옮긴 화면은 목록에서 지우지 않으면 실패한다(목록은 줄어들기만 한다). 검색칸과 페이지가 있는 목록·관리 화면도 걸려서 주석에 '목록 화면'이라 적어 두었다.
  - `components/admin`·`app/admin`·`lib/admin`의 코드(주석 제외)에 '확장 배송비'·'저장 버전'이 없다.

## 적용 순서

상품등록(첫 PR) → 상품 관리 나머지 → 판매·배송 → CS → 전시·마케팅 → 설정. 화면을 하나 정리할 때 위 8개를 모두 본다.

## 전환 현황

- **상품등록(2026-11-25, #750)**: 상품 등록·수정 화면.
- **상품 관리 나머지(2026-11-25)**: 상품 목록·일괄 변경·바로 수정, 엑셀 등록·내려받기, 카테고리 관리, 자주 쓰는 카테고리, 임시저장 창, 상품속성 관리, ERP 품목, 재고 대조·상품 동영상, 사이즈·A/S·이벤트 템플릿, 상품정보제공고시 템플릿, 사진 보관함, 연관상품, 상품공지사항, 원산지 고르기, 옵션의 ERP 품목 고르기. 저장하려면 채워야 하던 근거 칸은 카테고리 관리와 상품의 수령 방식·주문 후 제작에서 없앴다. 그룹상품(메뉴에서 숨김)은 내부 값 가리기와 확인창만 했다.
- **남은 화면**: `LEGACY_PICKERS`(`lib/admin/screen-rules-contract.test.ts`)에 28개. 판매·배송(배송정보·묶음그룹·배송 안내 템플릿), CS(답변 템플릿·문의 상담), 전시·마케팅(카테고리 전시·쿠폰·쇼핑스토리·리뷰이벤트), 설정(운영자) 화면이다. 상품 수정 화면의 일부 패널(목록 색상칩·예약 일정·정기배송·배송비 규칙)의 저장 결과 확인 버튼(`같은 요청으로 결과 확인`), 선택창 버튼의 옛 이름(`카테고리 선택`·`추가구성상품 찾기`·`템플릿에서 가져오기`), 근거 칸(쿠폰·리뷰·클레임·운영 스위치·배송정보)은 아직 남아 있다. 엑셀 등록의 사방넷 상품 양식에서 연결 IP·브랜드별 IP를 고르는 칸은 아직 전체 드롭다운이다(규칙 1 대상). 상품 목록의 건수 칸 '품절(재고 0)'과 조회 조건·엑셀 내려받기 요약의 '품절'은 같은 조건인데 이름이 다르다.
