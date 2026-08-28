\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 굿즈 리뷰 (#254)
--
-- 이 스모크가 DB 안에서 고정하는 것:
--   1. 쓰기 경로는 RPC뿐이다 — 테이블 직접 insert/update/delete가 막힌다
--   2. 자격은 서버가 판정한다 — 배송완료 이상 · 그 주문의 굿즈 · 90일 · 1회
--   3. 평점 파생값은 뷰라 어긋날 수 없다 — 블라인드가 즉시 평균에서 빠진다
--   4. 공개 읽기는 visible만이다 — 비로그인도 읽고, 블라인드는 새지 않는다
--   5. 신고는 커뮤니티 큐로 가되 엉뚱한 숨김 액션에 소비되지 않는다
--   6. 운영자 답글은 첫 등록에서만 알린다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: enum · 함수 ACL
-- ---------------------------------------------------------------------------
select 1 / case when (
  'review' = any (
    select value::text
    from unnest(enum_range(null::public.report_target)) as t(value)
  )
) then 1 else 0 end as assert_report_target_has_review;

-- 공개 브라우징 — 비로그인도 리뷰를 읽는다. 반대로 작성은 로그인 사용자만이다.
select 1 / case when (
  has_function_privilege(
    'anon', 'public.good_reviews(text, text, boolean, integer, integer)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.create_good_review(uuid, text, integer, text, text[])', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.create_good_review(uuid, text, integer, text, text[])', 'execute'
  )
) then 1 else 0 end as assert_review_rpc_acl;

-- 리뷰 테이블은 읽기만 열려 있다. 쓰기 권한이 하나라도 열리면 자격 판정을
-- 우회하는 경로가 생긴다.
select 1 / case when (
  has_table_privilege('anon', 'public.reviews', 'select')
  and has_table_privilege('authenticated', 'public.reviews', 'select')
  and not has_table_privilege('authenticated', 'public.reviews', 'insert')
  and not has_table_privilege('authenticated', 'public.reviews', 'update')
  and not has_table_privilege('authenticated', 'public.reviews', 'delete')
  and not has_table_privilege('service_role', 'public.reviews', 'insert')
) then 1 else 0 end as assert_reviews_table_is_read_only;

select 1 / case when (
  has_table_privilege('anon', 'public.good_review_stats', 'select')
) then 1 else 0 end as assert_review_stats_is_public;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000951',
    'authenticated', 'authenticated', 'review-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000952',
    'authenticated', 'authenticated', 'review-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000953',
    'authenticated', 'authenticated', 'review-stranger@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

-- profiles.role은 user_role enum이다. 텍스트를 그대로 밀어 넣으면 타입 오류가 난다.
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000951',
    'review-buyer@example.test', 'review_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000952',
    'review-staff@example.test', 'review_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000953',
    'review-stranger@example.test', 'review_stranger', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('review-ip', '리뷰 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('review-goods', 'review-ip', '리뷰 굿즈', '문구', 12000, 'ok', 20),
  ('review-other-goods', 'review-ip', '다른 굿즈', '문구', 9000, 'ok', 20);

insert into public.orders (id, user_id, status, total, address, delivered_at)
values
  -- A: 배송완료 + 어제. 정상 작성 대상
  (
    '50000000-0000-4000-8000-000000000951',
    '00000000-0000-4000-8000-000000000951', 'delivered', 12000, '{}'::jsonb,
    now() - interval '1 day'
  ),
  -- B: 배송중. 아직 받지 않았다
  (
    '50000000-0000-4000-8000-000000000952',
    '00000000-0000-4000-8000-000000000951', 'shipping', 12000, '{}'::jsonb, null
  ),
  -- C: 배송완료 + 91일. 작성 기한이 닫혔다
  (
    '50000000-0000-4000-8000-000000000953',
    '00000000-0000-4000-8000-000000000951', 'done', 12000, '{}'::jsonb,
    now() - interval '91 days'
  ),
  -- D: 거래확정. 두 번째 정상 작성 대상(평균 계산 확인용)
  (
    '50000000-0000-4000-8000-000000000954',
    '00000000-0000-4000-8000-000000000951', 'done', 12000, '{}'::jsonb,
    now() - interval '3 days'
  );

-- order_items는 주문 시점 스냅샷(이름·유형·IP)을 not null로 요구한다.
-- 카탈로그가 나중에 바뀌어도 주문이 무엇이었는지 남기기 위해서다.
insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  ('50000000-0000-4000-8000-000000000951', 'review-goods', 1, 12000, '리뷰 굿즈', '문구', 'review-ip'),
  ('50000000-0000-4000-8000-000000000952', 'review-goods', 1, 12000, '리뷰 굿즈', '문구', 'review-ip'),
  ('50000000-0000-4000-8000-000000000953', 'review-goods', 1, 12000, '리뷰 굿즈', '문구', 'review-ip'),
  ('50000000-0000-4000-8000-000000000954', 'review-goods', 1, 12000, '리뷰 굿즈', '문구', 'review-ip');

-- ---------------------------------------------------------------------------
-- 구매자 세션
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000951', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 배송 전 주문에는 별점을 남길 수 없다. 받아 보지 않은 굿즈의 평점은 정보가 아니다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000952', 'review-goods', 5, '아직 안 왔지만 좋아요'
    );
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'review before delivery should be rejected';
  end if;
end;
$$;

-- 기한(배송완료 후 90일)이 지난 주문도 막힌다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000953', 'review-goods', 5, '아주 늦은 리뷰입니다'
    );
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'review after the 90 day window should be rejected';
  end if;
