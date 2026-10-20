-- Personal body templates: owner-scoped text and reusable formatting.
-- Personal reusable text/format templates. Images and document metadata are not
-- template properties; every application also uses its destination sanitizer.
create function private.body_template_valid_html(p_html text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_html is not null and char_length(p_html) between 1 and 30000
  and p_html !~* '<[[:space:]]*/?[[:space:]]*(img|picture|source|video|audio|iframe|object|embed|svg|math|script|style|link|meta|base|template|input)([[:space:]/>]|$)'
  and length(btrim(regexp_replace(regexp_replace(p_html,'<[^>]*>',' ','g'),
    '(&nbsp;|&#0*160;|&#x0*a0;)','','gi'),E' \t\n\r\f\v'||chr(160)))>0;
$$;
revoke all on function private.body_template_valid_html(text) from public,anon,authenticated,service_role;

create table private.admin_body_templates (
 id uuid primary key,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(name=btrim(name) and char_length(name) between 1 and 50 and name!~'[[:cntrl:]]'),
 body_html text not null check(private.body_template_valid_html(body_html)),
 revision bigint not null default 1 check(revision>0),
 archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index admin_body_templates_owner_updated_idx on private.admin_body_templates(owner_id,updated_at desc,id);
alter table private.admin_body_templates enable row level security;
revoke all on private.admin_body_templates from public,anon,authenticated,service_role;
comment on table private.admin_body_templates is
 'Personal text/format templates, 50 total per owner including archived rows. No image ownership, document title, related products or schedule. No direct client table access. Stored HTML is untrusted and destination-sanitized on every read/application.';

create function private.body_template_summary(p_row private.admin_body_templates)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'name',p_row.name,'revision',p_row.revision,
  'archivedAt',p_row.archived_at,'createdAt',p_row.created_at,'updatedAt',p_row.updated_at,
  'characterCount',char_length(p_row.body_html));
$$;
revoke all on function private.body_template_summary(private.admin_body_templates) from public,anon,authenticated,service_role;

create function private.read_body_templates(p_expected_actor_id uuid,p_capability text,p_id uuid,p_archived boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); target private.admin_body_templates;
begin
 if actor is null or p_expected_actor_id is distinct from actor then
  raise insufficient_privilege using message='body_template_actor_changed';end if;
 if not public.has_operator_capability(p_capability,false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if p_id is not null then
  select * into target from private.admin_body_templates where owner_id=actor and id=p_id;
  if not found then raise no_data_found using message='body_template_not_found';end if;
  return private.body_template_summary(target)||jsonb_build_object('bodyHtml',target.body_html);
 end if;
 if p_archived is null then raise invalid_parameter_value using message='invalid_body_template';end if;
 return jsonb_build_object('limit',50,
  'total',(select count(*) from private.admin_body_templates where owner_id=actor),
  'archivedCount',(select count(*) from private.admin_body_templates where owner_id=actor and archived_at is not null),
  'rows',(select coalesce(jsonb_agg(private.body_template_summary(t) order by t.updated_at desc,t.id),'[]'::jsonb)
    from private.admin_body_templates t where t.owner_id=actor and (t.archived_at is not null)=p_archived));
end $$;
revoke all on function private.read_body_templates(uuid,text,uuid,boolean) from public,anon,authenticated,service_role;

create function private.mutate_body_template(p_expected_actor_id uuid,p_capability text,p_operation_id uuid,
 p_id uuid,p_expected_revision bigint,p_name text,p_body_html text,p_archived boolean,p_operation text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous private.admin_body_templates; saved private.admin_body_templates;
 request jsonb; result jsonb; action text; before_revision bigint; digest text;
begin
 if actor is null or p_expected_actor_id is distinct from actor then
  raise insufficient_privilege using message='body_template_actor_changed';end if;
 perform private.require_actor_operator_capability(actor,p_capability,false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_operation not in ('save','archive') then raise invalid_parameter_value using message='invalid_body_template';end if;
 if p_operation='save' and (p_name is null or char_length(btrim(p_name)) not between 1 and 50
  or p_name~'[[:cntrl:]]' or not private.body_template_valid_html(p_body_html)) then
  raise invalid_parameter_value using message='invalid_body_template';end if;
 if p_operation='archive' and (p_archived is null or p_expected_revision<1) then
  raise invalid_parameter_value using message='invalid_body_template';end if;
 -- Audit receipts contain a fixed hash and non-content mutation metadata only.
 -- Personal names/bodies must never be copied into the shared audit log.
 digest:=encode(sha256(convert_to(jsonb_build_object('name',case when p_operation='save' then btrim(p_name) end,
  'bodyHtml',case when p_operation='save' then p_body_html end,'archived',case when p_operation='archive' then p_archived end)::text,'UTF8')),'hex');
 request:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision,'contentSha256',digest);
 action:=case when p_operation='save' then 'admin.body_template.saved' else 'admin.body_template.archived' end;
 perform pg_advisory_xact_lock(hashtextextended('body-template-operation:'||p_operation_id::text,0));
 result:=private.operator_lifecycle_replay(actor,p_operation_id,action,request);
 if result is not null then return result;end if;
 -- Serializes all surface writers for one owner, including first insertion at
 -- the quota boundary. No caller supplies the owner, including primary managers.
 perform pg_advisory_xact_lock(hashtextextended('body-template-owner:'||actor::text,0));
 select * into previous from private.admin_body_templates where owner_id=actor and id=p_id for update;
 if not found then
  if p_operation<>'save' or p_expected_revision<>0 then raise no_data_found using message='body_template_not_found';end if;
  if exists(select 1 from private.admin_body_templates where id=p_id) then raise no_data_found using message='body_template_not_found';end if;
  if (select count(*) from private.admin_body_templates where owner_id=actor)>=50 then
   raise check_violation using message='body_template_limit';end if;
  begin
   insert into private.admin_body_templates(id,owner_id,name,body_html)
    values(p_id,actor,btrim(p_name),p_body_html) returning * into saved;
  exception when unique_violation then raise no_data_found using message='body_template_not_found';end;
  before_revision:=0;
 else
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='body_template_conflict';end if;
  before_revision:=previous.revision;
  if p_operation='save' then
   update private.admin_body_templates set name=btrim(p_name),body_html=p_body_html,revision=revision+1,updated_at=clock_timestamp()
   where owner_id=actor and id=p_id returning * into saved;
  else
   update private.admin_body_templates set archived_at=case when p_archived then coalesce(previous.archived_at,clock_timestamp()) end,
    revision=revision+1,updated_at=clock_timestamp() where owner_id=actor and id=p_id returning * into saved;
  end if;
 end if;
 result:=jsonb_build_object('id',saved.id,'revision',saved.revision,'archivedAt',saved.archived_at,'updatedAt',saved.updated_at);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,action,'body-template:'||p_id::text,
  jsonb_build_object('request',request,'beforeRevision',before_revision,'result',result));
 return result;
end $$;
revoke all on function private.mutate_body_template(uuid,text,uuid,uuid,bigint,text,text,boolean,text) from public,anon,authenticated,service_role;

create function public.admin_list_goods_body_templates(p_expected_actor_id uuid,p_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return private.read_body_templates(p_expected_actor_id,'catalog.manage',null,p_archived);
end $$;
revoke all on function public.admin_list_goods_body_templates(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_body_templates(uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_list_goods_body_templates(uuid,boolean)'::regprocedure,'catalog.manage','read',false);

create function public.admin_get_goods_body_template(p_expected_actor_id uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_id is null then raise invalid_parameter_value using message='invalid_body_template';end if;
 return private.read_body_templates(p_expected_actor_id,'catalog.manage',p_id,null);
end $$;
revoke all on function public.admin_get_goods_body_template(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_body_template(uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_goods_body_template(uuid,uuid)'::regprocedure,'catalog.manage','read',false);

create function public.admin_save_goods_body_template(p_expected_actor_id uuid,p_id uuid,p_expected_revision bigint,p_operation_id uuid,p_name text,p_body_html text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 return private.mutate_body_template(p_expected_actor_id,'catalog.manage',p_operation_id,p_id,p_expected_revision,p_name,p_body_html,null,'save');
end $$;
revoke all on function public.admin_save_goods_body_template(uuid,uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_body_template(uuid,uuid,bigint,uuid,text,text) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_goods_body_template(uuid,uuid,bigint,uuid,text,text)'::regprocedure,'catalog.manage','write',false);

create function public.admin_archive_goods_body_template(p_expected_actor_id uuid,p_id uuid,p_expected_revision bigint,p_operation_id uuid,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 return private.mutate_body_template(p_expected_actor_id,'catalog.manage',p_operation_id,p_id,p_expected_revision,null,null,p_archived,'archive');
end $$;
revoke all on function public.admin_archive_goods_body_template(uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_goods_body_template(uuid,uuid,bigint,uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_archive_goods_body_template(uuid,uuid,bigint,uuid,boolean)'::regprocedure,'catalog.manage','write',false);

create function public.admin_list_story_body_templates(p_expected_actor_id uuid,p_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return private.read_body_templates(p_expected_actor_id,'store.manage',null,p_archived);
end $$;
revoke all on function public.admin_list_story_body_templates(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_story_body_templates(uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_list_story_body_templates(uuid,boolean)'::regprocedure,'store.manage','read',false);

create function public.admin_get_story_body_template(p_expected_actor_id uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_id is null then raise invalid_parameter_value using message='invalid_body_template';end if;
 return private.read_body_templates(p_expected_actor_id,'store.manage',p_id,null);
end $$;
revoke all on function public.admin_get_story_body_template(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_story_body_template(uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_story_body_template(uuid,uuid)'::regprocedure,'store.manage','read',false);

create function public.admin_save_story_body_template(p_expected_actor_id uuid,p_id uuid,p_expected_revision bigint,p_operation_id uuid,p_name text,p_body_html text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 return private.mutate_body_template(p_expected_actor_id,'store.manage',p_operation_id,p_id,p_expected_revision,p_name,p_body_html,null,'save');
end $$;
revoke all on function public.admin_save_story_body_template(uuid,uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_story_body_template(uuid,uuid,bigint,uuid,text,text) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_story_body_template(uuid,uuid,bigint,uuid,text,text)'::regprocedure,'store.manage','write',false);

create function public.admin_archive_story_body_template(p_expected_actor_id uuid,p_id uuid,p_expected_revision bigint,p_operation_id uuid,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 return private.mutate_body_template(p_expected_actor_id,'store.manage',p_operation_id,p_id,p_expected_revision,null,null,p_archived,'archive');
end $$;
revoke all on function public.admin_archive_story_body_template(uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_story_body_template(uuid,uuid,bigint,uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_archive_story_body_template(uuid,uuid,bigint,uuid,boolean)'::regprocedure,'store.manage','write',false);

select private.register_operator_internal_contract('private.body_template_valid_html(text)'::regprocedure);
select private.register_operator_internal_contract('private.body_template_summary(private.admin_body_templates)'::regprocedure);
select private.register_operator_internal_contract('private.read_body_templates(uuid,text,uuid,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.mutate_body_template(uuid,text,uuid,uuid,bigint,text,text,boolean,text)'::regprocedure);
notify pgrst,'reload schema';
