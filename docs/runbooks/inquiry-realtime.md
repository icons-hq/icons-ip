# 문의 실시간 연결 검증

#432의 실시간 표면은 기존 문의 원장과 서버 액션을 사용한다. 고객 위젯은 FAQ를 먼저 보여주고 로그인한 고객에게 내 문의·새 문의를 제공한다. `/my/inquiries/[inquiryId]`와 어드민 문의 목록·상세도 변경을 구독한다. 위젯 오버레이는 `OverlayPortal`로 `body` 아래에 렌더한다.

## 데이터와 권한

- `20260908025703_inquiry_realtime_delivery.sql`은 `supabase_realtime`에 `inquiries`, `inquiry_messages`를 추가하고 INSERT·UPDATE만 발행한다. DELETE의 RLS 필터 제약 때문에 DELETE·TRUNCATE는 발행하지 않는다. 적용 시점에 저장소의 다른 `postgres_changes` 소비자는 없었다. 이후 같은 publication에 테이블을 추가할 때 이 이벤트 정책을 함께 확인한다.
- 기존 RLS가 고객 본인과 현재 staff/admin만 허용한다. `inquiry_internal_notes`와 감사 로그는 publication에 넣지 않는다. 서버의 service role로 고객 채널을 만들지 않는다.
- 테이블 SELECT를 열어두지 않고 공개 가능한 칼럼에만 authenticated SELECT를 부여한다. `inquiries.assignee_id`, `handled_by`, `waiting_since`와 `inquiry_messages.author_id`는 일반 고객뿐 아니라 authenticated를 공유하는 운영자의 원시 구독에도 노출되지 않는다. 운영자 상세의 담당 정보는 staff 권한을 확인하는 `admin_inquiry_workspace` RPC가 읽는다. 답변자 표시 이름은 기존 목적별 조회 RPC를 사용한다.
- 클라이언트는 이벤트를 갱신 신호로만 사용한다. 표시할 본문·첨부·운영자 이름은 기존 권한 있는 로더에서 다시 읽는다. `/api/inquiries`는 요청의 사용자 ID를 받지 않고 서버가 확인한 로그인 사용자로 조회하며 `private, no-store`로 반환한다. 계정이 바뀌면 위젯 패널을 다시 마운트하고, 이전 응답은 사용자 ID와 요청 키로 차단한다.
- `SUBSCRIBED`는 WebSocket 채널 입장 완료다. DB 구독 준비는 `system` 이벤트의 `extension=postgres_changes`, `status=ok`로 확인한다. 이때 다시 조회하여 최초 접속·재연결 중 놓친 변경을 보완한다. 연결 오류 시 재시도 상태와 수동 새로고침을 표시한다.

## 자동 검증

SQL 검증은 트랜잭션 안에서 fixture를 만들고 롤백한다. 대상 환경에 최신 migration이 적용되어 있어야 한다.

```sh
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/inquiry_realtime_delivery.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/inquiry_threads.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/inquiry_assignment_and_private_notes.sql
```

`inquiry_realtime_delivery.mjs`는 실제 Realtime 호스트와 해당 호스트가 읽는 DB의 조합을 검증한다. 같은 JWT secret을 쓰는 격리된 로컬 DB/Realtime를 먼저 준비한다. `INQUIRY_REALTIME_URL`은 테넌트의 `.localhost` 호스트를 사용하고, `INQUIRY_REALTIME_JWT_SECRET`은 로컬 환경에서만 주입한다. 비밀값을 로그나 저장소에 기록하지 않는다. 공유 Supabase 포트 `54322`는 스크립트가 거절한다.

```sh
# PGHOST=127.0.0.1, PGPORT=<격리 포트>, PGUSER, PGDATABASE, PGPASSWORD,
# INQUIRY_REALTIME_URL, INQUIRY_REALTIME_JWT_SECRET를 준비한 뒤 실행한다.
# psql이 PATH에 없다면 PSQL에 실행 파일 절대 경로를 지정한다.
node supabase/tests/inquiry_realtime_delivery.mjs
```

네 고객/운영자 fixture와 두 문의를 임시 생성하고 종료 시 정리한다. 행·칼럼 필터 없는 구독으로 고객 A/B 격리, 운영자 조회, 비로그인 빈 401 응답, 내부 칼럼 비노출, 운영자 강등 후 수신 차단, DELETE 비발행을 검사한다. 구독 준비 후 답변 RPC 호출부터 수신까지 3초 이내인지 측정한다. 이 수치는 전송 계약이며 화면에 표시되는 시간은 아래 브라우저 검증으로 확인한다.

2026-09-08 격리 cold DB에서 46ms, QA DB에서 132~133ms, 앱과 같은 QA API 프록시를 거친 연결에서 89~90ms로 위 계약이 통과했다. 로컬 검증 결과이며 hosted Realtime 적용이나 운영팀 리허설 완료를 의미하지 않는다.

## 브라우저 확인

최신 앱 빌드와 동일한 DB/Realtime 연결을 사용한다. 어드민 답변을 저장한 뒤 열린 고객 대화에 새로고침 없이 3초 안에 나타나는지 확인하고, 고객 답글이 열린 어드민 문의 콘솔과 새 메시지 배지에 반영되는지 확인한다.

비로그인 FAQ·로그인 유도, 로그인 FAQ 첫 화면→내 문의→새 문의, 첨부·실제 답변자명·종결 문의, 로그아웃/계정 전환 시 이전 고객 내용 제거를 확인한다. 데스크톱과 모바일에서 배경 inert, 최초 포커스, Tab 순환, Escape/닫기 후 버튼 포커스 복귀, 스크롤과 하단 탭바 간섭도 확인한다. 실제 브라우저와 운영팀 S1~S5 완료 증거는 별도로 남긴다.
