# 회원 탈퇴·외부 이메일·runtime log 개인정보 후보 설계 (#137·#191 공용)

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: 내부 위험결정 승인 · local TDD 허용 · 외부 인프라·Production 별도 gate · GitHub 미게시 · 작성 2026-08-11 · 승인 2026-08-12

## Problem Statement

현재 설정에는 회원 탈퇴 기능과 durable 처리 원장이 없다. 프로필·주문·티켓·커뮤니티·카드·Storage가 한 사용자와 연결되고, 일부 참조는 FK가 아닌 문자열·UUID·JSON·로그에 남는다. 단순 Auth 삭제는 진행 중 거래와 법정 보존을 구분하지 못하고 FK·Storage 때문에 실패하거나, 앱 DB 밖의 이메일 처리자 사본과 runtime log를 남긴 채 성공으로 오인할 수 있다.

탈퇴 처리에는 DB 트랜잭션으로 묶을 수 없는 Storage API, Auth hard delete, 외부 이메일 provider, 복원 독립 삭제 원장이 포함된다. 삭제 뒤 장애·백업 복원·provider 재시도까지 고려하지 않으면 사용자가 부활하거나 탈퇴 이후 새 이메일 사본이 생성될 수 있다. 현재 로그에는 원문 주문 UUID, `paymentKey`, subject와 provider 오류가 출력될 수 있어 탈퇴 여부와 무관한 개인정보 최소화 gap도 있다.

## Solution

사용자가 직접 신청하고 결과를 미리 확인하는 self-only 탈퇴 흐름, 진행 중 의무 gate, private 법정 보존 snapshot, 멱등 삭제 worker와 복원 독립 append-only 원장을 하나의 상태 머신으로 구현한다. 파괴적 단계 전에 외부 `purge_committed` intent를 durable ack하고, 완료 뒤 같은 stable event를 확정한다.

모든 이메일은 Supabase Send Email Hook과 거래메일 공통 fence를 통과시키고 provider 호출 전에 durable outbound intent를 남긴다. 외부 provider 사본은 opaque locator로 추적하고 회원별 삭제 또는 승인된 TTL 만료 ack를 받아야 한다. runtime log와 Log Drain은 원문 식별자를 제거하고 용도별 versioned HMAC과 allowlist 오류 코드만 사용한다.

구현 순서는 `#137 1단계 → #191 → #137 2단계`로 고정한다. #137 1단계가 삭제 request·private 원장·공개 상태·발송 fence seam을 먼저 제공하고, #191이 그 seam만 소비해 Hook·outbound processor·provider 정합화를 구현한다. 이후 #137 2단계가 provider terminal ack를 삭제 barrier에 연결해 hard delete와 완료 처리를 닫는다. #191은 #137 2단계에 의존하지 않으므로 상호 선행 조건을 만들지 않는다.

## User Stories

