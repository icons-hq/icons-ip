# 프로필 편집 설계

Date: 2026-07-15  
Issue: #136  
Status: Approved by the user's standing instruction to execute Project #8 autonomously

## 목표

로그인과 온보딩을 완료한 사용자가 `/settings`에서 닉네임과 프로필 아바타를 안전하게 편집하게 한다. 기존 이메일 read-only 표시와 마케팅 동의 저장은 유지한다. 회원 탈퇴는 법정 보존 정책 #102와 후속 구현 #137로 분리했으므로 이 설계에 포함하지 않는다.

## 선택한 접근

기존 커뮤니티 이미지와 같은 Server Action 업로드를 사용한다. 브라우저 직접 업로드는 본문 한도를 피하지만 클라이언트 상태, rollback, 제출 경로 검증이 복잡하다. 별도 multipart Route Handler는 이 기능에 비해 API와 보안 표면이 크다.

Server Action은 Next.js의 same-origin 검사를 그대로 사용하고, Supabase 사용자 세션과 `user-uploads` RLS 아래에서 동작한다. 서버가 저장 경로를 직접 만들기 때문에 브라우저는 다른 사용자 경로를 제출할 수 없다. 현재 Server Action 기본 본문 한도는 1MB이므로 `experimental.serverActions.bodySizeLimit`을 6MB로 설정해 제품의 5MB 검증 계약과 맞춘다.

## 모듈 경계

### `lib/profile.ts`

- 닉네임을 trim하고 1~30자로 제한한다. 문자 종류는 제한하지 않는다.
- JPEG, PNG, WebP만 허용하고 5MB를 상한으로 둔다.
- 인증된 사용자 ID, 서버 nonce, MIME에서 `<uid>/profile/<nonce>.<ext>` 경로를 만든다.
- 현재 사용자 프로필 폴더인지 검사하는 작은 경로 guard를 제공한다.

이 모듈은 FormData 정규화와 경로 계약만 알고 Supabase나 React에 의존하지 않는다.

### `app/settings/actions.ts`

기존 마케팅 동의 Action은 그대로 유지하고 별도 `updateProfileAction`을 추가한다.

1. 입력을 정규화한다.
2. Supabase 설정, 로그인, 온보딩을 기존 settings gate와 같은 순서로 확인하고, 요청 시작 시점의 `avatar_path`를 안전한 이전 객체 경로로 캡처한다.
3. 새 이미지가 있으면 서버가 만든 본인 경로로 업로드한다.
4. `profiles.nickname/avatar_path`를 한 번에 갱신한다.
5. DB 갱신이 실패하면 방금 업로드한 객체를 제거한다.
6. 성공하면 캡처한 이전 경로가 같은 사용자의 프로필 폴더에 속하고 신규 경로와 다를 때 그 객체 하나만 best-effort로 제거한다. 폴더를 list하거나 나중의 동시 요청이 만든 다른 객체를 삭제하지 않는다. 정리 실패는 이미 성공한 프로필 저장을 되돌리지 않으며, 고아 객체는 후속 운영 정리를 위해 남을 수 있다.
7. 설정·홈·커뮤니티 표면을 revalidate하고 성공 메시지를 반환한다.

DB unique violation `23505`는 닉네임 필드 오류로, 업로드/DB 오류는 내부 원문을 숨긴 사용자 메시지로 변환한다.

### 데이터베이스

기존 `profiles.nickname unique`와 `sync_public_profile` trigger를 유지한다. 대소문자와 앞뒤 공백만 다른 닉네임도 중복이므로 `lower(btrim(nickname))` partial unique index를 새 immutable migration으로 추가한다. 배포 전에 기존 충돌 그룹이 있으면 migration이 명시적으로 fail closed한다.

신규 함수나 확대된 테이블 권한은 없다. 기존 authenticated column grant와 self-update RLS만 사용한다. SQL smoke는 normalized uniqueness, 다른 사용자 update 차단, public profile 동기화를 검증한다.

### 읽기와 UI

공용 auth profile 타입과 select에 `avatar_path`를 추가한다. `/settings` Server Component가 사용자 세션으로 private Storage signed URL을 만들며, 실패하면 `null`을 전달한다.

`Settings`는 서로 독립된 두 form을 렌더링한다.

- 프로필 form: 현재 avatar 또는 닉네임 첫 글자 fallback, 파일 선택, 편집 가능한 닉네임, 별도 저장 버튼과 필드 오류.
- 약관 form: 기존 required consent 표시, 마케팅 선택, 기존 저장 버튼과 메시지.

파일 input은 `accept="image/jpeg,image/png,image/webp"`를 사용한다. 이미지가 없거나 signed URL 생성이 실패하면 닉네임 첫 글자를 표시하고, 닉네임도 비어 있으면 `I`를 사용한다.

## 오류와 정합성

- 인증/온보딩 gate는 기존 redirect 계약을 재사용한다.
- 잘못된 닉네임이나 파일은 DB/Storage 쓰기 전에 거부한다.
- Storage upload 실패 시 DB를 쓰지 않는다.
- DB 실패 시 신규 객체를 제거해 dangling upload를 방지한다.
- DB 성공 뒤에는 요청 시작 시 캡처한 안전한 이전 객체 하나만 정리한다. 폴더 전체 정리는 더 늦은 동시 요청의 객체를 삭제할 수 있으므로 수행하지 않는다.
- 이전 객체 정리 실패는 데이터 진실원에 영향을 주지 않고 프로필 저장 성공을 유지한다. 이때 남은 고아 객체는 다음 교체가 자동 재시도하지 않으며 후속 운영 정리 대상으로 남을 수 있다.
- signed URL 실패는 페이지 전체 실패가 아니라 fallback avatar로 축소한다.

## 테스트

- `lib/profile.test.ts`: trim, 길이, MIME/크기, 빈 파일, 경로 생성/guard.
- `app/settings/actions.test.ts`: auth/config/onboarding gate, 성공, `23505`, upload 실패, DB 실패 rollback, 성공 후 요청 시작 시점의 안전한 이전 객체만 정리하고 폴더 list·후행 동시 객체 삭제를 하지 않는 계약, 정리 실패 시 성공 유지, 마케팅 회귀.
- `components/screens/Settings.test.tsx`: 두 form 분리, avatar/fallback, 입력 속성, pending/error/success 상태.
- `app/settings/page.test.tsx`: auth/onboarding gate, avatar signed URL 성공/실패 fallback.
- `supabase/tests/profile_editing.sql`: normalized uniqueness, self-only update, public sync, 함수/권한 확대 없음.
- 전체 `npm test`, `npm run lint`, `npm run build`, local Supabase reset/smoke/lint.
- 브라우저 QA: desktop/mobile에서 닉네임 저장, avatar 업로드·교체, 마케팅 form 회귀.

## 문서 영향

- `docs/launch-readiness-plan.md`의 Account 트랙을 #102 human policy, #136 profile editing, #137 blocked implementation으로 맞춘다.
- `DESIGN.md`에 Settings의 editable profile surface와 fallback avatar 규칙만 추가한다.
- PRD/ARCHITECTURE의 제품 범위나 전체 기술 방향은 바뀌지 않는다.

## 제외 범위

- 회원 탈퇴와 법정 보존 원장
- 커뮤니티 피드의 프로필 아바타 노출
- 이미지 crop/resize 편집기
- 이메일 변경
