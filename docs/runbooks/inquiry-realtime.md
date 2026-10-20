# 문의 실시간 연결 검증

migration 파일 경로는 [배포 매핑](../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

#432의 실시간 표면은 기존 문의 원장과 서버 액션을 사용한다. 고객 위젯은 FAQ를 먼저 보여주고 로그인한 고객에게 내 문의·새 문의를 제공한다. `/my/inquiries/[inquiryId]`와 어드민 문의 목록·상세, `/admin/cs/chat` 상담하기 화면도 변경을 구독한다. 위젯 오버레이는 `OverlayPortal`로 `body` 아래에 렌더한다.

## 데이터와 권한

- `20260908025703_inquiry_realtime_delivery.sql`은 `supabase_realtime`에 `inquiries`, `inquiry_messages`를 추가하고 INSERT·UPDATE만 발행한다. DELETE의 RLS 필터 제약 때문에 DELETE·TRUNCATE는 발행하지 않는다. 적용 시점에 저장소의 다른 `postgres_changes` 소비자는 없었다. 이후 같은 publication에 테이블을 추가할 때 이 이벤트 정책을 함께 확인한다.
- 기존 RLS가 고객 본인과 현재 `cs.manage` 권한을 가진 운영자만 허용한다. `inquiry_internal_notes`와 감사 로그는 publication에 넣지 않는다. 서버의 service role로 고객 채널을 만들지 않는다.
- 테이블 SELECT를 열어두지 않고 공개 가능한 칼럼에만 authenticated SELECT를 부여한다. `inquiries.assignee_id`, `handled_by`, `waiting_since`와 `inquiry_messages.author_id`는 일반 고객뿐 아니라 authenticated를 공유하는 운영자의 원시 구독에도 노출되지 않는다. 운영자 상세의 담당 정보는 staff 권한을 확인하는 `admin_inquiry_workspace` RPC가 읽는다. 답변자 표시 이름은 기존 목적별 조회 RPC를 사용한다.
- 클라이언트는 이벤트를 갱신 신호로만 사용한다. 표시할 본문·첨부·운영자 이름은 기존 권한 있는 로더에서 다시 읽는다. `/api/inquiries`는 요청의 사용자 ID를 받지 않고 서버가 확인한 로그인 사용자로 조회하며 `private, no-store`로 반환한다. 계정이 바뀌면 위젯 패널을 다시 마운트하고, 이전 응답은 사용자 ID와 요청 키로 차단한다.
- `SUBSCRIBED`는 WebSocket 채널 입장 완료다. DB 구독 준비는 `system` 이벤트의 `extension=postgres_changes`, `status=ok`로 확인한다. 이때 다시 조회하여 최초 접속·재연결 중 놓친 변경을 보완한다. 첫 DB 구독 대기·연결 오류 동안에는 활성 탭이 온라인인 경우 5초마다 기존 인증 로더를 다시 읽는다. DB ready가 확인되면 이 보완 조회를 중단하며 구독을 닫을 때 타이머도 제거한다. 연결 오류 시 재시도 상태와 수동 새로고침을 표시한다.

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

`system` 메시지는 고객·관리자 화면과 문의 위젯에서 ‘자동 안내’로 표시한다. Realtime 신호는 화면을 갱신하지만 새 사람 답글 배지에는 포함하지 않는다. 작성자 프로필은 system만 비어 있고 기존 column SELECT 권한에서 `author_id`는 계속 제외한다. 자동 안내는 `admin_answer_inquiry` 또는 알림/메일 발송 경로를 호출하지 않는다.

## 상담하기 콘솔 (2026-10-20)

`/admin/cs/chat`은 ICONS 고객문의의 대화 목록·중앙 대화/입력창·우측 상담정보를 한 화면에서 제공한다. 검색은 대화 본문·닉네임·문의번호·운영자가 붙인 태그를 대상으로 하며, 담당자·최근 1주일/1개월/전체 기간·읽음 여부·최신/오래된 순서 조건을 서버에서 적용한 뒤 30건씩 페이지를 자른다. 기간은 마지막 대화 시각 기준이다. 전체·대기·진행중·완료는 기존 `all|open|answered|closed`에 대응한다. `answered`는 답변 후 추가 질문을 받을 수 있는 상태이고, `closed`는 기존 계약대로 재개할 수 없다.

자주 쓰는 문구, 담당자 변경, 내부 메모와 상담완료는 기존 서버 액션/RPC를 재사용한다. 상담창의 답변·사진·파일은 아래의 검증된 첨부와 멱등 메시지 RPC를 사용한다. 답변은 인앱 알림과 기존 이메일 처리 경로를 유지하며, 이메일만 실패한 경우 답변까지 실패한 것으로 표시하지 않는다. 상담완료는 별도 확인 후 실행한다. 초안은 기존 로그인 계정·세션 경계를 따르고, 고객에게는 내부 메모·운영자 태그를 노출하지 않는다. 구매이력/연결 주문은 `sales.read`, 고객 상세 링크는 `platform.manage` 권한에 따라 표시한다. 모바일에서는 목록↔대화 이동과 상담정보 바로가기를 제공하며 입력창을 하단 도구막대 위에 유지한다.

`admin_inquiry_chat_console`은 현재 `cs.manage`를 검사한다. `private.inquiry_chat_reads(actor_id, message_id)`는 운영자별 읽음 원장이다. 활성 탭에 표시된 대화의 고객 메시지 ID만 `/api/admin/inquiry-chat/read`로 보내며, API는 같은 출처·현재 로그인 계정 바인딩·업무 권한을 확인한다. `admin_mark_inquiry_chat_read`는 입력 ID 모두가 지정 문의의 고객 메시지인지 검증한 후 멱등 기록한다. 조회 후 도착한 메시지는 같은 타임스탬프이거나 UUID 순서가 앞서더라도 읽음에 포함되지 않는다. 다른 운영자의 읽음도 바꾸지 않는다. 읽음 원장은 본문·연락처를 복제하지 않고 메시지/운영자 삭제 시 FK cascade로 정리되며 알림·이메일을 만들지 않는다.

`private.inquiry_chat_tags`에는 운영자가 명시적으로 입력한 1~20자 태그를 대화당 최대 10개까지 저장한다. `admin_update_inquiry_chat_tag`는 현재 운영자 바인딩과 `cs.manage` 검사 후 문의 행을 잠가 해당 태그의 추가/삭제만 수행하고 감사 기록을 남긴다. 같은 요청 재시도는 중복 저장·감사를 만들지 않는다. 네트워크 실패 시 입력과 기존 태그를 유지하고 같은 의도로 다시 시도할 수 있다. `admin_inquiry_chat_context`는 태그와 동일 고객의 최근 20개 다른 대화만 반환한다. 두 private 테이블은 RLS를 켜고 클라이언트 역할의 직접 접근을 봉인하며 권한 있는 RPC로만 읽거나 변경한다.

앱 코드와 다음 migration을 함께 적용해야 한다. 누락/유효하지 않은 RPC 응답은 정상 빈 상담함으로 표시하지 않고 조회 실패로 처리한다. 운영 환경 적용은 별도 승인 범위다.

- `20261020085524_inquiry_chat_console.sql`: 상담 목록·운영자별 읽음 원장과 RPC.
- `20261020085526_inquiry_chat_tags_and_history.sql`: 태그·태그 검색·같은 고객의 이전 대화.
- `20261020085530_inquiry_chat_private_files.sql`: 비공개 첨부·파일 보관함·멱등 발송, 실제 사진이 있는 빈 본문 허용.
- `20261020085531_inquiry_file_filename_contract.sql`: 다운로드 파일명과 검증된 MIME의 확장자 일치 제약.
- `20261020085532_inquiry_file_session_lock_order.sql`: 권한 회수와 같은 계정 작업→프로필 잠금 순서로 세션검사 교착 방지.

추가 SQL 회귀는 격리 DB에서 `supabase/tests/inquiry_chat_console.sql`을 실행한다. 실제 역할로 필터/정렬/페이지, 읽음 분리, 미표시 메시지 보존, 태그 멱등/제한/감사, 접근 권한과 최소 ACL을 확인하고 합성 fixture를 전부 롤백한다. 브라우저에서는 합성 고객 새 문의→운영자 실시간 수신/읽음→사진·문구 답변→고객 실시간 수신→담당자/메모/태그→상담완료와 새로고침 후 저장 상태를 확인한다. 태그 전송을 실패시켜 입력 보존과 재시도도 확인한다.

### 상담 사진·파일 보관함

상담창은 한 글자 답변과 본문 없는 사진·파일 메시지를 허용한다. 본문과 확인된 첨부가 모두 없으면 전송할 수 없다. 한 메시지에는 최대 3개, 파일당 20MB를 첨부한다. 운영자는 보관함에서 파일명 검색·등록·첨부·다운로드·삭제를 할 수 있고, 활성 보관함 전체 한도는 100개다. JPG/JPEG·PNG·WebP·GIF·MP4·PDF·TXT·XLS·XLSX·PPT·DOC·DOCX·HWP를 지원한다. 기존 고객 문의 작성/추가 답글의 사진 계약은 최대 3장·각 5MB를 유지한다.

`inquiry-files-private`은 비공개 버킷이다. 서버가 현재 `cs.manage`와 로그인 세션을 확인해 업로드 ID·경로·이름·MIME·크기를 준비하고 브라우저가 Storage로 직접 업로드한다. 파일 바이트를 Next Server Action 본문으로 보내거나 전역 요청 크기 제한을 늘리지 않는다. 업로드 후 서버가 Storage 정보와 실제 바이트를 읽어 크기·내용·SHA-256을 확인한다. 사진은 sharp로 실제 형식, 한 변 12,000px, 전체 4천만 화소, 최대 100프레임을 확인하고 디코딩한다. 문서·MP4는 서명과 크기를 검사하며 문서 내용 실행·압축 해제나 백신 검사를 수행했다고 표시하지 않는다. 파일명 확장자는 검증 MIME과 같아야 하고 JPEG는 `.jpg`/`.jpeg`를 함께 허용한다.

`admin_send_inquiry_chat_message`는 검증된 파일 UUID만 받는다. 문의 잠금과 현재 권한 검사 후 본문·파일 연결·상태·인앱 알림·감사를 한 트랜잭션으로 기록한다. 요청 ID가 같으면 actor·문의·본문·파일 UUID가 모두 같은 경우에만 기존 메시지를 반환하므로 결과 확인이 메시지나 알림을 복제하지 않는다. 응답 유실 시 초안·첨부와 같은 요청을 보존하고 편집을 잠근 뒤 ‘전송 결과 다시 확인’을 제공한다. 알려진 오류에서는 초안·첨부를 유지한다. 새로운 성공에만 입력을 초기화한다. 파일 업로드·보관함 조회/삭제 실패에는 재시도를 제공하며 취소한 사진은 늦게 업로드가 끝나도 다시 첨부되지 않는다.

`/api/inquiries/files`는 파일 ID와 선택한 메시지 ID로만 접근한다. 현재 로그인 세션과 본인 문의 또는 `cs.manage`를 검사하고, 바이트 조회·SHA 확인 뒤 다시 권한을 확인한다. 고객은 실제 해당 메시지에 연결된 파일만 받으며 보관함이나 다른 고객 메시지로 우회할 수 없다. 응답은 `private, no-store`, `nosniff`이고 문서는 다운로드로 전달한다. 고객 화면에는 Storage 경로나 공개·장기 서명 URL을 전달하지 않는다. Storage 정책은 준비된 자기 경로에 INSERT만 허용하며 직접 SELECT/UPDATE/DELETE는 허용하지 않는다.

보관함 삭제는 이후 선택을 막되 이미 보낸 메시지의 파일은 유지한다. 준비된 업로드는 30분 동안 유효하고 보관함 밖에서 검증한 미전송 사진은 24시간 동안 사용할 수 있다. 다음 업로드 준비/보관함 삭제에서 최대 5개씩 만료·삭제된 미참조 객체를 정리하며, 전송된 파일은 정리 대상으로 삼지 않는다. 사진·파일 선택은 새로고침 후 초안 복구와 별개이며 재선택이 필요하다. 파일 세션 검사는 계정 작업 advisory 잠금을 먼저 얻은 뒤 프로필·로그인 세션을 읽어 권한 회수 경로와 잠금 순서를 맞춘다. 격리 DB에서 계정 작업 잠금·프로필 갱신 트랜잭션과 실제 파일 세션검사를 겹쳐 수정 전 교착과 수정 후 양쪽 완료를 확인했다.

격리 DB에서 `supabase/tests/inquiry_chat_files.sql`로 준비/검증/발송 멱등, 빈 본문, 파일명·MIME·크기, 세션·고객·운영자 권한, 삭제 이후 다운로드와 ACL을 검증한다. 실제 브라우저에서는 4MB PDF 직접 업로드→고객 자동 수신→원본 바이트 일치, 다른 고객 403·비로그인 401, 손상 사진 거절, 통신 실패·업로드 취소 경쟁, 저장 후 응답 유실의 동일 요청 재시도를 확인한다.

이 콘솔은 네이버 톡톡 서버나 네이버 구매이력을 연결하지 않는다. AI 요약을 생성하지 않고 실제 문의 제목·유형·시각을 보여준다. 네이버 원본 고객 메시지·계정 정보를 합성 fixture나 저장소 증거로 복제하지 않는다.
