# 어드민 룩을 shadcn/ui 템플릿 룩으로 바꾸고, 화면은 kit 부품으로 옮긴다

- Status: accepted (2026-11-05) — 제품 소유자 결정(룩 = 템플릿). 첫 전환 화면은 취소관리 목록이다(어드민 IA 재정의 1단계와 함께 배포).
- 갱신(2026-11-06): MD 승인을 받아 **남은 모든 화면을 한 번에 옮겼다.** 결과 절의 "화면 단위로 바꿔 한 번에 전부 바뀌지 않게 한다"를 대체한다. 결정 5의 ①~④를 마치고 관리자 전용 옛 CSS를 퇴역했다.
- 관련: [ADR-0014](./0014-admin-console-redesign.md)(결정 3을 대체한다 · 결정 1·2·4·5는 유지), [ADR-0011](./0011-lfs-storefront-redesign.md)(공개 표면 White Catalog — 바뀌지 않는다)

## 맥락

어드민을 오픈소스 템플릿으로 전면 개편하는 안을 검토했다. 기준은 회의·요구사항에서 뽑은 세 원칙이다: ① 운영자가 머릿속에 그리는 화면은 스마트스토어다(어휘·IA·동선·정책), ② 화면은 바꿔도 판정은 DB가 한다, ③ 회사의 실제 업무 흐름(엑셀·출고지·운영값)에 연결돼야 끝난다.

엔진째 바꾸는 후보(Medusa v2·Vendure v3·Saleor·Payload 3)는 자체 스키마가 감사 RPC·RLS를 우회하고, React 18 SPA·GPLv3·RBAC/감사 유료 잠금 중 하나 이상에 걸렸다. 어드민 프레임워크(react-admin·Refine)는 쓰기 RPC를 전부 수작업으로 이어야 하고 같은 라우트에서 화면 단위로 바꿀 수 없었다. 그래서 남은 축은 소스를 복사해 소유하는 shadcn/ui와 그 위의 데이터 표(구 tablecn, 현 Dice UI data-table)다.

취소관리 목록 PoC(2026-11-05, 격리 Supabase 스택·운영 빌드)에서 확인한 것:

- 조회 RPC·일괄 처리 서버 액션·URL 계약을 그대로 두고 화면만 바꿀 수 있다. 일괄 검토중·거부가 DB에 반영되고, DB가 거절한 승인은 결과표에 사유로 남았다.
- 필터·정렬·페이지·행 수·기간·검색이 기존 URL 키로 동작한다. Dice UI의 `useDataTable`(nuqs, `perPage`·`sort=col.desc`·열별 키)은 그 계약과 맞지 않아 쓰지 않고 어댑터(`useConsoleTable`)로 대신했다.
- 기존 테스트 12,532개 중 1개만 바뀌었다(컴포넌트 이름으로 찾던 라우트 테스트).
- **기존 관리자 CSS는 cascade layer 밖에 있고 Tailwind v4 유틸리티는 `@layer utilities` 안에 있어, 선택자 우선순위와 상관없이 기존 요소 규칙이 kit 부품을 덮는다.** PoC는 kit 부품(`data-slot`)에만 `all: revert-layer`를 거는 다리로 풀었다.
- 비용: 취소 라우트 클라이언트 JS gzip +179KB(Base UI·TanStack Table v9·react-day-picker·date-fns·cmdk·lucide), 전역 CSS gzip +7~9KB(템플릿 룩·tw-animate-css 포함, 어드민 CSS처럼 루트 레이아웃이 모든 페이지에 싣는다), 새 의존성 10개, 소유할 kit 소스 34파일·약 6,500줄(쓰지 않는 레지스트리 파일 정리 뒤).

PoC 1차는 kit에 White Catalog 관리자 토큰(판매자센터 초록·각진 모서리)을 입혔다. 두 룩을 같은 화면에서 비교한 뒤 제품 소유자가 템플릿 룩을 택했다.

## 결정

