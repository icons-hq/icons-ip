-- #478: approved document HTML. HTML parsing/sanitizing belongs to the vetted
-- application sanitizer; the public renderer sanitizes again even for direct
-- RPC writes. The database owns format/length, verified image ownership, and audit.
alter table public.goods
  add column description_format text not null default 'plain',
  add column description_image_paths text[] not null default '{}',
  add constraint goods_description_format check(description_format in ('plain','html')),
  add constraint goods_description_html_length check(description_format <> 'html' or char_length(description) <= 30000),
  add constraint goods_description_images check(
    cardinality(description_image_paths) <= 20
    and array_position(description_image_paths,null::text) is null
    and not('' = any(description_image_paths))
    and (description_format='html' or cardinality(description_image_paths)=0)
  );
comment on column public.goods.description is '상세 설명 원문. description_format=plain이면 문자 그대로, html이면 공통 허용목록으로 정제하여 렌더';
comment on column public.goods.description_image_paths is 'HTML 상세가 참조하는 검증된 public-media 경로. 공통 렌더러도 이 목록 밖 이미지를 제거';

create or replace function public.enforce_admin_goods_content_artwork_claim()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor_id uuid:=(select auth.uid());
  old_paths text[]:='{}';
  new_paths text[];
  candidate text;
begin
  if tg_op='UPDATE' then
    old_paths:=array_remove(array[old.image_path,old.detail_image_path]
      || coalesce(old.gallery_paths,'{}') || coalesce(old.description_image_paths,'{}'),null);
  end if;
  select coalesce(array_agg(distinct path),'{}') into new_paths
    from unnest(array_remove(array[new.detail_image_path]
      || coalesce(new.gallery_paths,'{}') || coalesce(new.description_image_paths,'{}'),null)) path;
  foreach candidate in array new_paths loop
    continue when candidate=any(old_paths);
    -- The existing main-image AFTER trigger validates this same row's image.
    continue when candidate=new.image_path;
    continue when private.can_copy_goods_artwork(new.id::text,candidate);
    if v_actor_id is null then
      if session_user='postgres' then continue; end if;
      raise check_violation using message='unverified_artwork';
    end if;
    if not public.is_staff() or candidate !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then
      raise check_violation using message='unverified_artwork';
    end if;
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=v_actor_id and claim.path=substring(candidate from length('public-media/')+1)
        and claim.kind='good' and claim.status='verified' and claim.verified_at is not null
        and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.enforce_admin_goods_content_artwork_claim() from public,anon,authenticated,service_role;
