-- Operational A/S contact and seller notes, separate from statutory notice fields.
create table private.goods_after_sales_content (
 good_id text primary key references public.goods(id) on update cascade on delete restrict,
 phone text not null check(char_length(phone)<=20 and phone!~'[[:cntrl:]]'),
 guide text not null check(char_length(guide)<=1300 and translate(guide,E'\n\t','')!~'[[:cntrl:]]'),
 seller_special_notes text not null default '' check(char_length(seller_special_notes)<=1300 and translate(seller_special_notes,E'\n\t','')!~'[[:cntrl:]]'),
 check((phone='' and guide='' and seller_special_notes='') or (phone<>'' and guide<>'')),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id)
);
create table private.goods_after_sales_templates (
 id uuid primary key,
 phone text not null check(char_length(phone) between 1 and 20 and phone!~'[[:cntrl:]]'),
 guide text not null check(char_length(guide) between 1 and 1300 and translate(guide,E'\n\t','')!~'[[:cntrl:]]'),
 seller_special_notes text not null default '' check(char_length(seller_special_notes)<=1300 and translate(seller_special_notes,E'\n\t','')!~'[[:cntrl:]]'),
 revision integer not null default 1 check(revision>0),archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id)
);
alter table private.goods_after_sales_content enable row level security;
alter table private.goods_after_sales_templates enable row level security;
revoke all on private.goods_after_sales_content,private.goods_after_sales_templates from public,anon,authenticated,service_role;

