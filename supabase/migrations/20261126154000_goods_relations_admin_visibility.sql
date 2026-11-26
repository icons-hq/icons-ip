-- 연관상품 관리 화면의 '공개' 판정을 하나로 맞춘다(어드민 화면 규칙 PR 2 · R1).
--
-- 지금까지 관리자 화면이 되읽는 구성 상품의 public은 창마다 달랐다.
--   · 상품 고르는 창(admin_search_goods_for_relation): sale_restriction='none'이어야 public — 판매 제한(19금) 상품은 늘 false
--   · 저장 뒤 편집 화면·목록(private.goods_relation_document): good_sale_restriction_visible(…, auth.uid()) — 지금 보고 있는
--     운영자가 성인 인증을 했으면 true, 아니면 false
-- 관리자 화면은 "이 상품이 공개돼 있는가"를 보여 줘야 하고, 보는 운영자에 따라 달라지면 안 된다. 두 함수 모두
-- private.goods_display_visibility(상품 보관 > IP 보관 > 상품 초안 > IP 초안 > 판매 제한 > 공개)로 판정한다.
--   · visibility: 'public' | 'restricted' | 'draft' | 'ip_draft' | 'archived' | 'ip_archived'
--   · public: 상품과 IP가 공개됐고 보관되지 않았다(visibility가 public 또는 restricted). 판매 제한 여부와 운영자의 성인 인증은 보지 않는다.
-- 화면은 restricted 상품에 '성인 인증 고객에게만'을 따로 붙인다.
--
-- 고객 화면의 조건은 바꾸지 않는다. get_good_relations·get_good_relation_compositions·get_good_other_compositions는
-- 그대로 good_sale_restriction_visible(…, auth.uid())로 성인 인증 고객에게만 판매 제한 상품을 보인다.
-- goods_relation_document는 저장 감사 기록의 before/after에도 쓰인다. 이제 그 값도 저장한 운영자의 성인 인증과 무관하다.

create or replace function private.goods_relation_document(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
 select jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'enabled',r.enabled,'startsAt',r.starts_at,'endsAt',r.ends_at,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
  'state',case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end,
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public.goods_relation_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end,
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'imagePath',g.image_path,
   'public',shown.visibility in ('public','restricted'),'visibility',shown.visibility)||case when r.kind='other_composition' then jsonb_build_object('compositionLabel',m.composition_label) else '{}'::jsonb end order by m.position)
   from public.goods_relation_members m join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
   cross join lateral (select private.goods_display_visibility(g,i.published_at is not null,i.archived_at is not null) as visibility) shown
   where m.relation_id=r.id),'[]'::jsonb))
 from public.goods_relations r where r.id=p_id;
$function$;

create or replace function public.admin_search_goods_for_relation(p_query text default ''::text, p_page integer default 1)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
    raise invalid_parameter_value using message='invalid_goods_relation_filter'; end if;
  -- 보관한 상품은 고를 수 없어 조회에서 뺀다. 초안·IP 초안·판매 제한 상품은 미리 담을 수 있게 두고 visibility로 알린다.
  with matches as materialized (
    select g.id,g.name,g.code,g.image_path,shown.visibility,shown.visibility in ('public','restricted') as is_public
    from public.goods g join public.ips i on i.id=g.ip_id
    cross join lateral (select private.goods_display_visibility(g,i.published_at is not null,i.archived_at is not null) as visibility) shown
    where g.archived_at is null and (btrim(p_query)=''
      or strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)
  ), page_rows as (select * from matches order by is_public desc,name,id limit 20 offset(p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'pageSize',20,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'imagePath',image_path,'public',is_public,'visibility',visibility)
      order by is_public desc,name,id) from page_rows),'[]'::jsonb)) into result;
  return result;
end $function$;

-- create or replace는 실행 권한을 그대로 둔다(document: postgres만, search: authenticated만). 정의가 바뀌었으니 운영자 계약 지문을 다시 등록한다.
select private.register_operator_internal_contract('private.goods_relation_document(uuid)'::regprocedure);
select private.register_operator_rpc_contract(
  'public.admin_search_goods_for_relation(text,integer)'::regprocedure, 'catalog.read', 'read', false
);