drop trigger enforce_admin_goods_content_artwork_claim on public.goods;
create trigger enforce_admin_goods_content_artwork_claim
  after insert or update of gallery_paths,detail_image_path,description_image_paths on public.goods
  for each row execute function public.enforce_admin_goods_content_artwork_claim();

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_description;
revoke all on function private.admin_save_good_before_description(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_description(jsonb) to postgres;
create function public.admin_save_good(target_good jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor_id uuid:=(select auth.uid());
  previous_good public.goods;
  description_value text:=nullif(btrim(target_good->>'description',E' \t\n\r\f\v'),'');
  format_value text;
  image_paths text[];
  saved jsonb;
  before_value jsonb;
  after_value jsonb;
begin
  if v_actor_id is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  -- Match category assignment and cloning: tree before product advisory/row.
  -- Taking a product lock first would deadlock with those existing writers.
  perform private.lock_catalog_category_tree();
  if nullif(target_good->>'previous_id','') is not null then
    perform pg_advisory_xact_lock(hashtextextended('admin_good:'||(target_good->>'previous_id'),0));
    select * into previous_good from public.goods where id=target_good->>'previous_id' for update;
    if not found then raise no_data_found using message='catalog_record_missing'; end if;
  end if;
  format_value:=case when target_good ? 'description_format' then target_good->>'description_format' else coalesce(previous_good.description_format,'plain') end;
  if format_value is null or format_value not in ('plain','html') then raise check_violation using message='goods_description_format'; end if;
  -- Keep legacy plain rows and their clone path compatible. The existing form
  -- still caps newly edited plain text at 2,000; this new DB cap is HTML-only.
  if format_value='html' and char_length(description_value)>30000 then
    raise check_violation using message='goods_description_length';
  end if;
  if target_good ? 'description_image_paths' then
    if jsonb_typeof(target_good->'description_image_paths') is distinct from 'array' then raise check_violation using message='goods_description_images'; end if;
    if jsonb_array_length(target_good->'description_image_paths')>20
      or exists(select 1 from jsonb_array_elements(target_good->'description_image_paths') item where jsonb_typeof(item)<>'string' or item='""'::jsonb)
    then raise check_violation using message='goods_description_images'; end if;
    image_paths:=array(select jsonb_array_elements_text(target_good->'description_image_paths'));
  else
    image_paths:=case when format_value='html' and description_value is not distinct from previous_good.description then coalesce(previous_good.description_image_paths,'{}') else '{}' end;
  end if;
  if format_value='plain' and cardinality(image_paths)>0 then raise check_violation using message='goods_description_images'; end if;
  before_value:=jsonb_build_object('format',coalesce(previous_good.description_format,'plain'),'description',previous_good.description,'imagePaths',coalesce(previous_good.description_image_paths,'{}'));
  saved:=private.admin_save_good_before_description(target_good-'description_format'-'description_image_paths');
  if previous_good.id is not null then
    -- The lower writer may have removed the old main/gallery/detail slot or
    -- renamed this draft. Preserve only this locked source row's verified paths
    -- across the final HTML update. The destination now exists under saved.id,
    -- so no authorization FK ever points at an intermediate or another good.
    insert into private.goods_artwork_copy_authorizations(transaction_id,target_good_id,source_good_id,actor_id,allowed_paths)
      values(txid_current(),saved->>'id',saved->>'id',v_actor_id,
        array_remove(array[previous_good.image_path,previous_good.detail_image_path]
          || coalesce(previous_good.gallery_paths,'{}') || coalesce(previous_good.description_image_paths,'{}'),null));
  end if;
  update public.goods set description_format=format_value,description_image_paths=image_paths where id=saved->>'id';
  if previous_good.id is not null then
    delete from private.goods_artwork_copy_authorizations permission
      where permission.transaction_id=txid_current() and permission.target_good_id=saved->>'id'
        and permission.source_good_id=saved->>'id' and permission.actor_id=v_actor_id;
  end if;
  after_value:=jsonb_build_object('format',format_value,'description',description_value,'imagePaths',image_paths);
  if before_value is distinct from after_value then
    insert into public.audit_log(actor_id,action,target,diff)
      values(v_actor_id,'admin.good.description_saved','goods:'||(saved->>'id'),jsonb_build_object('before',before_value,'after',after_value));
  end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Moving an already verified image within this same good does not consume its claim again.
create or replace function public.enforce_admin_catalog_artwork_claim()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := (select auth.uid());
  object_path text;
  expected_kind text := tg_argv[0];
begin
  if new.image_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.image_path is not distinct from old.image_path then
    return new;
  end if;

  if expected_kind='good' and tg_table_schema='public' and tg_table_name='goods' and tg_op='UPDATE' then
    if new.image_path=any(array_remove(array[old.detail_image_path]||coalesce(old.gallery_paths,'{}')||coalesce(old.description_image_paths,'{}'),null)) then
      return new;
    end if;
  end if;

  if expected_kind='good' and tg_table_schema='public' and tg_table_name='goods'
    and private.can_copy_goods_artwork(new.id::text,new.image_path) then return new; end if;

  if current_actor_id is null then
    if session_user = 'postgres' then
      return new;
    end if;
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  if not public.is_staff()
    or new.image_path !~ '^public-media/catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  object_path := substring(new.image_path from length('public-media/') + 1);
  if object_path not like 'catalog/' || expected_kind || '/%' then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'attached',
    attached_at = clock_timestamp(),
    resolved_at = clock_timestamp()
  where claim.actor_id = current_actor_id
    and claim.path = object_path
    and claim.kind = expected_kind
    and claim.status = 'verified'
    and claim.verified_at is not null
    and claim.final_size is not null
    and claim.attached_at is null
    and claim.expires_at > clock_timestamp();

  if not found then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_admin_catalog_artwork_claim() from public,anon,authenticated,service_role;


-- The clone allowlist explicitly includes the document format and its verified images.
create or replace function public.admin_clone_good(
  target_operation_id uuid,
  target_source_good_id text,
  target_new_id text default null,
  target_new_code text default null,
  target_new_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  source_good public.goods;
  source_ip_id text;
  category_value uuid;
  category_row public.catalog_categories;
  source_variants jsonb;
  target_payload jsonb;
  saved jsonb;
  saved_good public.goods;
  saved_code text;
  saved_id text;
  effective_name text;
  normalized_source_id text := nullif(pg_catalog.btrim(coalesce(target_source_good_id, '')), '');
  normalized_new_id text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(target_new_id, ''))), '');
  normalized_new_code text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(target_new_code, ''))), '');
  normalized_new_name text := nullif(pg_catalog.btrim(coalesce(target_new_name, '')), '');
  request_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
