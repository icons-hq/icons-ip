-- 규모 후속 — 판매·할인 기간 경계 통과 알림 (데이터층 인계서 §8 「판매 시작/종료 스윕 크론」)
--
-- 판매 상태와 할인가는 **저장하지 않고 조회 시 파생**한다(`good_sale_state`·`good_effective_price`).
-- 그래서 정각에 DB 가 바꿀 것은 없다. 늦는 것은 **캐시**뿐이다 — 상점 목록·집계는 300초 캐시를
-- 들고 있어, 자정에 판매를 여는 상품이 최대 5분간 「판매 예정」으로 남는다.
--
-- 이 잡은 팝업 경계 틱과 **같은 규율**이다: 아무것도 바꾸지 않는다. 경계를 지났다는 사실만
-- 앱에 알려 캐시를 버리게 하고 감사에 남긴다. 잡이 죽어도 데이터는 정확하고 화면만 캐시
-- 수명만큼 늦는다 — 상태를 바꾸는 잡이었다면 잡이 죽는 순간 데이터가 틀린다.
--
-- 함정 메모: `coalesce` 는 SQL 문법이라 `pg_catalog.` 을 붙일 수 없다. 설정(vault)이 없으면
-- 0 을 돌려주고 끝난다 — 실패로 적으면 로컬·미설정 환경에서 매분 빨간 줄이 쌓인다.

create or replace view private.goods_sale_boundaries as
  select good.id as good_id, good.sale_starts_at as at, 'sale_start' as kind
  from public.goods as good where good.sale_starts_at is not null
  union all
  select good.id, good.sale_ends_at, 'sale_end'
  from public.goods as good where good.sale_ends_at is not null
  -- 할인도 기간이다. 정각에 할인가가 풀리는데 캐시가 옛 가격을 들고 있으면 표시와 청구가 갈린다
  -- (청구는 파생값을 다시 계산하므로 정확하다 — 갈리는 쪽은 화면이다).
  union all
  select good.id, good.discount_starts_at, 'discount_start'
  from public.goods as good where good.discount_starts_at is not null
  union all
  select good.id, good.discount_ends_at, 'discount_end'
  from public.goods as good where good.discount_ends_at is not null;

create or replace function public.goods_sale_boundary_tick()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_site text;
  v_secret text;
  v_count integer := 0;
begin
  select decrypted_secret into v_site from vault.decrypted_secrets where name = 'goods_revalidate_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'goods_revalidate_secret';
  if v_site is null or v_secret is null then
    return 0;
  end if;

  for v_row in
    -- 지난 1분 안에 지난 경계. 반열림이라 정각은 「지났다」에 든다.
    select distinct boundary.good_id, boundary.at, boundary.kind
    from private.goods_sale_boundaries as boundary
    where boundary.at > now() - interval '1 minute' and boundary.at <= now()
  loop
    perform net.http_post(
      url := v_site,
      body := jsonb_build_object('goodId', v_row.good_id, 'at', v_row.at, 'kind', v_row.kind),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', v_secret)
    );
    insert into public.audit_log (actor_id, action, target, diff)
    values (null, 'good.boundary', 'goods:' || v_row.good_id,
            jsonb_build_object('at', v_row.at, 'kind', v_row.kind));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.goods_sale_boundary_tick() is
  '판매·할인 기간 경계 통과 시 앱 캐시만 버리게 한다. **상태는 바꾸지 않는다** — 잡이 죽어도 데이터는 정확하다.';

revoke all on function public.goods_sale_boundary_tick() from public, anon, authenticated;
grant execute on function public.goods_sale_boundary_tick() to service_role;
revoke all on table private.goods_sale_boundaries from public, anon, authenticated, service_role;

select cron.schedule('goods-sale-boundary-tick', '* * * * *', $$select public.goods_sale_boundary_tick();$$)
where not exists (select 1 from cron.job where jobname = 'goods-sale-boundary-tick');