1. 회원으로서 탈퇴 전에 즉시 삭제, 작성물 처리, 법정 분리보존, 진행 중 차단 사유를 구체적으로 확인한다.
2. 회원으로서 진행 중 주문·배송·취소·환불·유효 티켓이 없으면 전자적으로 직접 탈퇴를 신청한다.
3. 회원으로서 차단 사유가 있으면 해결할 주문·티켓 경로를 받고, 단순 과거 거래 때문에 계정 전체가 유지되지 않는다.
4. 회원으로서 신청 즉시 새 구매·예매·작성·카드팩·게임·마케팅과 Auth·거래메일 발송이 멈춘다.
5. 회원으로서 다른 사용자의 댓글이 없는 내 포스트는 삭제되고, 대화 맥락이 필요한 포스트는 중립 tombstone으로 남는다.
6. 회원으로서 다른 사람 포스트의 내 댓글은 계정 연결이 제거된 본문으로 남으며 직접 식별정보에 대한 삭제 요청 경로를 받는다.
7. 회원으로서 내가 올린 이미지는 bucket이나 legacy path와 무관하게 삭제된다.
8. 회원으로서 법정 보존이 필요한 거래는 전체 계정이 아니라 승인된 거래별 최소 snapshot만 분리 보존된다.
9. 탈퇴 회원으로서 인증 계정이 없어도 과거 거래기록과 개인정보 권리행사를 검증된 연락 경로로 요청할 수 있다.
10. 운영자로서 진행 중 obligation, legal hold, 예상 밖 데이터가 있으면 자동 삭제 대신 정확한 검토 상태로 상향한다.
11. 운영자로서 외부 API 장애 뒤 마지막 성공 단계부터 같은 stable event로 안전하게 재시도한다.
12. 운영자로서 DB가 탈퇴 전 백업으로 복원돼도 복원 독립 원장을 replay해 삭제 대상이 부활하지 않게 한다.
13. 운영자로서 이메일 provider가 메시지를 수락했는지, 실패했는지, 후속 event로 정합화됐는지 PII 없는 event chain으로 확인한다.
14. 운영자로서 모호한 이메일 응답은 provider의 idempotency window 안에서만 재시도하고, 만료 뒤 자동 중복 발송하지 않는다.
15. 개인정보 담당자로서 외부 이메일 사본·event·suppression·backup과 runtime Log Drain의 TTL·접근·파기 ack를 증명할 수 있다.
16. 개인정보 담당자로서 legal hold는 명시적 승인 해제 전 자동 파기되지 않고 주기적 review가 남음을 확인한다.
17. 보안 검토자로서 private 원장과 SECURITY DEFINER 함수가 public·anon·일반 authenticated·불필요한 service role에 노출되지 않음을 검증한다.
18. 개발자로서 이메일·결제 장애를 원문 주문 ID·`paymentKey`·provider body 없이 상관관계 식별자로 조사할 수 있다.
19. 감사자로서 삭제 요청, 보존 snapshot, 외부 ack, Auth 삭제, 만료 파기와 복원 replay의 순서를 재구성할 수 있다.
20. 탈퇴 회원으로서 Auth 계정이 hard delete된 뒤에도 URL에 비밀값을 노출하지 않고 제한된 기간 동안 내 처리 상태만 확인할 수 있다.

## Implementation Decisions

