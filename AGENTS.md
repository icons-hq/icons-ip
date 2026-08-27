<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

## 배포와 Preview

- Vercel Git 자동 배포는 `vercel.json`의 `git.deploymentEnabled: false`로 비활성화되어 있다. Preview와 production 배포는 GitHub Actions의 Vercel CLI 경로만 사용한다.
- PR preview는 전용 Supabase 프로젝트를 본다. preview 배포 전에 `deploy-supabase-preview`가 migration을 올리므로 스키마 변경 PR도 preview에서 앱과 DB 버전이 맞는다. preview가 production 프로젝트를 가리키게 만들지 않고, preview DB에 운영 데이터를 넣지 않는다(ADR-0006).

## 공통 참조 규칙

작업 성격에 맞는 문서를 먼저 읽는다. 모든 작업에 모든 문서를 강제하지는 않는다.

- UI 문구, 도메인 용어, 사용자-facing 이름을 다룰 때는 `CONTEXT.md`를 먼저 읽는다.
- 제품 범위, v1/v2 경계, P0~P3 우선순위가 걸린 작업은 `docs/PRD.md`를 먼저 읽는다.
- DB, Auth, 결제, 권한, 라우팅 구조, mock→real 이전 작업은 `docs/ARCHITECTURE.md`를 먼저 읽는다.
- 카드 리워드, 뽑기권, RNG, 참여형 게임이 걸린 작업은 `docs/adr/0003-free-reward-pivot.md`·`docs/adr/0004-draw-ticket-card-packs.md`를 함께 읽는다. `docs/adr/0002-cross-platform-popup-game-miniapps.md`는 superseded 이력이며 Expo나 범용 게임 미니앱 구현의 근거로 쓰지 않는다. 유료 가챠 유물(`wallets`·`pulls` 등)을 다루면 `docs/adr/0001-paid-digital-gacha.md`(superseded)를 참조한다.
- 19+ 유한 실물 쿠지는 기존 디지털 카드·뽑기권·참여형 게임과 분리된 `prize_sale` 도메인이다. 현재 구현 범위와 선행 증거는 GitHub #212·#213을 따른다.
- issue tracker, triage label, agent skill 운영 작업은 `docs/agents/`를 먼저 읽는다.

문서가 서로 충돌하면 조용히 덮어쓰지 말고, 어떤 문서와 충돌하는지 먼저 밝힌다. 코드와 문서가 충돌하면 현재 동작은 코드가 진실이고, 문서는 별도 요청이 있을 때 갱신한다.

## 도메인 언어

- `CONTEXT.md`의 용어를 우선한다.
- 수집형 디지털 `카드`와 실물 `굿즈`를 혼용하지 않는다.
- `팬덤 가입`은 v1에서 무료 `팔로우`다. 유료 `멤버십`과 섞지 않는다.
- `트레이드`는 카드 C2C(구 명칭 "교환"), `마켓`은 굿즈 C2C다. 둘 다 v1에서는 플레이스홀더/v2 범위다. `교환`은 굿즈 `클레임` 유형(회수 후 재출고)으로만 쓴다.
- 유료 가챠·`충전금`은 폐기됐다(ADR-0003·ADR-0004). `카드`는 `뽑기권`(UI 표기 "카드팩") 개봉과 참여형 게임의 무상 리워드로만 발급된다. 굿즈·티켓 신규 결제의 provider는 Korpay이고 provider-neutral seam 뒤에서 gate로 제어된다. Toss는 `provider=toss`인 기존 거래의 조회·취소·웹훅에만 남긴다. 현재 gate 상태·rollout 증거·잔여 위험은 `docs/runbooks/korpay-production-rollout.md`를 따른다.
- 범용 온라인 팝업 운영 레이어와 Expo webview 호스트는 현 로드맵 범위가 아니다. 기존 게임 `goods` variant는 운영 콘솔에서 읽기 전용이며, 남아 있는 mock 연출은 실제 경품·구매권을 만들지 않는다. 실물 쿠지에 재사용하지 않는다.

