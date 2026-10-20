-- Informational product benefits and reusable event wording.
create table private.goods_benefit_content (
 good_id text primary key references public.goods(id) on update cascade on delete restrict,
 event_text text not null default '' check(char_length(event_text)<=40 and event_text!~'[[:cntrl:]]'),
 gift_text text not null default '' check(char_length(gift_text)<=100 and gift_text!~'[[:cntrl:]]'),
 gift_image_paths text[] not null default '{}' check(cardinality(gift_image_paths)<=3 and array_position(gift_image_paths,null) is null),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id),
 check(cardinality(gift_image_paths)=0 or length(btrim(gift_text))>0)
);
create table private.goods_event_templates (
 id uuid primary key,event_text text not null check(char_length(btrim(event_text)) between 1 and 40 and event_text!~'[[:cntrl:]]'),
 revision integer not null default 1 check(revision>0),archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id)
);
alter table private.goods_benefit_content enable row level security;
alter table private.goods_event_templates enable row level security;
revoke all on private.goods_benefit_content,private.goods_event_templates from public,anon,authenticated,service_role;

create function private.goods_benefit_document(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'goodName',g.name,'eventText',coalesce(b.event_text,''),'giftText',coalesce(b.gift_text,''),
 'giftImagePaths',coalesce(to_jsonb(b.gift_image_paths),'[]'::jsonb),'revision',coalesce(b.revision,0),'updatedAt',b.updated_at)
 from public.goods g left join private.goods_benefit_content b on b.good_id=g.id where g.id=p_good_id;
$$;
revoke all on function private.goods_benefit_document(text) from public,anon,authenticated,service_role;

