# 프로필 편집 설계

Date: 2026-07-15
Issue: #136
Status: Implemented on `ps/feat/profile-editing`; browser QA, independent review, merge, preview and production verification remain pending

## 목표

로그인과 온보딩을 완료한 사용자가 `/settings`에서 닉네임과 private Storage 아바타를 안전하게 편집하게 한다. 이메일 read-only 표시와 마케팅 동의 저장은 유지한다. 회원 탈퇴는 법정 보존 정책 #102와 후속 구현 #137로 분리했으므로 이 설계에 포함하지 않는다.

## 배경과 제약

아바타 제품 계약은 JPEG, PNG, WebP 형식과 5MiB 이하 크기다. Vercel Functions의 요청·응답 payload 한도는 4.5MB이므로 5MiB 파일을 Server Action이나 Route Handler의 multipart body로 보내면 애플리케이션 코드보다 앞에서 거절될 수 있다. Next.js의 `serverActions.bodySizeLimit`은 이 플랫폼 한도를 높이지 못한다.

따라서 파일 바이트는 브라우저에서 Supabase Storage로 직접 보내고, Server Action은 작은 metadata·signed-upload grant·최종 Storage path만 처리한다. Supabase도 6MB 이하 파일에는 standard upload를 권장하며, signed upload URL과 `uploadToSignedUrl`을 제공한다.

참조:

- https://vercel.com/docs/functions/limitations
- https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- https://supabase.com/docs/guides/storage/uploads/standard-uploads
- https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl

## 선택한 흐름

프로필 아바타 저장은 `prepare → direct upload → finalize` 세 단계다.

1. 브라우저가 닉네임과 선택 파일의 MIME·size만 `prepareProfileAvatarUploadAction`에 보낸다.
2. Action은 입력과 인증·온보딩을 확인하고, 서버가 만든 `<uid>/profile/<uuid-v4>.<ext>` 경로를 service-only 원장에 `pending`으로 먼저 기록한 뒤 one-time signed upload token을 반환한다.
3. 브라우저는 `uploadToSignedUrl`로 파일 바이트를 `user-uploads`에 직접 전송한다.
4. 브라우저는 닉네임과 신규 `avatarPath` 문자열만 `updateProfileAction`에 보낸다. 파일 input에는 `name`을 두지 않아 FormData에 파일 바이트가 들어가지 않게 한다.
5. Action은 Storage metadata, MIME·확장자, 실제 magic bytes를 검증한 후 service-role-only RPC로 profile 행과 같은 사용자의 `pending` claim을 잠그고 원자적으로 갱신한다.
6. RPC가 반환한 실제 직전 아바타 한 개만 제거한다. 후보 검증 실패나 DB 실패는 원장이 `rejected` 전이를 확정해 `cleanup_safe`를 반환한 경우에만 신규 후보를 제거하며, replay·응답 유실·transport 예외에서는 제거하지 않는다.

브라우저가 prepare 뒤 finalize 전에 종료되거나 네트워크가 끊기면 `pending` claim과 signed-upload 후보가 남을 수 있다. 이를 완전히 없애려면 만료 job이 필요하므로 #136 최소 범위에서는 운영 위험으로 기록한다. Action이 관찰한 cleanup 실패는 `audit_log`에 actor, path, stage만 남기며 원문 오류나 민감정보는 기록하지 않는다.

## 모듈 경계

### `lib/profile.ts`

Supabase와 React에 의존하지 않는 공용 계약을 소유한다.

- 닉네임은 trim 후 1~30 Unicode grapheme다.
- grapheme 계산 전에 raw 입력을 512 UTF-16 code units로 제한한다. 30개의 긴 ZWJ emoji는 허용하면서 multi-megabyte 입력의 분할 비용을 제한한다.
- `Intl.Segmenter` 결과는 배열 전체로 만들지 않고 31번째 grapheme에서 즉시 중단한다.
- settings와 onboarding이 같은 닉네임 validator를 사용한다.
- 아바타 metadata는 정수 size `1..5 * 1024 * 1024`, JPEG/PNG/WebP MIME만 허용한다.
- 경로는 정확히 `<uid>/profile/<lowercase UUID v4>.(jpg|png|webp)`만 허용하고 MIME·확장자를 연결한다.
- JPEG, PNG, WebP signature를 검증하는 magic-byte helper를 제공한다.
- avatar fallback initial을 서버에서 계산한다. 닉네임이 비면 `I`다.

### `app/settings/actions.ts`

