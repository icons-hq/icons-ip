-- LFS 패리티 2차 L5(#570): 카테고리 메가메뉴·모바일 카테고리 시트의 데이터.
-- 1) 전시분류 노드 아이콘 이미지(기존 curation 업로드 claim 재사용) + 어드민 적용 RPC
-- 2) 공개 메뉴 RPC — 고객 카테고리 공개 스위치가 켜졌을 때 공개 전시 트리만 내려 준다.
-- 상품분류·ERP·상품 행·전시 구성 값은 바꾸지 않는다.

alter table private.category_display_nodes
 add column image_path text
 constraint category_display_nodes_image_path_check
 check (image_path is null or image_path ~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$');

-- 어드민 전시분류 목록에 노드 이미지를 더한다. 공개 페이지가 쓰는 category_display_category 결과(조회 토큰의 일부)는 그대로 둔다.
create or replace function public.admin_list_category_displays() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 return jsonb_build_object('checkedAt',statement_timestamp(),'revision',(select revision from private.category_display_tree_control where singleton),
 'categories',coalesce((with recursive tree as (
  select n.id,array[lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)] path from private.category_display_nodes n where n.parent_id is null
  union all select n.id,t.path||(lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)) from private.category_display_nodes n join tree t on n.parent_id=t.id
 ) select jsonb_agg(private.category_display_category(n.id)||jsonb_build_object('imagePath',n.image_path) order by t.path) from private.category_display_nodes n join tree t on t.id=n.id),'[]'::jsonb),
 'sourceCategories',coalesce((select jsonb_agg(private.category_display_source_category(c.id) order by c.depth,c.sort_order,c.code)
  from public.catalog_categories c where c.archived_at is null),'[]'::jsonb));
end $$;
revoke all on function public.admin_list_category_displays() from public,anon,authenticated,service_role;
grant execute on function public.admin_list_category_displays() to authenticated;

-- 노드 이미지 적용·해제. 전시분류 트리와 같은 잠금 순서(운영자 → 요청 UUID → 카테고리 트리 → 트리 revision)와
-- 같은 revision CAS·요청 UUID 멱등·감사를 쓴다. 새 이미지는 본인이 검증 완료한 curation claim만 소비한다.
create function public.admin_set_category_display_node_image(p_node_id uuid,p_image_path text,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;previous private.category_display_nodes;current_revision bigint;receipt public.audit_log;request jsonb;result jsonb;
begin
 actor:=private.require_operator_capability('store.manage',false);
 if p_node_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_image_path is not null and p_image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
 then raise invalid_parameter_value using message='invalid_display_node_image';end if;
 request:=jsonb_build_object('nodeId',p_node_id,'imagePath',p_image_path,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('category-display-operation:'||p_operation_id,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id=actor and receipt.action='admin.category_display.image_changed' and receipt.target='category-display:'||p_node_id and receipt.diff->'request'=request then return receipt.diff->'result';end if;
  raise unique_violation using message='operation_conflict';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog_category_tree',0));
 select revision into current_revision from private.category_display_tree_control where singleton for update;
 if current_revision<>p_expected_revision then raise sqlstate 'PT409' using message='category_display_tree_conflict';end if;
 select * into previous from private.category_display_nodes where id=p_node_id for update;
 if not found then raise no_data_found using message='display_node_missing';end if;
 if p_image_path is not null and p_image_path is distinct from previous.image_path then
  update public.admin_artwork_upload_claims as claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
  where claim.actor_id=actor and claim.path=substr(p_image_path,length('public-media/')+1) and claim.kind='curation'
   and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end if;
 update private.category_display_nodes set image_path=p_image_path,updated_at=clock_timestamp() where id=p_node_id;
 update private.category_display_tree_control set revision=current_revision+1 where singleton;
 result:=jsonb_build_object('nodeId',p_node_id,'directory',public.admin_list_category_displays());
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.category_display.image_changed','category-display:'||p_node_id,
  jsonb_build_object('request',request,'before',jsonb_build_object('imagePath',previous.image_path),'result',result));
 return result;
end $$;
revoke all on function public.admin_set_category_display_node_image(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_category_display_node_image(uuid,text,bigint,uuid) to authenticated;

-- 공개 메뉴(메가메뉴·모바일 카테고리 시트). 고객 카테고리 공개 스위치가 꺼져 있으면 빈 배열이다 — 셸은 기존 메뉴로 돌아간다.
-- 보관한 노드와 그 하위는 빼고, 공개 전시(켜진 구성 + 공개 상품 1개 이상)가 있는 노드와 그 조상만 트리 순서로 돌려준다.
-- 공개 전시가 없는 노드 이름은 내보내지 않는다(준비 중 분류 이름 비노출). navigable은 /shop?displayCategory 목적지가 있는지다.
create function public.get_storefront_category_menu() returns jsonb
language sql stable security definer set search_path='' as $$
 with recursive display_tree as (
  select n.id,n.parent_id,1 depth,array[lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)] path
  from private.category_display_nodes n where n.parent_id is null and n.archived_at is null
  union all select n.id,n.parent_id,t.depth+1,t.path||(lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text))
  from private.category_display_nodes n join display_tree t on n.parent_id=t.id where n.archived_at is null and t.depth<4
 ), flagged as (
  select t.id,t.parent_id,t.depth,t.path,n.name,n.image_path,
   exists(select 1 from private.category_display_compositions d where d.category_id=t.id and d.enabled
    and exists(select 1 from private.category_display_matching_goods(private.category_display_values(t.id)) limit 1)) navigable
  from display_tree t join private.category_display_nodes n on n.id=t.id
  where coalesce((select c.customer_enabled from public.category_activation_control c where c.id='catalog'),false)
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'parentId',f.parent_id,'name',f.name,'depth',f.depth,'imagePath',f.image_path,'navigable',f.navigable) order by f.path),'[]'::jsonb)
 from flagged f
 where f.navigable or exists(select 1 from flagged d where d.navigable and d.depth>f.depth and d.path[1:f.depth]=f.path);
$$;
revoke all on function public.get_storefront_category_menu() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_category_menu() to anon,authenticated;

select private.register_operator_rpc_contract('public.admin_list_category_displays()'::regprocedure,'store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_set_category_display_node_image(uuid,text,bigint,uuid)'::regprocedure,'store.manage','write',false);
select private.register_operator_internal_contract('public.get_storefront_category_menu()'::regprocedure);