begin
  if actor_id is null or not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if target_operation_id is null then
    raise invalid_parameter_value using message = 'invalid_operation_id';
  end if;
  if normalized_source_id is null or normalized_source_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise invalid_parameter_value using message = 'invalid_source_good_id';
  end if;
  if normalized_new_id is not null and normalized_new_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise invalid_parameter_value using message = 'invalid_clone_good_id';
  end if;
  if normalized_new_code is not null and normalized_new_code !~ '^[A-Z0-9][A-Z0-9-]{0,99}$' then
    raise invalid_parameter_value using message = 'invalid_clone_good_code';
  end if;
  if normalized_new_name is not null and pg_catalog.char_length(normalized_new_name) > 200 then
    raise invalid_parameter_value using message = 'invalid_clone_good_name';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'source_good_id', normalized_source_id,
    'new_id', normalized_new_id,
    'new_code', normalized_new_code,
    'new_name', normalized_new_name
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin.goods.clone.operation:' || target_operation_id::text, 0)
  );
  select audit.actor_id, audit.action, audit.diff
    into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id
       and existing_action = 'admin.catalog.good.cloned'
       and existing_diff -> 'request' = request_payload
       and existing_diff ? 'result'
    then
      return existing_diff -> 'result';
    end if;
    raise unique_violation using message = 'goods_clone_operation_conflict';
  end if;

  -- Checkout locks goods before its IP. Never hold the parent while waiting for
  -- this source or an existing manual target. A multi-item checkout may already
  -- hold this IP SHARE from an earlier item, so parent contention must fail fast.
  perform private.lock_catalog_category_tree();
  select * into source_good
  from public.goods
  where id = normalized_source_id
  for update;
  if not found then
    raise no_data_found using message = 'goods_clone_source_not_found';
  end if;
  if source_good.archived_at is not null then
    raise check_violation using message = 'goods_clone_source_archived';
  end if;
  if normalized_new_id is not null and normalized_new_id = source_good.id then
    raise unique_violation using message = 'good_clone_id_taken';
  end if;
  if normalized_new_id is not null and exists(select 1 from public.goods where id=normalized_new_id) then
    raise unique_violation using message='catalog_id_taken';
  end if;
  if normalized_new_code is not null and exists(select 1 from public.goods where code=normalized_new_code) then
    raise unique_violation using message='goods_code_key';
  end if;
  begin
    select id into source_ip_id from public.ips where id=source_good.ip_id for update nowait;
  exception when lock_not_available then
    raise sqlstate 'PT409' using message='goods_clone_source_busy';
  end;
  if not found then raise no_data_found using message='goods_clone_source_not_found'; end if;

  -- Lock the complete source option set before reading it. The payload below
  -- intentionally omits source option IDs, codes, external identities and cost.
  perform 1
  from public.goods_variants as variant
  where variant.good_id = source_good.id
  order by variant.id
  for update;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', variant.name,
        'attributes', coalesce(variant.attributes, '{}'::jsonb),
        'extraPrice', greatest(0,variant.price - source_good.price),
        'stockQty', 0,
        'isActive', variant.archived_at is null,
        'lowStockThreshold', variant.low_stock_threshold
      ) order by variant.is_default desc, variant.sort_order, variant.id
    ), '[]'::jsonb
  )
  into source_variants
  from public.goods_variants as variant
  where variant.good_id = source_good.id
    and (variant.archived_at is null or variant.is_default);
  if pg_catalog.jsonb_array_length(source_variants) = 0 then
    raise check_violation using message = 'goods_clone_source_options_missing';
  end if;
  if exists (
    select 1
    from public.goods_variants as variant
    where variant.good_id = source_good.id
      and variant.archived_at is null
      and variant.price < source_good.price
  ) then
    raise check_violation using message = 'goods_clone_source_options_invalid';
  end if;

  -- A category is copied only while it is an active leaf. Archived or changed
  -- source category values become an explicitly unclassified draft.
  if source_good.category_id is not null then
    select * into category_row
    from public.catalog_categories as category
    where category.id = source_good.category_id
    for share;
    if found and category_row.archived_at is null
       and not exists (
         select 1 from public.catalog_categories as child
         where child.parent_id = category_row.id and child.archived_at is null
       ) then
      category_value := category_row.id;
    end if;
  end if;

  effective_name := coalesce(normalized_new_name, source_good.name || ' 복사본');
  target_payload := pg_catalog.jsonb_build_object(
    'id', normalized_new_id,
    'code', normalized_new_code,
    'ip_id', source_good.ip_id,
    'name', effective_name,
    'name_en', source_good.name_en,
    'type', source_good.type,
    'origin_id', source_good.origin_id,
    'shipping_fee_type', source_good.shipping_fee_type,
    'individual_fee', source_good.individual_fee,
    'allow_card_payment', source_good.allow_card_payment,
    'allow_bank_transfer', source_good.allow_bank_transfer,
    'sale_restriction', source_good.sale_restriction,
    'order_quantity_limit_enabled', source_good.order_quantity_limit_enabled,
    'min_order_qty', source_good.min_order_qty,
    'max_order_qty', source_good.max_order_qty,
    'member_purchase_limit_enabled', source_good.member_purchase_limit_enabled,
    'member_lifetime_qty_limit', source_good.member_lifetime_qty_limit,
    'claim_policy', jsonb_build_object('returnAllowed',source_good.claim_return_allowed,
      'exchangeAllowed',source_good.claim_exchange_allowed,'restrictionReason',source_good.claim_restriction_reason,
      'returnFee',source_good.claim_return_fee,'returnFreeShippingFee',source_good.claim_return_free_shipping_fee,
      'exchangeFee',source_good.claim_exchange_fee),
    'price', source_good.price,
    'compare_at_price', source_good.compare_at_price,
    'badge', source_good.badge,
    'stock', 'ok',
    'bg', source_good.bg,
    'image_path', null,
    'notice_maker', source_good.notice_maker,
    'notice_origin', source_good.notice_origin,
    'notice_material', source_good.notice_material,
    'notice_size', source_good.notice_size,
    'notice_made_on', source_good.notice_made_on,
    'notice_as_manager', source_good.notice_as_manager,
    'notice_as_contact', source_good.notice_as_contact,
    'description', source_good.description,
    'description_format', source_good.description_format,
    'description_image_paths', '[]'::jsonb,
    'gallery_paths', '[]'::jsonb,
    'detail_image_path', null,
    'search_keywords', coalesce(to_jsonb(source_good.search_keywords), '[]'::jsonb),
    'category_id', category_value,
    'publish', false,
    'variants', source_variants,
    'variant_baseline', '[]'::jsonb
  );

  -- The existing safe writer owns validation, ID/code allocation, option code
  -- allocation, deferred default-option checks, and its established audit.
  saved := public.admin_save_good(target_payload);
  saved_id := saved ->> 'id';
  if saved_id is null then
    raise check_violation using message = 'goods_clone_result_missing';
  end if;

  -- Stopped non-default rows are historical configuration, not rows of the
  -- active editor. Preserve their absolute price and duplicate old attributes
  -- without reactivating them or importing old IDs/codes, stock, or ledgers.
  insert into public.goods_variants(good_id,name,attributes,price,stock_qty,sort_order,is_default,low_stock_threshold,archived_at)
    select saved_id,variant.name,variant.attributes,variant.price,0,
      (jsonb_array_length(source_variants)+row_number() over(order by variant.sort_order,variant.id)-1)::integer,
      false,variant.low_stock_threshold,clock_timestamp()
    from public.goods_variants variant
    where variant.good_id=source_good.id and variant.archived_at is not null and not variant.is_default;
  update public.goods_variants copied
    set price=original.price
    from public.goods_variants original
    where copied.good_id=saved_id and copied.is_default
      and original.good_id=source_good.id and original.is_default and original.archived_at is not null;

  insert into private.goods_artwork_copy_authorizations(transaction_id,target_good_id,source_good_id,actor_id,allowed_paths)
    values(txid_current(),saved_id,source_good.id,actor_id,
      array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.gallery_paths,'{}')||coalesce(source_good.description_image_paths,'{}'),null));
  update public.goods set image_path=source_good.image_path,gallery_paths=source_good.gallery_paths,
    detail_image_path=source_good.detail_image_path,description_image_paths=source_good.description_image_paths where id=saved_id;
  delete from private.goods_artwork_copy_authorizations where transaction_id=txid_current() and target_good_id=saved_id;

  -- Shipping notice is an immutable snapshot on the source good. Applying the
  -- exact references/snapshot avoids resolving a later template revision.
  update public.goods
  set shipping_notice_template_id = source_good.shipping_notice_template_id,
      shipping_notice_template_version = source_good.shipping_notice_template_version,
      shipping_notice_snapshot = source_good.shipping_notice_snapshot
  where id = saved_id;

  select good.* into saved_good from public.goods as good where good.id = saved_id for update;
  saved_code := saved_good.code;
  if saved_code is null then
    raise check_violation using message = 'goods_clone_result_missing';
  end if;

  insert into public.audit_log(id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.catalog.good.cloned',
    'goods:' || saved_id,
    pg_catalog.jsonb_build_object(
      'request', request_payload,
      'sourceGoodId', source_good.id,
      'copiedOptions',(select jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name,'attributes',variant.attributes,
        'price',variant.price,'lowStockThreshold',variant.low_stock_threshold,'active',variant.archived_at is null)
        order by variant.sort_order,variant.id) from public.goods_variants variant where variant.good_id=saved_id),
      'copiedArtwork',jsonb_build_object('imagePath',source_good.image_path,'galleryPaths',source_good.gallery_paths,'detailImagePath',source_good.detail_image_path,'descriptionImagePaths',source_good.description_image_paths),
      'copiedDescription',jsonb_build_object('format',source_good.description_format,'description',source_good.description),
      'result', pg_catalog.jsonb_build_object(
        'id', saved_id,
        'code', saved_code,
        'sourceGoodId', source_good.id,
        'operationId', target_operation_id
      )
    )
  );
  return pg_catalog.jsonb_build_object(
    'id', saved_id,
    'code', saved_code,
    'sourceGoodId', source_good.id,
    'operationId', target_operation_id
  );
end;
$$;

revoke all on function public.admin_clone_good(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_clone_good(uuid, text, text, text, text)
  to authenticated;