1. **룩은 shadcn/ui base-nova·neutral 기본값을 그대로 쓴다.** 색·모서리·그림자·부품 모양을 템플릿에서 가져오고, 서체만 어드민 로컬 Pretendard를 유지한다(한글 본문). ADR-0014 결정 3(White Catalog 토큰 편입)을 대체한다. `DESIGN.md` 「판매자센터 기준(2026-10-16)」의 색·크기·표 밀도 기준은 퇴역했다.
2. **스마트스토어 기준은 룩이 아니라 업무 쪽에 남는다.** 메뉴 IA·라벨 어휘(ADR-0014 결정 4)·조회 조건·처리 동선·정책은 그대로 스마트스토어를 기준으로 한다. 템플릿의 영어 라벨·상태명·빈 상태 문구는 운영팀 어휘로 바꾸고, 템플릿에 없는 스마트스토어식 조회 요소는 kit 부품으로 만든다 — 기간 프리셋(오늘·1주·1개월·3개월)은 기존 콘솔과 같은 KST 계산(`consoleDatePresets`)으로 그린다.
3. **부품은 shadcn CLI로 복사해 `components/admin/kit/`에 두고 우리가 소유한다.** base는 Base UI 하나다(Combobox·Dice UI가 이미 Base UI를 쓰므로 Radix를 함께 두지 않는다). 목록 표준은 두 갈래다 — 서버가 행을 그리는 목록은 공용 `ConsoleGrid`(kit 표 모양·조회항목 설정·행 선택), 클라이언트 열 정의가 필요한 목록(취소·반품·교환)은 Dice UI data-table + `useConsoleTable` 어댑터. 어느 쪽이든 화면별 URL 계약(`adminClaimHref` 등)이 진실원이다. kit 팝업은 `AdminKitPortalHost`가 둔 `body > .wc-admin.admin-kit-portal`에 붙는다.
4. **판정은 바꾸지 않는다.** RPC·RLS·서버 액션·감사·엑셀 입출력·권한(capability) 판정은 그대로이고, 화면은 그 결과를 보여 주기만 한다.
5. **순서(2026-11-06 완료).** ① 관리자 CSS를 utilities보다 낮은 cascade layer로 내리고 `revert-layer` 다리를 퇴역한다 ② 셸(사이드바·헤더)을 kit으로 바꾼다 ③ 목록 화면을 공용 표로 모은다 ④ 폼·상세·설정을 옮긴다 ⑤ 옛 관리자 CSS를 퇴역한다.
6. **합격 기준은 ADR-0014 결정 5(S1~S5)를 그대로 쓴다.** 전면 전환 뒤 운영팀이 다시 수행한다.

## 검토한 대안

- **kit 부품 + White Catalog 관리자 토큰(PoC 1차).** 운영팀이 이미 익힌 판매자센터 색을 유지하고 문서 개정이 적다. 제품 소유자가 템플릿 룩을 택해 기각.
- **엔진 교체(Medusa·Vendure·Saleor·Payload).** 원칙 ②를 깨고(자체 스키마) 한국 결제·클레임·출고 흐름을 다시 만들어야 한다. 기각.
- **어드민 프레임워크(react-admin·Refine).** 쓰기 RPC 수작업 배선, SPA 이중화 또는 유지보수 정지. 기각.
- **Dice UI `useDataTable`의 URL 형식을 그대로 채택.** 화면마다 URL이 두 벌이 되고 엑셀·상세 링크·공유 링크가 갈라진다. 기각.
- **화면 단위 점진 전환(2026-11-05 결과 절의 원래 계획).** 운영팀이 두 룩을 오가는 기간을 줄이려고 MD 승인 뒤 한 번에 옮겼다. 셸·공용 부품을 먼저 바꿔 중간 상태에서도 전 화면이 같은 룩이 되게 한 뒤 화면군 8개를 병렬로 옮겼다.

## 결과

