<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

## 기본 작업 원칙

- 기본 답변 언어는 한국어다.
- 사용자가 명시적으로 수정·생성·삭제를 요청하지 않으면 읽기 전용으로 행동한다.
- 변경은 요청 범위 안에서만 최소로 수행한다. 요청받지 않은 기능 추가, 리팩터링, 최적화는 하지 않는다.
- 키, 토큰, 인증 정보, 결제 식별자 같은 민감 정보는 출력하지 않는다.
- 삭제, 덮어쓰기, 외부 API 쓰기, production write처럼 되돌리기 어려운 작업은 먼저 확인한다.
- `gh issue view/list`, `gh pr view`, remote 상태 확인 같은 읽기 작업은 필요 시 수행할 수 있다.
- issue 생성/수정, PR 생성, push, 배포, Supabase remote 적용, 외부 서비스 설정 변경은 사용자가 명시적으로 요청했거나 직전에 확인한 경우에만 수행한다.
- `main` push 또는 `main`으로 merge되는 PR은 GitHub Actions를 통해 Supabase remote migration과 Vercel production deploy를 유발할 수 있으므로 production write로 취급한다.
- Vercel Git 자동 배포는 `vercel.json`의 `git.deploymentEnabled: false`로 비활성화되어 있다. Preview와 production 배포는 GitHub Actions의 Vercel CLI 경로만 사용한다.

## 공통 참조 규칙

작업 성격에 맞는 문서를 먼저 읽는다. 모든 작업에 모든 문서를 강제하지는 않는다.

- UI 문구, 도메인 용어, 사용자-facing 이름을 다룰 때는 `CONTEXT.md`를 먼저 읽는다.
- 제품 범위, v1/v2 경계, P0~P3 우선순위가 걸린 작업은 `docs/PRD.md`를 먼저 읽는다.
- DB, Auth, 결제, 권한, 라우팅 구조, mock→real 이전 작업은 `docs/ARCHITECTURE.md`를 먼저 읽는다.
- 카드 리워드, 뽑기권, RNG, 게임 미니앱, 래플이 걸린 작업은 `docs/adr/0003-free-reward-pivot.md`·`docs/adr/0004-draw-ticket-card-packs.md`·`docs/adr/0002-cross-platform-popup-game-miniapps.md`도 함께 읽는다. 유료 가챠 유물(`wallets`·`pulls` 등)을 다루면 `docs/adr/0001-paid-digital-gacha.md`(superseded)를 참조한다.
- issue tracker, triage label, agent skill 운영 작업은 `docs/agents/`를 먼저 읽는다.

문서가 서로 충돌하면 조용히 덮어쓰지 말고, 어떤 문서와 충돌하는지 먼저 밝힌다. 코드와 문서가 충돌하면 현재 동작은 코드가 진실이고, 문서는 별도 요청이 있을 때 갱신한다.

## 도메인 언어

- `CONTEXT.md`의 용어를 우선한다.
- 수집형 디지털 `카드`와 실물 `굿즈`를 혼용하지 않는다.
- `팬덤 가입`은 v1에서 무료 `팔로우`다. 유료 `멤버십`과 섞지 않는다.
- `교환`은 카드 C2C, `마켓`은 굿즈 C2C다. 둘 다 v1에서는 플레이스홀더/v2 범위다.
- 유료 가챠·`충전금`은 폐기됐다(ADR-0003·ADR-0004). `카드`는 `뽑기권`(UI 표기 "카드팩") 개봉과 참여형 게임의 무상 리워드로만 발급된다. 굿즈·티켓은 토스페이먼츠로 직접 결제한다.

## 구현 원칙

- 현재 앱은 Claude Design 핸드오프 기반 시각적 프로토타입에서 출발했다. `lib/data.ts` mock을 시드로 삼아 도메인별로 Supabase fetch/RPC로 점진 이전한다.
- 공개 브라우징을 유지한다. IP·굿즈·카드·이벤트·커뮤니티 읽기는 기본 공개이고, 로그인은 구매·카드팩 개봉·게임 플레이·예매·작성·팔로우 같은 보호 액션 시점에 요구한다.
- 돈, 재고, 카드 발급 RNG, 뽑기권 발급·개봉, 래플 추첨, 티켓 검표는 클라이언트나 앱 레벨 상태에 맡기지 않는다. Supabase Postgres RPC, RLS, 행 잠금, 멱등 처리를 기준으로 구현한다.
- 결제 확정의 진실원은 토스페이먼츠 웹훅이다. 클라이언트 성공 콜백만으로 주문, 충전, 티켓을 확정하지 않는다.
- 관리자 권한은 `profiles.role`과 RLS 양쪽에서 확인하고, 민감 작업은 감사 가능해야 한다.
- `exchange`와 `market` 화면은 v2 전까지 프로토타입/플레이스홀더로 유지한다.

