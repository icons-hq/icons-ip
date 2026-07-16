# 프로필 편집 설계

Date: 2026-07-15
Issue: #136
Status: Approved by the user's standing instruction to execute Project #8 autonomously

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
2. Action은 입력과 인증·온보딩을 확인하고, 서버가 만든 `<uid>/profile/<uuid-v4>.<ext>` 경로의 one-time signed upload token을 반환한다.
3. 브라우저는 `uploadToSignedUrl`로 파일 바이트를 `user-uploads`에 직접 전송한다.
4. 브라우저는 닉네임과 신규 `avatarPath` 문자열만 `updateProfileAction`에 보낸다. 파일 input에는 `name`을 두지 않아 FormData에 파일 바이트가 들어가지 않게 한다.
5. Action은 Storage metadata, MIME·확장자, 실제 magic bytes를 검증한 후 service-role-only RPC로 profile 행을 잠그고 원자적으로 갱신한다.
6. RPC가 반환한 실제 직전 아바타 한 개만 제거한다. DB 실패나 후보 검증 실패 시 신규 후보만 제거한다.

브라우저가 prepare 뒤 finalize 전에 종료되거나 네트워크가 끊기면 signed-upload 후보가 남을 수 있다. 이를 완전히 없애려면 pending-upload 원장과 만료 job이 필요하므로 #136 최소 범위에서는 운영 위험으로 기록한다. Action이 관찰한 cleanup 실패는 service-role 재시도 후 `audit_log`에 actor, path, stage만 남기며 원문 오류나 민감정보는 기록하지 않는다.

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

`prepareProfileAvatarUploadAction`은 닉네임과 선언된 파일 metadata를 먼저 검증하고, settings auth gate를 통과한 뒤 사용자 세션 Storage client로 `createSignedUploadUrl(path, { upsert: false })`를 호출한다. `{ path, token }` 외 파일·credential은 반환하지 않는다.

`updateProfileAction`은 다음 순서를 지킨다.

1. 공용 닉네임 validator와 제출된 `avatarPath`의 exact-user-path 계약을 확인한다.
2. 인증과 온보딩을 다시 확인한다.
3. 신규 후보가 있으면 Storage `info()`의 size와 `contentType`을 검사한다.
4. 상한 확인 후 `download()`한 객체의 signature가 선언 MIME과 일치하는지 검사한다.
5. 검증된 사용자 ID, 닉네임, avatar path만 service-role-only RPC에 전달한다.
6. RPC가 잠긴 행의 실제 이전 `avatar_path`를 반환한다.
7. 성공 후 반환된 이전 경로만 제거한다. 실패 시 새 후보만 제거한다. 폴더 list나 광역 삭제는 하지 않는다.

Storage remove는 resolved `{ error }`와 rejected Promise를 모두 실패로 취급한다. 사용자 client 제거가 실패하면 service client로 같은 exact path 하나를 재시도하고, 그것도 실패하면 `audit_log`에 안전한 cleanup-failure record를 쓴다. cleanup 실패는 이미 성공한 프로필 저장을 실패로 바꾸지 않는다.

닉네임 uniqueness `23505`, 잘못된 객체, Storage·DB 오류는 내부 원문을 숨긴 필드 또는 form 메시지로 매핑한다.

### 데이터베이스와 Storage

현재 branch의 migration은 아직 공유·적용되지 않은 draft이므로 일관된 계약으로 교체한다.

- 배포 전에 normalized nickname 충돌, blank/untrimmed nickname, 잘못된 기존 avatar path가 있으면 fail closed한다.
- `profiles.nickname`은 null 또는 trim된 nonempty 값이고 raw DB 길이도 제한한다. 정확한 grapheme 수는 trusted server validator가 책임진다.
- `profiles.avatar_path`는 해당 row ID의 strict profile UUID path 또는 null이다.
- `lower(btrim(nickname))` partial unique index를 둔다.
- authenticated role에서 `profiles.nickname`과 `profiles.avatar_path` 직접 update column privilege를 revoke한다. 기존 birth date, consents, onboarded 상태 범위는 #136에서 바꾸지 않는다.
- `service_update_profile_identity(user_id, nickname, avatar_path, replace_avatar)` RPC는 `SECURITY DEFINER`, 고정 search path, fully-qualified relation, service-role-only execute를 사용한다.
- RPC는 profile 행을 `FOR UPDATE`로 잠그고 갱신 직전 `avatar_path`를 반환해 동시 교체 시 최신 이전 객체를 정리하게 한다.
- `user-uploads` bucket을 5MiB로 제한한다. 기존 community GIF 계약 때문에 bucket MIME은 JPEG/PNG/WebP/GIF를 유지하고, profile path와 서버 validator에서 GIF를 금지한다.
- Storage INSERT RLS는 `<uid>/profile/<uuid-v4>.(jpg|png|webp)` 또는 `<uid>/community/<uuid-v4>.(jpg|png|webp|gif)`만 허용한다.

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
- DB 갱신은 service-role-only RPC와 row lock을 통과한다.
- cleanup은 exact path 한 개에만 적용하고 결과 오류와 rejection을 모두 처리한다.
- public profile 동기화 trigger는 기존대로 유지한다.
- signed preview 실패, cleanup 실패는 성공한 진실원 갱신을 되돌리지 않는다.

## 테스트

- 순수 계약: raw 512 code-unit ceiling, 30/31 grapheme와 긴 ZWJ emoji, exact path, MIME/size, magic bytes, fallback initial.
- actions: prepare auth gate와 signed token, final payload 무파일 계약, Storage info/download 검증, RPC 순서, uniqueness, rollback, resolved/rejected cleanup failure와 audit fallback.
- onboarding: settings와 같은 30-grapheme 계약이 DB write 전에 적용됨.
- UI/page: file input에 `name`이 없음, direct upload helper, 독립 상태, pending, focus class, 서버 계산 initial, signed preview fallback.
- SQL smoke: fail-closed constraints, normalized uniqueness, authenticated direct update 거절, service-only RPC ACL/security, previous path 반환, public profile sync, bucket/RLS exact path.
- 전체 test/lint/build, local Supabase reset/smoke/lint.
- 실브라우저: 정확히 5MiB인 유효 PNG direct upload, 5MiB+1 거절, 두 번째 교체 후 객체 1개, 새로고침 preview, 마케팅 회귀, 390px overflow, keyboard focus, console error 0, 임시 데이터 정리.

## 문서 영향

- `docs/launch-readiness-plan.md`의 Account 트랙을 #102 human policy, #136 profile editing, #137 blocked implementation으로 맞춘다.
- `DESIGN.md`에 Settings의 editable profile surface와 fallback avatar 규칙을 기록한다.
- PRD/ARCHITECTURE의 제품 범위는 바뀌지 않는다.

## 제외 범위

- 회원 탈퇴와 법정 보존 원장
- 커뮤니티 대용량 업로드 경로 개선
- abandoned signed upload를 청소하는 원장·cron
- 커뮤니티 피드의 프로필 아바타 노출
- 이미지 crop/resize 편집기
- 이메일 변경