end;
$$;

-- 그 주문에 담기지 않았던 굿즈는 대상이 아니다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000951', 'review-other-goods', 5, '산 적 없는 굿즈입니다'
    );
    accepted := true;
  exception
    when no_data_found then accepted := false;
  end;

  if accepted then
    raise exception 'review for a good outside the order should be rejected';
  end if;
end;
$$;

-- 별점 범위 밖은 거절한다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000951', 'review-goods', 6, '별 여섯 개 주고 싶어요'
    );
    accepted := true;
  exception
    when invalid_parameter_value then accepted := false;
  end;

  if accepted then
    raise exception 'rating outside 1..5 should be rejected';
  end if;
end;
$$;

-- 정상 작성.
select public.create_good_review(
  '50000000-0000-4000-8000-000000000951',
  'review-goods',
  4,
  '  배송도 빨랐고 마감도 깔끔합니다  '
) as review_a_id \gset

select public.create_good_review(
  '50000000-0000-4000-8000-000000000954',
  'review-goods',
  2,
  '색이 사진과 달라서 아쉬웠어요'
) as review_b_id \gset

select 1 / case when (
  select count(*)
  from public.reviews
  where good_id = 'review-goods'
    and user_id = '00000000-0000-4000-8000-000000000951'
) = 2 then 1 else 0 end as assert_reviews_created;

-- 본문 앞뒤 공백은 저장 전에 정리된다.
select 1 / case when (
  select body
  from public.reviews
  where id = :'review_a_id'
) = '배송도 빨랐고 마감도 깔끔합니다' then 1 else 0 end as assert_review_body_trimmed;

-- 같은 주문×굿즈에 두 번은 못 쓴다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000951', 'review-goods', 1, '한 번 더 써 봅니다'
    );
    accepted := true;
  exception
    when unique_violation then accepted := false;
  end;

  if accepted then
    raise exception 'a second review for the same order and good should be rejected';
  end if;
end;
$$;

-- 테이블 직접 쓰기는 전부 막혀 있어야 한다. 하나라도 열리면 위의 자격 판정이
-- 장식이 된다.
do $$
declare
  accepted boolean := false;
begin
  begin
    insert into public.reviews (user_id, good_id, order_id, rating, body)
    values (
      '00000000-0000-4000-8000-000000000951',
      'review-goods',
      '50000000-0000-4000-8000-000000000952',
      5,
      '직접 넣은 리뷰입니다'
    );
    accepted := true;
  exception
    when insufficient_privilege or check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'direct reviews insert should be blocked';
  end if;
end;
$$;

do $$
declare
  accepted boolean := false;
begin
  begin
    update public.reviews set rating = 5 where user_id = '00000000-0000-4000-8000-000000000951';
    accepted := found;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'direct reviews update should be blocked';
  end if;
end;
$$;

do $$
declare
  accepted boolean := false;
begin
  begin
    delete from public.reviews where user_id = '00000000-0000-4000-8000-000000000951';
    accepted := found;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'direct reviews delete should be blocked';
  end if;
end;
$$;

-- 파생값은 뷰다 — 앱이 아무것도 증감하지 않아도 방금 쓴 두 건이 그대로 잡힌다.
select 1 / case when (
  select review_count = 2
    and rating_average = 3.00
    and rating_2_count = 1
    and rating_4_count = 1
    and photo_count = 0
  from public.good_review_stats
  where good_id = 'review-goods'
) then 1 else 0 end as assert_review_stats_aggregate;

-- 작성자 수정 — 기한 안이므로 통과하고 edited_at이 찍힌다.
select public.update_good_review(:'review_a_id', 5, '다시 보니 흠잡을 데가 없습니다');

select 1 / case when (
  select rating = 5 and edited_at is not null and body = '다시 보니 흠잡을 데가 없습니다'
  from public.reviews
  where id = :'review_a_id'
) then 1 else 0 end as assert_review_updated;

