-- DRAFT: group-owned common information, with one atomic edit/recovery contract.
-- Individual price, stock, artwork, payment and fulfillment stay on each good;
-- aggregation-owned commercial rules continue to use their original source.
create function private.goods_group_common_public_fields(p_good jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_good)
 where key=any(array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
  'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords']);
$$;
create function private.assert_goods_group_common_write(p_good_id text,p_before jsonb,p_after jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_before is not distinct from p_after then return;end if;
 if exists(select 1 from private.goods_group_members where good_id=p_good_id)
  and not exists(select 1 from private.goods_group_write_authorizations
   where transaction_id=txid_current() and good_id=p_good_id and actor_id=auth.uid()) then
  raise check_violation using message='goods_group_common_owned_by_group';
 end if;
end;
$$;
create function private.guard_goods_group_common_information() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_good text;new_good text;before_value jsonb;after_value jsonb;
begin
 if tg_op<>'INSERT' then old_good:=case when tg_table_name='goods' then to_jsonb(old)->>'id' else to_jsonb(old)->>'good_id' end;end if;
 if tg_op<>'DELETE' then new_good:=case when tg_table_name='goods' then to_jsonb(new)->>'id' else to_jsonb(new)->>'good_id' end;end if;
 if tg_table_name='goods' then
  before_value:=private.goods_group_common_public_fields(to_jsonb(old));after_value:=private.goods_group_common_public_fields(to_jsonb(new));
 elsif tg_table_name='goods_attribute_values' then
  before_value:=coalesce(to_jsonb(old)->'entries','[]');after_value:=coalesce(to_jsonb(new)->'entries','[]');
 elsif tg_table_name='goods_after_sales_content' then
  if tg_op<>'INSERT' then before_value:=jsonb_build_array(old.phone,old.guide,old.seller_special_notes);end if;
  if tg_op<>'DELETE' then after_value:=jsonb_build_array(new.phone,new.guide,new.seller_special_notes);end if;
 elsif tg_table_name='goods_size_charts' then
  if tg_op<>'INSERT' then before_value:=jsonb_build_array(old.enabled,old.chart);end if;
  if tg_op<>'DELETE' then after_value:=jsonb_build_array(new.enabled,new.chart);end if;
 elsif tg_table_name='goods_additional_categories' then
  if tg_op='INSERT' and exists(select 1 from public.goods_additional_categories where good_id=new.good_id and category_id=new.category_id) then return new;end if;
  if tg_op<>'INSERT' then before_value:=jsonb_build_array(old.good_id,old.category_id);end if;
  if tg_op<>'DELETE' then after_value:=jsonb_build_array(new.good_id,new.category_id);end if;
 end if;
 if old_good is not null then perform private.assert_goods_group_common_write(old_good,before_value,after_value);end if;
 if new_good is distinct from old_good then perform private.assert_goods_group_common_write(new_good,before_value,after_value);end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$$;
create trigger goods_group_common_information_guard before update on public.goods
 for each row execute function private.guard_goods_group_common_information();
create trigger goods_group_attributes_guard before insert or update or delete on public.goods_attribute_values
 for each row execute function private.guard_goods_group_common_information();
create trigger goods_group_additional_categories_guard before insert or update or delete on public.goods_additional_categories
 for each row execute function private.guard_goods_group_common_information();
create trigger goods_group_after_sales_guard before insert or update or delete on private.goods_after_sales_content
 for each row execute function private.guard_goods_group_common_information();
create trigger goods_group_size_chart_guard before insert or update or delete on private.goods_size_charts
 for each row execute function private.guard_goods_group_common_information();

create function public.admin_get_goods_group_editor_ownership(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when public.has_operator_capability('catalog.read',false) then jsonb_build_object('goodId',g.id,
  'group',(select private.goods_group_snapshot(group_id) from private.goods_group_members where good_id=g.id),
  'aggregation',jsonb_build_object('goodId',g.id,'ownerGoodId',coalesce(m.root_good_id,g.id),'aggregationId',r.aggregation_id,
   'sharedPolicy',private.goods_aggregation_shared_policy(g.id),'shared',m.good_id is not null,'editable',coalesce(m.root_good_id,g.id)=g.id)) else null end
 from public.goods g left join private.goods_aggregation_members m on m.good_id=g.id
 left join private.goods_aggregation_roots r on r.root_good_id=m.root_good_id where g.id=p_good_id;
$$;
create function public.admin_get_goods_group_common(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_group private.goods_groups;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into current_group from private.goods_groups where id=p_group_id and archived_at is null;
 if not found then return null;end if;
 return jsonb_build_object('group',private.goods_group_snapshot(p_group_id),'common',private.goods_group_common_identity(current_group.common_good_id),
  'afterSales',public.admin_get_goods_after_sales_content(current_group.common_good_id),'sizeChart',public.admin_get_goods_size_chart(current_group.common_good_id));
end;
$$;

create function private.validate_goods_group_common_values(p_values jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare keys text[]:=array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
 'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords','additional_category_ids'];
begin
 if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& array['goods','attributes','afterSales','sizeChart']
  or (p_values-array['goods','attributes','afterSales','sizeChart'])<>'{}'::jsonb
  or jsonb_typeof(p_values->'goods') is distinct from 'object' or not(p_values->'goods' ?& keys) or ((p_values->'goods')-keys)<>'{}'::jsonb
  or jsonb_typeof(p_values->'attributes') is distinct from 'object'
  or jsonb_typeof(p_values->'afterSales') is distinct from 'object' or jsonb_typeof(p_values->'sizeChart') is distinct from 'object' then
  raise invalid_parameter_value using message='invalid_goods_group_common';
 end if;
end;
$$;

create function public.admin_save_goods_group_common(p_group_id uuid,p_expected_revision bigint,p_values jsonb,p_operation_id uuid,
 p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.goods_group_operations;current_group private.goods_groups;target_ids text[];lock_ids text[];target_id text;item public.goods;
 expected_hash text;before_group jsonb;before_common jsonb;after_common jsonb;individual_before jsonb;individual_after jsonb;variant_before jsonb;variant_after jsonb;
 payload jsonb;source_paths text[];attribute_revision integer;child_revision integer;child_operation uuid;result jsonb;
begin
 perform private.require_goods_group_identity(p_expected_actor_id,p_expected_session_id);
 perform private.validate_goods_group_common_values(p_values);
 if p_group_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
  raise invalid_parameter_value using message='invalid_goods_group_operation';end if;
 expected_hash:=encode(extensions.digest(jsonb_build_array('common',p_group_id,p_expected_revision,p_values)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('goods-group-operation:'||p_operation_id::text,0));
 select * into prior from private.goods_group_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id<>p_expected_actor_id or prior.session_id<>p_expected_session_id or prior.command<>'common'
   or prior.target_group_id is distinct from p_group_id or prior.expected_revision is distinct from p_expected_revision or prior.receipt is null then
   raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  if prior.receipt->>'state'='sealed' then return prior.receipt;end if;
  if prior.request_hash<>expected_hash then raise sqlstate 'PT409' using message='goods_group_operation_conflict';end if;
  return prior.receipt;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 perform private.lock_catalog_category_tree();
 select * into current_group from private.goods_groups where id=p_group_id for update;
 if not found or current_group.archived_at is not null or current_group.revision<>p_expected_revision then
  raise sqlstate 'PT409' using message='goods_group_changed';end if;
 select array_agg(good_id order by good_id) into target_ids from private.goods_group_members where group_id=p_group_id;
 if cardinality(target_ids) not between 1 and 100 or not(current_group.common_good_id=any(target_ids)) then
  raise check_violation using message='goods_group_members_invalid';end if;
 select array_agg(distinct id order by id) into lock_ids from (
  select unnest(target_ids) id union select private.goods_aggregation_owner(id) from unnest(target_ids) id) all_goods;
 -- Existing normal editors acquire admin_good advisory before their goods row.
 -- Claim those locks without waiting before owning the union of goods rows.
 foreach target_id in array lock_ids loop
  if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||target_id,0)) then raise sqlstate 'PT409' using message='goods_group_retry';end if;
  if target_id=any(target_ids) and (not pg_try_advisory_xact_lock(hashtextextended('goods-after-sales-operation:'||md5('goods-group-common-after-sales:'||p_operation_id::text||':'||target_id)::uuid::text,0))
   or not pg_try_advisory_xact_lock(hashtextextended('goods-size-operation:'||md5('goods-group-common-size:'||p_operation_id::text||':'||target_id)::uuid::text,0))) then
   raise sqlstate 'PT409' using message='goods_group_retry';end if;
 end loop;
 perform 1 from public.goods where id=any(lock_ids) order by id for update nowait;
 if exists(select 1 from public.goods where id=any(target_ids) and archived_at is not null) then raise check_violation using message='goods_group_member_unavailable';end if;
 perform 1 from public.goods_variants where good_id=any(target_ids) order by id for update nowait;
 perform 1 from public.ips where id in(select ip_id from public.goods where id=any(target_ids) union select p_values#>>'{goods,ip_id}') order by id for share nowait;
 if not exists(select 1 from public.ips where id=p_values#>>'{goods,ip_id}' and archived_at is null) then
  raise check_violation using message='catalog_parent_archived';end if;
 before_group:=private.goods_group_snapshot(p_group_id);before_common:=private.goods_group_common_identity(current_group.common_good_id);
 if exists(select 1 from unnest(target_ids) id where private.goods_group_common_identity(id) is distinct from before_common) then
  raise check_violation using message='goods_group_common_mismatch';end if;
 select jsonb_object_agg(g.id,to_jsonb(g)-array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
  'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords','published_at','updated_at','kc_disclosures']) into individual_before
 from public.goods g where id=any(target_ids);
 select jsonb_agg(to_jsonb(v) order by v.id) into variant_before from public.goods_variants v where good_id=any(target_ids);
 insert into private.goods_group_operations(operation_id,actor_id,session_id,command,target_group_id,expected_revision,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,'common',p_group_id,p_expected_revision,expected_hash);
 insert into private.goods_group_write_authorizations(transaction_id,good_id,actor_id)
 select txid_current(),id,p_expected_actor_id from unnest(target_ids) id;
 update public.goods set published_at=null where id=any(target_ids) and published_at is not null;
 -- Save and validate the common source first. Its new HTML images acquire their
 -- real single-use upload claim there before sealed copying to other members.
 for item in select * from public.goods where id=any(target_ids) order by (id=current_group.common_good_id) desc,id loop
  select coalesce(revision,0) into attribute_revision from public.goods_attribute_values where good_id=item.id;
  payload:=to_jsonb(item)||(p_values->'goods')||jsonb_build_object('previous_id',item.id,'id',item.id,'publish',false,
   'product_attributes',case when item.id=current_group.common_good_id then p_values->'attributes'
    else jsonb_set(p_values->'attributes','{expectedRevision}',to_jsonb(coalesce(attribute_revision,0))) end);
  if item.id<>current_group.common_good_id then
   insert into private.goods_artwork_copy_authorizations(transaction_id,target_good_id,source_good_id,actor_id,allowed_paths)
   values(txid_current(),item.id,current_group.common_good_id,p_expected_actor_id,
    array_remove(array[item.image_path,item.detail_image_path]||coalesce(item.gallery_paths,'{}')||coalesce(item.description_image_paths,'{}')||coalesce(source_paths,'{}'),null));
  end if;
  perform public.admin_save_good(payload);
  if item.id=current_group.common_good_id then select description_image_paths into source_paths from public.goods where id=item.id;end if;
  delete from private.goods_artwork_copy_authorizations where transaction_id=txid_current() and target_good_id=item.id and actor_id=p_expected_actor_id;
  select coalesce(revision,0) into child_revision from private.goods_after_sales_content where good_id=item.id;
  child_operation:=md5('goods-group-common-after-sales:'||p_operation_id::text||':'||item.id)::uuid;
  perform public.admin_save_goods_after_sales_content(item.id,coalesce(child_revision,0),child_operation,p_values->'afterSales');
  select coalesce(revision,0) into child_revision from private.goods_size_charts where good_id=item.id;
  child_operation:=md5('goods-group-common-size:'||p_operation_id::text||':'||item.id)::uuid;
  perform public.admin_save_goods_size_chart(item.id,coalesce(child_revision,0),child_operation,p_values->'sizeChart');
  perform private.invalidate_goods_kc_review(item.id,'goods_group_common_changed');
  update public.goods set kc_disclosures='[]' where id=item.id;
 end loop;
 after_common:=private.goods_group_common_identity(current_group.common_good_id);
 if exists(select 1 from unnest(target_ids) id where private.goods_group_common_identity(id) is distinct from after_common) then
  raise check_violation using message='goods_group_common_mismatch';end if;
 select jsonb_object_agg(g.id,to_jsonb(g)-array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
  'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords','published_at','updated_at','kc_disclosures']) into individual_after
 from public.goods g where id=any(target_ids);
 select jsonb_agg(to_jsonb(v) order by v.id) into variant_after from public.goods_variants v where good_id=any(target_ids);
 if individual_after is distinct from individual_before or variant_after is distinct from variant_before then
  raise check_violation using message='goods_group_individual_fields_changed';end if;
 update private.goods_groups set revision=revision+1,updated_at=clock_timestamp(),updated_by=p_expected_actor_id where id=p_group_id;
 result:=jsonb_build_object('state','completed','operationId',p_operation_id,'group',private.goods_group_snapshot(p_group_id));
 insert into private.goods_group_changes(group_id,operation_id,actor_id,revision,before_value,after_value)
 values(p_group_id,p_operation_id,p_expected_actor_id,p_expected_revision+1,before_group||jsonb_build_object('common',before_common),
  (result->'group')||jsonb_build_object('common',after_common));
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'catalog.goods_group.common_saved','goods_group:'||p_group_id::text,
  jsonb_build_object('before',before_common,'after',after_common,'goodIds',to_jsonb(target_ids),'allProductsUnpublished',true,'requiresKcReview',true));
 update private.goods_group_operations set receipt=result,completed_at=clock_timestamp() where operation_id=p_operation_id;
 delete from private.goods_group_write_authorizations where transaction_id=txid_current() and actor_id=p_expected_actor_id and good_id=any(target_ids);
 return result;
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;

-- Preserve an existing sealed cross-product copy authorization while the
-- normal description wrapper temporarily preserves its own old image slots.
CREATE OR REPLACE FUNCTION private.admin_save_good_before_discount_display(target_good jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          || coalesce(previous_good.gallery_paths,'{}') || coalesce(previous_good.description_image_paths,'{}'),null))
      on conflict(transaction_id,target_good_id) do nothing;
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
end $function$
;

do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['goods_group_common_public_fields','assert_goods_group_common_write','guard_goods_group_common_information','validate_goods_group_common_values']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array['admin_get_goods_group_editor_ownership','admin_get_goods_group_common','admin_save_goods_group_common']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to authenticated',fn);
 end loop;
end $$;
select private.register_operator_internal_contract('private.admin_save_good_before_discount_display(jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_goods_group_editor_ownership(text)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_get_goods_group_common(uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
