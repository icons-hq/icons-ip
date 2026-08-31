-- S8 라우팅 이사 (#330): 오프라인 팝업 목록이 `/events`에서 `/offline-popups`로
-- 옮겨졌다. 이벤트 공개 알림이 예전 경로를 그대로 들고 있으면 팔로워가 알림을
-- 눌렀을 때 리다이렉트에 한 번 튕기거나 빈 화면을 본다.
--
-- 20260716090001의 private.notify_event_insert() 본문에서 link_path 리터럴 한
-- 줄만 바꾼 재정의다. 팬아웃 조건·dedupe 키·staff 게이트는 그대로다.
--
-- 알림 문구도 함께 옮긴다: 이 표면의 사용자-facing 이름은 '오프라인 팝업'이고
-- '이벤트'는 온라인 캠페인 허브의 이름이다(CONTEXT.md). 알림만 옛 이름을 들고
-- 있으면 알림함과 도착 화면이 서로 다른 것을 가리키는 것처럼 읽힌다.

create or replace function private.notify_event_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.ip_id is null
    or (select auth.uid()) is null
    or not (select public.is_staff())
  then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'event_published',
    '새 오프라인 팝업이 공개됐어요',
    left(new.title || ' 오프라인 팝업이 공개됐습니다.', 500),
    '/offline-popups',
    'event',
    new.id,
    'event:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_events
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

-- create or replace는 기존 ACL을 보존하지만, 이 파일만 읽고 봉인 상태를 판단할
-- 수 있어야 한다(20260707090001 규율).
revoke all on function private.notify_event_insert()
  from public, anon, authenticated, service_role;
