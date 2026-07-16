# 인앱 알림함과 IP 알림 설정 설계

작성일: 2026-07-16
대상 이슈: [#104](https://github.com/sangwopark19/icons-ip/issues/104)

## 목표

로그인 사용자가 주문·카드팩·팔로우 IP의 새 소식을 한곳에서 확인하고, IP별 드롭·이벤트 알림을 제어할 수 있는 인앱 전용 알림 경계를 만든다. 이메일·푸시·예약 발송은 포함하지 않는다.

## 선택한 모듈 경계

세 가지 설계를 비교했다.

1. 각 권위 RPC가 `issue(cause)`를 명시적으로 호출하는 중앙 모듈
2. 이벤트 원장과 비동기 processor로 수신함을 materialize하는 outbox 모듈
3. 권위 테이블의 멱등 AFTER trigger가 단일 `notifications` 수신함을 만드는 모듈

현재 저장소에는 주문·리워드 RPC가 후속 migration에서 여러 번 재정의된 이력이 있고 v1 알림 규모가 작다. 따라서 호출 누락 없이 현재 경로를 포괄하고 별도 cron·retry 운영을 만들지 않는 3번을 채택한다.

- 주문 상태와 뽑기권은 권위 행 변경과 같은 transaction에서 알림을 만든다.
- 굿즈·이벤트는 runtime staff admin RPC의 최초 INSERT만 공개로 본다. DB seed·migration처럼 `auth.uid()`가 없는 catalog INSERT는 fan-out하지 않는다.
- 드롭·이벤트 fan-out은 애플리케이션 반복문 없이 한 번의 `INSERT ... SELECT`로 수행한다.
- 트리거 함수와 helper는 `private` schema에 두고 어떤 client role에도 직접 실행 권한을 주지 않는다.
- fan-out 규모가 커질 때에는 내부 구현만 event 원장으로 교체할 수 있으며 사용자 interface는 유지한다.

## 데이터 계약

### `notifications`

- `id`, `user_id`, `type`, `title`, `body`, `link_path`, `source_type`, `source_id`, `dedupe_key`, `read_at`, `created_at`
- `user_id`는 `profiles(id)`를 참조하고 사용자 삭제 시 함께 삭제한다.
- `(user_id, dedupe_key)` unique key로 재처리 중복을 막는다. `source_id` 원문은 길이 제한 없이 추적용으로 보존하고, 128자 이하인 `dedupe_key`만 멱등 index에 사용한다.
- `link_path`는 protocol-relative URL과 역슬래시를 거부하는 앱 내부 상대 경로만 허용한다.
- 제목·본문은 공백-only와 과도한 길이를 거부한다.
- 본인 알림함 정렬 index와 unread partial index를 둔다.
- 유형은 `order_paid`, `order_shipping`, `draw_ticket_issued`, `drop_published`, `event_published`, `announcement`을 허용한다. `announcement`은 #105가 같은 수신함을 사용하기 위한 확장점일 뿐 #104에서는 발급하지 않는다.

RLS는 authenticated 본인 SELECT만 허용한다. 직접 INSERT·UPDATE·DELETE는 anon/authenticated/service-role client에 허용하지 않고 읽음 변경은 RPC로만 수행한다.

### `ip_follows`

- `notify_drops boolean not null default true`
- `notify_events boolean not null default true`

팔로우는 홈·피드·알림을 개인화한다는 현재 도메인 계약에 따라 새 팔로우와 기존 팔로우 모두 두 설정을 기본 ON으로 둔다. v1은 외부 발송 채널이 아니며 사용자는 두 값을 개별적으로 끌 수 있다. 언팔로우하면 기존 행과 설정이 함께 삭제되고 재팔로우 시 기본 ON으로 시작한다.

팔로워 fan-out을 위해 `ip_id` 선두 index를 둔다.

## 발급 matrix

| 권위 변경 | 알림 | 링크 | `dedupe_key` 원인 |
|---|---|---|---|
| `orders.status`가 처음 `paid`가 됨 | 결제 확인 | `/orders/{id}` | `order:paid:{id}` |
| `orders.status`가 처음 `shipping`이 됨 | 배송 시작 | `/orders/{id}` | `order:shipping:{id}` |
| `draw_tickets` INSERT statement | 카드팩 N개 발급 | `/packs` | `draw_ticket:{source}:{source_id}` |
| staff runtime `goods` INSERT | 새 드롭 | `/shop` | `good:` + good id SHA-256 |
| staff runtime `events` INSERT | 새 이벤트 | `/events` | `event:` + event id SHA-256 |

- 같은 상태 UPDATE, catalog UPDATE, seed/catalog maintenance INSERT는 발급하지 않는다.
- 한 결제에서 주문 결제와 카드팩 발급은 서로 다른 사실이므로 알림 두 건을 허용한다.
- 굿즈·이벤트의 긴 catalog id는 원문 `source_id`로 보존하되, SHA-256 고정 길이 `dedupe_key`로 index와 fan-out을 안전하게 유지한다.
- draw ticket은 statement transition table로 사용자·source별 집계한다. 동시 INSERT는 정렬된 사용자·source·source_id 단위 transaction advisory lock을 잡은 뒤 권위 행 전체를 다시 세어 stale count를 막는다. 같은 source에 후속 티켓이 실제 추가되면 한 알림의 수량 snapshot을 현재 총량으로 갱신하고 `read_at = NULL`, `created_at = now()`로 되살려 최신 unread로 노출한다.
- `ip_id IS NULL`인 합동 이벤트는 IP preference 대상이 아니므로 fan-out하지 않는다.

## 사용자 interface

### 읽기

- Server Component용 `loadNotifications(userId)`는 RLS와 별도로 `user_id`를 명시하고 최신 50건을 `(created_at DESC, id DESC)`로 읽는다.
- `getIpNotificationPreferencesForUser(userId)`는 현재 팔로우 행만 읽는다.
- 상단 벨은 로그인 상태에서 browser Supabase client로 unread count만 읽으며 realtime 구독은 만들지 않는다.
- 사용자별 데이터에는 mock fallback을 사용하지 않는다. Supabase 미구성·실패는 빈 가짜 데이터로 위장하지 않고 명시적 오류 경계로 닫는다.

### 변경

- `open_notification(id)`는 인증 actor 본인 행을 `NULL → timestamp`로 한 번만 바꾸고 검증된 `link_path`를 반환한다. 타인/없는 ID는 같은 `notification_not_found` 오류다.
- `set_ip_notification_preferences(ip, drops?, events?, auto_follow=false)`는 선택적 팔로우 생성과 채널 설정을 한 transaction에서 수행한다. 기존 팔로우에서는 생략된 channel을 보존한다.
- Server Action은 인증·온보딩을 다시 검사하고 preference RPC 한 번만 호출한다. 비팔로우 상태의 IP·이벤트 CTA는 `auto_follow=true`로 기존 `follow_ip` 계약과 기본/요청 설정을 같은 DB transaction 안에서 적용한다.

## 정보 구조와 UX

- 데스크톱·모바일 상단: 검색과 장바구니 사이의 벨 → `/notifications`; unread badge는 `99+` cap.
- `/notifications`: 보호 알림함, unread/read ledger 행, 내부 링크 이동, 빈 상태, `IP 알림 설정` 링크.
- `/notifications/settings`: 현재 팔로우 IP별 `새 굿즈·드롭`, `팝업·이벤트` 두 switch.
- 마이페이지: 6번째 `알림함` 카드. 모바일 하단 5탭은 늘리지 않는다.
- IP 허브: 비팔로우면 `팔로우하고 알림 받기`, 팔로우면 두 channel 설정 form.
- 예정 이벤트 상세: 기존 `상세 보기`/예매 흐름을 유지하고 IP가 있을 때만 이벤트 알림 secondary action을 제공한다.
- 합동 이벤트에는 IP 알림 action을 보이지 않는다.

알림 목록은 Orders/Tickets의 조용한 ledger 표현을 재사용한다. unread는 색뿐 아니라 점·좌측선·스크린리더 텍스트로 구분한다. 상단 아이콘, 목록 action, switch는 44px target과 `focus-visible`을 제공한다. 390px에서는 상단 gap을 줄이되 target은 줄이지 않는다.

## 제외 범위

- Supabase Realtime
- 카테고리 탭·검색·무한 스크롤·알림 상세 화면
- 다시 안읽음·삭제·보관함
- 이메일·푸시·야간 동의·예약 발송
- catalog draft/publish 모델 신설
- #105의 관리자 공지 작성·수신자 preview·발송 이력

## 검증 기준

- SQL smoke: RLS 격리, 직접 mutation 차단, 함수 ACL 봉인, 읽음 단조성, 설정 보존·미팔로우 거부, 상태 전이 멱등, draw-ticket 동시 집계·후속 발급 unread/최신 시각 갱신, 긴 catalog id fan-out, 설정별 set fan-out, seed suppression, index 존재
- Vitest: DTO 변환, 보호 redirect·온보딩 gate, 빈/읽음/안읽음 화면, 내부 링크 action, 로그인 상태별 bell, settings/IP/event CTA, route/MyPage 회귀
- 브라우저: guest redirect, signed-in inbox와 unread badge, IP 설정 저장·reload, 예정 이벤트 secondary action, desktop/390px overflow·44px target·focus·console 오류
- 전체 test, lint, build, local Supabase reset/test/lint, GitHub CI, preview, production canary
