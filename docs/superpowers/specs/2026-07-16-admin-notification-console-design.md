# 관리자 인앱 공지 발송 콘솔 설계

작성일: 2026-07-16
대상 이슈: [#105](https://github.com/icons-hq/icons-ip/issues/105)

## 목표

staff/admin이 전체 사용자 또는 특정 IP 팔로워에게 인앱 공지를 즉시 발송하고, 발송 전 현재 수신자 수를 확인하며, 발송 결과를 감사 가능한 이력으로 조회한다. 이메일·푸시·예약 발송은 포함하지 않는다.

## 선택한 모듈 경계

세 가지 원장 구성을 비교했다.

1. 별도 `notification_broadcasts`와 수신자별 `notifications`를 함께 유지한다.
2. outbox와 비동기 worker를 추가한다.
3. 수신자별 `notifications`와 기존 `audit_log`를 발송 원장으로 재사용한다.

현재 범위는 즉시 발송뿐이고 `audit_log`가 관리자 작업의 기존 원장이다. 별도 상태 머신이나 이중 원장을 만들지 않는 3번을 채택한다.

- `notifications`는 사용자별 수신 사실을 보존한다.
- `audit_log`의 `admin.notification.sent` 한 행은 operation ID, 정규화된 요청, 실제 수신자 수와 발송 시각을 보존한다.
- 수신자 UUID·이메일 목록은 감사 행과 이력 RPC에 저장하거나 반환하지 않는다.
- 대상 추정, 실제 발송, 이력 조회는 서로 다른 staff 전용 RPC로 분리한다.

## 대상 의미

- `all`: 발송 시점에 존재하는 모든 `profiles`. 관리자와 온보딩 미완료 계정도 포함한다. 계정 활성/정지 계약이 아직 없으므로 임의의 추가 조건을 만들지 않는다.
- `ip_followers`: 발송 시점에 해당 IP를 팔로우하는 모든 `ip_follows.user_id`.
- `notify_drops`와 `notify_events`는 드롭·이벤트 알림 설정이므로 운영 공지에는 적용하지 않는다.
- 추정치는 화면을 읽은 시점의 값이다. 실제 대상은 발송 RPC 안에서 다시 확정하고 반환한 실제 수신자 수를 성공 결과와 이력에 표시한다.
- 수신자가 0명이면 발송하지 않는다. `all`은 현재 전체 profile이라는 이슈 계약을 그대로 지키며 임의의 수신자 상한이나 일부 truncation을 두지 않는다.

## DB 계약

### `admin_estimate_notification_recipients(scope, ip_id)`

- 현재 수신자 수, 발송 가능 여부, IP 제목을 반환한다.
- 전체 대상에는 IP ID를 허용하지 않고 IP 대상에는 존재하는 IP ID를 요구한다.

### `admin_send_notification(operation_id, scope, ip_id, title, body)`

- UUID operation ID, 대상, 공백을 정리한 제목 1–120자, 본문 1–500자를 검증한다.
- 링크는 이번 범위에서 `/notifications`로 고정한다.
- operation별 transaction advisory lock을 잡는다.
- 수신자가 1명 이상이면 대상 table에서 한 번의 `INSERT ... SELECT`로 `announcement` 알림을 발급하고 `ROW_COUNT`를 실제 결과로 사용한다.
- `source_type = 'admin_announcement'`, `source_id = operation UUID`, `dedupe_key = 'announcement:' + operation UUID`를 사용한다.
- 같은 actor가 같은 operation과 정규화 요청을 재시도하면 기존 실제 수신자 수와 발송 시각을 반환한다.
- 같은 operation을 다른 actor·대상·문구에 재사용하면 conflict로 실패한다.
- 알림 fan-out과 audit insert는 한 transaction이므로 일부 성공을 남기지 않는다.

### `admin_list_notification_history(limit, offset)`

- 최신순으로 operation, actor 표시명, 대상 snapshot, 제목·본문, 실제 수신자 수와 발송 시각을 반환한다.
- IP 제목은 발송 당시 snapshot을 사용한다.
- 수신자 식별 정보는 반환하지 않는다.

세 함수는 `SECURITY DEFINER SET search_path = ''`와 완전 수식 객체명을 사용한다. `public`, `anon`, `authenticated`, `service_role`의 기본 권한을 모두 회수한 뒤 `authenticated`에만 실행을 부여하며, 함수 안에서 `is_staff()`를 다시 확인한다. 기존 알림 본인 읽기 RLS와 client 직접 쓰기 차단은 변경하지 않는다.

## 관리자 interface

- 사이드바에 `공지 발송` 섹션을 추가한다.
- 대상은 `전체 사용자` 또는 `특정 IP 팔로워`로 선택한다. 후자는 IP 선택이 필수다.
- 현재 추정 수신자 수와 발송 가능 여부를 항상 표시한다.
- 제목·본문을 입력하는 동안 사용자 알림 카드 형태의 미리보기를 보여준다.
- 첫 버튼으로 내용을 확인하고, `예상 N명에게 즉시 발송하며 회수할 수 없습니다` 확인 상태에서 최종 발송한다.
- 입력이나 대상을 바꾸면 확인 상태를 해제한다. pending 동안 중복 제출을 막고 같은 operation ID를 재사용한다.
- 성공 후 실제 수신자 수를 표시하고 새 operation ID를 준비한다.
- 최근 20건은 발송 시각, actor, 대상, 실제 수신자 수, 제목·본문을 보여준다.

고정 안내 문구:

> 인앱 알림함에 즉시 발송됩니다. 이메일·푸시는 발송하지 않습니다. 수신자 수는 현재 기준 추정치이며 실제 수신자는 발송 시점에 확정됩니다.

야간 마케팅 발송 게이트는 외부 발송 채널의 정책이다. 이 기능은 인앱 전용이며 이메일·푸시 전송용으로 재사용하지 않는다는 주석과 안내를 남긴다.

## 오류와 동시성

- 미인증·non-staff 호출, 잘못된 대상 조합, 없는 IP, 빈/초과 문구, 0명, operation 충돌을 명시적으로 실패시킨다.
- 같은 operation 동시 호출은 advisory lock 뒤 한 번만 fan-out하고 나머지는 동일 결과를 재생한다.
- 서로 다른 operation은 같은 문구라도 의도적인 별도 발송이다.
- 발송 중 사용자 삭제 등 FK 경합이 생기면 전체 transaction을 rollback한다.

## 제외 범위

- 예약 발송과 수정·취소
- 이메일·모바일 push·SMS
- 사용자별 수신자 목록과 PII export
- 마케팅 동의·야간 시간대 gate
- 발송 이력 삭제
- rich text, 첨부 파일, 임의 링크 입력

## 검증 기준

- SQL smoke: ACL/RLS, staff gate, 대상 검증, 0명, 대규모 전체 fan-out, preference 비적용, 실제 count, 감사 이력, 멱등·충돌·rollback, PII 비노출, index
- Vitest: form 정규화, DB row 변환, staff loader/action gate, 수신자 preview, 2단계 확인, pending·성공·실패, 이력과 admin navigation
- 통합: 전체 test, lint, build, local Supabase reset/test/lint
- 브라우저: staff desktop/390px 작성·확인·발송·이력, 사용자 수신함 확인, focus·44px target·overflow·console 오류
- 출시: PR CI, preview, squash merge, production migration·route·인증 E2E, synthetic data 정리, Issue/Project 동기화
