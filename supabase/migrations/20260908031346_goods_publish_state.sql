-- #421: publication is separate from inventory, sale restrictions and the permanent URL lock.
alter table public.goods add column published_at timestamptz;
update public.goods set published_at=created_at,first_published_at=coalesce(first_published_at,created_at) where archived_at is null;
create index goods_published_at_idx on public.goods(published_at);
alter table public.goods drop constraint goods_type_check;
alter table public.goods add constraint goods_type_check check (
 type in ('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트') or (published_at is null and type='')
);

-- A publication locks the URL once, including goods prepared under a draft IP.
-- IP publication no longer writes child rows: purchase locks goods before its IP.
drop trigger ips_lock_goods_slugs on public.ips;
drop function private.lock_published_ip_goods_slugs();
create or replace function private.guard_goods_public_slug()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if old.first_published_at is not null and new.id is distinct from old.id then
      raise check_violation using message='goods_slug_locked';
    end if;
    if old.first_published_at is not null then new.first_published_at:=old.first_published_at; end if;
  end if;
  if new.archived_at is not null then new.published_at:=null; end if;
  if new.published_at is not null and new.first_published_at is null then new.first_published_at:=clock_timestamp(); end if;
  return new;
end $$;
revoke all on function private.guard_goods_public_slug() from public,anon,authenticated,service_role;
drop trigger goods_public_slug_guard on public.goods;
create trigger goods_public_slug_guard before insert or update of id,published_at,archived_at,first_published_at on public.goods
for each row execute function private.guard_goods_public_slug();

create function private.set_good_published(target_id text,publish_requested boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare selected public.goods; transition_at timestamptz;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if publish_requested is null then raise invalid_parameter_value using message='invalid_publish_state'; end if;
  select * into selected from public.goods where id=target_id for update;
  if not found then raise no_data_found using message='catalog_not_found'; end if;
  if selected.archived_at is not null then raise check_violation using message='catalog_item_archived'; end if;
  if publish_requested=(selected.published_at is not null) then return false; end if;
  if publish_requested and (
    nullif(btrim(selected.name),'') is null or nullif(btrim(selected.type),'') is null
    or nullif(btrim(selected.image_path),'') is null
    or exists(select 1 from unnest(array[selected.notice_maker,selected.notice_origin,selected.notice_material,
      selected.notice_size,selected.notice_made_on,selected.notice_as_manager,selected.notice_as_contact]) field
      where nullif(btrim(field),'') is null)
    or not exists(select 1 from public.goods_variants where good_id=target_id and archived_at is null)
  ) then raise check_violation using message='goods_publish_incomplete'; end if;
  transition_at:=case when publish_requested then clock_timestamp() else null end;
  update public.goods set published_at=transition_at where id=target_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),
    case when publish_requested then 'admin.good.published' else 'admin.good.unpublished' end,'goods:'||target_id,
    jsonb_build_object('published_at',transition_at,'previous_published_at',selected.published_at));
  return true;
end $$;
revoke all on function private.set_good_published(text,boolean) from public,anon,authenticated,service_role;
create function public.admin_set_good_published(target_id text,target_published boolean)
returns boolean language sql security definer set search_path='' as $$
  select private.set_good_published(target_id,target_published);