- **Cascade.** 관리자 스타일시트는 `@layer components` 안에 있고, 모든 선택자 주체에 `:not([data-slot])`이 붙어 kit 부품에 닿지 않는다(`revert-layer` 다리 없음). 콘솔 루트(셸·포털·검표)는 `.wc-root`가 아니다 — 공개 표면의 언레이어드 기본·포커스 규칙이 레이어를 이기기 때문이다. 공개 미리보기만 자기 `.wc-root` 래퍼를 둔다.
- **토큰.** shadcn 토큰(+사이드바·차트)은 `admin-kit.css`의 `.wc-admin`에만, 의미색 등 콘솔이 여전히 읽는 `--wc-*` 이름은 `wc-admin.css`가 shadcn 토큰에 잇는다. 숫자 입력 스피너 숨김(10/27 R18)·테두리/포커스 기본은 `admin-kit.css`의 `@layer base`가 kit 부품과 네이티브 입력 모두에 건다.
- **옛 CSS 퇴역.** 관리자 전용 스타일시트 약 619KB·60여 파일 → 약 12KB·5파일. 남은 것은 공개 상품 상세 미리보기 보정과 처리 기한·저평점 데이터 속성 색(`wc-admin-surfaces.css`), 콘솔 토큰·키보드 툴팁(`wc-admin.css`), 콘솔 안에 그리는 고객 부품 보정(`admin-sales-console.css`의 ClaimWithdrawal, `admin-order-detail.css`의 ShipmentDetails), 쇼핑스토리 모바일 미리보기. `admin-kit-vocabulary.css`는 콘솔이 소유하지 않는 고객 부품의 `btn`·`muted`·`mono`와 일부러 네이티브로 둔 입력·체크박스·라디오에 kit 모양을 `@apply`로 입힌다.
- **셸.** kit Sidebar(inset·아이콘 접힘·768px 아래 시트·⌘/Ctrl+B), 접힘 상태는 `sidebar_state` 쿠키로 다음 화면에도 이어진다. 상단 막대(h-12 sticky, `html` scroll-padding-top 48px)에 사이드바 버튼·현재 위치·콘솔 전환·바로가기·업무 도구·계정 메뉴. 우측 72px 업무 도구 레일은 상단 아이콘 버튼과 오른쪽 시트로 옮겼다. 하단 고정 바는 `--admin-content-left`·`--admin-content-inset`(admin-kit.css)으로 본문 패널에 맞춘다.
- **경계 계약.** `app/admin-kit-contract.test.ts`가 지킨다 — shadcn 토큰 값은 `.wc-admin` 안에만, 옛 관리자 CSS는 `@layer components` 안·kit 부품 제외 가드, kit 옷 파일은 kit 부품과 공개 미리보기를 건드리지 않고 관리자 CSS 뒤에 싣는다, kit import는 어드민 코드에서만, Dice UI URL 상태(nuqs·`useDataTable`)는 쓰지 않는다.
- **kit vendor 소스에 얹은 ICONS 수정**: 한국어 문구·`ko` 달력, 포털 컨테이너(Dialog·Popover·Select·DropdownMenu·Tooltip·Sheet·AlertDialog·HoverCard), Dice/Base UI 타입 보정, ActionBar 선택 유지, 툴바의 `filtersEnd`·`viewOptions` 자리(조회항목 설정 `components/admin/kit/console-table-settings.tsx` — 공용 표와 같은 그리드 설정 저장 키), `buttonVariants`·`badgeVariants`가 `cn`으로 겹치는 클래스를 합친 결과를 돌려줌(Link·label 버튼의 테두리), `useRender`를 부르는 부품(Badge·Breadcrumb·ButtonGroup·Item)의 `"use client"`, 방향 변형 `data-horizontal`/`data-vertical`을 Base UI 1.9의 `data-orientation`에 잇는 `@custom-variant`, `useIsMobile`을 외부 저장소 구독으로, Input의 파일 선택 버튼 모양(회색 버튼), SheetContent의 `showOverlay`(비모달 업무 도구 시트는 배경막 없이), 모바일 메뉴 시트의 안쪽 닫기 버튼 유지, ⌘/Ctrl+B 단축키는 입력칸·contentEditable에서 무시(본문 편집기의 굵게 우선), SidebarInset은 div(셸이 본문 칸만 `<main>`), SidebarContent는 `no-scrollbar` 대신 얇은 스크롤바(넘침 단서 — `@utility no-scrollbar`는 `admin-kit.css`가 Command용으로 정의), 데스크톱 사이드바 `print:hidden`, data-table의 스크롤 영역 포커스(`role="region"`·tabIndex 0)와 보이는 폭 가운데 빈 상태. 쓰지 않는 레지스트리 파일은 두지 않는다.
- **함정.** kit `Button`은 type을 주지 않으면 `type="button"`이다(Base UI) — form 제출 버튼은 `type="submit"`을 적는다. Tailwind는 완성된 클래스 문자열만 생성하므로 보간으로 클래스를 조각내지 않는다. 네이티브 `<dialog>`에 `flex` 같은 display 유틸리티를 그대로 달면 UA의 `dialog:not([open])` 숨김을 이겨 닫힌 상태로 본문에 펼쳐진다 — `hidden … open:flex`로 쓴다. Base UI Dialog 배경막은 비모달에도 그려진다.
- 한글 입력은 우리가 지킨다: Dice UI 텍스트 필터는 조합 중에도 값을 확정해 쓰지 않고, cmdk #363·Base UI #5574가 열려 있는 동안 조합 회귀 테스트를 둔다.
- Base UI·TanStack Table v9·`cn`(0.x)의 판 올림은 vendor 소스 갱신 작업이 된다. shadcn CLI 갱신은 diff로 받아 위 ICONS 수정을 다시 얹는다.