- `#137 1단계` 소유 범위는 self-only preview·request·status 공개 계약, private deletion request 원장, obligation·법정 snapshot, request와 withdrawal·underage 발송 fence의 원자 기록, 삭제 worker와 provider fence의 소비 seam이다. Send Email Hook·provider 호출·provider event reconciliation은 이 단계에서 구현하지 않는다.
- 첫 local 1a 절편은 request·fence와 Auth가 살아 있는 self-only preview/request/coarse status로 제한한다. plaintext subject locator를 쓰는 현재 검증본은 disposable-local prototype이며 배포 migration·CI runner에서 제외한다. deployable 1a는 암호화 locator·key custody·`subject_retain_until` 계약을 먼저 포함해야 한다. post-Auth opaque status cookie는 raw bearer가 PostgREST/로그 경계에 노출되지 않도록 앱-DB HMAC/KMS secret custody·rotation·rate-limit 계약을 승인한 1b에서 구현한다. 1a는 `purging|completed`, destructive worker, 법정 snapshot·targets·tombstone·external purge task를 만들거나 #137 완료를 주장하지 않는다.
- `#191` 소유 범위는 Supabase Send Email Hook, 거래메일 공통 fence 소비, durable outbound intent·dispatcher, provider accepted/failed/ambiguous 전송 결과와 stable-ID webhook event/reducer, provider locator와 purge task 연결, 관련 Production 설정·smoke다. 삭제 공개 상태 머신·Storage/DB cleanup·Auth hard delete는 소유하지 않는다.
- `#137 2단계` 소유 범위는 #191의 승인된 terminal/fence ack seam을 소비한 Storage·DB·Auth cleanup, 외부 purge barrier, restore replay와 `completed` 전이다. #191의 공개 contract test가 통과하기 전에는 provider 연동 완료를 가정하지 않는다.
- 공개 탈퇴 요청은 현재 인증 사용자를 서버에서 파생하는 self-only 경계다. 브라우저가 대상 user ID를 지정하지 않는다.
- 공개 preview는 blocker code·대상 수·해결 경로·UGC 잔존 예상·법정 보존 범주만 반환하고 다른 회원 데이터나 자유서술 원문을 노출하지 않는다. 상태 조회는 `blocked|processing|retryable|completed`와 공개 가능한 다음 행동만 반환한다.
- Auth hard delete 전에는 현재 인증 사용자로 상태를 조회한다. request 성공 시 256-bit 난수 status token을 한 번만 발급해 `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/account/deletion/status` cookie에 저장하고, private request에는 원문이 아닌 domain-separated HMAC·key version·만료시각만 둔다. Auth hard delete 뒤에는 이 cookie로 해당 request의 coarse status만 조회하며 token을 URL·HTML·runtime log에 넣지 않는다. 이 token은 post-Auth bearer이므로 유효한 cookie 자체가 탈취되면 coarse status가 노출될 수 있음을 위협 모델에 남기고, PII·내부 단계·자유서술은 반환하지 않는다. 승인된 TTL은 terminal 뒤 7일과 request 뒤 절대 90일 중 빠른 시각이며, 만료 뒤에는 공개된 비로그인 개인정보·지원 경로를 사용한다.
- 탈퇴 request 생성과 withdrawal·underage outbound fence는 하나의 DB 트랜잭션으로 durable하게 기록한다. fence가 없는 request나 request가 없는 fence 상태를 만들지 않는다.
- `underage_rejected`는 request·fence durable ack 직후 전역 sign-out을 시도하고 현재 응답의 Auth·앱 cookie를 즉시 만료한다. DB fence는 기존 JWT의 앱·DB 보호 mutation을 거부할 뿐 GoTrue의 token 발급 자체를 중단하지 못한다. 따라서 login action·Auth callback·`proxy.ts`·보호 Server 경계가 fence를 재확인해 세션을 받아들이지 않고 cookie를 반복 만료하며, Send Email Hook은 recovery 메일을 억제하고 최종 hard delete가 Auth 발급 가능성을 제거한다. remote sign-out 실패는 PII 없는 retry 상태로 남긴다. 이 즉시 접근 종료는 삭제 `completed`를 뜻하지 않는다.
- 예상 밖 거래·티켓·권리 사건 같은 외부 의무가 없는 신규 `underage_rejected`는 durable request/fence ack부터 24시간 안에 Auth hard delete를 완료하는 운영 목표를 둔다. deadline을 넘기면 PII 없는 경보와 멱등 재시도를 계속하고 외부 완료 ack 전에는 `completed`로 표시하지 않는다.
- 일반 withdrawal은 request 직후 발송·보호 mutation을 DB fence로 차단한다. 진행 obligation 때문에 `blocked_active_obligation`이면 해결·권리 경로에 필요한 session을 유지한다. 외부 `purge_committed` ack 뒤 `purging`에 진입할 때 전역 sign-out·refresh session revoke를 시도한다. 그 전이를 반환한 신청/상태 응답과 이후 모든 인증·상태 응답은 남아 있는 Auth·앱 cookie를 반복 만료하고, login action·Auth callback·`proxy.ts`는 새 Auth token이 발급돼도 purging/completed 계정의 앱 session을 받아들이지 않는다. 비동기 worker가 브라우저 cookie를 직접 지운다고 가정하지 않는다. 상태 조회용 opaque cookie만 승인된 terminal+7일/절대90일 TTL까지 coarse status를 제공하며, `underage_rejected`의 즉시 종료 규칙과 일반 withdrawal의 purging 진입 규칙을 구분한다.
- 정상 상태는 `requested → blocked_active_obligation` 또는 `requested → purging → completed`다. 외부 실패는 `retryable_failure`로 기록하고 마지막 성공 단계와 PII 없는 오류 코드만 남긴다.
- 진행 중 주문·배송·취소·환불·티켓은 구체적 blocker다. 완료된 과거 거래, 커뮤니티 신고, 계정 제재만으로 계정 전체 삭제를 막지 않는다.
- destructive cleanup 전에 복원 독립 외부 원장에 stable deletion event의 `purge_committed` intent를 append하고 durable ack를 받는다. ack 전에는 `purging`에 진입하지 않는다.
- 복원 독립 원장은 현재 Supabase 프로젝트·같은 backup/restore failure domain 밖의 별도 시스템이어야 한다. 같은 DB의 `deleted_subject_tombstones`·outbound attempt·task mirror는 조회 최적화용일 뿐 원장을 대체하지 않는다. 2026-08-12 내부 검토는 GCP append service + read-only verifier, immutable event ID, key/ACL/retention/hold/snapshot 계약을 승인했다. 별도 인프라 issue와 실제 restore drill 없이는 #137/#191을 완료하지 않으며, 실제 GCP project·region·billing·IAM을 이 문서에서 추정하지 않는다.
- append service는 caller principal별 event-type ACL, server-issued namespace, schema와 선행 ack·허용 상태전이를 검증한다. 앱 writer는 `purge_completed`, `legal_hold_released`, key destroy를 만들 수 없고 append·verify/read·restore/decrypt·expiry purge·hold set/release·key destroy·break-glass principal을 분리한다.
- ack 전 실패는 obligation과 법정 snapshot을 다시 검증한 뒤 intent append부터 재개한다. ack 뒤 실패는 기록된 마지막 성공 단계 다음부터 재개한다.
- 삭제 요청에는 FK 없는 암호화 subject, key version, stable event ID, subject 보존 만료와 파기 시각을 둔다. daily/PITR뿐 아니라 logical export·clone·DR·분석 사본까지 모든 DB/Auth 복구 가능 artifact의 authoritative snapshot catalog를 유지한다. subject/linkage는 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 artifact 전부의 `max(expires_at)`+최대 replay 지연+7일과 `purge_completed`·재시도 종료 중 늦은 시각까지 유지한다. 미등록·expiry 미상 artifact와 catalog 변경은 fail closed하고 기존 TTL을 단축하지 않으며 linkage가 이미 파기된 cutoff보다 오래된 복원은 runbook이 거부한다. core digest와 sensitive linkage는 record/subject별 DEK로 암호화하고 공유 KMS KEK에는 wrapped DEK만 두며, 개인별 파기는 ciphertext·wrapped DEK·모든 recoverable generation을 제거한다.
- 법정 보존은 일반 서비스 테이블과 분리된 private 영역의 계약, 결제, 공급, 표시·광고, 분쟁·권리 사건 원장으로 만든다. 필드·기산점·기간·접근 역할은 공식 법령과 2026-08-12 내부 보존 매트릭스에서 확정한 값만 사용하며, 회사·처리자 실제 사실이 필요한 항목은 확인 전 fail closed한다.
- `private.consent_receipts`·`private.age_gate_reviews`·`private.age_assurance_receipts`는 일반 서비스 원장이다. 탈퇴 시 subject·reviewer·receipt/review/transaction-ref 식별자와 정정 생년월일 provenance를 삭제·unlink하고, 내부 보존 매트릭스에서 근거·기한·접근 역할이 확정된 최소 동의 증빙만 `private.legal_retention_records`에 이동한다. reviewer는 nullable 또는 승인된 keyed HMAC·감사 ref로만 남기며 원본 신분증·원문 증빙·provider raw payload는 저장하지 않는다.
- 현재 mutable 주문·티켓·표시정보를 과거 증거라고 간주하지 않는다. 필요한 경우 거래 생성·노출 시점에 불변 snapshot과 버전을 새로 저장한다.
- 보존 함수는 고정 search path뿐 아니라 public·anon·authenticated·service role의 기본 execute를 모두 revoke하고 필요한 서버 역할에만 명시적으로 grant한다. 함수 내부 authorization과 private schema 비노출을 함께 적용한다.
- 포스트는 다른 회원 댓글 유무에 따라 삭제 또는 중립 tombstone으로 처리한다. 댓글은 익명화됐다고 과장하지 않고 계정 연결이 해제된 본문 유지로 표시한다. 업로드 객체는 모두 제거한다.
- Storage는 모든 bucket의 owner metadata, legacy prefix와 DB 참조 경로를 함께 inventory하고 Storage API로 삭제한다. service-role 업로드처럼 owner가 없고 비표준 경로인 객체도 DB 참조로 찾은 뒤 owner/path/reference 잔여 0건을 검증한다. 공용 staff asset은 사용자 탈퇴 대상과 분리한다.
- 이메일 발송 fence는 원자 기록 뒤 새 outbound intent와 새 claim을 0건으로 만든다. fence 전에 이미 lease를 얻은 in-flight attempt는 호출이 끝나거나 terminal 취소·ambiguous로 수렴할 때까지 drain하고, fence epoch·lease·마지막 provider 수락시각을 cutoff에 포함한다. Supabase Auth 메일은 Send Email Hook을 사용해 거래메일과 같은 claim 계약을 적용한다.
- Send Email Hook은 secret·요청 무결성과 예상 event/template를 검증하고 5초 예산, 최소 권한, 설정·fence 조회 실패 시 fail-closed를 적용한다. 제한 대상의 공개 Auth 응답은 계정 존재·제한 상태를 드러내지 않는다.
- Production 전환은 Hook route와 durable dispatcher를 먼저 배포하고 서명·health probe를 통과한 뒤, 별도 승인 단계에서 Hook을 활성화하고 설정을 read-back한다. 앱 route가 배포되기 전에 Auth 설정을 바꾸지 않는다.
- Supabase 공식 계약상 Send Email Hook이 활성화되면 Auth 메일은 Hook 경로를 사용한다. 다만 2026-05 공개 이슈의 rate-limit/custom SMTP 상호작용이 해소됐음을 controlled Production canary로 확인하기 전에는 기존 custom SMTP 설정을 즉시 삭제하지 않는다. 활성화 불변식은 `Hook fail-closed + direct SMTP 발송 0건`이며, 호환 설정의 최종 제거는 가입확인·재발송·recovery·email-change canary와 설정 read-back 뒤 별도 승인한다.
- provider 호출 전 DB와 복원 독립 원장에 stable outbound ID의 durable intent를 남긴다. 같은 ID를 idempotency key와 PII 없는 provider tag로 사용하고 message ID·서명과 timestamp가 검증된 webhook event로 정합화한다.
- outbound 전송 상태는 `intent → accepted|failed|ambiguous`로 구분한다. HTTP 2xx는 provider 수락일 뿐 실제 delivery로 단정하지 않는다.
- provider 응답은 `email_outbound_accepted|email_outbound_failed`, 검증된 webhook은 `(provider, outbound_id, provider_event_id)`별 `email_outbound_provider_event`를 외부 원장에 먼저 append·ack한 뒤에만 DB attempt/event mirror를 갱신한다. accepted에는 암호화한 opaque provider message ID·provider·idempotency key version·수락시각만, provider event에는 검증된 유형·발생시각만 둔다.
- 외부 이메일 chain은 `email_outbound_intent`, `email_outbound_accepted`, `email_outbound_failed`, stable ID별 `email_outbound_provider_event`로 고정한다. event는 중복·역순을 보존하고 versioned reducer가 전체 집합에서 현재 상태를 계산한다. recipient·본문 대신 암호화 또는 HMAC 식별자, opaque provider locator, key version, 보존 만료를 둔다.
- provider 응답이 모호하면 같은 payload와 key로 승인된 24시간 window 안에서만 재시도한다. window 이후 미확정 intent는 자동 발송하지 않고 조회·지원 절차로 판정한다.
- 외부 이메일 처리자와 Log Drain은 DPA, 국외이전, content/event/suppression/backup별 TTL, 접근 역할, 회원별 삭제 또는 자동 만료 ack가 승인돼야 활성화한다.
- Auth hard delete는 Storage·DB cleanup, 외부 task intent 등록과 fence 이전 outbound의 terminal ack 수렴 뒤 수행하되 발송 fence를 유지한다. `provider_fence_acked_at`, 마지막 provider 수락시각, Auth hard-delete ack 중 가장 늦은 시각을 외부 purge cutoff로 사용한다. Auth 삭제 실패 뒤에는 cutoff를 재산정하고 새 provider 사본이 없음을 재검증한다.
- 완료는 Storage owner/path 0건, 앱 식별자 잔여 0건, fence 이전 outbound의 durable terminal ack와 ambiguous 0건, Auth hard-delete ack, `external_purge_registered` ack, 외부 `purge_completed` ack가 모두 있을 때만 기록한다.
- runtime log와 모든 Log Drain은 원문 주문 UUID, dedupe key, recipient, subject, `paymentKey`, provider body/message와 raw `Error.message`를 기록하지 않는다. `order_ref|ticket_ref|email_ref`는 별도 observability key로 `HMAC-SHA-256(purpose || 0x00 || identifier)`한 전체 base64url digest와 key version을 사용한다. identifier는 각각 `orders.id`, `ticket_orders.id`, `private.email_outbound_attempts.outbound_id`, purpose는 `order|ticket|email`로 고정하고 오류는 allowlist code로 정규화한다. lookup·탈퇴 후 본인확인 HMAC과 key ring을 공유하지 않으며 이전 observability key는 모든 runtime log·Log Drain의 승인 TTL까지만 유지한다.
- 결제 webhook은 서명 비밀값을 가정하지 않는다. 받은 `paymentKey`로 provider 조회 API를 재검증하되 원문 키와 provider body를 로그에 남기지 않는다.
- legal hold는 `review_at`과 해제 승인자를 요구하며 set·release 모두 서로 독립된 2인 승인을 durable하게 확인하지 못하면 fail closed한다. 외부 원장에도 immutable `legal_hold_set|legal_hold_released`를 append하고, 앱 writer와 분리된 compliance principal들이 외부 sensitive object의 hold와 linkage/envelope-key purge 정지를 함께 적용한다. backend가 GCS이면 temporary hold와 metageneration precondition을 사용하며 DB hold만으로 완료하지 않는다.
- 암호화 recipient는 terminal 판정과 provider locator 이전 직후, 늦어도 provider의 24시간 idempotency window 종료에 파기한다. attempt 보존은 승인된 provider email/event 조회 만료에 운영 검증 7일을 더한 날을 넘지 않는다.
- snapshot에는 외부 원장의 단조 sequence 또는 독립 durable watermark를 함께 기록한다. 복원 중 verifier/replay principal 외 모든 writer·job·queue·Hook·webhook·Auth callback·provider egress를 차단하고 stable event key로 lossless replay한다. wall-clock cutoff나 객체별 GCS generation을 전역 cursor로 쓰지 않으며, 미완료 task 재실행·owner/식별자 잔여 0건·replay checkpoint durable ack 뒤 writer를 단계적으로, public traffic을 마지막에 연다.
- 파괴·외부 처리 순서는 다음 barrier로 고정한다.
  1. request와 발송 fence를 같은 트랜잭션으로 기록한다. 사유가 `underage_rejected`면 durable ack 직후 전역 sign-out을 시도하고 현재 응답의 Auth·앱 cookie를 만료한다.
  2. obligation을 행 잠금으로 재검증하고 승인된 법정 snapshot을 만든다.
  3. 외부 `purge_committed`를 durable ack한 뒤에만 `purging`으로 전이하고 전역 sign-out·refresh session revoke를 시도한다. 이 전이를 반환하는 응답과 이후 인증·상태 응답은 남은 Auth·앱 cookie를 반복 만료한다.
  4. UGC·개인화·Storage·일반 서비스 PII를 정리하고 외부 `external_purge_intent`를 durable ack한다.
  5. fence 이후 신규 intent·claim이 0건이고, fence 이전 lease를 가진 in-flight outbound가 외부 `accepted|failed` ack 또는 승인된 terminal 취소로 수렴하며 ambiguous가 0건임을 확인해 `provider_fence_acked_at`과 마지막 provider 수락시각을 기록한다. provider webhook은 stable event ID와 reducer checkpoint로 별도 drain한다.
  6. Auth를 hard delete하고 refresh session 제거 ack를 받는다.
  7. `provider_fence_acked_at`, 마지막 provider 수락시각, Auth hard-delete ack 중 가장 늦은 시각을 cutoff로 외부 삭제·자동 만료 due를 등록하고 `external_purge_registered`를 durable ack한다.
  8. 외부 `purge_completed`를 durable ack한 뒤 request를 `completed`로 전이한다. 일반 withdrawal의 Auth·앱 cookie는 purging 진입 이후 응답에서 이미 반복 만료하며, worker가 브라우저 cookie를 제거했다고 기록하지 않는다. `underage_rejected`도 이 ack 전에는 삭제 완료로 표시하지 않는다. 상태 조회 cookie는 승인 TTL까지 coarse status만 제공한다.

