begin;

-- 기존 판매 상태를 보존한다. 이 행이 없으면 고객 경로는 숨김으로 판단한다.
create table private.adult_goods_storefront_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  revision bigint not null default 1 check (revision >= 1)
);
insert into private.adult_goods_storefront_settings (singleton) values (true);
alter table private.adult_goods_storefront_settings enable row level security;
revoke all on private.adult_goods_storefront_settings from public, anon, authenticated, service_role;

create function private.adult_goods_storefront_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.adult_goods_storefront_settings where singleton and enabled);
$$;
revoke all on function private.adult_goods_storefront_enabled() from public, anon, authenticated, service_role;

create function public.get_adult_goods_visibility() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', enabled, 'revision', revision)
  from private.adult_goods_storefront_settings where singleton;
$$;
revoke all on function public.get_adult_goods_visibility() from public, anon, authenticated, service_role;
grant execute on function public.get_adult_goods_visibility() to anon, authenticated;

create function public.admin_set_adult_goods_visibility(p_enabled boolean, p_expected_revision bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid;
  previous private.adult_goods_storefront_settings;
  result jsonb;
begin
  actor := private.require_operator_capability('platform.manage', true);
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1 then
    raise invalid_parameter_value using message = 'invalid_adult_goods_visibility';
  end if;
  select * into strict previous from private.adult_goods_storefront_settings where singleton for update;
  if previous.enabled = p_enabled then return public.get_adult_goods_visibility(); end if;
  if previous.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'adult_goods_visibility_changed';
  end if;
  update private.adult_goods_storefront_settings set enabled = p_enabled, revision = revision + 1
    where singleton returning jsonb_build_object('enabled', enabled, 'revision', revision) into result;
  insert into public.audit_log (actor_id, action, target, diff)
    values (actor, 'admin.adult_goods.visibility', 'adult_goods',
      jsonb_build_object('before', previous.enabled, 'result', result));
  return result;
end;
$$;
revoke all on function public.admin_set_adult_goods_visibility(boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_adult_goods_visibility(boolean, bigint) to authenticated;
select private.register_operator_rpc_contract('public.admin_set_adult_goods_visibility(boolean,bigint)'::regprocedure, 'platform.manage', 'write', true);

-- 상품 행·옵션·검색·전시·견적·구매 가능 여부가 공유하는 판정. 회원의 KCP 인증 증거 자체는 별개다.
create or replace function private.good_sale_restriction_visible(p_restriction public.goods_sale_restriction, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_restriction = 'none' or (p_restriction = 'adult'
    and (select private.adult_goods_storefront_enabled()) and private.adult_verification_valid(p_user_id));
$$;
revoke all on function private.good_sale_restriction_visible(public.goods_sale_restriction, uuid) from public, anon, authenticated, service_role;

create or replace function public.get_masked_adult_goods(p_good_id text default null)
returns table (id text, ip_id text, display_order integer, category_id uuid, price integer, stock text, stock_qty integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.ip_id, g.display_order, g.category_id, g.price, g.stock, g.stock_qty, g.created_at
  from public.goods g join public.ips ip on ip.id = g.ip_id
  where (select private.adult_goods_storefront_enabled()) and g.sale_restriction = 'adult'
    and g.published_at is not null and g.archived_at is null
    and ip.published_at is not null and ip.archived_at is null and (p_good_id is null or g.id = p_good_id)
  order by g.id;
$$;
revoke all on function public.get_masked_adult_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.get_masked_adult_goods(text) to anon, authenticated;

-- 주문 생성의 마지막 판정도 새 설정을 따른다. 이미 만들어진 주문의 결제 확정·취소는 이 경로를 쓰지 않는다.
do $$
declare
  definition text := pg_get_functiondef('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
  anchor text := 'if r.sale_restriction = ''adult'' and not private.adult_verification_valid(v_user) then';
begin
  if position(anchor in definition) = 0 then raise exception 'adult_goods_order_guard_changed'; end if;
  execute replace(definition, anchor,
    'if r.sale_restriction = ''adult'' and not private.adult_goods_storefront_enabled() then
       raise check_violation using message = ''catalog_item_unavailable'';
     elsif r.sale_restriction = ''adult'' and not private.adult_verification_valid(v_user) then');
end;
$$;

commit;
