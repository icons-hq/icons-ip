# 커뮤니티 트렌딩 태그 설계

작성일: 2026-07-16
대상 이슈: [#106](https://github.com/icons-hq/icons-ip/issues/106)

## 목표

Supabase 모드의 커뮤니티 화면에서 mock 태그 대신 최근 visible 포스트의 실제 태그를 집계해 보여준다. 태그가 없거나 집계 호출이 실패하면 mock으로 위장하지 않고 빈 상태를 표시한다.

## 집계 계약

`community_trending_tags(window_days, result_limit)` SQL RPC를 공개 읽기 경계로 둔다.

- 기본 window는 호출 시점 기준 최근 7×24시간이고, 미래 시각 포스트는 제외한다.
- `status = 'visible'` 포스트만 집계한다. null·공백·선행 `#` 제거 후 빈 태그는 제외한다.
- 정규화는 앞뒤 공백을 제거하고 선행 `#`만 제거한다. 나머지 문자와 대소문자는 보존하므로 `%`, `_`, `Alpha`, `alpha`는 각각 literal 값이다.
- 결과는 태그별 사용 횟수 내림차순, 마지막 포스트 시각 내림차순, 태그 오름차순으로 정렬한다.
- 기본·최대 결과는 10개다. RPC 입력은 window 1–30일, 결과 1–10개로 clamp한다.
- 반환 필드는 `tag`, `usage_count`, `latest_post_at`이며 UI snapshot에는 정렬된 `tag`만 전달한다.

함수는 `SECURITY INVOKER SET search_path = ''`로 실행해 기존 `posts` RLS를 우회하지 않는다. 생성 직후 `public`, `anon`, `authenticated`, `service_role` 권한을 모두 회수하고 `anon`, `authenticated`에만 실행 권한을 다시 부여한다.

## source와 오류 계약

- catalog source가 `supabase`이면 포스트와 트렌딩 RPC를 병렬로 읽는다.
- Supabase 집계가 0행이면 `trending: []`를 반환한다.
- RPC 오류나 예외도 `trending: []`로 fail closed하되 공개 포스트 피드는 계속 렌더링한다.
- catalog source가 `mock`일 때만 기존 `DATA.TRENDING`을 사용한다.
- 사용자 차단·팔로우 기반 개인화는 #107 범위이므로 이번 집계에는 섞지 않는다.

## 화면 계약

커뮤니티 상단에 `최근 7일 트렌딩` 영역을 desktop/mobile 모두 노출한다.

- 태그는 `#태그` 칩으로 표시한다.
- 칩은 `/search?q=<encoded tag>`로 이동한다. mock의 기존 선행 `#`는 표시와 검색어에서 한 번만 제거하고 `%`, `_`, 공백 같은 문자는 `encodeURIComponent`로 안전하게 전달한다.
- 결과가 없으면 `최근 7일 동안 집계된 태그가 없어요`를 표시한다.

## 제외 범위

- 팔로우 IP·차단 사용자 기반 개인화
- 인기 검색어 persistence
- 태그 수정·병합·운영 큐레이션
- 별도 집계 테이블, cron, cache

## 검증 기준

- Vitest: Supabase RPC 배선·순서 보존·빈 결과·오류 fail closed·mock 전용 fallback, encoded search link와 빈 상태
- SQL smoke: visible/window/future/normalization/case/literal `%`·`_`, 정렬, top 10, 입력 clamp, ACL
- 통합: 전체 test, lint, build, local Supabase reset/smoke/lint
- 출시: PR CI, preview, squash merge, production migration과 공개 커뮤니티/검색 route 확인