select 1 / case when (
  select rating_average = 3.50
  from public.good_review_stats
  where good_id = 'review-goods'
) then 1 else 0 end as assert_stats_follow_edit;

-- 남의 리뷰는 수정도 삭제도 못 한다.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000953', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.update_good_review(
      (select id from public.reviews where rating = 5 and good_id = 'review-goods' limit 1),
      1,
      '남의 리뷰를 고쳐 봅니다'
    );
    accepted := true;
  exception
    when no_data_found then accepted := false;
  end;

  if accepted then
    raise exception 'editing someone else review should be rejected';
  end if;
end;
$$;

-- 스태프가 아닌 사용자는 어드민 RPC를 부를 수 없다. execute 권한은 authenticated
-- 전체에 열려 있고 실제 게이트는 함수 본문이라, 그 게이트를 여기서 고정한다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_review_console_counts();
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'non-staff should not read the review console counts';
  end if;
end;
$$;

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_set_review_status(
      (select id from public.reviews where good_id = 'review-goods' limit 1),
      'hidden',
      '마음에 안 듭니다'
    );
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'non-staff should not blind a review';
  end if;
end;
$$;

-- 신고는 로그인 사용자면 누구나 접수한다.
select (public.submit_community_report('review', :'review_b_id', '허위 후기로 의심됩니다') ->> 'reportId')
  as review_report_id \gset

select 1 / case when (
  select count(*)
  from public.reports
  where target_type = 'review'
    and target_id = :'review_b_id'
    and status = 'open'
) = 1 then 1 else 0 end as assert_review_report_submitted;

-- ---------------------------------------------------------------------------
-- 운영자 세션
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000952', true);

-- 답글은 공개 표시이고 첫 등록에서만 알린다.
select public.admin_reply_to_review(:'review_b_id', '색상 차이로 불편을 드려 죄송합니다. 교환을 도와드리겠습니다.');
select public.admin_reply_to_review(:'review_b_id', '색상 차이로 불편을 드려 죄송합니다. 반품·교환 안내를 드렸습니다.');

select 1 / case when (
  select admin_reply_at is not null
    and admin_reply_by = '00000000-0000-4000-8000-000000000952'
    and admin_reply = '색상 차이로 불편을 드려 죄송합니다. 반품·교환 안내를 드렸습니다.'
  from public.reviews
  where id = :'review_b_id'
) then 1 else 0 end as assert_admin_reply_saved;

-- notifications는 RLS로 본인 것만 보인다. 지금 세션은 운영자라 구매자에게 간
-- 알림이 보이지 않는다 — 소유자 세션으로 내려가 확인한다.
reset role;

select 1 / case when (
  select count(*)
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000951'
    and type = 'review_replied'
    and source_id = :'review_b_id'
) = 1 then 1 else 0 end as assert_reply_notifies_once;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000952', true);

-- 블라인드는 사유가 필수다. 사유 없는 비공개는 나중에 아무도 해제하지 못한다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_set_review_status(
      (select id from public.reviews where rating = 2 and good_id = 'review-goods' limit 1),
      'hidden',
      null
    );
    accepted := true;
  exception
    when invalid_parameter_value then accepted := false;
  end;

  if accepted then
    raise exception 'blinding without a reason should be rejected';
  end if;
end;
$$;

-- 다른 리뷰를 가리키는 신고로는 종결할 수 없다.
do $$
declare
  accepted boolean := false;
  other_review uuid;
  linked_report uuid;
begin
  select id into other_review
  from public.reviews
  where good_id = 'review-goods' and rating = 5
  limit 1;

  select id into linked_report
  from public.reports
  where target_type = 'review'
  limit 1;

  begin
    perform public.admin_set_review_status(other_review, 'hidden', '허위 후기', linked_report);
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'resolving an unrelated report through a review blind should be rejected';
  end if;
end;
$$;

-- 정상 블라인드 — 연결 신고가 함께 종결된다.
select public.admin_set_review_status(
  :'review_b_id', 'hidden', '구매하지 않은 사용자로 의심됨', :'review_report_id'
);

select 1 / case when (
  select status = 'hidden' and hidden_reason is not null and hidden_at is not null
  from public.reviews
  where id = :'review_b_id'
) then 1 else 0 end as assert_review_blinded;

select 1 / case when (
  select status = 'resolved'
  from public.reports
  where id = :'review_report_id'
) then 1 else 0 end as assert_linked_report_resolved;

-- 파생값이 즉시 따라온다. 캐시 컬럼이었다면 이 지점이 어긋날 자리다.
select 1 / case when (
  select review_count = 1 and rating_average = 5.00 and rating_2_count = 0
  from public.good_review_stats
  where good_id = 'review-goods'
) then 1 else 0 end as assert_blind_leaves_the_average;