## 프론트엔드 규칙

- Next.js 16, React 19, Tailwind v4 기준으로 작성한다.
- Next.js API, 라우팅, proxy/middleware, metadata, caching 관련 코드를 쓰기 전에는 `node_modules/next/dist/docs/`에서 현재 버전 문서를 확인한다.
- `app/globals.css`의 "Holographic Midnight" 디자인 시스템과 기존 컴포넌트 패턴을 우선한다.
- 색·타이포·컴포넌트·표면별 디자인 규율은 루트 `DESIGN.md`(기계 판독용 디자인 스펙)를 따른다. 토큰 진실원은 `app/globals.css`이며, 문서와 코드가 충돌하면 코드가 진실이다.
- 라우트는 `app/**/page.tsx`에서 screen 컴포넌트로 연결하는 현 구조를 존중한다.
- 프로토타입 라우트 id와 실제 경로 매핑은 `lib/routes.ts`를 기준으로 한다.

## 데이터베이스와 Supabase

- 스키마 변경은 `supabase/migrations/`에 기록한다. 이미 공유/적용된 migration은 수정하지 않고 새 migration을 추가한다. 적용 전 DRAFT migration은 일관성을 위해 정리할 수 있다.
- 사용자별 데이터는 RLS로 격리한다. 카탈로그성 데이터는 공개 읽기, 쓰기는 staff/admin 범위로 유지한다.
- service role은 서버 신뢰 경계 안에서만 사용하고, 클라이언트 번들에 노출하지 않는다.
- Supabase default privileges가 public 스키마 신규 함수에 anon/authenticated/service_role의 execute를 자동 부여한다. 함수 생성 후 `revoke all ... from public, anon, authenticated, service_role`로 봉인하고 필요한 롤에만 grant한다 — `from public`만으로는 봉인되지 않는다.
- 카드풀 발급 확률값, 카드·뽑기권 발급 이력, 결제 raw payload, 감사 로그는 추적 가능성을 해치지 않도록 다룬다.

## 검증

- 코드 변경 후 가능한 범위에서 `npm run lint`와 `npm run build`를 실행한다.
- Supabase migration을 변경한 경우 Supabase CLI가 설정되어 있으면 로컬 DB에 적용 검증을 수행한다.
- 실행하지 못한 검증은 최종 응답에 명시한다.

## 작업 계획과 Git

- 여러 파일을 바꾸는 작업은 수정 전에 범위와 순서를 짧게 공유한다.
- 사용자가 명시적으로 요청하지 않으면 branch 생성, staging, commit, push, PR 생성을 하지 않는다.
- `main`에 push하거나 PR을 merge하는 작업은 production 배포 경로를 시작할 수 있으므로, 단순 Git 정리로 취급하지 말고 사용자 요청/확인 범위 안에서만 수행한다.
- GitHub Actions 앱 빌드는 Node 26을 사용하지만, Vercel project/runtime Node.js Version은 공식 production Functions 지원 범위인 24.x로 유지한다.
- 사용자 변경으로 보이는 파일은 되돌리지 않는다. 같은 파일을 수정해야 하면 현재 내용을 기준으로 필요한 부분만 좁게 편집한다.
- PR 본문과 커밋 메시지에 Claude/Claude Code 출처 표기(`🤖 Generated with [Claude Code]...`, `Co-Authored-By: Claude ...`)를 넣지 않는다. 커밋의 `Co-Authored-By`는 사용자 글로벌 훅이 이미 제거하지만, PR 본문은 직접 생략한다.

## 문서 운영

- `CONTEXT.md`는 용어집만 담는다. 구현 세부사항, 스펙, 작업 메모를 넣지 않는다.
- `README.md`는 사람을 위한 개발/온보딩 문서다. `AGENTS.md`는 에이전트 작업 규칙만 담는다.
- 되돌리기 어렵고, 맥락 없이는 의아하며, 실제 trade-off가 있었던 결정만 `docs/adr/`에 기록한다.
- 제품 범위 변경은 `docs/PRD.md`, 구현 방향 변경은 `docs/ARCHITECTURE.md`, 에이전트 작업 규칙 변경은 이 파일에 기록한다.
- 코드 변경이 `CONTEXT.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/adr/`의 명시 원칙을 바꾸는 경우에만 관련 문서를 함께 갱신한다. 단순 구현, 버그 수정, UI 조정은 문서를 자동 갱신하지 않는다.
- Codex용 durable instruction surface는 `AGENTS.md`다. `CLAUDE.md`는 필요한 경우 `@AGENTS.md` 포인터로만 둔다.

## Agent skills

### Issue tracker

GitHub Issues (`sangwopark19/icons-ip`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
