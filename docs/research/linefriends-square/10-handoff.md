# linefriends-square 재현 스펙 — 10. 구현 핸드오프

> 컨텍스트 없는 새 세션이 이 문서 하나에서 출발해 S1부터 구현을 시작하기 위한 진입점. 2026-08-26 작성.
> 여기 없는 내용은 전부 정본 문서를 따른다 — 이 문서는 요약·포인터·함정 목록이지 스펙이 아니다.

## 현재 상태

- **완료**: 그릴링으로 전 결정 확정 → 용어(`CONTEXT.md`)·[ADR-0011](../../adr/0011-lfs-storefront-redesign.md)·재현 스펙(이 디렉토리 00~08)·[DESIGN.md](../../../DESIGN.md)(White Catalog v4)·[구현 계획](./09-implementation-plan.md) 작성, 이슈 발행, 통합 브랜치·draft PR 오픈. **코드 구현은 미착수.**
- **승인 상태**: 계획서 전체와 §4 기본값 7개(모바일 5탭 바 채택 · `/offline-popups` · 본인인증/SNS는 T-C · 3:4 통일 · green 단일 액센트 · `goods.type` 카테고리 · native scroll-snap · 코인→뽑기권)까지 **사용자 승인 완료**. 재질문 불필요.

## 좌표

| 항목 | 위치 |
|---|---|
| 에픽 | icons-hq/icons-ip#322 (스테이지 체크리스트 포함) |
| 스테이지 티켓 | S1 #323 · S2 #324 · S3 #325 · S4 #326 · S5 #327 · S6 #328 · S7 #329 · S8 #330 · S9 #331 — **티켓 본문이 각 스테이지 범위 정본** |
| T-C 백로그 | #332 (ready-for-human) |
| 통합 브랜치 | `ps/feat/lfs-storefront-redesign` (S0 문서 커밋 5개) |
| preview | 통합 브랜치 → main **draft PR** (S9 전 머지 금지, preview 확인용) |
| 보드 | Project 8 (ICONS v1 Launch Readiness) — 전 이슈 등록됨 |
| 스크린샷 원본 | `outputs/lfs-reference/` — **gitignored, 이 머신 로컬 전용**(원격에 없음). 스펙 문서가 파일명으로 인용 |

## 다음 작업 = S1 (#323)

브랜치 `ps/feat/wc-s1-foundation`을 통합 브랜치에서 분기 → PR base는 **통합 브랜치**(main 아님). 이후 스테이지도 동일. S4~S6은 병렬 가능(파일 소유권은 티켓에 명시됨).

권장 착수 순서: R-스펙 [07](./07-design-tokens.md) 정독 → `wc-foundation.css` → `components/wc/` 프리미티브 → `lib/routes.ts` 내비 단일화 → `app/wc-design.test.ts` → 기본 표면(not-found·error·loading).

## 이 세션에서 발견한 함정 (구현 시 필수 숙지)

1. **`wc-foundation.css`는 전역 element 스타일 금지.** 지면·본문 스타일은 `.wc-root` 스코프로만 — 미이행 표면과 어드민(editorial 계열 유지)이 깨진다. S9에서만 전역 승격.
2. **`app/editorial-design.test.ts`가 `app/layout.tsx`의 CSS 임포트 목록·순서를 문자열로 단언한다.** wc CSS 임포트를 추가하면 이 테스트를 함께 갱신해야 한다(행동 단언은 유지). 같은 파일이 팔레트 hex·reduced-motion도 파일 문자열로 검증한다.
3. **컴포넌트 테스트 87개가 클래스명·DOM 구조를 단언한다**(`renderToStaticMarkup`). 표면을 이행하는 스테이지에서 함께 재작성한다 — 미리 일괄 수정하지 말 것.
4. **내비 진실원이 2개다**: `lib/routes.ts` `NAV_ITEMS` + `Home.tsx` 하드코딩 `NAV_LINKS`(라벨도 불일치). S1은 routes.ts만 바꾸고, Home 쪽은 S3에서 화면째 교체된다. `PATHS`에 없는 id는 조용히 `'/'` 폴백하는 함정 있음.
5. **`Nav.tsx:36`·`SiteFooter.tsx:30`의 동일 숨김 조건**(`/`·auth·games·admin) — 홈 우회 제거는 S3에서. `MobNav.tsx`·`Atmos.tsx`는 dead(테스트만 참조, S9 제거 대상).
6. **홈 `Home.tsx` 1,030줄은 특정 카탈로그 레코드 id에 하드 커플링**(`e1/e2/e4`·`g3/g6/g9`·`c3/c11`·IP 5종) — S3에서 `/about`으로 옮길 때 이 커플링을 그대로 보존 이전한다(콘텐츠 섹션만, 자체 헤더/푸터 제거).
7. **행동 QA는 prod 빌드로.** 이 repo의 `next dev`는 Playwright 하이드레이션이 안 된다.
8. **Next.js는 훈련 데이터와 다르다** — 코드 작성 전 `node_modules/next/dist/docs/` 해당 가이드 선독(루트 AGENTS.md 최상단 지시).
9. **로컬 빌드도 env가 있으면 Supabase 모드**다(mock 아님). 시드는 카탈로그만.
10. **SQL smoke는 `npx supabase@2.101.0`으로 CI 미러링**(로컬 이미지와 CI 이미지 차이 이력). 신규 함수는 `revoke all ... from public, anon, authenticated, service_role` 봉인 후 필요 롤만 grant — `from public`만으로는 봉인 안 됨.
11. **워크트리에서 `next build` 실패 이력**(심링크 불가·npm install 필요) — 병렬 스테이지를 워크트리로 돌릴 때 각 워크트리에서 `npm install` 필요.
12. **main 병행 변경 주의**: 첫 판매 게이트(#315~#318)가 main에 계속 들어온다. 통합 브랜치를 주기적으로 main에 rebase.
13. **금지선**: 레퍼런스 이미지·카피·로고·핑크(#F83BAA·#FD4BBB) 사용 금지(wc-design.test.ts가 hex 부재를 기계 검증하도록 설계됨) · 결제/재고/RNG/검표 동결(DESIGN §11, 쿠폰 S7만 서버 RPC 금액 개입) · 사용자-facing '가챠/뽑기/충전' 어휘 금지 · PR 본문·커밋에 Claude 출처 표기 금지.
14. **레퍼런스 재방문은 최소화**(Cloudflare 차단 이력). 수치는 R-스펙이 정본이고, 시각 대조는 로컬 스크린샷으로.

## 완료 보고 관례

스테이지 PR 머지 후: 에픽 #322 체크리스트 갱신 + 티켓 Close + Project Done. S9 후 main 일괄 전환은 **사용자 승인 필요**(prod 배포 경로).