-- 감사 로그가 남는다.
select 1 / case when (
  select count(*)
  from public.audit_log
  where action = 'admin.review.status'
    and target = 'review:' || :'review_b_id'
) = 1 then 1 else 0 end as assert_blind_is_audited;

-- 리뷰 신고는 포스트 숨김으로 소비되지 않는다.
reset role;
-- 커뮤니티 글쓰기는 기본 OFF다(20260813081224). 이 스모크가 필요한 것은 신고
-- 가드뿐이라 게이트를 켜서 픽스처 포스트만 만든다 — 트랜잭션은 롤백된다.
update private.community_write_control set post_create_enabled = true;

insert into public.posts (id, user_id, ip_id, text, tag, status)
values (
  '50000000-0000-4000-8000-000000000961',
  '00000000-0000-4000-8000-000000000951',
  'review-ip',
  'review guard post',
  'smoke',
  'visible'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000952', true);

do $$
declare
  accepted boolean := false;
  review_report uuid;
begin
  select id into review_report
  from public.reports
  where target_type = 'review'
  limit 1;

  begin
    perform public.admin_hide_community_post(
      '50000000-0000-4000-8000-000000000961', review_report
    );
    accepted := true;
  exception
    when invalid_parameter_value then accepted := false;
  end;

  if accepted then
    raise exception 'a review report should never resolve through a post hide';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 비로그인 열람
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

-- 공개 목록은 visible만 돌려준다. 블라인드된 2점 리뷰는 새 나가지 않는다.
select 1 / case when (
  select count(*) = 1 and bool_and(rating = 5) and bool_and(not is_mine)
  from public.good_reviews('review-goods')
) then 1 else 0 end as assert_public_list_hides_blinded;

select 1 / case when (
  select count(*)
  from public.reviews
  where good_id = 'review-goods'
) = 1 then 1 else 0 end as assert_anon_rls_hides_blinded;

-- 사진 필터는 사진이 붙은 리뷰만 남긴다.
select 1 / case when (
  select count(*)
  from public.good_reviews('review-goods', 'recent', true)
) = 0 then 1 else 0 end as assert_photo_filter;

-- 비로그인 쓰기 차단은 두 겹이다: `anon`에게 EXECUTE가 없고(파일 상단
-- `assert_review_rpc_acl`), 함수 자신도 주체가 없으면 거절한다. 아래는 두 번째
-- 겹을 런타임으로 확인한다 — 세션은 `authenticated`지만 주체(`sub`)가 비어
-- 있으니 `auth.uid()`가 null이고, 함수가 `auth_required`로 막아야 한다.
--
-- 여기서 `anon`으로 직접 호출하지 않는 이유는 커버리지가 아니라 CI 환경이다.
-- CI가 고정한 postgres 이미지(supabase/postgres 17.6.1.106, CLI 2.101.0)는
-- EXECUTE 권한 없는 함수를 호출하면 오류 대신 백엔드가 segfault한다(로컬
-- 17.6.1.143에서는 정상 오류). ACL 거부 자체는 상단 단언이 선언적으로 고정하므로
-- 런타임으로 한 번 더 밟을 이유가 없다.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.create_good_review(
      '50000000-0000-4000-8000-000000000951', 'review-goods', 5, '비로그인 리뷰입니다'
    );
    accepted := true;
  exception
    when invalid_authorization_specification then accepted := false;
  end;

  if accepted then
    raise exception 'subjectless review creation should be blocked';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 작성자 삭제는 상시
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000951', true);

select public.delete_good_review(:'review_a_id');

select 1 / case when (
  select count(*)
  from public.reviews
  where id = :'review_a_id'
) = 0 then 1 else 0 end as assert_owner_delete;

select 1 / case when (
  select count(*)
  from public.good_review_stats
  where good_id = 'review-goods'
) = 0 then 1 else 0 end as assert_stats_row_disappears_when_empty;

-- 블라인드된 자기 리뷰는 작성자에게 계속 보인다 — 왜 내려갔는지 물어볼 근거다.
select 1 / case when (
  select count(*)
  from public.reviews
  where id = :'review_b_id'
    and status = 'hidden'
) = 1 then 1 else 0 end as assert_owner_sees_own_blinded_review;

-- 블라인드된 리뷰는 작성자도 수정할 수 없다. 원문이 사라지면 블라인드 사유를
-- 검증할 수 없다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.update_good_review(
      (select id from public.reviews where status = 'hidden' limit 1),
      5,
      '블라인드를 우회해 봅니다'
    );
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'editing a blinded review should be rejected';
  end if;
end;
$$;

reset role;

rollback;