create function private.validate_goods_after_sales_values(p_values jsonb,p_allow_empty boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare phone_value text;guide_value text;notes_value text;
begin
 if p_values is null or jsonb_typeof(p_values)<>'object'
  or not p_values ?& array['phone','guide','sellerSpecialNotes'] or p_values-array['phone','guide','sellerSpecialNotes']<>'{}'::jsonb
  or jsonb_typeof(p_values->'phone')<>'string' or jsonb_typeof(p_values->'guide')<>'string' or jsonb_typeof(p_values->'sellerSpecialNotes')<>'string' then
  raise invalid_parameter_value using message='invalid_goods_after_sales';end if;
 phone_value:=btrim(p_values->>'phone',E' \n\r\t');
 guide_value:=btrim(replace(replace(p_values->>'guide',E'\r\n',E'\n'),E'\r',E'\n'),E' \n\t');
 notes_value:=btrim(replace(replace(p_values->>'sellerSpecialNotes',E'\r\n',E'\n'),E'\r',E'\n'),E' \n\t');
 if p_allow_empty and phone_value='' and guide_value='' and notes_value='' then return jsonb_build_object('phone','','guide','','sellerSpecialNotes','');end if;
 if char_length(phone_value) not between 1 and 20 or phone_value~'[[:cntrl:]]'
  or char_length(guide_value) not between 1 and 1300 or translate(guide_value,E'\n\t','')~'[[:cntrl:]]'
  or char_length(notes_value)>1300 or translate(notes_value,E'\n\t','')~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_goods_after_sales';end if;
 return jsonb_build_object('phone',phone_value,'guide',guide_value,'sellerSpecialNotes',notes_value);
end $$;
revoke all on function private.validate_goods_after_sales_values(jsonb,boolean) from public,anon,authenticated,service_role;

create function private.goods_after_sales_document(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'goodName',g.name,'phone',coalesce(a.phone,''),'guide',coalesce(a.guide,''),
 'sellerSpecialNotes',coalesce(a.seller_special_notes,''),'revision',coalesce(a.revision,0),'updatedAt',a.updated_at)
 from public.goods g left join private.goods_after_sales_content a on a.good_id=g.id where g.id=p_good_id;
$$;
revoke all on function private.goods_after_sales_document(text) from public,anon,authenticated,service_role;

create function public.admin_get_goods_after_sales_content(p_good_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.goods_after_sales_document(p_good_id);
end $$;
revoke all on function public.admin_get_goods_after_sales_content(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_after_sales_content(text) to authenticated;

create function public.admin_save_goods_after_sales_content(p_good_id text,p_expected_revision integer,p_operation_id uuid,p_values jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_after_sales_content;request jsonb;receipt jsonb;values_doc jsonb;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_good_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_goods_after_sales';end if;
 values_doc:=private.validate_goods_after_sales_values(p_values,true);
 request:=jsonb_build_object('goodId',p_good_id,'expectedRevision',p_expected_revision,'values',values_doc);
 perform pg_advisory_xact_lock(hashtextextended('goods-after-sales-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.after_sales.saved',request);if receipt is not null then return receipt;end if;
 perform 1 from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_not_found';end if;
 select * into previous from private.goods_after_sales_content where good_id=p_good_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='goods_after_sales_changed';end if;
 insert into private.goods_after_sales_content(good_id,phone,guide,seller_special_notes,updated_by)
 values(p_good_id,values_doc->>'phone',values_doc->>'guide',values_doc->>'sellerSpecialNotes',actor)
 on conflict(good_id) do update set phone=excluded.phone,guide=excluded.guide,seller_special_notes=excluded.seller_special_notes,
 revision=goods_after_sales_content.revision+1,updated_at=clock_timestamp(),updated_by=actor;
 receipt:=private.goods_after_sales_document(p_good_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.after_sales.saved','goods:'||p_good_id,
 jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_goods_after_sales_content(text,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_after_sales_content(text,integer,uuid,jsonb) to authenticated;

create function public.get_good_after_sales_content(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('phone',a.phone,'guide',a.guide,'sellerSpecialNotes',a.seller_special_notes)
 from private.goods_after_sales_content a join public.goods g on g.id=a.good_id join public.ips i on i.id=g.ip_id
 where a.phone<>'' and g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
 and i.archived_at is null and i.published_at is not null;
$$;
revoke all on function public.get_good_after_sales_content(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_after_sales_content(text) to anon,authenticated;

create function public.admin_list_goods_after_sales_templates(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_archived is null or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_after_sales_template_search';end if;
 with filtered as materialized (select * from private.goods_after_sales_templates where (archived_at is not null)=p_archived and strpos(lower(phone||' '||guide||' '||seller_special_notes),lower(btrim(p_query)))>0),
 page as(select * from filtered order by created_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'phone',phone,'guide',guide,'sellerSpecialNotes',seller_special_notes,'revision',revision,'archived',archived_at is not null,'createdAt',created_at) order by created_at desc,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_list_goods_after_sales_templates(text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_after_sales_templates(text,boolean,integer) to authenticated;

create function public.admin_save_goods_after_sales_template(p_id uuid,p_values jsonb,p_archived boolean,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_after_sales_templates;request jsonb;receipt jsonb;saved private.goods_after_sales_templates;values_doc jsonb;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_id is null or p_archived is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_goods_after_sales_template';end if;
 values_doc:=private.validate_goods_after_sales_values(p_values);
 request:=jsonb_build_object('id',p_id,'values',values_doc,'archived',p_archived,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-after-sales-template-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.after_sales_template.saved',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-after-sales-template:'||p_id::text,0));
 select * into previous from private.goods_after_sales_templates where id=p_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision or (previous.id is null and p_archived) then raise sqlstate 'PT409' using message='goods_after_sales_template_changed';end if;
 insert into private.goods_after_sales_templates(id,phone,guide,seller_special_notes,updated_by)
 values(p_id,values_doc->>'phone',values_doc->>'guide',values_doc->>'sellerSpecialNotes',actor)
 on conflict(id) do update set phone=excluded.phone,guide=excluded.guide,seller_special_notes=excluded.seller_special_notes,
 archived_at=case when p_archived then coalesce(goods_after_sales_templates.archived_at,clock_timestamp()) else null end,
 revision=goods_after_sales_templates.revision+1,updated_at=clock_timestamp(),updated_by=actor returning * into saved;
 receipt:=jsonb_build_object('id',saved.id,'phone',saved.phone,'guide',saved.guide,'sellerSpecialNotes',saved.seller_special_notes,
 'revision',saved.revision,'archived',saved.archived_at is not null,'createdAt',saved.created_at);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.after_sales_template.saved','goods_after_sales_template:'||p_id,
 jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));return receipt;
end $$;
revoke all on function public.admin_save_goods_after_sales_template(uuid,jsonb,boolean,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_after_sales_template(uuid,jsonb,boolean,integer,uuid) to authenticated;

create function private.clone_goods_after_sales_content(p_source text,p_target text,p_actor uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if p_actor is distinct from auth.uid() or p_source=p_target then raise insufficient_privilege using message='operator_capability_required';end if;
 perform private.require_actor_operator_capability(p_actor,'catalog.manage');
 perform 1 from public.goods where id=p_source for share;
 if not found then raise no_data_found using message='good_not_found';end if;
 perform 1 from public.goods where id=p_target and published_at is null and archived_at is null for update;
 if not found then raise check_violation using message='goods_after_sales_clone_target_invalid';end if;
 insert into private.goods_after_sales_content(good_id,phone,guide,seller_special_notes,updated_by)
 select p_target,phone,guide,seller_special_notes,p_actor from private.goods_after_sales_content where good_id=p_source;
end $$;
revoke all on function private.clone_goods_after_sales_content(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.clone_goods_after_sales_content(text,text,uuid) to postgres;

-- The established clone stays owned by postgres; this helper owns access to the new table.
do $$ declare body text;anchor text:=E'  -- Stopped non-default rows are historical configuration, not rows of the';begin
 body:=pg_get_functiondef('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'goods_after_sales_clone_anchor_missing';end if;
 body:=replace(body,anchor,$clone$
  perform private.clone_goods_after_sales_content(source_good.id,saved_id,actor_id);
$clone$||anchor);execute body;
end $$;
select private.register_operator_internal_contract('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
select private.register_operator_internal_contract('private.clone_goods_after_sales_content(text,text,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.validate_goods_after_sales_values(jsonb,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.goods_after_sales_document(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_after_sales_content(text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_goods_after_sales_content(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_after_sales_content(text,integer,uuid,jsonb)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_list_goods_after_sales_templates(text,boolean,integer)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_after_sales_template(uuid,jsonb,boolean,integer,uuid)'::regprocedure,'catalog.manage','manual',false);
notify pgrst,'reload schema';
