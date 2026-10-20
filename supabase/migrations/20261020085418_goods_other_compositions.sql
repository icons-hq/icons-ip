-- Independent operator-curated other compositions.
-- Existing three public relation readers and the five-key modules setting remain unchanged.
set local search_path='';
do $source_contract$ begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.goods_relation_document(uuid)'::regprocedure),'UTF8'),'sha256'),'hex')<>'9febdb2305d949e1e3c7dff54e0da331c5f3067c01e21c6c8b61ed5842b13531' then raise exception 'other_composition_source_changed: private.goods_relation_document(uuid)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.product_detail_values_valid(text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')<>'647379ebc945cb846d7df7020c08ee72f5542dcbb0c564a647014539f90f6601' then raise exception 'other_composition_source_changed: private.product_detail_values_valid(text,jsonb)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('private.validate_goods_relation_composition(jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')<>'934d5deecf682014ef427c3531fe86d7d76500145ab63702ae7e72abc843146d' then raise exception 'other_composition_source_changed: private.validate_goods_relation_composition(jsonb)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_get_product_detail_presentation()'::regprocedure),'UTF8'),'sha256'),'hex')<>'5cd078b30266da028856bd202dfaf259ff2981c78c7cacd14e76d6fefef56f0c' then raise exception 'other_composition_source_changed: public.admin_get_product_detail_presentation()';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_list_goods_relations(text,text,text,integer,integer)'::regprocedure),'UTF8'),'sha256'),'hex')<>'41b8dffe3da26673d4320ea23786a37336be48c43802c06b7d6140c49f67379e' then raise exception 'other_composition_source_changed: public.admin_list_goods_relations(text,text,text,integer,integer)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')<>'4516725ae2eb1ea4402e9f94653a672ffcc06e9546cecc4302d88ea688373fe7' then raise exception 'other_composition_source_changed: public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_save_goods_relation(uuid,integer,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')<>'ead8c0f5305b7c54a2c9795665be091fde6c9bb52fe65f106eb7cf7f813213fe' then raise exception 'other_composition_source_changed: public.admin_save_goods_relation(uuid,integer,jsonb)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid)'::regprocedure),'UTF8'),'sha256'),'hex')<>'d6257f6e0bfc7c516eefd1d8d26c0cd33bc4cd11f93113a89c67940336c3d25c' then raise exception 'other_composition_source_changed: public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_good_relation_compositions(text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'f6e70e16fa4bbb161e3635a4dc3051aae7804bbe38ec05e4f27aca5b79858ae1' then raise exception 'other_composition_source_changed: public.get_good_relation_compositions(text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_good_relations(text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'9b880c68821ef5290f3223b3278453071ec7f8ff62ac87794d05ea75addc3e60' then raise exception 'other_composition_source_changed: public.get_good_relations(text)';end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.get_product_detail_presentation(text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'c3be7f211e40d1428786cb98cb83cd172137ad15cb2df778e21b37ef99a5c4c5' then raise exception 'other_composition_source_changed: public.get_product_detail_presentation(text)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='private.validate_goods_relation_composition(jsonb)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: private.validate_goods_relation_composition(jsonb)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='private.goods_relation_document(uuid)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: private.goods_relation_document(uuid)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='public.admin_list_goods_relations(text,text,text,integer,integer)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: public.admin_list_goods_relations(text,text,text,integer,integer)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='public.admin_save_goods_relation(uuid,integer,jsonb)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: public.admin_save_goods_relation(uuid,integer,jsonb)';end if;
 if (select pg_get_userbyid(proowner) from pg_proc where oid='private.product_detail_values_valid(text,jsonb)'::regprocedure)<>'postgres' then raise exception 'other_composition_owner_changed: private.product_detail_values_valid(text,jsonb)';end if;
 if (select pg_get_userbyid(relowner) from pg_class where oid='private.product_detail_settings'::regclass)<>'postgres' then raise exception 'other_composition_table_owner_changed: private.product_detail_settings';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.product_detail_settings'::regclass and conname='product_detail_settings_section_check' and pg_get_constraintdef(oid,true)='CHECK (section = ANY (ARRAY[''banner''::text, ''modules''::text]))') then raise exception 'other_composition_constraint_changed: product_detail_settings_section_check';end if;
 if (select pg_get_userbyid(relowner) from pg_class where oid='public.goods_relation_members'::regclass)<>'postgres' then raise exception 'other_composition_table_owner_changed: public.goods_relation_members';end if;
 if (select pg_get_userbyid(relowner) from pg_class where oid='public.goods_relations'::regclass)<>'postgres' then raise exception 'other_composition_table_owner_changed: public.goods_relations';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.goods_relations'::regclass and conname='goods_relations_kind_check' and pg_get_constraintdef(oid,true)='CHECK (kind = ANY (ARRAY[''together''::text, ''similar''::text, ''codi''::text]))') then raise exception 'other_composition_constraint_changed: goods_relations_kind_check';end if;
 if to_regprocedure('public.get_good_other_compositions(text)') is not null or exists(select 1 from pg_attribute where attrelid='public.goods_relation_members'::regclass and attname='composition_label' and not attisdropped) or exists(select 1 from private.product_detail_settings where section='otherComposition') then raise exception 'other_composition_schema_changed';end if;
end $source_contract$;
set local role postgres;
alter table public.goods_relations drop constraint goods_relations_kind_check;
alter table public.goods_relations add constraint goods_relations_kind_check check(kind in ('together','similar','codi','other_composition'));
alter table public.goods_relation_members add column composition_label text;
alter table public.goods_relation_members add constraint goods_relation_members_composition_label_check check(composition_label is null or (char_length(composition_label) between 1 and 40 and composition_label=btrim(composition_label,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') and composition_label !~ '[[:cntrl:]]'));
alter table private.product_detail_settings drop constraint product_detail_settings_section_check;
alter table private.product_detail_settings add constraint product_detail_settings_section_check check(section in ('banner','modules','otherComposition'));
insert into private.product_detail_settings(section,values) values('otherComposition','{"enabled":false}');

CREATE OR REPLACE FUNCTION private.validate_goods_relation_composition(p_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare relation_kind text; visual jsonb; ids text[]; point jsonb; seen text[]:='{}'; labels_seen text[]:='{}'; label_value text; starts_value timestamptz;ends_value timestamptz;
begin
 if jsonb_typeof(p_values) is distinct from 'object'
  or not(p_values ?& array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds','visual'])
  or exists(select 1 from jsonb_object_keys(p_values) key where key<>all(array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds','visual']||case when p_values->>'kind'='other_composition' then array['compositionLabels'] else '{}'::text[] end))
  or jsonb_typeof(p_values->'kind') is distinct from 'string' or p_values->>'kind' not in ('together','similar','codi','other_composition')
  or jsonb_typeof(p_values->'title') is distinct from 'string' or char_length(btrim(p_values->>'title')) not between 1 and 15
  or jsonb_typeof(p_values->'representativeGoodId') is distinct from 'string' or jsonb_typeof(p_values->'enabled') is distinct from 'boolean'
  or jsonb_typeof(p_values->'goodIds') is distinct from 'array' or jsonb_typeof(p_values->'startsAt') not in ('null','string')
  or jsonb_typeof(p_values->'endsAt') not in ('null','string') or jsonb_typeof(p_values->'visual') not in ('null','object')
 then raise invalid_parameter_value using message='invalid_goods_relation';end if;
 relation_kind:=p_values->>'kind';visual:=nullif(p_values->'visual','null'::jsonb);
 if jsonb_array_length(p_values->'goodIds') not between 2 and (case when visual is not null or relation_kind='codi' then 5 when relation_kind='together' then 6 else 10 end)
  or exists(select 1 from jsonb_array_elements(p_values->'goodIds') item where jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,119}$')
 then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or not(p_values->>'representativeGoodId'=any(ids)) then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 begin starts_value:=(p_values->>'startsAt')::timestamptz;ends_value:=(p_values->>'endsAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_goods_relation_period';end;
 if starts_value is not null and not isfinite(starts_value) or ends_value is not null and not isfinite(ends_value)
  or starts_value is not null and ends_value is not null and starts_value>=ends_value then raise invalid_parameter_value using message='invalid_goods_relation_period';end if;
 if relation_kind='codi' and visual is null or relation_kind in ('similar','other_composition') and visual is not null then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
 if relation_kind='other_composition' then
  if btrim(p_values->>'title')<>btrim(p_values->>'title',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') or (p_values->>'title') ~ '[[:cntrl:]]' then
   raise invalid_parameter_value using message='invalid_goods_relation';end if;
  if jsonb_typeof(p_values->'compositionLabels') is distinct from 'array' or jsonb_array_length(p_values->'compositionLabels')>10 then
   raise invalid_parameter_value using message='invalid_goods_relation_composition_labels';end if;
  for point in select value from jsonb_array_elements(p_values->'compositionLabels') loop
   if jsonb_typeof(point) is distinct from 'object' or not(point ?& array['goodId','label'])
    or (select count(*) from jsonb_object_keys(point))<>2
    or jsonb_typeof(point->'goodId') is distinct from 'string' or not(point->>'goodId'=any(ids)) or point->>'goodId'=any(labels_seen)
    or jsonb_typeof(point->'label') is distinct from 'string' then
     raise invalid_parameter_value using message='invalid_goods_relation_composition_labels';end if;
   label_value:=point->>'label';
   if char_length(label_value) not between 1 and 40 or label_value<>btrim(label_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    or label_value ~ '[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_goods_relation_composition_labels';end if;
   labels_seen:=array_append(labels_seen,point->>'goodId');
  end loop;
 end if;
 if visual is null then return;end if;
 if not(visual ?& array['imagePath','alt','description','hotspots'])
  or exists(select 1 from jsonb_object_keys(visual) key where key<>all(array['imagePath','alt','description','hotspots']))
  or jsonb_typeof(visual->'imagePath') is distinct from 'string'
  or visual->>'imagePath' !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  or jsonb_typeof(visual->'alt') is distinct from 'string' or char_length(btrim(visual->>'alt')) not between 1 and 120
  or jsonb_typeof(visual->'description') is distinct from 'string' or char_length(btrim(visual->>'description'))>90
  or jsonb_typeof(visual->'hotspots') is distinct from 'array' or jsonb_array_length(visual->'hotspots')>5
 then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
 for point in select value from jsonb_array_elements(visual->'hotspots') loop
  if jsonb_typeof(point) is distinct from 'object' or not(point ?& array['goodId','x','y'])
   or exists(select 1 from jsonb_object_keys(point) key where key<>all(array['goodId','x','y']))
   or jsonb_typeof(point->'goodId') is distinct from 'string' or not(point->>'goodId'=any(ids)) or point->>'goodId'=any(seen)
   or jsonb_typeof(point->'x') is distinct from 'number' or point->>'x' !~ '^[0-9]{1,5}$'
   or jsonb_typeof(point->'y') is distinct from 'number' or point->>'y' !~ '^[0-9]{1,5}$'
  then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
  if (point->>'x')::integer>10000 or (point->>'y')::integer>10000 then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
  seen:=array_append(seen,point->>'goodId');
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.goods_relation_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'enabled',r.enabled,'startsAt',r.starts_at,'endsAt',r.ends_at,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
  'state',case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end,
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public.goods_relation_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end,
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'imagePath',g.image_path,
   'public',g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null)||case when r.kind='other_composition' then jsonb_build_object('compositionLabel',m.composition_label) else '{}'::jsonb end order by m.position)
   from public.goods_relation_members m join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id where m.relation_id=r.id),'[]'::jsonb))
 from public.goods_relations r where r.id=p_id;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_save_goods_relation_composition(p_id uuid, p_expected_revision integer, p_operation_id uuid, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();prior public.goods_relations;saved public.goods_relations;existing public.audit_log;
 request_value jsonb;result_value jsonb;before_document jsonb;visual jsonb;ids text[];bad_id text;image_value text;
begin
 perform private.require_operator_capability('catalog.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 then raise invalid_parameter_value using message='invalid_goods_relation';end if;
 perform private.validate_goods_relation_composition(p_values);
 request_value:=jsonb_build_object('expectedRevision',p_expected_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('goods-relation-operation:'||p_operation_id::text,0));
 select * into existing from public.audit_log where id=p_operation_id;
 if found then
  if existing.actor_id=actor and existing.action='admin.goods.relation.saved' and existing.target='goods_relation:'||p_id::text and existing.diff->'request'=request_value then return existing.diff->'result';end if;
  raise sqlstate 'PT409' using message='goods_relation_operation_conflict';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-relation:'||p_id::text,0));
 select * into prior from public.goods_relations where id=p_id for update;
 if found then
  if prior.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_relation_changed';end if;
  before_document:=private.goods_relation_document(p_id);
 elsif p_expected_revision<>0 then raise sqlstate 'PT409' using message='goods_relation_changed';end if;
 select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
 perform 1 from public.goods where id=any(ids) order by id for share;
 -- Retain the existing relation contract: unavailable records can remain in a
 -- composition, while both public readers independently apply visibility gates.
 select requested.id into bad_id from unnest(ids) requested(id) left join public.goods g on g.id=requested.id where g.id is null limit 1;
 if bad_id is not null then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 visual:=nullif(p_values->'visual','null'::jsonb);image_value:=visual->>'imagePath';
 if image_value is not null and image_value is distinct from prior.image_path then
  update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
  where claim.actor_id=actor and claim.kind='curation' and claim.path=substr(image_value,length('public-media/')+1)
   and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end if;
 if prior.id is null then
  insert into public.goods_relations(id,kind,title,representative_good_id,enabled,starts_at,ends_at,image_path,image_alt,description,created_by,updated_by)
  values(p_id,p_values->>'kind',btrim(p_values->>'title'),p_values->>'representativeGoodId',(p_values->>'enabled')::boolean,
   (p_values->>'startsAt')::timestamptz,(p_values->>'endsAt')::timestamptz,image_value,coalesce(btrim(visual->>'alt'),''),coalesce(btrim(visual->>'description'),''),actor,actor) returning * into saved;
 else
  update public.goods_relations set kind=p_values->>'kind',title=btrim(p_values->>'title'),representative_good_id=p_values->>'representativeGoodId',enabled=(p_values->>'enabled')::boolean,
   starts_at=(p_values->>'startsAt')::timestamptz,ends_at=(p_values->>'endsAt')::timestamptz,image_path=image_value,image_alt=coalesce(btrim(visual->>'alt'),''),description=coalesce(btrim(visual->>'description'),''),
   revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning * into saved;
 end if;
 -- Member replacement cascades old points; recreated points must target the new members.
 delete from public.goods_relation_members where relation_id=p_id;
 insert into public.goods_relation_members(relation_id,good_id,position,composition_label)
 select p_id,id,position::integer,case when p_values->>'kind'='other_composition' then
  (select entry->>'label' from jsonb_array_elements(p_values->'compositionLabels') entry where entry->>'goodId'=id) else null end
 from unnest(ids) with ordinality item(id,position);
 if visual is not null then
  insert into public.goods_relation_hotspots(relation_id,good_id,x,y) select p_id,item->>'goodId',(item->>'x')::integer,(item->>'y')::integer from jsonb_array_elements(visual->'hotspots')item;
 end if;
 result_value:=jsonb_build_object('id',p_id,'revision',saved.revision);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.relation.saved','goods_relation:'||p_id,
  jsonb_build_object('request',request_value,'before',before_document,'after',private.goods_relation_document(p_id),'result',result_value));
 return result_value;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_goods_relations(p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_state text DEFAULT 'all'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.read') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_kind is null or p_kind not in ('all','together','similar','codi','other_composition')
  or p_state is null or p_state not in ('all','active','scheduled','stopped','ended') or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
 then raise invalid_parameter_value using message='invalid_goods_relation_filter';end if;
 with matched as materialized (
  select r.*,case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end state
  from public.goods_relations r where (p_kind='all' or r.kind=p_kind) and (btrim(p_query)='' or strpos(lower(r.title),lower(btrim(p_query)))>0 or strpos(r.id::text,btrim(p_query))>0
   or exists(select 1 from public.goods_relation_members m join public.goods g on g.id=m.good_id where m.relation_id=r.id
    and (strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)))
 ),filtered as materialized(select * from matched where p_state='all' or state=p_state),page_rows as(select id,updated_at from filtered order by updated_at desc,id limit p_page_size offset(p_page-1)*p_page_size)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,'rows',coalesce((select jsonb_agg(private.goods_relation_document(id) order by updated_at desc,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_save_goods_relation(p_id uuid, p_expected_revision integer, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.require_operator_capability('catalog.manage',false);
 if jsonb_typeof(p_values) is distinct from 'object' or p_values ? 'visual' or p_values->>'kind' not in ('together','similar')
  or exists(select 1 from public.goods_relations where id=p_id and (image_path is not null or kind='other_composition')) then raise invalid_parameter_value using message='goods_relation_visual_required';end if;
 return public.admin_save_goods_relation_composition(p_id,p_expected_revision,gen_random_uuid(),p_values||'{"visual":null}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION private.product_detail_values_valid(p_section text, p_values jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare entry jsonb; start_day date; end_day date;
begin
 if jsonb_typeof(p_values) is distinct from 'object' then return false;end if;
 if p_section='otherComposition' then
  return coalesce((select count(*)=1 from jsonb_object_keys(p_values))
   and jsonb_typeof(p_values->'enabled')='boolean',false);
 end if;
 if p_section='modules' then
  return coalesce((select count(*)=5 from jsonb_object_keys(p_values))
   and p_values ?& array['reviewSummary','similar','together','categoryPopular','storePopular']
   and not exists(select 1 from jsonb_each(p_values) e where jsonb_typeof(e.value)<>'boolean'),false);
 end if;
 if p_section<>'banner' or (select count(*) from jsonb_object_keys(p_values))<>10
  or not p_values ?& array['enabled','style','title','text','periodEnabled','startsOn','endsOn','targetType','goodIds','categoryIds']
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'periodEnabled') is distinct from 'boolean'
  or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'text') is distinct from 'string'
  or jsonb_typeof(p_values->'style') is distinct from 'string' or jsonb_typeof(p_values->'targetType') is distinct from 'string'
  or p_values->>'style' not in ('light','dark') or p_values->>'targetType' not in ('all','goods','categories')
  or char_length(p_values->>'title')>10 or char_length(p_values->>'text')>20
  or (p_values->>'title') ~ '[[:cntrl:]]' or (p_values->>'text') ~ '[[:cntrl:]]'
  or (p_values->>'title')<>btrim(p_values->>'title') or (p_values->>'text')<>btrim(p_values->>'text')
  or jsonb_typeof(p_values->'goodIds') is distinct from 'array' or jsonb_typeof(p_values->'categoryIds') is distinct from 'array'
 then return false;end if;
 if jsonb_array_length(p_values->'goodIds')>200 or jsonb_array_length(p_values->'categoryIds')>10 then return false;end if;
 for entry in select value from jsonb_array_elements(p_values->'goodIds') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$' then return false;end if;
 end loop;
 for entry in select value from jsonb_array_elements(p_values->'categoryIds') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 end loop;
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'goodIds'))
  or (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'categoryIds')) then return false;end if;
 if p_values->>'targetType'<>'goods' and jsonb_array_length(p_values->'goodIds')>0
  or p_values->>'targetType'<>'categories' and jsonb_array_length(p_values->'categoryIds')>0 then return false;end if;
 if (p_values->>'periodEnabled')::boolean then
  if jsonb_typeof(p_values->'startsOn') is distinct from 'string' or jsonb_typeof(p_values->'endsOn') is distinct from 'string'
   or p_values->>'startsOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_values->>'endsOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
  begin start_day:=(p_values->>'startsOn')::date;end_day:=(p_values->>'endsOn')::date;
  exception when others then return false;end;
  if start_day<date '2000-01-01' or end_day>date '2099-12-31' or start_day>end_day then return false;end if;
 elsif p_values->'startsOn'<>'null'::jsonb or p_values->'endsOn'<>'null'::jsonb then return false;end if;
 return not (p_values->>'enabled')::boolean or (
  char_length(p_values->>'title')>0 and char_length(p_values->>'text')>0
  and (p_values->>'targetType'<>'goods' or jsonb_array_length(p_values->'goodIds')>0)
  and (p_values->>'targetType'<>'categories' or jsonb_array_length(p_values->'categoryIds')>0));
end $function$
;

create function public.get_good_other_compositions(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; enabled boolean;
begin
 if p_good_id is null or p_good_id !~ '^[a-z0-9][a-z0-9-]{0,119}$' then
  raise invalid_parameter_value using message='invalid_other_composition_good';end if;
 select (values->>'enabled')::boolean into enabled from private.product_detail_settings where section='otherComposition';
 if not coalesce(enabled,false) then return jsonb_build_object('groups','[]'::jsonb,'nextChangeAt',null);end if;
 with matching as materialized(
  select r.* from public.goods_relations r where r.kind='other_composition' and r.enabled
   and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)
 ),public_members as materialized(
  select m.relation_id,m.good_id,m.position,m.composition_label
  from public.goods_relation_members m join matching r on r.id=m.relation_id
  join public.goods g on g.id=m.good_id join public.ips ip on ip.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
   and ip.archived_at is null and ip.published_at is not null
 ),eligible as materialized(
  select r.* from matching r where exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id<>p_good_id)
 ),active as(
  select * from eligible where (starts_at is null or starts_at<=statement_timestamp())
   and (ends_at is null or ends_at>statement_timestamp())
 )
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,
  'goods',(select jsonb_agg(jsonb_build_object('goodId',m.good_id,'compositionLabel',m.composition_label) order by m.position)
   from public_members m where m.relation_id=r.id and m.good_id<>p_good_id)) order by r.created_at,r.id) from active r),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at))changes(boundary)
   where boundary>statement_timestamp())) into result;
 return result;
end $$;
revoke all on function public.get_good_other_compositions(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_other_compositions(text) to anon,authenticated,postgres;
comment on function public.get_good_other_compositions(text) is
 'Independent operator-curated public compositions. Symmetric visible-member projection, no representative visibility dependency or hidden identity, no inference, no purchases, quantities, stock or review-family effect.';
select private.register_operator_internal_contract('private.validate_goods_relation_composition(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_relation_document(uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_list_goods_relations(text,text,text,integer,integer)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_relation(uuid,integer,jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_internal_contract('private.product_detail_values_valid(text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_other_compositions(text)'::regprocedure);
reset role;
notify pgrst,'reload schema';