$$;
revoke all on function public.admin_set_good_published(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_good_published(text,boolean) to authenticated;

drop function public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer);
create function public.admin_upsert_good(
  target_id text,
  target_ip_id text,
  target_name text,
  target_type text,
  target_price integer,
  target_badge text,
  target_stock text,
  target_bg text,
  target_image_path text,
  target_notice_maker text,
  target_notice_origin text,
  target_notice_material text,
  target_notice_size text,
  target_notice_made_on text,
  target_notice_as_manager text,
  target_notice_as_contact text,
  target_description text,
  target_gallery_paths text[],
  target_detail_image_path text,
  target_previous_id text default null,
  target_compare_at_price integer default null,
  target_publish boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_ip_id text;
  notice_maker text := nullif(btrim(coalesce(target_notice_maker, ''), E' \t\n\r\f\v'), '');
  notice_origin text := nullif(btrim(coalesce(target_notice_origin, ''), E' \t\n\r\f\v'), '');
  notice_material text := nullif(btrim(coalesce(target_notice_material, ''), E' \t\n\r\f\v'), '');
  notice_size text := nullif(btrim(coalesce(target_notice_size, ''), E' \t\n\r\f\v'), '');
  notice_made_on text := nullif(btrim(coalesce(target_notice_made_on, ''), E' \t\n\r\f\v'), '');
  notice_as_manager text := nullif(btrim(coalesce(target_notice_as_manager, ''), E' \t\n\r\f\v'), '');
  notice_as_contact text := nullif(btrim(coalesce(target_notice_as_contact, ''), E' \t\n\r\f\v'), '');
  gallery_paths text[] := coalesce(target_gallery_paths, '{}'::text[]);
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null and normalized_previous_id is distinct from target_id then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if nullif(btrim(target_name),'') is null then raise check_violation using message='goods_name_required'; end if;

  -- 고시정보 누락은 앱 폼에서도 막지만, RPC 를 직접 부르는 경로에서도 막는다.
  if (target_publish is true or exists(select 1 from public.goods where id=target_id and published_at is not null)) and (notice_maker is null
    or notice_origin is null
    or notice_material is null
    or notice_size is null
    or notice_made_on is null
    or notice_as_manager is null
    or notice_as_contact is null)
  then
    raise exception 'goods_notice_required' using errcode = '23514';
  end if;

  if coalesce(array_length(gallery_paths, 1), 0) > 4 then
    raise exception 'goods_gallery_limit' using errcode = '23514';
  end if;

  -- 정가는 할인 표기 전용이다 — 판매가 이하의 정가는 CHECK 에 맡기지 않고
  -- 여기서 도메인 이름을 가진 에러로 먼저 거른다.
  if target_compare_at_price is not null and target_compare_at_price <= target_price then
    raise exception 'goods_compare_at_price_invalid' using errcode = '23514';
  end if;

  select ip_id into previous_ip_id from public.goods where id = target_id for update;

  if normalized_previous_id is not null and not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;

  insert into public.goods (
    id,
    ip_id,
    name,
    type,
    price,
    compare_at_price,
    badge,
    stock,
    bg,
    image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact,
    description,
    gallery_paths,
    detail_image_path
  )
  values (
    target_id,
    target_ip_id,
    target_name,
    coalesce(target_type,''),
    coalesce(target_price,0),
    target_compare_at_price,
    target_badge,
    coalesce(target_stock,'ok'),
    target_bg,
    target_image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact,
    nullif(btrim(coalesce(target_description, ''), E' \t\n\r\f\v'), ''),
    gallery_paths,
    nullif(btrim(coalesce(target_detail_image_path, ''), E' \t\n\r\f\v'), '')
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    type = excluded.type,
    price = excluded.price,
    compare_at_price = excluded.compare_at_price,
    badge = excluded.badge,
    stock = excluded.stock,
    bg = excluded.bg,
    image_path = excluded.image_path,
    notice_maker = excluded.notice_maker,
    notice_origin = excluded.notice_origin,
    notice_material = excluded.notice_material,
    notice_size = excluded.notice_size,
    notice_made_on = excluded.notice_made_on,
    notice_as_manager = excluded.notice_as_manager,
    notice_as_contact = excluded.notice_as_contact,
    description = excluded.description,
    gallery_paths = excluded.gallery_paths,
    detail_image_path = excluded.detail_image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  if target_publish is not null then perform private.set_good_published(target_id,target_publish); end if;

  update public.ips
  set goods_count = (
      select count(*)::integer from public.goods where goods.ip_id = ips.id
    ),
    updated_at = now()
  where id in (target_ip_id, previous_ip_id);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.good.upsert',
    'goods:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'name', target_name,
      'price', target_price,
      'compare_at_price', target_compare_at_price,
      'gallery_count', coalesce(array_length(gallery_paths, 1), 0),
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

revoke all on function public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean) to authenticated;

create or replace function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=(select auth.uid());
  previous_id text:=nullif(btrim(target_good->>'previous_id'),'');
  target_id text:=nullif(btrim(target_good->>'id'),'');
  target_ip text:=target_good->>'ip_id';
  previous_ip text;
  previous_code text;
  requested_code text:=nullif(upper(btrim(target_good->>'code')),'');
  requested_variant_code text:=nullif(upper(btrim(target_good->>'default_variant_code')),'');
  saved_code text; saved_variant_code text;
begin
  if actor_id is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  if previous_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('admin_good:'||previous_id,0));
    select ip_id,code into previous_ip,previous_code from public.goods where id=previous_id for update;
    if not found then raise no_data_found using message='catalog_record_missing'; end if;
  end if;
  if target_id is null then
    perform pg_advisory_xact_lock(hashtextextended('goods_slug:'||private.goods_slug_from_name(target_good->>'name'),0));
    target_id:=private.available_goods_slug(target_good->>'name',previous_id);
  end if;
  if target_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then raise invalid_parameter_value using message='invalid_goods_slug'; end if;
  if previous_id is not null and previous_id is distinct from target_id then
    update public.goods set id=target_id where id=previous_id;
    update public.reward_policies set target_good_id=target_id where target_good_id=previous_id;
    update public.home_curations set payload=jsonb_set(payload,'{good_ids}',(
      select jsonb_agg(case when item=to_jsonb(previous_id) then to_jsonb(target_id) else item end order by position)
      from jsonb_array_elements(payload->'good_ids') with ordinality items(item,position)
    )) where jsonb_typeof(payload->'good_ids')='array' and payload->'good_ids' ? previous_id;
    update public.campaigns campaign set sections=(
      select jsonb_agg(case when jsonb_typeof(section->'good_ids')='array' and section->'good_ids' ? previous_id
        then jsonb_set(section,'{good_ids}',(
          select jsonb_agg(case when item=to_jsonb(previous_id) then to_jsonb(target_id) else item end order by item_position)
          from jsonb_array_elements(section->'good_ids') with ordinality items(item,item_position)
        )) else section end order by section_position)
      from jsonb_array_elements(campaign.sections) with ordinality sections(section,section_position)
    ) where campaign.sections @> jsonb_build_array(jsonb_build_object('good_ids',jsonb_build_array(previous_id)));
  end if;

  perform public.admin_upsert_good(
    target_id,target_ip,target_good->>'name',target_good->>'type',(target_good->>'price')::integer,
    target_good->>'badge',target_good->>'stock',target_good->>'bg',target_good->>'image_path',
    target_good->>'notice_maker',target_good->>'notice_origin',target_good->>'notice_material',target_good->>'notice_size',
    target_good->>'notice_made_on',target_good->>'notice_as_manager',target_good->>'notice_as_contact',
    target_good->>'description',array(select jsonb_array_elements_text(coalesce(target_good->'gallery_paths','[]'::jsonb))),
    target_good->>'detail_image_path',case when previous_id is null then null else target_id end,
    nullif(target_good->>'compare_at_price','')::integer,
    (target_good->>'publish')::boolean
  );
  if requested_code is not null then update public.goods set code=requested_code where id=target_id; end if;
  if requested_variant_code is not null then
    update public.goods_variants set code=requested_variant_code where good_id=target_id and is_default;
  end if;
  select code into saved_code from public.goods where id=target_id;
  select code into saved_variant_code from public.goods_variants where good_id=target_id and is_default;
  insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'admin.good.identifiers_saved','goods:'||target_id,
    jsonb_build_object('previous_id',previous_id,'id',target_id,'previous_code',previous_code,'code',saved_code,'default_variant_code',saved_variant_code));
  return jsonb_build_object('id',target_id,'code',saved_code,'default_variant_code',saved_variant_code);
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Drafts never announce a drop or consume a pending restock subscription.
CREATE OR REPLACE FUNCTION private.notify_good_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.published_at is null or new.archived_at is not null or new.sale_restriction<>'none'
    or not exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null) then return new; end if;
  if tg_op='UPDATE' and old.published_at is not null then return new; end if;
  if (select auth.uid()) is null or not (select public.is_staff()) then
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
    'drop_published',
    '새 굿즈가 공개됐어요',
    left(new.name || ' 굿즈가 공개됐습니다.', 500),
    '/shop',
    'good',
    new.id,
    'good:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_drops
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$function$;


