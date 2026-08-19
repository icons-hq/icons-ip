-- ============================================================================
-- ICONS · 굿즈 리뷰 — 도메인·공개 표면·어드민 리뷰 관리 (#254)
--
-- 리뷰는 배송완료된 굿즈에 구매자가 남기는 별점·글·사진 후기다(CONTEXT.md).
-- 커뮤니티 포스트나 댓글이 아니다 — 작성 자격이 "그 굿즈를 실제로 받은 주문"에
-- 매여 있고, 그래서 커뮤니티 글쓰기 게이트와도 무관하게 움직인다.
--
-- ## 보상은 없다
--
-- v1에는 리뷰 포인트가 없다(#254 확정). 그래서 이 스키마에는 적립·정산 흔적이
-- 하나도 없다. 보상을 나중에 붙이더라도 리뷰 테이블에 잔액을 달지 않고 별도
-- 원장을 두는 편이 맞다 — 돈은 리뷰의 속성이 아니다.
--
-- ## 쓰기 경로는 전부 RPC다
--
-- 테이블에는 select 정책만 둔다(email_deliveries·inquiries 선례). 자격 판정
-- (주문 상태 · 90일 기한 · 주문×굿즈당 1회)이 앱 코드에 흩어지면 한 호출자가
-- 기한 검사를 빠뜨리는 순간 "아무나 아무 굿즈에 별점을 남기는" 표면이 된다.
-- 별점은 구매 결정을 바꾸는 값이라 그 신뢰가 무너지면 기능 자체가 무의미해진다.
--
-- ## 평점 파생값(평균·개수·분포)은 집계 뷰다 — 캐시 컬럼이 아니다
--
-- 이 저장소는 파생값을 앱 레벨에서 증감하지 않는다. `ips.fans_count`는 RPC
-- 안에서만 갱신하고 `ip_follows` 직접 쓰기를 revoke해 캐시가 어긋날 경로 자체를
-- 없앴고(20260623090001), 커뮤니티 좋아요·댓글 수는 아예 캐시를 두지 않고 배열
-- 집계 RPC로 푼다(20260624093001).
--
-- 리뷰 평점은 **뷰**를 고른다. 근거:
--
--   1. 리뷰 하나가 움직이는 파생값이 7개다 — 개수 · 평균 · 별점 1~5 분포. 캐시
--      컬럼으로 두면 insert · 작성자 수정(별점 변경) · 작성자 삭제 · 운영자
--      블라인드 · 블라인드 해제까지 다섯 경로가 전부 일곱 값을 정확히 옮겨야
--      한다. 트리거 하나만 분기를 놓쳐도 "별 4.7개(리뷰 3건)"인데 목록에는 별
--      한 개짜리 리뷰만 보이는 화면이 만들어진다.
--   2. 이 파생값에는 fans_count 같은 동시성 압력이 없다. 팔로우는 초당 수백 건이
--      들어올 수 있지만 리뷰는 "배송완료된 주문×굿즈당 1회"라 상한이 판매량이다.
--   3. 뷰는 정의상 어긋날 수 없다. 블라인드 전환이 곧바로 평균에 반영되는 것도
--      뷰에서는 따로 배선할 것이 없다 — `status = 'visible'` 한 줄이 전부다.
--
-- 굿즈 목록 전면에 평점을 얹어 매 요청 수천 굿즈를 집계하게 되면 그때 이 뷰를
-- materialized view나 트리거 유지 컬럼으로 승격한다. 그 전에 캐시를 지어 두는
-- 것은 정합성만 잃고 아무것도 얻지 못한다.
--
-- ## 신고는 커뮤니티와 같은 큐로 간다
--
-- `report_target` enum에 'review'를 더했다(20260818130000). 신고 큐를 도메인별로
-- 쪼개면 어느 큐를 안 봤는지가 사고 원인이 된다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 기존 CHECK 확장 — 알림 타입
-- ---------------------------------------------------------------------------
-- 운영자 답글은 구매자에게 알린다. 리뷰를 남긴 사람은 그 뒤로 굿즈 상세를 다시
-- 열 이유가 없어서, 알리지 않으면 답글은 아무도 읽지 않는 글이 된다.
--
-- 이 CHECK와 lib/notifications.ts의 union은 같은 목록이어야 한다. 한쪽만 넓히면
-- 새 타입이 화면에서 사라지거나(앱) insert가 런타임에 막힌다(DB).
--
-- 목록을 통째로 다시 쓰지 않고 기존 정의에서 값을 읽어 덧붙인다. 손으로 적은
-- 목록은 브랜치가 갈라진 사이에 다른 마이그레이션이 추가한 타입을 조용히
-- 지운다 — 실제로 이 마이그레이션이 claim_updated(#252)를 지웠고, 클레임 결정이
-- 같은 트랜잭션에서 알림을 넣기 때문에 클레임 처리 전체가 실패할 뻔했다.
do $$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into strict v_def
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check';

  select string_agg(distinct quote_literal(matched[1]), ', ')
  into v_values
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as matched;

  if v_values is null then
    raise exception 'notifications_type_check has no readable type list';
  end if;

  if position('''review_replied''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('review_replied');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. 첨부 경로 형식
-- ---------------------------------------------------------------------------
-- 커뮤니티 업로드 인프라(user-uploads 버킷)를 그대로 쓰되 접두는 `<uid>/review/`로
-- 새로 연다. 커뮤니티 경로를 재사용하면 community_write_control이 커뮤니티 글쓰기를
-- 닫는 순간 리뷰 사진까지 함께 막힌다 — 서로 다른 운영 판단이 한 스위치에 묶인다
-- (문의 첨부가 `<uid>/inquiry/`를 따로 연 것과 같은 이유).
--
-- CHECK 안에서는 서브쿼리를 쓸 수 없으므로 배열 검사를 immutable 함수로 감싼다.
create function private.is_safe_review_image_paths(candidate text[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.cardinality(candidate) <= 5
    and not exists (
      select 1
      from pg_catalog.unnest(candidate) as entry(path)
      where entry.path !~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        || '/review/'
        || '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
        || '[.](jpg|png|webp|gif)$'
      )
    );
$$;

revoke all on function private.is_safe_review_image_paths(text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 굿즈가 없어진 리뷰는 읽을 수 없는 글이다. 문의(맥락 연결)와 달리 여기서는
  -- 대상이 곧 소유다. 다만 카탈로그는 hard delete하지 않고 보관하므로(PRD §5.8)
  -- 이 cascade가 실제로 도는 경우는 개발·테스트 정리뿐이다.
  good_id text not null references public.goods (id) on delete cascade,
  -- 자격의 근거. 리뷰 한 건은 "이 주문으로 이 굿즈를 받았다"는 사실에 매인다.
  order_id uuid not null references public.orders (id) on delete cascade,
  rating smallint not null
    constraint reviews_rating_check check (rating between 1 and 5),
  body text not null
    constraint reviews_body_check
    check (
      pg_catalog.char_length(body) between 5 and 1000
      and body ~ '[^[:space:]]'
    ),
  image_paths text[] not null default '{}'
    constraint reviews_image_paths_check
    check (private.is_safe_review_image_paths(image_paths)),
  -- 작성자 삭제는 행을 지운다. status는 운영자 블라인드 전용이다 — 둘을 한
  -- 컬럼에 섞으면 "내가 지웠는데 왜 신고 큐에 남아 있나"를 설명할 수 없다.
  status text not null default 'visible'
    constraint reviews_status_check check (status in ('visible', 'hidden')),
  hidden_reason text
    constraint reviews_hidden_reason_check
    check (hidden_reason is null or pg_catalog.char_length(hidden_reason) between 2 and 500),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  admin_reply text
    constraint reviews_admin_reply_check
    check (
      admin_reply is null
      or (
        pg_catalog.char_length(admin_reply) between 2 and 1000
        and admin_reply ~ '[^[:space:]]'
      )
    ),
  admin_reply_at timestamptz,
  admin_reply_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 작성자가 고친 시각. updated_at으로 대신하지 않는다 — 운영자 답글·블라인드도
  -- updated_at을 밀기 때문에, 그것으로 "수정됨"을 그리면 답글이 달렸을 뿐인
  -- 리뷰가 작성자가 고친 리뷰로 보인다.
  edited_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint reviews_order_good_user_unique unique (order_id, good_id, user_id),
  constraint reviews_hidden_state_check check (
    (status = 'hidden' and hidden_at is not null and hidden_reason is not null)
    or (status = 'visible' and hidden_at is null and hidden_reason is null)
  ),
  constraint reviews_admin_reply_state_check check (
    (admin_reply is null and admin_reply_at is null)
    or (admin_reply is not null and admin_reply_at is not null)
  )
);

create trigger trg_reviews_updated
before update on public.reviews
for each row execute function public.set_updated_at();

-- 공개 목록의 두 정렬(최신순·평점순). 부분 인덱스라 블라인드된 행은 아예 담기지
-- 않는다 — 공개 표면이 훑는 집합과 인덱스가 같은 모양이 된다.
create index reviews_good_recent_idx
  on public.reviews (good_id, created_at desc, id desc)
  where status = 'visible';

create index reviews_good_rating_idx
  on public.reviews (good_id, rating desc, created_at desc, id desc)
  where status = 'visible';

-- 사진 필터. 사진이 있는 리뷰만 담아 "사진 리뷰만" 전환이 전체 스캔이 되지 않게 한다.
create index reviews_good_photo_idx
  on public.reviews (good_id, created_at desc, id desc)
  where status = 'visible' and pg_catalog.cardinality(image_paths) > 0;

-- 내 리뷰 목록과 작성 가능 목록.
create index reviews_user_recent_idx
  on public.reviews (user_id, created_at desc, id desc);

create index reviews_order_idx
  on public.reviews (order_id);

-- 어드민 콘솔의 기본 정렬(최신순)과 저평점 고정 필터.
create index reviews_console_recent_idx
  on public.reviews (created_at desc, id desc);

create index reviews_low_rating_idx
  on public.reviews (created_at desc, id desc)
  where rating <= 2;

-- 답글 미등록 큐. 운영자가 가장 자주 여는 조건이라 부분 인덱스로 좁힌다.
create index reviews_awaiting_reply_idx
  on public.reviews (created_at desc, id desc)
  where admin_reply is null and status = 'visible';

-- ---------------------------------------------------------------------------
-- 3. 평점 파생값 — 집계 뷰
-- ---------------------------------------------------------------------------
-- 파일 머리의 근거대로 캐시 컬럼을 두지 않는다. `security_invoker = on`이라
-- 호출자의 RLS가 그대로 적용되고, 뷰 자신의 `status = 'visible'`이 한 번 더
-- 좁힌다 — 작성자가 자기 블라인드 리뷰를 볼 수 있는 정책이 있어도 평균에는
-- 절대 섞이지 않는다.
--
-- 리뷰가 0건인 굿즈는 행이 없다. 0으로 채운 행을 만들어 두면 "집계를 못 읽은
-- 것"과 "리뷰가 없는 것"이 같아 보인다 — 없는 것은 없는 채로 둔다.
create view public.good_review_stats
with (security_invoker = on) as
select
  review.good_id,
  pg_catalog.count(*)::bigint as review_count,
  round(avg(review.rating)::numeric, 2) as rating_average,
  pg_catalog.count(*) filter (where review.rating = 1)::bigint as rating_1_count,
  pg_catalog.count(*) filter (where review.rating = 2)::bigint as rating_2_count,
  pg_catalog.count(*) filter (where review.rating = 3)::bigint as rating_3_count,
  pg_catalog.count(*) filter (where review.rating = 4)::bigint as rating_4_count,
  pg_catalog.count(*) filter (where review.rating = 5)::bigint as rating_5_count,
  pg_catalog.count(*) filter (
    where pg_catalog.cardinality(review.image_paths) > 0
  )::bigint as photo_count
from public.reviews as review
where review.status = 'visible'
group by review.good_id;

-- ---------------------------------------------------------------------------
-- 4. RLS — 읽기만 열고 쓰기 경로는 두지 않는다
-- ---------------------------------------------------------------------------
alter table public.reviews enable row level security;

-- 공개 브라우징 원칙. 리뷰는 구매 결정을 위한 정보라 로그인 뒤에 보여 주면
-- 늦다 — 살지 말지를 정하는 사람은 아직 로그인하지 않은 사람이다.
create policy reviews_public_read
on public.reviews
for select
to anon, authenticated
using (status = 'visible');

-- 작성자는 블라인드된 자기 리뷰도 본다. 감추면 "내 리뷰가 사라졌다"만 남고
-- 왜 내려갔는지 물어볼 근거조차 사라진다.
create policy reviews_owner_read
on public.reviews
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy reviews_staff_read
on public.reviews
for select
to authenticated
using ((select public.is_staff()));

revoke all on table public.reviews
  from public, anon, authenticated, service_role;
grant select on table public.reviews to anon, authenticated;

revoke all on table public.good_review_stats
  from public, anon, authenticated, service_role;
grant select on table public.good_review_stats to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. 첨부 스토리지 정책
-- ---------------------------------------------------------------------------
-- 쓰기: 기존 permissive 정책에 `<uid>/review/` 가지를 더한다. 정지 계정은
-- 커뮤니티 업로드와 같은 이유로 막는다.
--
-- 이 정책 전체를 다시 만드는 이유는 permissive 정책이 OR로 합쳐지기 때문이다.
-- 가지 하나를 별도 정책으로 떼면 다음 사람이 "업로드 허용 경로"를 한 곳에서
-- 읽을 수 없게 된다.
drop policy if exists user_uploads_write on storage.objects;
create policy user_uploads_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-uploads'
    and (select auth.uid()) is not null
    and (
      (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
        )
        and private.has_pending_profile_avatar_claim(name)
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/inquiry/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/review/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
    )
  );

-- 읽기: 리뷰 사진은 공개 굿즈 상세에 그려진다. 비로그인 열람을 막으면 "사진
-- 리뷰가 있다"는 표시만 뜨고 사진은 안 보이는 화면이 된다. 실제로 공개된 리뷰에
-- 붙은 파일만 연다 — 업로드만 하고 등록하지 않은 파일은 열지 않는다.
create policy user_uploads_review_public_read
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'user-uploads'
  and exists (
    select 1
    from public.reviews as review
    where storage.objects.name = any (review.image_paths)
      and review.status = 'visible'
  )
);

-- 블라인드된 리뷰의 사진은 운영자만 본다. 블라인드 판단의 근거가 사진일 때
-- 그 사진을 못 보면 해제 여부를 정할 수 없다.
create policy user_uploads_review_staff_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-uploads'
  and (select public.is_staff())
  and exists (
    select 1
    from public.reviews as review
    where storage.objects.name = any (review.image_paths)
  )
);

-- ---------------------------------------------------------------------------
-- 6. 공통 헬퍼
-- ---------------------------------------------------------------------------
-- 작성 기한 — 배송완료 후 90일. 기한 계산이 여러 RPC에 흩어지면 한 곳만 고쳐
-- 작성은 되는데 수정은 안 되는(또는 그 반대의) 상태가 만들어진다.
create function private.review_write_deadline(target_delivered_at timestamptz)
returns timestamptz
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select target_delivered_at + interval '90 days';
$$;

-- grant를 붙이지 않는다. 이 함수는 security definer RPC 안에서만 불리고,
-- 그 RPC는 소유자 권한으로 돈다. 앱 롤에 execute를 열어 두면 private 스키마
-- usage가 없어 어차피 못 부르는 권한이 목록에만 남아 오해를 만든다.
revoke all on function private.review_write_deadline(timestamptz)
  from public, anon, authenticated, service_role;

-- 첨부 경로가 호출자 소유인지. CHECK는 형식만 보고, 소유는 여기서 본다 —
-- 형식만 맞으면 남의 uuid 폴더를 가리키는 경로도 통과하기 때문이다.
create function private.assert_own_review_image_paths(
  target_paths text[],
  target_owner uuid
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized text[] := coalesce(target_paths, '{}'::text[]);
begin
  if pg_catalog.cardinality(normalized) > 5 then
    raise check_violation using message = 'review_image_limit';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(normalized) as entry(path)
    where entry.path is null
      or pg_catalog.left(entry.path, pg_catalog.char_length(target_owner::text) + 8)
        <> target_owner::text || '/review/'
  ) then
    raise check_violation using message = 'invalid_review_image_path';
  end if;

  if not private.is_safe_review_image_paths(normalized) then
    raise check_violation using message = 'invalid_review_image_path';
  end if;

  return normalized;
end;
$$;

revoke all on function private.assert_own_review_image_paths(text[], uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. 사용자 RPC
-- ---------------------------------------------------------------------------
-- 작성. 자격 판정이 전부 여기 있다 — 주문 소유 · 배송완료 이상 · 그 주문에
-- 실제로 담겼던 굿즈 · 90일 기한 · 주문×굿즈당 1회.
--
-- `delivered_at`이 비어 있으면 거절한다. 기산점을 모르는 주문에 기한을 지어내면
-- 90일이 아니라 무기한이 된다(#250은 기존 행을 백필하지 않았다).
create function public.create_good_review(
  target_order_id uuid,
  target_good_id text,
  target_rating integer,
  target_body text,
  target_image_paths text[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_status text;
  v_delivered_at timestamptz;
  v_review_id uuid;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_actor
      and profile.suspended_at is not null
  ) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;

  if target_rating is null or target_rating not between 1 and 5 then
    raise invalid_parameter_value using message = 'invalid_review_rating';
  end if;
  if char_length(v_body) not between 5 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_body';
  end if;

  select target.status::text, target.delivered_at
    into v_status, v_delivered_at
  from public.orders as target
  where target.id = target_order_id
    and target.user_id = v_actor
  for share;

  if not found then
    raise no_data_found using message = 'review_order_not_found';
  end if;

  -- "delivered 이상"이 자격선이다(#250 사다리). done은 거래확정이라 당연히
  -- 포함하고, shipping까지 열면 받아 보지 않은 굿즈에 별점이 붙는다.
  if v_status not in ('delivered', 'done') then
    raise check_violation using message = 'review_order_not_delivered';
  end if;
  if v_delivered_at is null then
    raise check_violation using message = 'review_order_not_delivered';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = target_order_id
      and item.good_id = target_good_id
  ) then
    raise no_data_found using message = 'review_good_not_in_order';
  end if;

  if now() > private.review_write_deadline(v_delivered_at) then
    raise check_violation using message = 'review_window_closed';
  end if;

  v_paths := private.assert_own_review_image_paths(target_image_paths, v_actor);

  begin
    insert into public.reviews (user_id, good_id, order_id, rating, body, image_paths)
    values (v_actor, target_good_id, target_order_id, target_rating::smallint, v_body, v_paths)
    returning id into v_review_id;
  exception
    when unique_violation then
      raise unique_violation using message = 'review_already_exists';
  end;

  return v_review_id;
end;
$$;

-- 작성자 수정 — 기한 안에서만. 블라인드된 리뷰는 수정 대상이 아니다:
-- 상태는 그대로 hidden이라 고쳐도 공개되지 않고, 운영자가 판단한 원문만
-- 사라져 블라인드 사유를 검증할 수 없게 된다.
create function public.update_good_review(
  target_review_id uuid,
  target_rating integer,
  target_body text,
  target_image_paths text[] default '{}'
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_status text;
  v_order_id uuid;
  v_delivered_at timestamptz;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_actor
      and profile.suspended_at is not null
  ) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;

  if target_rating is null or target_rating not between 1 and 5 then
    raise invalid_parameter_value using message = 'invalid_review_rating';
  end if;
  if char_length(v_body) not between 5 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_body';
  end if;

  select review.status, review.order_id
    into v_status, v_order_id
  from public.reviews as review
  where review.id = target_review_id
    and review.user_id = v_actor
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;
  if v_status <> 'visible' then
    raise insufficient_privilege using message = 'review_hidden';
  end if;

  select target.delivered_at
    into v_delivered_at
  from public.orders as target
  where target.id = v_order_id;

  if v_delivered_at is null or now() > private.review_write_deadline(v_delivered_at) then
    raise check_violation using message = 'review_window_closed';
  end if;

  v_paths := private.assert_own_review_image_paths(target_image_paths, v_actor);

  update public.reviews
  set
    rating = target_rating::smallint,
    body = v_body,
    image_paths = v_paths,
    edited_at = now()
  where id = target_review_id;
end;
$$;

-- 작성자 삭제 — 상시. 기한이 지난 뒤에도 자기 글을 내릴 수 있어야 한다.
-- 운영자 블라인드와 달리 행 자체가 사라지므로 평균·분포에서도 즉시 빠진다.
create function public.delete_good_review(target_review_id uuid)
returns text[]
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_paths text[];
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  delete from public.reviews
  where id = target_review_id
    and user_id = v_actor
  returning image_paths into v_paths;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  -- 첨부 파일 정리는 호출자가 소유자 권한으로 한다. 여기서 지우려면 RPC가
  -- storage.objects 쓰기 권한을 가져야 하는데, 그 권한을 열면 이 함수 하나가
  -- 버킷 전체를 지울 수 있는 도구가 된다.
  return coalesce(v_paths, '{}'::text[]);
end;
$$;

-- 내 리뷰 표면의 단일 로더 — "작성할 수 있는 것"과 "이미 쓴 것"을 한 번에 준다.
-- 두 목록을 따로 부르면 화면이 "작성 가능"과 "작성 완료"에 같은 굿즈를 동시에
-- 그리는 창이 생긴다.
--
-- 인자를 주면 그 주문·굿즈 한 건으로 좁힌다. 작성 폼이 자격을 다시 묻는 경로다 —
-- 폼이 자격을 스스로 판정하면 목록과 폼이 서로 다른 답을 낼 수 있다.
create function public.my_review_targets(
  target_order_id uuid default null,
  target_good_id text default null,
  target_limit integer default 50
)
returns table (
  order_id uuid,
  good_id text,
  good_name text,
  good_bg text,
  good_image_path text,
  ordered_at timestamptz,
  delivered_at timestamptz,
  deadline_at timestamptz,
  writable boolean,
  review_id uuid,
  review_rating smallint,
  review_body text,
  review_image_paths text[],
  review_status text,
  review_created_at timestamptz,
  review_edited_at timestamptz,
  admin_reply text,
  admin_reply_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(target_limit, 50), 1), 200);
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  return query
  select
    ordered.id as order_id,
    item.good_id,
    good.name as good_name,
    good.bg as good_bg,
    good.image_path as good_image_path,
    ordered.created_at as ordered_at,
    ordered.delivered_at,
    private.review_write_deadline(ordered.delivered_at) as deadline_at,
    (
      review.id is null
      and ordered.delivered_at is not null
      and now() <= private.review_write_deadline(ordered.delivered_at)
    ) as writable,
    review.id as review_id,
    review.rating as review_rating,
    review.body as review_body,
    review.image_paths as review_image_paths,
    review.status as review_status,
    review.created_at as review_created_at,
    review.edited_at as review_edited_at,
    review.admin_reply,
    review.admin_reply_at
  from public.orders as ordered
  join public.order_items as item on item.order_id = ordered.id
  join public.goods as good on good.id = item.good_id
  left join public.reviews as review
    on review.order_id = ordered.id
    and review.good_id = item.good_id
    and review.user_id = v_actor
  where ordered.user_id = v_actor
    and ordered.status in ('delivered', 'done')
    and (target_order_id is null or ordered.id = target_order_id)
    and (target_good_id is null or item.good_id = target_good_id)
  /* 쓸 수 있는 것이 먼저, 그중에서도 기한이 임박한 것이 위로. */
  order by
    case when review.id is null then 0 else 1 end,
    ordered.delivered_at desc nulls last,
    item.good_id
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 공개 RPC — 굿즈 상세 리뷰 목록
-- ---------------------------------------------------------------------------
-- 비로그인도 읽는다. security definer지만 `status = 'visible'`을 본문에 못 박아
-- 블라인드된 리뷰가 새 나갈 경로를 두지 않는다.
--
-- user_id는 돌려주지 않는다. 공개 목록에 필요한 것은 표시 이름뿐이고, 계정 id를
-- 실어 보내면 "이 사람이 이 굿즈를 샀다"를 누구나 기계적으로 수집할 수 있다.
create function public.good_reviews(
  target_good_id text,
  target_sort text default 'recent',
  target_photo_only boolean default false,
  target_limit integer default 10,
  target_offset integer default 0
)
returns table (
  id uuid,
  rating smallint,
  body text,
  image_paths text[],
  author_name text,
  is_mine boolean,
  created_at timestamptz,
  edited_at timestamptz,
  admin_reply text,
  admin_reply_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_sort text := coalesce(nullif(btrim(coalesce(target_sort, '')), ''), 'recent');
  v_limit integer := least(greatest(coalesce(target_limit, 10), 1), 50);
  v_offset integer := greatest(coalesce(target_offset, 0), 0);
begin
  if v_sort not in ('recent', 'rating_desc', 'rating_asc') then
    raise check_violation using message = 'invalid_review_sort';
  end if;

  return query
  select
    review.id,
    review.rating,
    review.body,
    review.image_paths,
    coalesce(
      nullif(btrim(coalesce(author.nickname, '')), ''),
      'fan_' || left(review.user_id::text, 6)
    ) as author_name,
    (v_actor is not null and review.user_id = v_actor) as is_mine,
    review.created_at,
    review.edited_at,
    review.admin_reply,
    review.admin_reply_at,
    count(*) over()::bigint as total_count
  from public.reviews as review
  join public.profiles as author on author.id = review.user_id
  where review.good_id = target_good_id
    and review.status = 'visible'
    and (
      not coalesce(target_photo_only, false)
      or cardinality(review.image_paths) > 0
    )
  order by
    case when v_sort = 'rating_desc' then review.rating end desc nulls last,
    case when v_sort = 'rating_asc' then review.rating end asc nulls last,
    review.created_at desc,
    review.id desc
  limit v_limit
  offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 신고 연동
-- ---------------------------------------------------------------------------
-- enum 값은 20260818130000이 먼저 커밋했다. 여기서는 접수 함수의 분기와
-- 숨김 가드의 대상 검증을 함께 넓힌다 — enum만 늘리면 'review' 신고를 접수할
-- 경로가 없고, 접수만 열면 그 신고가 엉뚱한 숨김 액션에 소비된다.
create or replace function public.submit_community_report(
  target_type public.report_target,
  target_id text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_uuid uuid;
  normalized_reason text := nullif(btrim(reason), '');
  target_ip_id text := null;
  target_post_id uuid;
  inserted_report_id uuid;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  target_uuid := target_id::uuid;

  if target_type = 'post' then
    select posts.ip_id
      into target_ip_id
      from public.posts
      where posts.id = target_uuid
        and posts.status = 'visible';

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  elsif target_type = 'comment' then
    select comments.post_id
      into target_post_id
      from public.comments
      where comments.id = target_uuid;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;

    select posts.ip_id
      into target_ip_id
      from public.posts
      where posts.id = target_post_id
        and posts.status = 'visible'
      for share;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;

    perform 1
    from public.comments
    where comments.id = target_uuid
      and comments.post_id = target_post_id
      and comments.status = 'visible'
    for share;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  elsif target_type = 'review' then
    -- 리뷰는 IP가 아니라 굿즈에 매인다. 반환값의 ipId는 커뮤니티 피드 갱신용
    -- 힌트라 리뷰에는 해당이 없다 — 굿즈의 IP를 넣어 주면 신고 한 번이 엉뚱한
    -- IP 피드를 다시 그리게 만든다. null로 둔다.
    perform 1
    from public.reviews
    where reviews.id = target_uuid
      and reviews.status = 'visible'
    for share;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  elsif target_type = 'user' then
    perform 1
    from public.profiles
    where profiles.id = target_uuid;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  else
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (target_type, target_uuid::text, actor_id, normalized_reason)
  returning id into inserted_report_id;

  return jsonb_build_object('reportId', inserted_report_id, 'ipId', target_ip_id);
end;
$$;

-- 숨김 가드 — 신고 하나가 엉뚱한 대상의 숨김으로 소비되지 않게 한다.
-- 'review' 신고는 여기서 절대 종결되지 않는다. 리뷰의 처리 경로는
-- admin_set_review_status이고, 그 함수가 같은 방향의 검증을 대칭으로 한다.
-- 이 else 분기를 열어 두면 운영자가 리뷰 신고를 아무 포스트에 붙여 닫을 수 있다.
create or replace function public.admin_hide_community_post(
  target_post_id uuid,
  target_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  previous_status post_status;
  target_ip_id text;
  linked_report_target report_target;
  linked_report_target_id text;
  linked_report_post_id uuid;
begin
  if actor_id is null or not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select posts.status, posts.ip_id
    into previous_status, target_ip_id
    from public.posts
    where posts.id = target_post_id
    for update;

  if not found then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  update public.posts
  set status = 'hidden'
  where posts.id = target_post_id;

  if target_report_id is not null then
    select reports.target_type, reports.target_id
      into linked_report_target, linked_report_target_id
      from public.reports
      where reports.id = target_report_id
      for update;

    if not found then
      raise exception 'report_not_found' using errcode = '22023';
    end if;

    if linked_report_target = 'post' then
      if linked_report_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;

      linked_report_post_id := linked_report_target_id::uuid;
    elsif linked_report_target = 'comment' then
      if linked_report_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;

      select comments.post_id
        into linked_report_post_id
        from public.comments
        where comments.id = linked_report_target_id::uuid;

      if not found then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;
    else
      /* 'user'와 'review'가 여기로 온다. 둘 다 포스트 숨김으로는 해소되지 않는다. */
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;

    if linked_report_post_id <> target_post_id then
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;

    update public.reports
    set status = 'resolved'
    where reports.id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'community_post_hide',
    'post:' || target_post_id::text,
    jsonb_build_object('from', previous_status, 'to', 'hidden', 'reportId', target_report_id)
  );

  return jsonb_build_object('ipId', target_ip_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. 어드민 RPC
-- ---------------------------------------------------------------------------
-- 리뷰 콘솔 목록. 필터·정렬·페이지네이션은 전부 서버가 판정한다 — 어드민 화면이
-- 전체를 받아 걸러 내면 저평점 고정 필터가 "이 페이지 안의 저평점"이 된다.
--
-- p_review_id는 모더레이션 큐에서 넘어오는 딥링크용이다. 신고 한 건을 눌렀을 때
-- 본문 검색으로 근처를 찾게 만들면 운영자가 엉뚱한 리뷰를 블라인드할 수 있다.
create function public.admin_search_reviews(
  p_review_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_rating integer default null,
  p_status text default null,
  p_has_photo boolean default null,
  p_has_reply boolean default null,
  p_low_rating boolean default false,
  p_query text default null,
  p_field text default 'all',
  p_sort text default 'recent',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  good_id text,
  good_name text,
  order_id uuid,
  user_id uuid,
  author_name text,
  author_email text,
  rating smallint,
  body text,
  image_paths text[],
  status text,
  hidden_reason text,
  hidden_at timestamptz,
  admin_reply text,
  admin_reply_at timestamptz,
  reply_author_name text,
  report_count bigint,
  open_report_count bigint,
  created_at timestamptz,
  edited_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_sort text := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'recent');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('visible', 'hidden') then
    raise check_violation using message = 'invalid_review_status_filter';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise check_violation using message = 'invalid_review_rating_filter';
  end if;
  if v_field not in ('all', 'good', 'author', 'body') then
    raise check_violation using message = 'invalid_review_search_field';
  end if;
  if v_sort not in ('recent', 'oldest', 'rating_desc', 'rating_asc') then
    raise check_violation using message = 'invalid_review_sort';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_review_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'review_search_query_too_long';
  end if;

  return query
  select
    review.id,
    review.good_id,
    good.name as good_name,
    review.order_id,
    review.user_id,
    coalesce(
      nullif(btrim(coalesce(author.nickname, '')), ''),
      'fan_' || left(review.user_id::text, 6)
    ) as author_name,
    author.email as author_email,
    review.rating,
    review.body,
    review.image_paths,
    review.status,
    review.hidden_reason,
    review.hidden_at,
    review.admin_reply,
    review.admin_reply_at,
    replier.nickname as reply_author_name,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
    ) as report_count,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
        and report.status in ('open', 'reviewing')
    ) as open_report_count,
    review.created_at,
    review.edited_at,
    count(*) over()::bigint as total_count
  from public.reviews as review
  join public.goods as good on good.id = review.good_id
  join public.profiles as author on author.id = review.user_id
  left join public.profiles as replier on replier.id = review.admin_reply_by
  where (p_review_id is null or review.id = p_review_id)
    and (p_status is null or review.status = p_status)
    and (p_rating is null or review.rating = p_rating)
    and (not coalesce(p_low_rating, false) or review.rating <= 2)
    and (
      p_has_photo is null
      or (p_has_photo and cardinality(review.image_paths) > 0)
      or (not p_has_photo and cardinality(review.image_paths) = 0)
    )
    and (
      p_has_reply is null
      or (p_has_reply and review.admin_reply is not null)
      or (not p_has_reply and review.admin_reply is null)
    )
    and (
      p_from is null
      or review.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or review.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'good')
        and (
          position(lower(v_query) in lower(good.name)) > 0
          or position(lower(v_query) in lower(review.good_id)) > 0
        )
      )
      or (
        v_field in ('all', 'author')
        and (
          position(lower(v_query) in lower(coalesce(author.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(author.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'body')
        and position(lower(v_query) in lower(review.body)) > 0
      )
    )
  order by
    case when v_sort = 'rating_desc' then review.rating end desc nulls last,
    case when v_sort = 'rating_asc' then review.rating end asc nulls last,
    case when v_sort = 'oldest' then review.created_at end asc nulls last,
    review.created_at desc,
    review.id desc
  limit v_limit
  offset v_offset;
end;
$$;

-- 콘솔 상단 칩. 0건도 행으로 돌려준다 — 감추면 "정말 0건"과 "집계 실패"를
-- 구분할 수 없다. OUT 파라미터 이름에 `count`를 쓰면 plpgsql이 본문의 count(*)를
-- 그 변수로 읽으려 해 모호성 오류를 낸다(admin_inquiry_status_counts와 같은 함정).
create function public.admin_review_console_counts()
returns table (
  total_reviews bigint,
  low_rating_reviews bigint,
  awaiting_reply_reviews bigint,
  hidden_reviews bigint,
  reported_reviews bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  /* 미처리 신고는 조인으로 붙인다. FILTER 안에 상관 서브쿼리를 넣으면 읽는 사람이
     "행마다 도는 쿼리"를 못 알아보고, 신고 테이블이 커졌을 때 여기가 먼저 느려진다. */
  return query
  with reported as (
    select distinct report.target_id as review_id
    from public.reports as report
    where report.target_type = 'review'
      and report.status in ('open', 'reviewing')
  )
  select
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (where review.rating <= 2)::bigint,
    pg_catalog.count(*) filter (
      where review.admin_reply is null and review.status = 'visible'
    )::bigint,
    pg_catalog.count(*) filter (where review.status = 'hidden')::bigint,
    pg_catalog.count(*) filter (where reported.review_id is not null)::bigint
  from public.reviews as review
  left join reported on reported.review_id = review.id::text;
end;
$$;

-- 운영자 답글 작성·수정. 공개 표시라 리뷰 본문과 같은 화면에 그려진다.
--
-- 알림은 첫 답글에서만 나간다(dedupe_key로 고정). 답글을 다듬을 때마다 알림이
-- 다시 가면 구매자에게는 "운영자가 또 뭐라고 했다"로 읽히고, 알림 자체의 신뢰가
-- 깎인다.
create function public.admin_reply_to_review(
  target_review_id uuid,
  target_reply text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reply text := btrim(coalesce(target_reply, ''));
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
  v_link text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reply) not between 2 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_reply';
  end if;

  select review.user_id, review.good_id, review.admin_reply
    into v_user_id, v_good_id, v_previous
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  update public.reviews
  set
    admin_reply = v_reply,
    admin_reply_at = now(),
    admin_reply_by = v_actor
  where id = target_review_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.reply',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'replyLength', char_length(v_reply)
    )
  );

  -- 굿즈 id는 카탈로그 슬러그지만 링크로 쓰기 전에 형태를 확인한다. link_path
  -- CHECK가 제어문자·역슬래시를 막긴 해도, 이상한 id 하나 때문에 답글 저장
  -- 전체가 실패하는 것보다 안전한 목적지로 접는 편이 낫다.
  v_link := case
    when v_good_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then '/shop/' || v_good_id
    else '/my/reviews'
  end;

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
  values (
    v_user_id,
    'review_replied',
    '리뷰에 답글이 달렸어요',
    /* body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답글
       저장까지 함께 되돌아간다 — 이름을 잘라서라도 답글은 남긴다. */
    left(coalesce(v_good_name, '굿즈'), 100) || ' 리뷰에 ICONS 운영자가 답글을 남겼습니다.',
    v_link,
    'review',
    target_review_id::text,
    'review_replied:' || target_review_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

-- 블라인드/해제. 작성자 삭제와는 다른 행위라 행을 지우지 않고 상태만 바꾼다 —
-- 원문이 남아야 왜 내렸는지 검증할 수 있다.
--
-- 연결 신고를 함께 종결할 수 있지만, 그 신고가 정말 이 리뷰를 가리키는지 확인한
-- 뒤에만 한다(admin_hide_community_post의 대칭). 확인 없이 닫으면 운영자가 아무
-- 신고나 임의의 리뷰 블라인드로 소비할 수 있다.
create function public.admin_set_review_status(
  target_review_id uuid,
  target_status text,
  target_reason text default null,
  target_report_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_status text := btrim(coalesce(target_status, ''));
  v_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  v_previous text;
  v_good_id text;
  v_linked_target public.report_target;
  v_linked_target_id text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if v_status not in ('visible', 'hidden') then
    raise invalid_parameter_value using message = 'invalid_review_status';
  end if;
  -- 블라인드는 사유가 필수다. 사유 없는 비공개는 나중에 아무도 해제하지 못한다.
  if v_status = 'hidden' and (v_reason is null or char_length(v_reason) not between 2 and 500) then
    raise invalid_parameter_value using message = 'review_hide_reason_required';
  end if;

  select review.status, review.good_id
    into v_previous, v_good_id
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  update public.reviews
  set
    status = v_status,
    hidden_reason = case when v_status = 'hidden' then v_reason else null end,
    hidden_at = case when v_status = 'hidden' then now() else null end,
    hidden_by = case when v_status = 'hidden' then v_actor else null end
  where id = target_review_id;

  if target_report_id is not null then
    select report.target_type, report.target_id
      into v_linked_target, v_linked_target_id
    from public.reports as report
    where report.id = target_report_id
    for update;

    if not found then
      raise no_data_found using message = 'report_not_found';
    end if;
    if v_linked_target <> 'review' or v_linked_target_id <> target_review_id::text then
      raise check_violation using message = 'report_target_mismatch';
    end if;

    update public.reports
    set status = 'resolved'
    where reports.id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.status',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'from', v_previous,
      'to', v_status,
      'goodId', v_good_id,
      'reason', v_reason,
      'reportId', target_report_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. 함수 ACL
-- ---------------------------------------------------------------------------
-- Supabase default privileges가 public 스키마 신규 함수에 anon/authenticated/
-- service_role의 execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
revoke all on function public.create_good_review(uuid, text, integer, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_good_review(uuid, text, integer, text, text[])
  to authenticated;

revoke all on function public.update_good_review(uuid, integer, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.update_good_review(uuid, integer, text, text[])
  to authenticated;

revoke all on function public.delete_good_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_good_review(uuid)
  to authenticated;

revoke all on function public.my_review_targets(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.my_review_targets(uuid, text, integer)
  to authenticated;

-- 공개 브라우징 — 비로그인도 리뷰를 읽는다.
revoke all on function public.good_reviews(text, text, boolean, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.good_reviews(text, text, boolean, integer, integer)
  to anon, authenticated;

revoke all on function public.admin_search_reviews(
  uuid, date, date, integer, text, boolean, boolean, boolean, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_reviews(
  uuid, date, date, integer, text, boolean, boolean, boolean, text, text, text, integer, integer
) to authenticated;

revoke all on function public.admin_review_console_counts()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_review_console_counts()
  to authenticated;

revoke all on function public.admin_reply_to_review(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_reply_to_review(uuid, text)
  to authenticated;

revoke all on function public.admin_set_review_status(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_review_status(uuid, text, text, uuid)
  to authenticated;

-- 재정의한 기존 함수의 ACL도 다시 못 박는다. create or replace는 기존 ACL을
-- 유지하지만, 이 파일만 읽고 권한 상태를 판단할 수 있어야 한다.
revoke all on function public.submit_community_report(public.report_target, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_community_report(public.report_target, text, text)
  to authenticated;

revoke all on function public.admin_hide_community_post(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_hide_community_post(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 신고 대상자 캡처 — review 분기
--
-- private.capture_report_subject(20260717100001)는 신고 누적 정지를 위해 대상
-- 작성자를 기록하고, 모르는 target_type이면 target_not_found로 insert를 막는다.
-- report_target에 'review'를 더하고 submit_community_report에 분기를 넣어도
-- 이 트리거를 함께 넓히지 않으면 리뷰 신고가 런타임에 전부 실패한다.
-- ---------------------------------------------------------------------------
create or replace function private.capture_report_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_target_user_id uuid;
begin
  if new.target_type = 'user' then
    select profile.id
      into selected_target_user_id
    from public.profiles as profile
    where profile.id::text = new.target_id;
  elsif new.target_type = 'post' then
    select post.user_id
      into selected_target_user_id
    from public.posts as post
    where post.id::text = new.target_id;
  elsif new.target_type = 'comment' then
    select comment.user_id
      into selected_target_user_id
    from public.comments as comment
    where comment.id::text = new.target_id;
  elsif new.target_type = 'review' then
    select review.user_id
      into selected_target_user_id
    from public.reviews as review
    where review.id::text = new.target_id;
  end if;

  if selected_target_user_id is null then
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  insert into private.report_subjects (report_id, target_user_id)
  values (new.id, selected_target_user_id)
  on conflict (report_id) do update
  set target_user_id = excluded.target_user_id;

  return new;
end;
$function$;

revoke all on function private.capture_report_subject()
  from public, anon, authenticated, service_role;