`prepareProfileAvatarUploadAction`은 닉네임과 선언된 파일 metadata를 먼저 검증하고, settings auth gate를 통과한 뒤 service-only RPC로 exact path를 `pending` claim으로 등록한다. 등록 성공 뒤에만 사용자 세션 Storage client로 `createSignedUploadUrl(path, { upsert: false })`를 호출하며, `{ path, token }` 외 파일·credential은 반환하지 않는다. grant 발급 실패는 claim을 `rejected`로 확정한 경우에만 cleanup한다.

`updateProfileAction`은 다음 순서를 지킨다.

1. 공용 닉네임 validator와 제출된 `avatarPath`의 exact-user-path 계약을 확인한다.
2. 인증과 온보딩을 다시 확인한다.
3. 신규 후보가 있으면 Storage `info()`의 size와 `contentType`을 검사한다.
4. 상한 확인 후 `download()`한 객체의 signature가 선언 MIME과 일치하는지 검사한다.
5. 검증된 사용자 ID, 닉네임, avatar path만 service-role-only RPC에 전달한다.
6. RPC는 profile 행과 candidate claim을 잠그고 같은 사용자의 `pending`만 1회 소비한다. 성공은 candidate를 `active`, 실제 이전 claim을 `retired`로 바꾸고 이전 `avatar_path`를 반환한다.
7. 성공 후 반환된 이전 경로만 제거한다. 알려진 실패는 candidate가 `rejected`로 실제 전이된 경우에만 새 후보를 제거한다. replay·unknown 결과는 제거하지 않으며 폴더 list나 광역 삭제도 하지 않는다.

프로필 Storage remove는 service client로 exact path 하나만 수행하고 resolved `{ error }`와 rejected Promise를 모두 실패로 취급한다. 실패하면 actor·strict path·`candidate|previous` stage만 받는 hardened service-only RPC로 `audit_log`에 cleanup-failure record를 쓴다. cleanup 실패는 이미 성공한 프로필 저장을 실패로 바꾸지 않는다. authenticated DELETE는 본인 non-profile 경로(현재 community)는 유지하되 본인 `profile/*`도 거절한다.

닉네임 uniqueness `23505`, 잘못된 객체, Storage·DB 오류는 내부 원문을 숨긴 필드 또는 form 메시지로 매핑한다.

### 데이터베이스와 Storage

현재 branch의 migration 구현과 local reset·SQL smoke는 완료됐지만 아직 merge되지 않았고 remote에는 적용되지 않았다.

- 배포 전에 normalized nickname 충돌, blank/untrimmed nickname, 잘못된 기존 avatar path가 있으면 fail closed한다.
- `profiles.nickname`은 null 또는 trim된 nonempty 값이고 raw DB 길이도 제한한다. 정확한 grapheme 수는 trusted server validator가 책임진다.
- `profiles.avatar_path`는 해당 row ID의 strict profile UUID path 또는 null이다.
- `lower(btrim(nickname))` partial unique index를 둔다.
- authenticated role에서 `profiles.nickname`과 `profiles.avatar_path` 직접 update column privilege를 revoke한다. 기존 birth date, consents, onboarded 상태 범위는 #136에서 바꾸지 않는다.
- `profile_avatar_claims`는 strict owned path를 primary key로 두고 `pending|active|rejected|retired`를 기록한다. 기존 non-null `profiles.avatar_path`는 migration에서 `active`로 backfill하며, 테이블은 service read-only이고 상태 쓰기는 hardened RPC에만 둔다.
- prepare/reject/`service_update_profile_identity` RPC는 `SECURITY DEFINER`, 고정 search path, fully-qualified relation, service-role-only execute를 사용한다. finalize는 profile 행과 claim을 잠그고 `pending` candidate만 소비하며 replay에는 `cleanup_safe=false`를 반환한다.
- `user-uploads` bucket을 5MiB로 제한한다. 기존 community GIF 계약 때문에 bucket MIME은 JPEG/PNG/WebP/GIF를 유지하고, profile path와 서버 validator에서 GIF를 금지한다.
- Storage INSERT RLS는 `<uid>/profile/<uuid-v4>.(jpg|png|webp)` 또는 `<uid>/community/<uuid-v4>.(jpg|png|webp|gif)`만 허용한다.
- Storage DELETE RLS는 authenticated 사용자의 본인 non-profile 경로를 유지하지만 `profile/*`는 제외한다. 프로필 후보·이전 객체 cleanup은 service-only다.

### onboarding

