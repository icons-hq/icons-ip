# 커뮤니티 피드 개인화 설계

작성일: 2026-07-16
대상 이슈: [#107](https://github.com/sangwopark19/icons-ip/issues/107)

## 목표

기존 전체 공개 피드를 기본값으로 유지하면서, 팔로우한 IP의 포스트만 보는 명시적 `내 팬덤` 피드를 제공한다. 개인화는 포스트·채널·작성 대상과 홈 커뮤니티 프리뷰 순서에만 적용하고, 최근 7일 트렌딩은 전체 공개 집계를 유지한다.

## URL과 조회 계약

- `/community`는 기존 전체 피드다.
- `/community?feed=fandom`만 내 팬덤 피드로 해석한다. 알 수 없는 값과 배열 값은 전체 피드로 정규화한다.
- 내 팬덤 피드는 현재 사용자가 팔로우한 모든 IP를 `ip_follows.ip_id`로 읽는다. `notify_drops`·`notify_events` 설정은 피드 포함 여부에 영향을 주지 않는다.
- 팔로우 IP가 있으면 `posts.ip_id IN (...)` 조건을 정렬·30개 제한보다 먼저 적용한다. `ip_id IS NULL` 포스트는 내 팬덤에서 제외한다.
- visible/hidden staff 규칙, 작성자 차단, 댓글 미리보기, 좋아요 상태와 카운트는 기존 피드 계약을 그대로 유지한다.
- 최근 7일 트렌딩 태그는 scope와 무관한 전체 공개 집계다.

## 화면 상태

전체와 내 팬덤은 44px 이상의 링크 탭으로 전환한다. 내 팬덤에서는 채널 레일과 컴포저 IP 선택지를 팔로우 IP로만 제한한다.

- 비로그인: 현재 내 팬덤 URL을 `next`로 보존하는 로그인 CTA
- 로그인했지만 온보딩 미완료: 현재 URL을 보존하는 온보딩 CTA
- 온보딩 완료·팔로우 0개: IP 허브 CTA
- 팔로우 있음·포스트 0개: 첫 포스트 작성 안내와 전체 피드 링크
- 팔로우 있음·포스트 있음: 기존 포스트·반응·댓글 UI

포스트 작성·댓글·좋아요·삭제·신고·차단의 모든 form은 현재 scope URL을 hidden `next`로 전달한다. 서버 액션은 기존 `safeNextPath` 검증을 유지한다.

## 홈 개인화

새 홈 섹션은 만들지 않는다. 온보딩 완료 사용자의 기존 티커에서 이벤트와 품절 임박 굿즈의 선행 순서를 보존한 채, 커뮤니티 프리뷰만 팔로우 IP 항목을 먼저 둔다. 미로그인·온보딩 미완료·팔로우 0개 사용자는 기존 순서를 유지한다.

## 데이터베이스 경계

새 RPC나 migration은 만들지 않는다. 기존 `ip_follows` 본인 RLS와 `posts` 공개/작성자/staff visible 규칙을 앱 쿼리에서 조합한다. SQL smoke는 이 전제를 직접 고정한다.

## 제외 범위

- 팔로우·차단을 트렌딩 집계에 반영
- 추천 알고리즘, 점수화, 무한 스크롤
- 알림 설정에 따른 피드 필터
- 새로운 홈 섹션이나 별도 피드 테이블

## 검증 기준

- Vitest: scope 정규화, 팔로우 쿼리·DB 선필터, 상태별 CTA, action scope 보존, 홈 안정 정렬
- SQL smoke: `ip_follows` 본인 RLS, visible/hidden 공개·작성자·staff 계약
- 정적 검증: targeted ESLint와 `git diff --check`
- 전체 test/lint/build, shared Supabase reset·smoke, 브라우저와 production 검증은 부모 finish path에서 수행한다.