## 구현 원칙

- 공개 브라우징을 유지한다. IP·굿즈·카드·이벤트·커뮤니티 읽기는 기본 공개이고, 로그인은 구매·카드팩 개봉·게임 플레이·예매·작성·팔로우 같은 보호 액션 시점에 요구한다.
- 돈, 재고, 카드 발급 RNG, 뽑기권 발급·개봉, 유한 실물 경품 배정, 티켓 검표는 클라이언트나 앱 레벨 상태에 맡기지 않는다. Supabase Postgres RPC, RLS, 행 잠금, 멱등 처리를 기준으로 구현한다.
- 결제 callback body와 클라이언트 성공 신호는 확정의 진실원이 아니다. 굿즈·티켓 seam은 서버 전용 `PaymentGateway.confirm/reconcile` 결과와 DB 멱등 finalizer로만 신규 결제를 확정한다. 기존 Toss 거래만 웹훅 수신 뒤 provider 재조회 결과로 정합화한다.
- 관리자 권한은 `profiles.role`과 RLS 양쪽에서 확인하고, 민감 작업은 감사 가능해야 한다.
- `exchange`와 `market` 화면은 v2 전까지 프로토타입/플레이스홀더로 유지한다.

## 이미지 생성 워크플로우

- 이미지 생성·편집과 모델 기반 비전 QA는 현재 Codex 앱 작업에서 기본 내장 `imagegen`과 이미지 비전을 직접 사용한다.
- 이 기본 방식은 신규 생성뿐 아니라 레퍼런스 기반 재생성, 배경 교체·제거 같은 편집, 변환 전후 검수, 인게임 스크린샷 피드백에도 동일하게 적용한다.
- 사용자가 명시적으로 변경하지 않는 한 이미지 작업을 CLI/API, `codex exec`, 이미지 생성·편집 스크립트, 중첩 Codex 작업으로 대체하거나 fallback하지 않는다.
- 저장소 코드는 모델 호출 없이 기술 QA, 포맷 정규화, trim, atlas, manifest처럼 결정론적인 패키징만 수행한다. 작업별 예외와 변환 계약은 해당 에셋 파이프라인 문서를 정본으로 삼는다.
- 결정론적 변환이 있는 자산은 변환 전 후보와 최종 출력 모두를 현재 Codex 앱에서 직접 보고 각각 정확한 SHA-256에 비전 QA를 결속한다. 모델 검토가 빠졌거나 검토 대상 해시가 다르면 승인 가능한 산출물로 게시하지 않는다.
- 계약된 IP의 배우·의상·세트를 재현할 때는 공식 제공 자료를 최우선 레퍼런스로 붙이고, 허용된 시즌·초상·음성 범위를 해당 프로젝트 스펙에 명시한다.

## 프론트엔드 규칙

- Next.js 16, React 19, Tailwind v4 기준으로 작성한다.
- `app/globals.css`의 "Holographic Midnight" 디자인 시스템과 기존 컴포넌트 패턴을 우선한다.
- 색·타이포·컴포넌트·표면별 디자인 규율은 루트 `DESIGN.md`(기계 판독용 디자인 스펙)를 따른다. 토큰 진실원은 `app/globals.css`다.
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

## 작업 계획과 Git

- 여러 파일을 바꾸는 작업은 수정 전에 범위와 순서를 짧게 공유한다.
- `main`에 push하거나 PR을 merge하는 작업은 production 배포 경로를 시작할 수 있으므로, 단순 Git 정리로 취급하지 말고 사용자 요청/확인 범위 안에서만 수행한다.
- GitHub Actions 앱 빌드는 Node 26을 사용하지만, Vercel project/runtime Node.js Version은 공식 production Functions 지원 범위인 24.x로 유지한다.
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

GitHub Issues (`icons-hq/icons-ip`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