온보딩 닉네임도 같은 공용 validator를 사용한다. nickname 저장만 service-role identity RPC를 통과하게 하고, 기존 birth date·consents·follow·completion 동작은 유지한다. 이 변경은 #136의 nickname 불변식을 우회하지 않게 하는 최소 연결이며 onboarding 전체를 새 RPC 집합으로 재설계하지 않는다.

### 읽기와 UI

`/settings` Server Component가 현재 avatar의 signed preview URL과 서버 계산 fallback initial을 `Settings`에 전달한다. URL 생성 실패는 페이지 실패로 승격하지 않고 fallback initial로 축소한다. Client Component는 `Intl.Segmenter`를 다시 실행하지 않아 SSR hydration 차이를 만들지 않는다.

`Settings`는 독립된 두 form을 유지한다.

- 프로필 form: circular signed avatar 또는 initial, editable nickname, 이름 없는 file input, 별도 저장 버튼과 상태 영역.
- 약관 form: 기존 required consent 표시, 마케팅 선택, 별도 저장 버튼과 상태 영역.

업로드 중과 최종 저장 pending을 하나의 busy 상태로 합쳐 중복 submit을 막는다. 모든 편집 control과 버튼은 명시적인 cyan `:focus-visible` ring을 제공한다.

## 정합성과 보안 불변식

- 파일 바이트는 Next/Vercel request body에 들어가지 않는다.
- 서버가 경로를 만들고 final Action과 DB CHECK가 동일한 user UUID path를 재검증한다.
- bucket MIME 제한만 신뢰하지 않고 실제 magic bytes를 검사한다.
- authenticated Data API는 nickname/avatar를 직접 바꿀 수 없다.
- DB 갱신은 service-role-only prepare/reject/finalize RPC, durable claim과 row lock을 통과한다.
- cleanup은 DB가 cleanup-safe 상태 전이를 확정한 exact path 한 개에만 service client로 적용하고 결과 오류와 rejection을 모두 처리한다.
- public profile 동기화 trigger는 기존대로 유지한다.
- signed preview 실패, cleanup 실패는 성공한 진실원 갱신을 되돌리지 않는다.

## 테스트

- 순수 계약: raw 512 code-unit ceiling, 30/31 grapheme와 긴 ZWJ emoji, exact path, MIME/size, magic bytes, fallback initial.
- actions: prepare claim→signed token 순서, final payload 무파일 계약, Storage info/download 검증, first finalize/replay, known rejection의 exactly-once cleanup, unknown transport cleanup 금지, previous retirement와 hardened audit fallback.
- onboarding: settings와 같은 30-grapheme 계약이 DB write 전에 적용됨.
- UI/page: file input에 `name`이 없음, direct upload helper, 독립 상태, pending, focus class, 서버 계산 initial, signed preview fallback.
- SQL smoke: fail-closed constraints, normalized uniqueness, authenticated direct update 거절, service-only 원장·RPC ACL/security, first finalize/replay, rejected cleanup 1회, previous retirement, audit RPC, public profile sync, bucket INSERT/DELETE RLS.
- 자동 검증 완료: `npm test` 93 files/979 tests, warning 수정 후 `npm run lint`, Next production build, local Supabase reset/profile smoke. DB lint에는 기존 `refund_ticket_order`의 미사용 `p_reason` warning 한 건만 남았다.
- 미검증: 실브라우저의 정확히 5MiB 유효 PNG direct upload, 5MiB+1 거절, 두 번째 교체 후 객체 1개, 새로고침 preview, 마케팅 회귀, 390px overflow, keyboard focus, console error 0, 임시 데이터 정리.
- preview·production 배포와 live smoke는 PR 이후 별도 검증한다. 자동 검증 완료만으로 #136이나 Project item을 완료 처리하지 않는다.

## 문서 영향

- `docs/launch-readiness-plan.md`의 Account 트랙을 #102 human policy, #136 profile editing, #137 blocked implementation으로 맞춘다.
- `DESIGN.md`에 Settings의 editable profile surface와 fallback avatar 규칙을 기록한다.
- PRD/ARCHITECTURE의 제품 범위는 바뀌지 않는다.

## 제외 범위

- 회원 탈퇴와 법정 보존 원장
- 커뮤니티 대용량 업로드 경로 개선
- abandoned `pending` claim과 signed-upload 객체를 만료 청소하는 job
- 커뮤니티 피드의 프로필 아바타 노출
- 이미지 crop/resize 편집기
- 이메일 변경
