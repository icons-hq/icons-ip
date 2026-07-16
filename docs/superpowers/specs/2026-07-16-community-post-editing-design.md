# 커뮤니티 포스트 수정 설계

작성일: 2026-07-16
대상 이슈: [#108](https://github.com/sangwopark19/icons-ip/issues/108)

## 목표

로그인·온보딩을 마친 작성자가 자신의 visible 포스트에서 텍스트·태그·IP 연결만 수정할 수 있게 한다. hidden 포스트와 타인 포스트는 수정할 수 없으며, 기존 이미지·작성자·모더레이션 상태·작성 시각은 보존한다.

## 데이터베이스 경계

- `posts_update` RLS policy와 `posts` 직접 UPDATE 권한을 제거한다.
- `edit_own_post(target_post_id, post_text, post_ip_id, post_tag)`만 `authenticated`에 실행을 허용한다.
- RPC는 `SECURITY DEFINER`와 빈 `search_path`를 사용하고 내부에서 `auth.uid()`를 재검사한다.
- 새 IP는 존재 여부를 `FOR KEY SHARE`, 대상 포스트는 작성자+visible 조건으로 `FOR UPDATE` 확인한다.
- 공백 text와 존재하지 않는 IP를 거부하고 text·tag·ip_id만 갱신한다. tag 공백은 null로 저장한다.
- 반환값은 `{previousIpId, ipId, updatedAt}`이며, 사용자 수정은 운영 감사 로그 대상이 아니다.
- 기존 staff 모더레이션 RPC는 권한 봉인 뒤에도 `SECURITY DEFINER` 경계에서 정상 작동한다.

## 앱과 화면 계약

- feed DTO는 DB의 `updated_at`과 raw nullable tag를 읽고 `canEdit=작성자+visible`, `isEdited=updated_at>created_at`을 파생한다. mock은 두 값을 false로 둔다.
- 수정 전용 normalizer는 UUID·text·IP·tag만 읽는다. 작성 폼의 검증 문구와 tag 정규화를 재사용하고 image 입력은 받지 않는다.
- Server Action은 로그인·온보딩과 catalog IP를 확인한 뒤 RPC를 호출한다. 실패는 소유권이나 hidden 상태를 구분하지 않는 inline 오류로 닫는다.
- 성공 시 `/`, `/community`, `/search`, 이전·현재 `/ip/<id>`를 재검증하고 `safeNextPath`를 거친 현재 전체/내 팬덤 URL로 돌아간다.
- 작성자 visible 포스트에만 44px `수정` 토글과 inline form을 보인다. fandom에서는 팔로우 채널만 선택지로 사용한다.
- form은 text textarea, IP select, tag input, 저장·취소만 제공한다. 이미지 교체 입력은 없으며 기존 이미지 유지 안내를 표시한다.
- 수정된 포스트는 작성 시각 옆에 `· 수정됨`을 표시한다. nullable tag는 화면에서만 `커뮤니티`로 대체한다.

## 제외 범위

- 이미지 교체·삭제
- 수정 이력 또는 사용자 수정 감사 로그
- hidden 포스트 복원·수정
- 운영 정책, 댓글 모더레이션

## 검증 기준

- SQL smoke: 함수 ACL/definer/search path, 직접 UPDATE 차단, 성공·실패·필드 보존·모더레이션 회귀
- Vitest: edit normalizer, DTO 파생값, action gate/RPC/revalidation/error, 화면 권한·접근성·이미지 보존
- 정적 검증: targeted ESLint, 전체 test/lint/build, `git diff --check`
- fresh local Supabase reset과 전체 SQL smoke는 CI와 같은 CLI 버전으로 실행한다.
