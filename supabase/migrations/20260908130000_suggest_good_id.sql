-- 현업 요청 슬라이스 5 — 굿즈 등록 시 다음 순번 제안
--
-- 요청: 「상품 ID 자동발급·순차 코드」. 자체코드(바코드)는 있고 `goods.id` 는 수기다.
--
-- **자동 강제가 아니라 제안이다.** id 를 시스템이 정해 버리면 이관 데이터(ERP·사방넷에서
-- 넘어온 기존 코드)와 충돌한다 — 그래서 칸을 채워 주되 고쳐 쓸 수 있게 둔다.
--
-- 접두어는 **가장 많이 쓰는 것**을 고른다. 카탈로그에 g/gd/GOODS 가 섞여 있어도 운영자가
-- 실제로 쓰는 모양을 따라가야 제안이 쓸모 있다.
--
-- 자리수는 **지금 가장 큰 id 의 자리수**를 지킨다. g0001 을 쓰는 곳에 g2 를 제안하면
-- 정렬이 깨진 채로 쌓인다.
--
-- 함정 메모: `coalesce`/`least`/`greatest` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다.

create or replace function public.admin_suggest_good_id()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_max bigint;
  v_width integer;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- 접두어 하나를 고른다: 많이 쓰는 것 우선, 같으면 사전순으로 안정화한다.
  select public.storefront_natural_prefix(good.id)
  into v_prefix
  from public.goods as good
  where public.storefront_natural_number(good.id) is not null
  group by 1
  order by pg_catalog.count(*) desc, 1 asc
  limit 1;

  -- 숫자로 끝나는 id 가 하나도 없으면 제안하지 않는다 — 없는 규칙을 지어내지 않는다.
  if v_prefix is null then
    return null;
  end if;

  select
    pg_catalog.max(public.storefront_natural_number(good.id)),
    pg_catalog.max(pg_catalog.length((pg_catalog.regexp_match(good.id, '([0-9]+)$'))[1]))
  into v_max, v_width
  from public.goods as good
  where public.storefront_natural_prefix(good.id) = v_prefix
    and public.storefront_natural_number(good.id) is not null;

  -- `lpad` 는 목표 길이가 더 짧으면 **자른다**. 자리수만 넘기면 g9 다음이 g1 이 되어
  -- 이미 있는 id 를 제안한다 — 그래서 숫자 길이와 함께 큰 쪽을 쓴다.
  return v_prefix || pg_catalog.lpad(
    (v_max + 1)::text,
    greatest(coalesce(v_width, 1), pg_catalog.length((v_max + 1)::text)),
    '0'
  );
end;
$$;

revoke all on function public.admin_suggest_good_id() from public, anon, service_role;
grant execute on function public.admin_suggest_good_id() to authenticated;