## Testing Decisions

- 탈퇴 preview와 신청의 공개 Server Action/API를 통합 테스트한다. self-only, 확인 문구, 구체적 blocker와 해결 링크, 중복 신청 멱등성을 검증한다.
- 상태 조회는 Auth가 있는 경우와 hard delete 뒤 status cookie 경우를 분리해 테스트한다. token 원문 미저장, 위조·추측·다른 request 교환·변조·만료 token의 정보 0건, cookie 속성, terminal+7일/절대 90일 만료, rate limit, key rotation, 유효 token에도 PII 없는 coarse status만 노출을 검증한다.
- 단계별 contract test는 #137 1단계의 request/fence seam만으로 #191 Hook·dispatcher가 실행되고, #191의 terminal/fence ack seam만으로 #137 2단계가 완료 barrier를 판정함을 검증한다. 어느 단계도 상대의 private table이나 미완료 구현을 직접 참조하지 않는다.
- SQL 테스트는 주문·취소·환불·티켓 obligation 전 조합, private 원장 ACL, 함수 execute revoke/grant, snapshot 불변성, 동의 receipt·연령 review subject/reviewer/provenance purge와 잔여 0건, legal hold set/release의 독립 2인 승인과 제2 승인자 부재 시 fail-closed를 검증한다.
- 상태 머신은 `purge_committed` ack 전후 모든 실패 지점에 fault injection을 넣어 재진입 상태와 마지막 성공 단계를 검증한다.
- UGC 테스트는 포스트 삭제, tombstone, 댓글 계정 연결 해제, 직접 식별정보 후속 요청, 모든 이미지 제거를 구분한다.
- Storage 테스트는 표준 prefix, legacy 비표준 경로, 다른 bucket owner metadata, owner 없는 DB 참조 객체, 부분 삭제, 1,000개 초과 pagination과 최종 owner/path/reference 0건 검증을 포함한다.
- Auth 테스트는 전역 sign-out만으로 완료하지 않고 service-role hard delete ack, 이미 삭제된 사용자 멱등성, 여전히 유효한 JWT의 보호 mutation 차단을 확인한다.
- session 테스트는 `underage_rejected`의 durable ack 직후 global sign-out·현재 cookie 만료와 일반 withdrawal의 `purging` 진입 시 session revoke·현재/후속 응답 cookie 반복 만료를 별도 사례로 검증한다. 비동기 worker만으로 browser cookie가 제거됐다고 보지 않으며 두 사례 모두 외부 완료 ack 전 삭제 완료를 표시하지 않는다.
- 외부 의무가 없는 신규 `underage_rejected`는 durable ack+24시간 경계 전후의 hard-delete 완료, deadline 경보·재시도와 미완료 표시 금지를 검증한다.
- Send Email Hook과 거래메일을 같은 제한 matrix로 테스트한다. requested·purging·underage rejected·completed에서 신규 intent·claim은 0회이고, fence 이전 in-flight lease만 drain된다.
- Hook rollout은 route 미배포 상태에서 활성화가 거부되고, route health·서명 probe 뒤에만 설정을 변경하며, read-back 실패 시 활성화 완료로 표시하지 않는지 검증한다. custom SMTP 설정이 남은 canary에서도 Auth 메일이 Hook을 우회해 직접 발송되지 않아야 한다.
- outbound processor는 provider 전 intent 실패, 수락 뒤 응답 유실, HTTP 2xx와 실제 delivery 구분, 위조·중복·순서 역전 webhook, 24시간 window 경계, 만료 뒤 수동 판정, Auth 삭제 실패 뒤 cutoff 재등록을 검증한다.
- provider fence 테스트는 request/fence 원자성, fence epoch 뒤 신규 intent·claim 0회, pre-fence lease의 drain·terminal 취소, fence 이전 모든 outbound terminal ack, ambiguous 0건 전 Auth 미삭제, 세 cutoff 중 최댓값, `external_purge_registered`·`purge_completed` ack 전 완료 금지를 검증한다.
- observability sanitizer를 공개 경계로 테스트한다. 거래메일, 주문 확인·배송 호출부, admin 재발송, Toss webhook, payment confirm, provider adapter 어디에도 원문 주문 ID·`paymentKey`·recipient·subject·provider body가 남지 않아야 한다.
- HMAC 테스트는 domain separation, key version, 충분한 출력 길이, 이전 키 TTL, 같은 입력의 안정성과 서로 다른 용도의 비연결성을 확인한다.
- restore drill은 모든 restore-capable artifact의 `max(expires_at)` TTL 재계산, 미등록·expiry 미상 artifact와 catalog drift의 fail-closed, snapshot durable watermark, 모든 writer·job·queue·hook·webhook·callback·provider egress 격리, stable event key의 lossless replay와 더 오래된 복원 거부를 검증한다. destructive 단계 사이 장애, intent만 있는 외부 task, legal hold와 완료된 삭제 replay를 포함하고 동의 receipt·연령 review 연결까지 최종 잔여 0건과 replay checkpoint durable ack 뒤 마지막 public traffic 개방을 증명한다.
- ledger test는 caller별 event-type·상태전이 allowlist와 앱 writer의 `purge_completed|legal_hold_released|key destroy` 거부, soft delete·Object Versioning off의 배포별 read-back·drift alert와 모든 recoverable generation 0건을 검증한다.
- 외부 provider와 Production smoke는 마스킹된 locator·event·TTL·삭제 ack만 증거로 남기며 비밀값과 실제 사용자 PII를 저장하지 않는다.
- 구현은 승인된 탈퇴 요청, worker processor, Send Email Hook, observability sanitizer의 공개 seam부터 실패 테스트를 작성하는 TDD 순서를 따른다.