revoke all on function private.notify_good_insert() from public,anon,authenticated,service_role;
drop trigger trg_goods_notify_insert on public.goods;
create trigger trg_goods_notify_insert after insert or update of published_at on public.goods for each row execute function private.notify_good_insert();

CREATE OR REPLACE FUNCTION private.notify_goods_restock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 판매 가능 술어가 거짓→참으로 전이할 때만 발화한다.
  if not (
    new.archived_at is null
    and new.published_at is not null
    and new.sale_restriction='none'
    and exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null)
    and new.stock <> 'soldout'
    and new.stock_qty > 0
  ) or (
    old.archived_at is null
    and old.published_at is not null
    and old.sale_restriction='none'
    and old.stock <> 'soldout'
    and old.stock_qty > 0
  ) then
    return new;
  end if;

  with flipped as (
    update public.restock_alerts
    set status = 'notified', notified_at = now()
    where good_id = new.id and status = 'pending'
    returning user_id
  )
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
    flipped.user_id,
    'restock_available',
    '재입고 알림',
    left(new.name || ' 굿즈가 다시 판매를 시작했어요.', 500),
    '/shop/' || new.id,
    'good',
    new.id,
    -- 재신청→재품절→재입고 사이클마다 새 알림이어야 하므로 시각을 키에 넣는다.
    -- now() 는 트랜잭션 시작에 고정되어 같은 트랜잭션(또는 같은 초)의 두 사이클이
    -- 충돌하므로, 문장 시각(clock_timestamp) 밀리초로 사이클을 구분한다.
    'restock:' || new.id || ':'
      || (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint::text
  from flipped
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$function$;


revoke all on function private.notify_goods_restock() from public,anon,authenticated,service_role;
drop trigger trg_goods_notify_restock on public.goods;
create trigger trg_goods_notify_restock after update of stock,stock_qty,archived_at,published_at on public.goods for each row execute function private.notify_goods_restock();

-- New orders fence unpublished goods after the existing idempotent order lookup.
CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  r record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  -- 카트와 재고를 같은 결정적 순서로 잠근 뒤 DB 값만으로 주문 스냅샷을 만든다.
  for r in
    select
      cart.good_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    v_item_count := v_item_count + 1;

    if r.stock = 'soldout' or r.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    perform private.change_default_goods_variant_stock(r.good_id, -r.qty::bigint);

    insert into public.order_items (
      order_id,
      good_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.qty,
      r.price,
      r.name,
      r.type,
      r.ip_id
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id;

    v_subtotal := v_subtotal + (r.price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- 배송비 판정은 할인 전 소계 기준이다 — 쿠폰이 무료배송 경계를 흔들면
  -- 카트의 "얼마 더 담으면 무료배송" 안내가 거짓말이 된다.
  v_shipping_fee := private.goods_shipping_fee_for(v_subtotal);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_user_coupon(v_selected_coupon, v_user, v_subtotal);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount,
      shipping_fee = v_shipping_fee,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public, anon, authenticated, service_role;

-- Public search keeps its existing independent IP and sale-restriction gates.
-- Merge #405 sale restriction and #410 IP publishing. The later IP migration
-- had replaced search_public_content from the older catalog-archiving version,
-- dropping the adult-goods predicate. Both visibility conditions are required.
-- Community post visibility, blocking, wildcard escaping, ranking and limits
-- are byte-for-byte the same as main's 20260901120000 function.
create or replace function public.search_public_content(
  search_query text,
  per_group_limit integer default 6
)
returns table (
  kind text,
  id text,
  label text,
  subtitle text,
  ip_id text,
  ip_title text,
  image_path text,
  bg text,
  accent text,
  score real
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with raw_params as (
    select
      nullif(left(btrim(search_query), 80), '') as q,
      greatest(1, least(coalesce(per_group_limit, 6), 20)) as result_limit,
      auth.uid() as actor_id
  ),
  params as (
    select
      raw_params.q,
      case
        when raw_params.q is null then null
        else '%' || replace(replace(replace(raw_params.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      end as q_like,
      raw_params.result_limit,
      raw_params.actor_id
    from raw_params
  ),
  visible_posts as (
    select
      posts.id,
      posts.user_id,
      posts.ip_id,
      posts.text,
      posts.tag,
      posts.image_path,
      ips.title as ip_title,
      verticals.color as accent
    from public.posts
    left join public.ips on ips.id = posts.ip_id
    left join public.verticals on verticals.key = ips.vertical_key
    cross join params
    where params.q is not null
      and posts.status = 'visible'
      and not exists (
        select 1
        from public.blocks
        where blocks.user_id = params.actor_id
          and blocks.blocked_user_id = posts.user_id
      )
  ),
  all_matches as (
    select
      'ip'::text as kind,
      ips.id::text as id,
      ips.title as label,
      concat_ws(' · ', verticals.label, ips.sub) as subtitle,
      ips.id::text as ip_id,
      ips.title as ip_title,
      ips.image_path,
      ips.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(ips.title, params.q),
        case when ips.title ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(ips.sub, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(ips.tagline, '') ilike params.q_like escape E'\\' then 0.6 else 0 end,
        case when coalesce(ips.synopsis, '') ilike params.q_like escape E'\\' then 0.4 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.ips on params.q is not null
    join public.verticals on verticals.key = ips.vertical_key
    where ips.archived_at is null
      and ips.published_at is not null
      and (
        ips.title ilike params.q_like escape E'\\'
        or coalesce(ips.sub, '') ilike params.q_like escape E'\\'
        or coalesce(ips.tagline, '') ilike params.q_like escape E'\\'
        or coalesce(ips.synopsis, '') ilike params.q_like escape E'\\'
        or extensions.similarity(ips.title, params.q) > 0.15
      )

    union all

    select
      'good'::text as kind,
      goods.id::text as id,
      goods.name as label,
      concat_ws(' · ', ips.title, goods.type) as subtitle,
      goods.ip_id::text,
      ips.title as ip_title,
      goods.image_path,
      goods.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(goods.name, params.q),
        case when goods.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(goods.badge, '') ilike params.q_like escape E'\\' then 0.4 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.goods on params.q is not null
    join public.ips on ips.id = goods.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where goods.archived_at is null
      and goods.published_at is not null
      and ips.archived_at is null
      and ips.published_at is not null
      and goods.sale_restriction = 'none'
      and (
        goods.name ilike params.q_like escape E'\\'
        or goods.type ilike params.q_like escape E'\\'
        or coalesce(goods.badge, '') ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(goods.name, params.q) > 0.15
      )

    union all

    select
      'card'::text as kind,
      cards.id::text as id,
      cards.name as label,
      concat_ws(' · ', ips.title, cards.rarity::text, cards.no) as subtitle,
      cards.ip_id::text,
      ips.title as ip_title,
      cards.image_path,
      cards.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(cards.name, params.q),
        case when cards.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(cards.no, '') ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when cards.rarity::text ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.cards on params.q is not null
    join public.ips on ips.id = cards.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where cards.archived_at is null
      and ips.archived_at is null
      and ips.published_at is not null
      and (
        cards.name ilike params.q_like escape E'\\'
        or coalesce(cards.no, '') ilike params.q_like escape E'\\'
        or cards.rarity::text ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(cards.name, params.q) > 0.15
      )

    union all

    select
      'post'::text as kind,
      visible_posts.id::text as id,
      visible_posts.text as label,
      concat_ws(' · ', visible_posts.ip_title, case when visible_posts.tag is null then null else '#' || visible_posts.tag end) as subtitle,
      visible_posts.ip_id::text,
      visible_posts.ip_title,
      null::text as image_path,
      null::text as bg,
      visible_posts.accent,
      greatest(
        extensions.similarity(visible_posts.text, params.q),
        case when visible_posts.text ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        case when coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join visible_posts on true
    where visible_posts.text ilike params.q_like escape E'\\'
      or coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\'
      or coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.text, params.q) > 0.15

    union all

    select
      'tag'::text as kind,
      visible_posts.tag as id,
      '#' || visible_posts.tag as label,
      '커뮤니티 태그'::text as subtitle,
      null::text as ip_id,
      null::text as ip_title,
      null::text as image_path,
      null::text as bg,
      max(visible_posts.accent) as accent,
      max(greatest(
        extensions.similarity(visible_posts.tag, params.q),
        case when visible_posts.tag ilike params.q_like escape E'\\' then 1 else 0 end
      ))::real as score,
      params.result_limit
    from params
    join visible_posts on visible_posts.tag is not null
    where visible_posts.tag ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.tag, params.q) > 0.15
    group by visible_posts.tag, params.result_limit
  ),
  ranked as (
    select
      all_matches.*,
      row_number() over (
        partition by all_matches.kind
        order by all_matches.score desc, all_matches.label asc, all_matches.id asc
      ) as group_rank
    from all_matches
  )
  select
    ranked.kind,
    ranked.id,
    ranked.label,
    ranked.subtitle,
    ranked.ip_id,
    ranked.ip_title,
    ranked.image_path,
    ranked.bg,
    ranked.accent,
    ranked.score
  from ranked
  where ranked.group_rank <= ranked.result_limit
  order by
    case ranked.kind
      when 'ip' then 1
      when 'good' then 2
      when 'card' then 3
      when 'post' then 4
      when 'tag' then 5
      else 6
    end,
    ranked.score desc,
    ranked.label asc,
    ranked.id asc;
$$;

revoke all on function public.search_public_content(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(text, integer)
  to anon, authenticated;
