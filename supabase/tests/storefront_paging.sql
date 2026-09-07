\set ON_ERROR_STOP on

-- 스토어프론트 공개 페이징 (규모 ⑤)

begin;

insert into public.verticals (key, label, color)
values ('sfp', '스토어 페이징 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key, fans_count)
values
  ('sfp-ip-a', '페이징 IP A', 'sfp', 900000),
  ('sfp-ip-b', '페이징 IP B', 'sfp', 800000)
on conflict (id) do nothing;

-- 1,100개 — PostgREST 응답 상한(1,000)을 넘긴다. 절단 회귀는 이 숫자가 있어야 잡힌다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, badge)
select
  'sfp-g-' || lpad(i::text, 5, '0'),
  case when i % 2 = 0 then 'sfp-ip-a' else 'sfp-ip-b' end,
  '페이징 굿즈 ' || i,
  (array['키링', '아크릴', '문구'])[1 + (i % 3)],
  1000 + i,
  'ok',
  10,
  case when i % 100 = 0 then 'NEW' else null end
from generate_series(1, 1100) as g(i);

-- 숨김·보관은 스토어프론트에서 빠져야 한다(D-9 규율).
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, hidden_at)
values ('sfp-hidden', 'sfp-ip-a', '숨긴 굿즈', '키링', 5000, 'ok', 3, now());
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, archived_at)
values ('sfp-archived', 'sfp-ip-a', '보관 굿즈', '키링', 5000, 'ok', 3, now());

analyze public.goods;

-- ---------------------------------------------------------------------------
-- A. 절단 회귀 — 1,001번째 상품에 닿는다
-- ---------------------------------------------------------------------------
-- 전량 select 였을 때 이 행은 「느린 상품」이 아니라 **없는 상품**이었다.
select 1 / case when (
  select count(*) from public.storefront_goods_page(
    p_ip_ids => array['sfp-ip-a', 'sfp-ip-b'], p_limit => 200, p_offset => 1000
  )
) = 100 then 1 else 0 end as assert_row_1001_is_reachable;

select 1 / case when (
  select filtered_total from public.storefront_goods_page(
    p_ip_ids => array['sfp-ip-a', 'sfp-ip-b'], p_limit => 1, p_offset => 1000
  )
) = 1100 then 1 else 0 end as assert_filtered_total_counts_all_matches;

-- 마지막 페이지 뒤는 빈 결과다(오류가 아니라).
select 1 / case when (
  select count(*) from public.storefront_goods_page(
    p_ip_ids => array['sfp-ip-a'], p_limit => 10, p_offset => 100000
  )
) = 0 then 1 else 0 end as assert_past_the_end_is_empty;

-- ---------------------------------------------------------------------------
-- B. 숨김·보관 제외
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*) from public.storefront_goods_page(p_ip_ids => array['sfp-ip-a'], p_limit => 200)
  where id in ('sfp-hidden', 'sfp-archived')
) = 0 then 1 else 0 end as assert_hidden_and_archived_are_excluded;

select 1 / case when (
  select count(*) from public.storefront_goods_by_ids(array['sfp-hidden', 'sfp-archived', 'sfp-g-00001'])
) = 1 then 1 else 0 end as assert_by_ids_also_excludes_hidden;

-- ---------------------------------------------------------------------------
-- C. 상한과 화이트리스트
-- ---------------------------------------------------------------------------
-- 상한을 넘겨 달라고 해도 200에서 멈춘다. 브라우저가 보내는 값이라 믿지 않는다.
select 1 / case when (
  select count(*) from public.storefront_goods_page(p_ip_ids => array['sfp-ip-a','sfp-ip-b'], p_limit => 999)
) = 200 then 1 else 0 end as assert_limit_is_clamped;

select 1 / case when (
  select count(*) from public.storefront_goods_page(p_ip_ids => array['sfp-ip-a','sfp-ip-b'], p_limit => 0)
) = 1 then 1 else 0 end as assert_limit_has_a_floor;

do $$
begin
  begin
    perform count(*) from public.storefront_goods_page(p_sort => 'random');
    raise exception 'expected unsupported sort to be rejected';
  exception when check_violation then null;
  end;

  begin
    perform count(*) from public.storefront_goods_page(p_view => 'best');
    raise exception 'expected unsupported view to be rejected';
  exception when check_violation then null;
  end;

  begin
    perform count(*) from public.storefront_goods_by_ids(
      (select array_agg('sfp-g-' || lpad(i::text, 5, '0')) from generate_series(1, 501) as g(i))
    );
    raise exception 'expected an oversized id array to be rejected';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. 정렬 — 자연 순서와 가격
