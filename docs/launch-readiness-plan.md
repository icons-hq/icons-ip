# ICONS v1 출시 준비 계획 (Launch Readiness)

> 상태: Active · 작성 2026-07-13 · 범위 갱신 2026-08-14 · 근거: 그릴링 세션(범위 확정) + 코드베이스 심층 인벤토리
> 실행판: [GitHub Project #8 — ICONS v1 Launch Readiness](https://github.com/users/sangwopark19/projects/8)
> 각 이슈의 스펙 진실원은 issue body다. 이 문서는 **기준선·갭 분석·트랙 구조**의 진실원이다.
>
> ⚠️ 이 문서는 "**v1 기능이 존재하는가**"를 다룬다. "실제로 돈을 받고 물건을 보낼 수 있는가"는 별개 마일스톤이며 [`first-sale-readiness.md`](./first-sale-readiness.md)가 진실원이다.

---

## 1. 기준선 (확정 결정)

1. **출시 범위 = 원 PRD v1 전체**([`docs/PRD.md`](./PRD.md) §4.1) — 인증·온보딩, IP 허브, 굿즈 커머스, 카드(무상 리워드), **팝업 티케팅(P3) 포함**, 커뮤니티, 검색, `/admin`.
2. 단 PRD §5.4(유료 가챠)는 폐기됐으므로([ADR-0003](./adr/0003-free-reward-pivot.md)·[ADR-0004](./adr/0004-draw-ticket-card-packs.md)) 카드 도메인은 **뽑기권(카드팩) 개봉 + 참여형 게임 무상 리워드** 스펙으로 치환해 읽는다.
3. **범용 온라인 팝업 운영 레이어와 Expo webview 호스트는 Not Planned**다. `popups` 운영 단위·미션·등급·범용 래플·브랜드 리포트·네이티브 브리지를 Post-launch 예약 범위로 유지하지 않는다. 현재 웹 티케팅과 카드 보상형 참여형 게임은 이 결정과 별개로 유지한다.
4. PRD `S`(권장) 항목 중 다음을 출시 블로커로 **승격**: 계정 삭제·회원 탈퇴, 마이페이지 통합 진입점, 알림함·IP 알림 설정, 커뮤니티 보강(트렌딩 실데이터·피드 개인화·포스트 수정·댓글 모더레이션·운영 정책), 어드민 운영 4종(회원 조회·제재 / 아트워크 업로드 / 카탈로그 보관 / 배너·공지·큐레이션).
5. **짝 규칙**: 모든 사용자 기능은 대응하는 어드민 운영 기능을 함께 출시한다(주문↔주문 콘솔, 예매↔회차·검표 콘솔, 알림↔발송 콘솔).
6. 어드민 기준선은 PR #86(사이드바 콘솔 + 실데이터 매출 대시보드, merge 완료)이다.

## 2. 현재 상태 (이미 배선 완료)

- **인증/온보딩**: 이메일/PW 가입·로그인, 확인 메일 콜백·재전송, 비밀번호 재설정, Google·Apple·Kakao 관리형 OAuth와 production provider·이메일 claim 설정, 온보딩 게이트(닉네임·생년월일·분리 동의·추천 IP 팔로우), 마케팅 동의 사후 변경. 소셜 로그인은 production 배포 후 controlled smoke가 남아 있다.
- **공개 카탈로그**: 홈·IP 허브·굿즈 목록·카드·이벤트 목록/상세가 Supabase 읽기 + mock 폴백. 굿즈 상세(`/shop/[goodId]`)는 첫 실판매 준비 마일스톤에서 구현했다 — 2026-08-06 시점에는 미구현이었고 이 문단이 완료로 오기하고 있었다 → [first-sale-readiness §3.2 C1](./first-sale-readiness.md). 홈은 활성 hero·announcement와 결정적으로 정렬한 최대 5개 featured IP 큐레이션을 소비하고, Postgres 통합 검색을 제공한다.
- **카드 리워드 코어**: `draw_tickets`·`reward_policies`·`card_grants` 스키마, `/packs` 개봉(`open_draw_ticket`), 바인더 보유 오버레이, 참여형 게임 card 보상(`play_game`), 대상 IP·선택 same-IP 굿즈·독립 카드풀 기반 누적 주문 발급 정책과 soft revoke 이력 보존.
- **커뮤니티**: 작성(이미지)·댓글·좋아요·삭제·신고·차단 전부 Server Action + RPC 배선.
- **어드민**: staff/admin 게이트, 카탈로그 upsert·보관/복원 4종, 홈 히어로·특집 IP·공지 배너 큐레이션, 카드풀 운영 기간·등급별 확률·카드 풀 바인딩, 뽑기권 발급 정책(`/admin?section=policy`)과 PII-free 발급/사용 가능/개봉/회수 집계, 신고 처리·포스트 숨김, 역할 부여·회수, 주문·배송·환불, 멱등 실재고 입고·보정, 티켓 회차·가격·정원·현장 검표, 마스킹 회원 검색·명시적 상세·계정 정지/해제, 실데이터 매출 대시보드 — 전부 audited. 큐레이션 공지 저장은 인앱 공지를 자동 발송하지 않는다.
- **커머스·티케팅 DB**: `orders`/`payments`/`refunds`/`order_cancellation_requests`/`ticket_types`/`tickets`/`ticket_cancellation_requests`/`check_ins` 스키마와 원자적 RPC가 존재한다. 커머스·티켓 흐름, 관리자 회차 콘솔, provider-neutral attempt/claim/finalizer, 내 주문·티켓·취소/환불, staff 현장 검표가 연결됐다. 신규 checkout은 provider adapter가 없어 목적별 gate가 기본 OFF이고, 기존 Toss 2건만 known-only 조회·취소·웹훅 정리 경로에 남는다. Korpay adapter와 rollout은 #207이 추적한다.
- **인앱 알림**: 본인 RLS 알림함·unread 벨·마이페이지 진입점, 팔로우 IP별 드롭/이벤트 설정, IP·예정 이벤트 CTA가 연결됐다. 주문 상태·카드팩 발급·runtime staff 카탈로그 INSERT가 멱등 trigger로 발급하며, 관리자는 전체 사용자·특정 IP 팔로워 수를 미리 보고 audited 즉시 공지를 발송하며 최근 실제 발송 이력을 확인한다. 이메일·푸시·예약 발송은 제외한다(#104·#105).

## 3. 갭 분석 요약

### 3.1 사용자 표면

| 영역 | 현황 | 갭 → 이슈 |
|---|---|---|
| 장바구니 | localStorage·`cart_items` 병합과 재고 검증 완료(#89) | 완료 |
| 체크아웃·결제 | 배송지·주문과 provider-neutral 원장·굿즈/티켓 seam(#204~#206) 연결. 신규 provider gate 기본 OFF, 기존 Toss 2건은 known-only 정리 | rotated Korpay credential·승인 범위·보안/운영 답변을 #87·#207에서 검증. 신규 Toss checkout은 닫혀 있다 |
| 주문 | 본인 내역·상세·카드팩 발급·배송 전 취소/청약철회(#91·#92), 관리자 주문·배송·환불 콘솔(#93) 완료 | 완료 |
| 티켓 예매 | 공개 상세→회차/수량 선택→10분 선점→provider-neutral 결제 attempt→승인 후 QR 발급→내 티켓·예매 전체 취소/환불→현장 검표 연결(#54·#95·#97·#206). 신규 provider gate 기본 OFF | Korpay dark deploy·controlled canary #207 |
| 인증 보조 | 비밀번호 재설정 완료(#101), Google·Apple·Kakao OAuth 배선과 provider·이메일 claim 설정 완료 | #17: production 배포·controlled smoke |
| 계정 | 프로필 편집(#136), 로그인·온보딩 보호 마이페이지(#103), 소셜 OAuth 배선. 탈퇴 Phase 1 self-only 요청·legal snapshot·write fence는 기본 OFF로 배포 | #137 완료는 #191 통지, Phase 2 hard delete, #215 secondary ledger·restore replay와 controlled destructive smoke에 의존 |
| 알림 | 인앱 알림함·unread 벨·IP별 드롭/이벤트 설정·IP/예정 이벤트 CTA·어드민 공지 발송 완료(#104·#105) | 완료 |
| 커뮤니티 | 최근 7일 visible 포스트 기반 트렌딩(#106), 전체/내 팬덤 피드와 홈 커뮤니티 우선순위(#107), 작성자 visible 포스트 수정(#108), 개별 댓글 숨김·공개 집계 제외(#109) 완료 | 완료 |
| 교환/마켓 | v2 플레이스홀더(의도됨) | 유지 — 갭 아님 |

### 3.2 어드민·DB 표면

| 유형 | 갭 → 이슈 |
|---|---|
| A. 스키마만 있고 어드민 경로 없음 | 없음 (#98~#100 완료) |
| B. RPC는 있는데 UI 없음 | 검표 #97 완료 |
| C. 인프라 부재 | 실재고 조정 #94 완료 |
| D. 도메인 자체 부재 | 없음 (#111 회원 조회·제재, #112 아트워크 업로드, #113 카탈로그 보관, #114 배너·공지·큐레이션 완료) |

## 4. 출시 블로커 트랙 (Phase = Launch Blocker)

| Track | 이슈 | 의존성 |
|---|---|---|
| **Payments** | #204 provider-neutral 원장 → #205·#206 checkout seam → #87 [human] Korpay 승인·보안·운영 답변 → #207 Korpay dark deploy·controlled canary | rotated Korpay credential과 공급사 답변 전 Production gate OFF |
| **Commerce** | #89 실장바구니·#90 체크아웃·#91 주문 내역·#92 취소/청약철회·#93 어드민 주문 콘솔·#94 실재고 관리 완료 | 완료 |
| **Ticketing** | #96 회차 콘솔·#54 예매 플로우·#95 내 티켓/환불·#97 현장 검표 완료. provider seam은 #206 | Korpay 활성화는 #87·#207 뒤 |
| **Rewards Ops** | #98 카드풀·확률 콘솔, #99 발급 정책 콘솔, #100 게임 등록 콘솔 완료 | 완료 |
| **Account** | #101 비밀번호 재설정, #136 프로필 편집, #103 마이페이지 완료. #102 탈퇴 보존 정책은 완료. #137은 Phase 1 요청/fence 뒤 #191 메일과 #215 secondary Supabase ledger·restore replay를 거쳐 hard delete까지 수행 | #137 완료는 #191·#215와 destructive canary 증거에 의존. #17은 integration/deploy gate |
| **Notifications** | #104 알림함·IP 알림, #105 어드민 공지 발송 완료 | 완료 |
| **Community** | #106 트렌딩 실데이터, #107 피드 개인화, #108 포스트 수정, #109 댓글 숨김, #110 운영 정책과 default-OFF write gate 완료 | 공개 활성화는 별도 운영 rehearsal·수령인 증거 뒤 수행 |
| **Admin Ops** | #111 회원 조회·제재, #112 아트워크 업로드, #113 카탈로그 보관, #114 배너·공지·큐레이션 완료 | 완료 |

2026-08-13 전환 계획의 machine-safe foundation #204~#206은 완료됐고 #207·#208·#210~#215는 외부 계약·운영 증거와 선행 이슈를 기다린다. 사람 답변은 #87(Korpay), #208(CS·재무 직접환급), #209(NICE), #191(Resend 운영), #215(secondary compliance Supabase)에 남기고, 답변 전 관련 Production gate는 열지 않는다.

## 5. 별도 트랙과 Not Planned 경계

- **Not Planned**: 범용 온라인 팝업 운영 레이어와 Expo webview 앱 호스트. 과거 한 에픽에 함께 묶였던 검색·알림·대기열·배지 개선도 자동으로 예약하지 않으며, 실제 사용자·운영 증거가 생길 때 각각 독립 이슈로 제안한다.
- **별도 First Sale 범위**: 19+ 꽝 없는 유한 실물 쿠지는 legacy 래플이나 게임 `goods` variant의 재개가 아니다. 유한 pool 예약→결제→실물 unit 배정은 [#212](https://github.com/icons-hq/icons-ip/issues/212), 공개 잔여 확률·last-one·검증 영수증·운영은 [#213](https://github.com/icons-hq/icons-ip/issues/213)이 추적한다. Korpay·NICE·법률·IP·재고·환불 evidence가 선행한다.
- **연령보증**: v1 14+ 제품 원칙의 강제 계약·기존 계정 처리·법정 문서는 [#188](https://github.com/icons-hq/icons-ip/issues/188)이 정본이다. 현재 자가신고 생년월일을 완료 증거로 보지 않으며, 19+ NICE는 #209·#210에서 분리한다.

## 6. 가정

- 공개 알림은 v1에서 **인앱만**이다. 주문·Auth·탈퇴 같은 트랜잭션 이메일은 #191 dark path와 별도 운영 gate를 따르며, 마케팅 이메일·푸시는 규제 검토 전 열지 않는다.
- 체크아웃·예매는 로그인 필수(보호 액션). 장바구니만 비로그인 로컬 허용 후 병합.
- 좌석 지정 없음 — `ticket_types` capacity 카운트 모델 유지(`CONTEXT.md`).
- 결제 callback body와 클라이언트 성공 신호는 진실원이 아니다. 기존 Toss 2건은 known-only provider 재조회·웹훅으로 정리하고, 신규 Korpay는 `PaymentGateway.confirm/reconcile`과 DB 멱등 finalizer로만 확정한다. 돈·재고·발급은 Postgres RPC + 행 잠금 + 멱등(`AGENTS.md` 불변).
- 기존 게임의 `goods` variant는 운영 콘솔에서 읽기 전용이다. 남아 있는 mock 연출은 실제 경품·구매권을 만들지 않으며 운영 경로로 활성화하지 않는다. 유한 실물 쿠지는 별도 `prize_sale` 도메인에서만 구현한다.

### 6.1 결제 전환 운영 경계

- 신규 Toss checkout은 #205·#206 완료와 함께 닫혔다. Toss live key로 다시 활성화하거나 Toss 실결제 canary를 수행하지 않는다.
- 기존 Production Toss 결제 2건은 `provider=toss`로 보존하고 해당 거래의 조회·취소·웹훅만 유지한다. 두 거래가 공급사 콘솔에서도 최종 종결된 뒤 별도 PR에서 Toss runtime과 secret을 제거한다.
- Korpay는 #87 공급사 답변과 credential rotation, #207 dark deploy가 끝나기 전 기본 OFF다. 실제 canary는 공급사 취소 접수를 조율한 최소 1,000원 1회이며 실행 직전 사용자 확인을 다시 받는다.

## 7. 운영

- 실행판은 [Project #8](https://github.com/users/sangwopark19/projects/8) 하나다. `Status`(Todo→In Progress→Done) · `Phase`(Launch Blocker/Post-launch) · `Track`(9종) · `Dependency`(Unblocked/Blocked)로 운영한다. issue body의 `Blocked by`가 해소되면 `Dependency`를 `Unblocked`로 바꾼다.
- 라벨: `ready-for-agent` = 스펙 완결, `ready-for-human` = 계약·자격증명·정책처럼 사람 답변이 필요한 이슈다.
- 완료된 옛 보드 #3(P0 Foundation)·#4(Frontend UX)·#5(게임 레이어)는 이 계획 수립과 함께 close했다. 이력은 보드와 issue에 남아 있다.
