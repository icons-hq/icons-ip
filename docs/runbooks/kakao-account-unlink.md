# 카카오 연결 해제 수신(계정 상태 변경 웹훅) 런북

회원이 카카오 쪽에서 ICONS 앱 연결을 끊으면(카카오계정 탈퇴, 카카오계정 '연결된 서비스 관리'에서 해제, 카카오
고객센터 처리 등) 카카오가 그 사실을 알려 준다. 이 알림을 받아 회원 데이터에 반영하는 절차다.

2026-11-18 도메인 전환 점검 중, 카카오 앱(앱 ID `1520482`)에 '연결 해제 웹훅'과 '계정 상태 변경 웹훅'이 모두 등록돼
있지 않은 것을 발견했다. 카카오 콘솔은 "미설정 시 서비스 외부에서의 회원 탈퇴 정보를 전달받을 수 없어 개인정보 처리가
누락될 수 있다"고 경고한다. 이 런북을 만든 PR이 그 공백을 메운다.

| 항목 | 상태 |
|---|---|
| 수신 경로 `/api/webhooks/kakao/account-status`·DB 원장·처리 RPC | 이 런북을 만든 PR |
| env `KAKAO_REST_API_KEY` | 사람(§3) — 없으면 경로가 404다 |
| 카카오 콘솔 계정 상태 변경 웹훅 등록 | 사람(§3) |
| 카카오 콘솔 연결 해제 웹훅 | **등록하지 않는다**(§1) |

코드: [`lib/kakao/account-unlink.server.ts`](../../lib/kakao/account-unlink.server.ts),
[`app/api/webhooks/kakao/account-status/route.ts`](../../app/api/webhooks/kakao/account-status/route.ts),
[`supabase/migrations/20261118190000_kakao_account_unlink.sql`](../../supabase/migrations/20261118190000_kakao_account_unlink.sql).

## 1. 결정: 연결 해제 웹훅이 아니라 계정 상태 변경 웹훅(SSF)