-- ---------------------------------------------------------------------------
-- 추천순은 앱의 Intl.Collator(numeric) 와 같아야 한다: sfp-g-00002 가 sfp-g-00010 보다 앞.
select 1 / case when (
  select string_agg(id, ',' order by ordinality)
  from (
    select id, row_number() over () as ordinality
    from public.storefront_goods_page(p_ip_ids => array['sfp-ip-a','sfp-ip-b'], p_limit => 3)
  ) as page
) = 'sfp-g-00001,sfp-g-00002,sfp-g-00003' then 1 else 0 end as assert_natural_order;

-- 자연 정렬 키 자체 — 접두어가 같으면 꼬리 숫자가 순서를 정한다.
select 1 / case when (
  public.storefront_natural_number('g10') = 10
  and public.storefront_natural_number('g2') = 2
  and public.storefront_natural_prefix('g10') = 'g'
  and public.storefront_natural_number('no-digits') is null
) then 1 else 0 end as assert_natural_keys;

select 1 / case when (
  select bool_and(price = expected)
  from (
    select price, 1001 + row_number() over () - 1 as expected
    from public.storefront_goods_page(
      p_ip_ids => array['sfp-ip-a','sfp-ip-b'], p_sort => 'price_asc', p_limit => 5
    )
  ) as page
) then 1 else 0 end as assert_price_ascending;

-- ---------------------------------------------------------------------------
-- E. 필터와 집계
-- ---------------------------------------------------------------------------
select 1 / case when (
  select filtered_total from public.storefront_goods_page(p_ip_ids => array['sfp-ip-a'], p_limit => 1)
) = 550 then 1 else 0 end as assert_ip_filter_narrows_the_total;

select 1 / case when (
  select filtered_total
  from public.storefront_goods_page(
    p_ip_ids => array['sfp-ip-a','sfp-ip-b'], p_price_min => 1001, p_price_max => 1010, p_limit => 1
  )
) = 10 then 1 else 0 end as assert_price_range_narrows_the_total;

-- facet 은 **필터 전** 스코프에서 뽑는다 — 필터를 걸 때마다 체크박스가 사라지면 되돌릴 수 없다.
select 1 / case when (
  select count from public.storefront_goods_facets() where kind = 'ip' and value = 'sfp-ip-a'
) = 550 then 1 else 0 end as assert_ip_facet_uses_the_prefilter_scope;

-- NEW 컬렉션은 스코프가 다르고, 집계도 그 스코프를 따른다(1,100 중 100 배수 11개).
select 1 / case when (
  (select count from public.storefront_goods_facets(p_view => 'new') where kind = 'ip' and value = 'sfp-ip-a') = 11
) then 1 else 0 end as assert_new_scope_has_its_own_facets;

-- ---------------------------------------------------------------------------
-- F. IP 목록
-- ---------------------------------------------------------------------------
select 1 / case when (
  select id from public.storefront_ips_page(p_limit => 1)
) = 'sfp-ip-a' then 1 else 0 end as assert_ips_ordered_by_fans;

select 1 / case when (
  select count(*) from public.storefront_ips_page(p_limit => 999)
) <= 200 then 1 else 0 end as assert_ips_limit_is_clamped;

-- ---------------------------------------------------------------------------
-- G. 권한 — 공개 표면이다. 로그인하지 않은 방문자도 상점을 본다.
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('anon', 'public.storefront_goods_page(text,text[],text[],integer,integer,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.storefront_goods_page(text,text[],text[],integer,integer,text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.storefront_goods_page(text,text[],text[],integer,integer,text,integer,integer)', 'execute')
  and has_function_privilege('anon', 'public.storefront_goods_by_ids(text[])', 'execute')
  and has_function_privilege('anon', 'public.storefront_goods_facets(text,integer)', 'execute')
  and has_function_privilege('anon', 'public.storefront_goods_scope(text)', 'execute')
  and has_function_privilege('anon', 'public.storefront_ips_page(integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.storefront_ips_page(integer,integer)', 'execute')
) then 1 else 0 end as assert_storefront_acl;

rollback;