create function public.admin_get_goods_benefit_content(p_good_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.goods_benefit_document(p_good_id);
end $$;
revoke all on function public.admin_get_goods_benefit_content(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_benefit_content(text) to authenticated;

create function public.admin_save_goods_benefit_content(p_good_id text,p_expected_revision integer,p_operation_id uuid,p_values jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_benefit_content;request jsonb;receipt jsonb;images text[];candidate text;event_value text;gift_value text;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_good_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null or p_values is null or jsonb_typeof(p_values)<>'object'
  or not p_values ?& array['eventText','giftText','giftImagePaths'] or p_values-array['eventText','giftText','giftImagePaths']<>'{}'::jsonb
  or jsonb_typeof(p_values->'eventText')<>'string' or jsonb_typeof(p_values->'giftText')<>'string' or jsonb_typeof(p_values->'giftImagePaths')<>'array' then
  raise invalid_parameter_value using message='invalid_goods_benefit_content';end if;
 event_value:=btrim(p_values->>'eventText');gift_value:=btrim(p_values->>'giftText');
 if char_length(event_value)>40 or char_length(gift_value)>100 or event_value~'[[:cntrl:]]' or gift_value~'[[:cntrl:]]'
  or jsonb_array_length(p_values->'giftImagePaths')>3 or exists(select 1 from jsonb_array_elements(p_values->'giftImagePaths') path where jsonb_typeof(path)<>'string') then
  raise invalid_parameter_value using message='invalid_goods_benefit_content';end if;
 select coalesce(array_agg(value order by position),'{}') into images from jsonb_array_elements_text(p_values->'giftImagePaths') with ordinality paths(value,position);
 if cardinality(images)<>(select count(distinct value) from unnest(images) value) or (cardinality(images)>0 and gift_value='')
  or exists(select 1 from unnest(images) path where path!~'^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$') then
  raise invalid_parameter_value using message='invalid_goods_benefit_images';end if;
 request:=jsonb_build_object('goodId',p_good_id,'expectedRevision',p_expected_revision,'eventText',event_value,'giftText',gift_value,'giftImagePaths',images);
 perform pg_advisory_xact_lock(hashtextextended('goods-benefit-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.benefits.saved',request);if receipt is not null then return receipt;end if;
 perform 1 from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_not_found';end if;
 select * into previous from private.goods_benefit_content where good_id=p_good_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='goods_benefits_changed';end if;
 -- Photo library archive takes the same row before checking all product references.
 for candidate in select value from unnest(images) value order by value loop
  continue when candidate=any(coalesce(previous.gift_image_paths,'{}'));
  if private.can_reuse_shared_goods_artwork(candidate) then continue;end if;
  update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
   where claim.actor_id=actor and claim.kind='good' and claim.path=substr(candidate,length('public-media/')+1)
    and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end loop;
 insert into private.goods_benefit_content(good_id,event_text,gift_text,gift_image_paths,updated_by) values(p_good_id,event_value,gift_value,images,actor)
 on conflict(good_id) do update set event_text=excluded.event_text,gift_text=excluded.gift_text,gift_image_paths=excluded.gift_image_paths,
 revision=goods_benefit_content.revision+1,updated_at=clock_timestamp(),updated_by=actor;
 receipt:=private.goods_benefit_document(p_good_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.benefits.saved','goods:'||p_good_id,
 jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_goods_benefit_content(text,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_benefit_content(text,integer,uuid,jsonb) to authenticated;

create function public.get_good_benefit_content(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('eventText',b.event_text,'giftText',b.gift_text,'giftImagePaths',b.gift_image_paths)
 from private.goods_benefit_content b join public.goods g on g.id=b.good_id join public.ips i on i.id=g.ip_id
 where g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
 and i.archived_at is null and i.published_at is not null;
$$;
revoke all on function public.get_good_benefit_content(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_benefit_content(text) to anon,authenticated;

create function public.admin_list_goods_event_templates(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_archived is null or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_event_template_search';end if;
 with filtered as materialized (select * from private.goods_event_templates where (archived_at is not null)=p_archived and strpos(lower(event_text),lower(btrim(p_query)))>0),
 page as(select * from filtered order by created_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'eventText',event_text,'revision',revision,'archived',archived_at is not null,'createdAt',created_at) order by created_at desc,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_list_goods_event_templates(text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_event_templates(text,boolean,integer) to authenticated;

create function public.admin_save_goods_event_template(p_id uuid,p_event_text text,p_archived boolean,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_event_templates;request jsonb;receipt jsonb;saved private.goods_event_templates;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_id is null or p_event_text is null or char_length(btrim(p_event_text)) not between 1 and 40 or p_event_text~'[[:cntrl:]]'
  or p_archived is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_goods_event_template';end if;
 request:=jsonb_build_object('id',p_id,'eventText',btrim(p_event_text),'archived',p_archived,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-event-template-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.event_template.saved',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-event-template:'||p_id::text,0));
 select * into previous from private.goods_event_templates where id=p_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision or (previous.id is null and p_archived) then raise sqlstate 'PT409' using message='goods_event_template_changed';end if;
 insert into private.goods_event_templates(id,event_text,updated_by) values(p_id,btrim(p_event_text),actor)
 on conflict(id) do update set event_text=excluded.event_text,archived_at=case when p_archived then coalesce(goods_event_templates.archived_at,clock_timestamp()) else null end,
 revision=goods_event_templates.revision+1,updated_at=clock_timestamp(),updated_by=actor returning * into saved;
 receipt:=jsonb_build_object('id',saved.id,'eventText',saved.event_text,'revision',saved.revision,'archived',saved.archived_at is not null,'createdAt',saved.created_at);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.event_template.saved','goods_event_template:'||p_id,
 jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));return receipt;
end $$;
revoke all on function public.admin_save_goods_event_template(uuid,text,boolean,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_event_template(uuid,text,boolean,integer,uuid) to authenticated;

create function private.goods_benefit_has_photo(p_good_id text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.goods_benefit_content where good_id=p_good_id and p_path=any(gift_image_paths));
$$;
revoke all on function private.goods_benefit_has_photo(text,text) from public,anon,authenticated,service_role;
grant execute on function private.goods_benefit_has_photo(text,text) to postgres;
select private.register_operator_internal_contract('private.goods_benefit_has_photo(text,text)'::regprocedure);

-- Keep the existing exact reference list and include the gift-image surface.
do $$ declare body text;anchor text:='where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,''{}'')||coalesce(g.description_image_paths,''{}''),null))';begin
 body:=pg_get_functiondef('private.goods_photo_references(text)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'goods_benefit_reference_anchor_missing';end if;
 body:=replace(body,anchor,anchor||' or private.goods_benefit_has_photo(g.id,target_path)');execute body;
end $$;

-- The established clone is owned by postgres. Keep new-table access inside a
-- definer helper owned by this migration actor; never grant direct table DML.
create function private.clone_goods_benefit_content(p_source text,p_target text,p_actor uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if p_actor is distinct from auth.uid() or p_source=p_target then raise insufficient_privilege using message='operator_capability_required';end if;
 perform private.require_actor_operator_capability(p_actor,'catalog.manage');
 perform 1 from public.goods where id=p_source for share;
 if not found then raise no_data_found using message='good_not_found';end if;
 perform 1 from public.goods where id=p_target and published_at is null and archived_at is null for update;
 if not found then raise check_violation using message='goods_benefit_clone_target_invalid';end if;
 insert into private.goods_benefit_content(good_id,event_text,gift_text,gift_image_paths,updated_by)
  select p_target,event_text,gift_text,gift_image_paths,p_actor from private.goods_benefit_content where good_id=p_source;
end $$;
revoke all on function private.clone_goods_benefit_content(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.clone_goods_benefit_content(text,text,uuid) to postgres;
select private.register_operator_internal_contract('private.clone_goods_benefit_content(text,text,uuid)'::regprocedure);

-- The clone writer holds the source good lock and creates an unpublished target.
do $$ declare body text;anchor text:=E'  -- Stopped non-default rows are historical configuration, not rows of the';begin
 body:=pg_get_functiondef('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'goods_benefit_clone_anchor_missing';end if;
 body:=replace(body,anchor,$clone$
  perform private.clone_goods_benefit_content(source_good.id,saved_id,actor_id);
$clone$||anchor);execute body;
end $$;
select private.register_operator_internal_contract('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);

select private.register_operator_rpc_contract('public.admin_get_goods_benefit_content(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_benefit_content(text,integer,uuid,jsonb)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_list_goods_event_templates(text,boolean,integer)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_event_template(uuid,text,boolean,integer,uuid)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_internal_contract('private.goods_benefit_document(text)'::regprocedure);
select private.register_operator_internal_contract('private.goods_photo_references(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_benefit_content(text)'::regprocedure);
notify pgrst,'reload schema';