카카오는 같은 사실을 두 웹훅으로 알려 준다. 2026-11-18 카카오 공식 문서
([카카오 로그인 웹훅](https://developers.kakao.com/docs/latest/ko/kakaologin/callback),
[웹훅 공통](https://developers.kakao.com/docs/latest/ko/getting-started/callback),
[앱 설정](https://developers.kakao.com/docs/latest/ko/app-setting/app))을 기준으로 비교했다.

| | 연결 해제 웹훅 | 계정 상태 변경 웹훅(SSF, User Unlinked) |
|---|---|---|
| 요청 | GET 또는 POST, `app_id`·`user_id`·`referrer_type` | POST, `application/secevent+jwt` 본문의 SET(RS256 JWT) |
| 인증 | `Authorization: KakaoAK <대표 어드민 키>` 비교(공유 비밀) | 카카오 인증 서버의 개인키 서명을 공개키(`https://kauth.kakao.com/.well-known/jwks.json`)로 검증, `aud`=대표 REST API 키 |
| 성공 응답 | 3초 안에 200 | 3초 안에 본문 없는 202 |
| 실패 응답 | 규격 없음 | 400 + `{"err","description"}`(RFC 8935). 400은 다시 보내지 않는다 |
| 재전송 | **없음** | 최초 포함 6번(5분 간격 2번, 30분 간격 2번, 60분 뒤 1번) |
| 중단 | 오래 응답이 없거나 오류가 잦으면 일시 중지 | 3시간 넘게 연속 실패하면 비활성화 |
| 사유 값 | 5종 | 7종(`REVOKE_ACCOUNT_SERVICE_TERMS`·`UNLINK_FROM_SERVICE` 추가) |
| 동의항목 | 필요 없음 | OAUTH 카테고리(User Unlinked)는 필요 없음. RISC·CAEP만 `openid_sse` 필요 |

계정 상태 변경 웹훅을 고른 이유:

1. **재전송.** 연결 해제 웹훅은 한 번 놓치면(배포 중, 일시 장애, 3초 초과) 그 회원의 처리가 영영 빠진다. 콘솔 경고가
   말하는 '개인정보 처리 누락'이 바로 이것이다. SSF는 실패하면 2시간 넘게 다시 보내므로, 앱은 처리를 응답 전에 끝내고
   실패하면 500을 돌려 재전송을 받는다.
2. **인증.** 공유 비밀(어드민 키) 비교 대신 서명을 검증한다. 어드민 키는 앱 오너(회사 공용 계정)만 볼 수 있어 env 등록도
   오너가 해야 하지만, SSF는 공개키와 REST API 키(비밀값이 아님)만 있으면 된다.
3. **사유가 더 많다.** 연결 해제 웹훅의 사유 5종을 모두 포함한다.

치르는 값: SET 서명 검증 코드(`node:crypto`, 의존성 추가 없음)와 공개키 캐시가 생겼고, 3시간 연속 실패면 웹훅이
꺼지므로 §6을 지킨다. 두 웹훅을 함께 등록하지 않는다 — 같은 해제가 두 번 오고, 연결 해제 웹훅 수신 경로는 없다.
콘솔이 '연결 해제 웹훅 미설정' 경고를 계속 보일 수 있지만 같은 사실을 이 웹훅이 받는다.

## 2. 받으면 하는 일

앱은 서명·발급자(`https://kauth.kakao.com`)·대상(`aud`)을 검증하기 전에는 본문을 믿지 않는다. 검증을 통과한
`user-unlinked` 이벤트만 `service_record_kakao_unlink`(service_role 전용)로 넘기고, DB가 아래처럼 처리한다
(2026-11-18 사용자 결정). 다른 이벤트는 받기만 한다(202).

| 결과(`outcome`) | 조건 | 하는 일 |
|---|---|---|
| `relinked` | 알림 시각(`toe`)보다 5초 넘게 나중에 카카오로 다시 로그인한 기록이 있다(identity `last_sign_in_at`·`updated_at`) | 아무것도 바꾸지 않는다. 늦게 온 재전송이 다시 연결한 회원을 끊지 않게 한다. `toe`는 초 단위로 잘리고 시계도 조금 어긋나 5초 여유를 둔다 |
| `identity_unlinked` | 다른 로그인 수단이 있다 — Google·Apple 같은 다른 공급자 identity, 또는 비밀번호가 있는 이메일 identity | 카카오 identity만 지운다(§2.1) |
| `withdrawal_review` | 카카오 말고는 로그인할 수단이 없다(비밀번호 없는 이메일 identity만 있는 경우 포함) | 계정·카카오 identity를 그대로 두고 탈퇴 검토 대기로 남긴다(§5) |
| `no_member` | 그 회원번호의 카카오 identity가 없다 | 기록만 한다. 회원을 특정하는 값은 남기지 않는다 |

- 원장 `private.kakao_unlink_events`는 이벤트 ID(`jti`)당 한 행이다. 재전송에는 처음 결과를 돌려주고 다시 처리하지 않는다.
  카카오 회원번호는 남기지 않고, 회원(`auth.users`)이 지워지면 함께 지워진다.
- 카카오 시계가 앞서 미래 시각이 와도 지금으로 줄여 판정한다.

### 2.1 다른 로그인 수단이 있는 회원 — 카카오 연결만 끊는다

개인정보처리방침 제8조("처리 목적이 달성된 개인정보는 지체 없이 파기")를 따른다. 카카오 로그인이라는 목적이 끝났으므로
카카오가 준 값을 지운다.

- 지우는 것: `auth.identities`의 카카오 행(카카오 닉네임·프로필 사진 주소·이메일·회원번호가 든 `identity_data`),
  `auth.users.raw_user_meta_data`에서 카카오 identity와 같은 값인 키. `raw_app_meta_data`의 공급자 목록은 남은
  identity로 다시 맞춘다(GoTrue가 identity를 지울 때와 같다).
- 남는 것: 계정, 계정 이메일(`auth.users.email`·`profiles.email`), 주문·쿠폰 등 거래, 다른 로그인 수단,
  카카오톡 채널 친구 쿠폰 발급 기록(회원·채널당 1회 판정용), 마케팅 수신 동의(카카오톡 수단은 채널 메시지 수신 동의라
  로그인 연결과 무관).
- 나중에 같은 카카오 계정으로 다시 로그인하면 GoTrue가 같은 검증된 이메일의 계정에 자동으로 잇는다. 이메일이 다르면 새
  계정이 된다(처음 카카오로 가입할 때와 같다).

### 2.2 카카오로만 가입한 회원 — 계정을 두고 탈퇴 검토 대기

비밀번호 없는 이메일 identity(관리 API로 계정 이메일을 바꿀 때 생길 수 있다)만 더 있는 회원도 여기에 든다. 그 identity만으로는
로그인할 수 없고, 카카오를 지우면 다음 카카오 로그인이 다른 이메일의 새 계정으로 갈라진다.

- 운영 회원 탈퇴 기능(Phase 1)이 꺼져 있어 자동 탈퇴를 할 수 없다(2026-11-18 운영 확인: `phase_one_enabled=false`).
- 카카오 identity를 지우면 그 회원은 로그인 수단이 없어지고, 같은 카카오 계정으로 다시 로그인할 때 같은 이메일의 기존
  계정과 부딪혀 로그인이 깨진다. 그래서 identity를 둔다.
- 이미 로그인된 ICONS 세션은 끊지 않는다(사용자 결정 — 기록만).

## 3. 사람 단계: env와 콘솔 등록

카카오 앱 오너는 회사 공용 계정 `playxmd@kakao.com`이다(2026-11-18 소유권 이전, 앱 키는 그대로). 사용자 개인 계정은 Editor다. 카카오 문서상
Editor는 오너 전용 항목(앱 삭제·플랫폼 키 삭제·어드민 키 관리·대표 키 변경)을 뺀 설정을 바꿀 수 있어 웹훅 등록도 될 것으로
보이지만, 문서에 웹훅 권한이 명시돼 있지 않다. 저장이 막히면 오너 계정으로 한다. 이 웹훅은 어드민 키가 필요 없다.

**순서를 지킨다 — env와 배포가 먼저, 콘솔 등록이 나중.** 등록한 뒤 경로가 404를 돌려주면 카카오가 실패로 세고 3시간 뒤
웹훅을 끈다.

1. 카카오 콘솔 [앱] > [플랫폼 키]에서 **대표 REST API 키**를 확인한다. SET의 `aud`는 대표 키다. Supabase 카카오
   provider가 쓰는 'ICONS Web' REST API 키(README)가 대표인지 함께 확인하고, 다르면 대표 키 값을 쓴다.
2. Vercel production env `KAKAO_REST_API_KEY`에 그 값을 넣고 재배포한다(비밀값은 아니지만 서버 env로만 둔다).
3. 경로가 열렸는지 확인한다. 404면 env가 반영되지 않은 것이다.

   ```bash
   curl -sS -i -X POST https://iconsip.com/api/webhooks/kakao/account-status --data 'not-a-jwt'
   ```

   기대값: `400`과 `{"err":"invalid_request",...}`.
4. 카카오 콘솔 [앱] > [웹훅] > [계정 상태 변경 웹훅] > 웹훅 등록:
   - 상태: 사용함
   - 웹훅 URL: `https://iconsip.com/api/webhooks/kakao/account-status` (전환 뒤 주소는 §4)
   - 변경 이벤트: OAUTH 카테고리의 **User Unlinked**만
5. 콘솔 [도구] > [웹훅 테스트]에서 계정 상태 변경 웹훅을 보내 202를 확인하고, 원장에 행이 생겼는지 본다(테스트 회원번호는
   ICONS 회원이 아니라 `no_member`일 것이다).

   ```sql
   select outcome, reason, event_at, received_at
   from private.kakao_unlink_events order by received_at desc limit 5;
   ```

   400이면 Vercel 로그의 `[kakao-account-status] refused` 경고에서 `err`·`description`을 본다(Vercel은 응답 본문을
   남기지 않아 앱이 따로 남긴다). `invalid_audience`는 1번의 키가 대표 키가 아닌 경우다 — 이 상태로 두면 실제 해제도
   400으로 버려지고 카카오는 다시 보내지 않으므로 등록 직후 반드시 확인한다.
6. 연결 해제 웹훅([앱] > [웹훅] > [연결 해제 웹훅])은 등록하지 않는다(§1).

## 4. 주소와 도메인 전환

웹훅은 대개 리디렉션을 따라가지 않는다([domain-migration-xsquare.md](domain-migration-xsquare.md) 2단계).

- **전환 전(지금)**: `https://iconsip.com/api/webhooks/kakao/account-status`. `xsquare.kr`는 아직 `iconsip.com`으로
  307 리디렉션 중이라 지금 `xsquare.kr`로 등록하면 받지 못한다.
- **3단계 전환 직후**: 콘솔의 웹훅 URL을 `https://xsquare.kr/api/webhooks/kakao/account-status`로 바꾼다
  (domain-migration 3단계 4번 "웹훅 교체"에 포함). 옛 주소는 308 리디렉션이 되므로 늦출수록 재전송이 실패로 쌓인다.

## 5. 탈퇴 검토 대기

카카오로만 가입한 회원이 연결을 끊으면 `private.kakao_unlink_withdrawal_queue`에 나타난다. 회원마다 마지막 해제만 보고,
알림 뒤 카카오로 다시 로그인한 회원과 이미 어드민에서 탈퇴를 처리한 회원(`private.member_withdrawal_processings`)은 빠진다.

```sql
select q.user_id, q.reason, q.event_at, u.email
from private.kakao_unlink_withdrawal_queue q
join auth.users u on u.id = q.user_id
order by q.event_at;
```

- `ACCOUNT_DELETE`·`FORCED_ACCOUNT_DELETE`: 카카오계정 자체가 없어져 그 회원은 다시 로그인할 수 없다.
- `UNLINK_FROM_APPS` 등: 회원이 다시 카카오로 로그인하면 목록에서 빠진다.
- 지금은 목록만 쌓인다. 어드민 탈퇴 처리(고객 상세의 '탈퇴 요청 처리')는 1:1 문의를 근거로 받으므로, 카카오 쪽 해제만으로는
  그 경로를 쓸 수 없다. 이 목록을 어드민 화면에 띄우고 탈퇴 처리의 근거로 잇는 일은 후속 작업이다. 진행 중 주문·환불이 있으면
  그 처리가 먼저다.

## 6. 운영 확인

Vercel 로그(카카오 회원번호와 본문은 남기지 않는다):

| 로그 | 응답 | 뜻 |
|---|---|---|
| `[kakao-account-status] refused` (warn) | 400 | 서명 전 판정 실패. 위조이거나 설정 문제(`invalid_audience`) |
| `[kakao-account-status] signing key unavailable` (warn) | 500 | 공개키를 받지 못했거나 목록에 그 키 ID가 없다. 카카오가 다시 보낸다 |
| `[kakao-account-status] signed SET has an unexpected shape` / `signed user-unlinked event has an unexpected shape` (error) | 500 | 카카오가 서명한 알림인데 코드가 예상한 모양이 아니다. **재전송이 이어지는 약 2시간 반 안에 파서를 고친다** |
| `[kakao-account-status] unlink not recorded` (error) | 500 | DB 처리 실패. 카카오가 다시 보낸다 |

- 공개키는 6시간 캐시하고, 모르는 키 ID가 와도 1분에 한 번만 다시 받는다(동시에 온 요청은 조회 한 번을 함께 쓴다). 서명이
  맞는 정상 알림을 400으로 버리지 않도록, 키를 찾지 못하면 이유와 상관없이 500이다. 위조 요청은 어느 응답을 받든 상관없다.
- 3시간 넘게 연속 실패하면 카카오가 웹훅을 끄고 앱 멤버에게 메일을 보낸다. 원인을 고친 뒤 [계정 상태 변경 웹훅] 설정에서
  상태를 다시 '사용함'으로 바꾼다. 꺼진 동안의 해제는 다시 오지 않는다.

## 7. 롤백

- 수신을 멈추려면 콘솔에서 웹훅 상태를 '사용 안 함'으로 먼저 바꾸고, 그다음 env를 지운다(순서가 반대면 404가 실패로 쌓인다).
- 이미 끊은 카카오 연결은 되돌리지 않는다. 회원이 카카오로 다시 로그인하면 같은 이메일 계정에 이어진다.

## 8. 남는 위험

- `relinked` 판정은 GoTrue가 카카오 재로그인 때 identity의 `last_sign_in_at` 또는 `updated_at`을 갱신한다는 전제다. 로컬에는
  카카오 provider가 없어 실측하지 못했다. 첫 운영 해제를 받은 뒤 확인한다.
- 카카오 문서에 SET 전체 예시가 없다. 회원번호를 이벤트의 `subject.sub`와 최상위 `sub`에서 읽고, 서명된 SET의 모양이 다르면
  500으로 재전송을 받는다. 첫 웹훅 테스트(§3의 5번)로 실제 형식을 확인한다.
- 멱등 키는 SET의 `jti`다. 카카오 문서는 웹훅 요청 식별값을 `txm`이라 하고 재전송이 같은 `jti`를 쓰는지는 밝히지 않는다.
  다른 `jti`로 다시 와도 두 번째 처리는 `no_member`(이미 끊음)거나 대기 목록에서 하나로 접혀 피해는 없다.
- GoTrue의 identity 해제 API는 남은 identity 개수를 자기 쪽에서 세므로, 회원이 같은 순간 다른 수단을 직접 떼면 로그인 수단이
  0개가 되는 좁은 경쟁 구간이 남는다(앱은 해제 기능을 노출하지 않는다).
- user metadata는 '카카오 identity와 같은 값'인 키를 지운다. 다른 공급자가 우연히 같은 값을 넣은 키도 지워지지만, 앱은
  user metadata를 읽지 않고 그 공급자로 다시 로그인하면 다시 채워진다.
- 카카오로만 가입한 회원은 연결을 끊은 뒤에도 기존 ICONS 세션으로 계속 이용할 수 있다(결정).
- 서비스가 카카오 연결 해제 API를 직접 부를 때 User Unlinked가 오는지 문서가 분명하지 않다(사유 `UNLINK_FROM_SERVICE`는 있다).
  ICONS는 이 API를 부르지 않는다.