## Out of Scope

- 공식 법령·내부 보존 매트릭스 또는 확인된 회사 사실 없이 거래·신고·권리 사건의 기산점·보존기간·접근자를 임의 확장하는 것
- 승인되지 않은 anti-fraud 계정·기기·IP 보존
- 외부 provider의 DPA·국외이전·삭제 API를 존재한다고 가정하는 것
- Production 이메일, Toss live, Log Drain, Supabase 설정 또는 migration의 무승인 적용
- staff/admin 업무 인수인계의 조직 절차 자동화
- 삭제된 계정·카드·개인화 데이터의 복구 기능
- 네이버의 Npay·전자금융업자·통신판매중개자·정산 역할 복제

## Further Notes

- 상세 정책·필드 매트릭스: [`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md)
- 이메일 현재 코드와 활성화 gate: [`transactional-email.md`](../../transactional-email.md)
- 내부 위험결정과 아직 확인해야 할 외부 사실: [`policy-legal-review.md`](../../questionnaires/policy-legal-review.md)
- 제품·TDD 승인 입력: [`to-questionnaire-open-issue-decisions.md`](../../questionnaires/to-questionnaire-open-issue-decisions.md)
- 출시 gate: [`first-sale-readiness.md`](../../first-sale-readiness.md), [`launch-readiness-plan.md`](../../launch-readiness-plan.md)
- GitHub 추적: [#137](https://github.com/icons-hq/icons-ip/issues/137), [#191](https://github.com/icons-hq/icons-ip/issues/191)
- Supabase 계약·관찰: [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook), [Hook rate-limit 공개 이슈 #45743](https://github.com/supabase/supabase/issues/45743)
- 복원 독립 원장 결정: 2026-08-12 내부 검토, [Supabase backup·project 삭제 계약](https://supabase.com/docs/guides/platform/backups), [GCS Bucket Lock](https://docs.cloud.google.com/storage/docs/bucket-lock), [GCS Object Retention Lock](https://docs.cloud.google.com/storage/docs/object-lock), [GCS create-only precondition](https://docs.cloud.google.com/storage/docs/request-preconditions), [Vercel OIDC](https://vercel.com/docs/oidc)
- NAVER·스마트스토어에서는 계층과 사용자 절차를 참고했을 뿐 문구, Npay, 중개·정산 역할을 복제하지 않는다.
- 이 문서는 2026-08-12 내부 위험결정으로 local TDD가 승인된 구현 계약이다. GitHub 이슈 본문·default branch의 진실원은 아직 아니며 실제 provider/GCP 사실, restore drill과 Production 승인은 별도 gate다.
