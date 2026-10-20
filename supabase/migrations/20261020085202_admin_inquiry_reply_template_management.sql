-- Preserve the existing staff-shared private-inquiry template rows and limits.
alter table public.inquiry_reply_templates
  add column category text not null default 'other' check(category in ('product','shipping','return','exchange','refund','other')),
  add column revision integer not null default 1 check(revision>0),
  add column archived_at timestamptz,
  add column updated_by uuid references public.profiles(id) on delete set null;
create index inquiry_reply_templates_category_title_idx on public.inquiry_reply_templates(category,title,id) where archived_at is null;

-- Old unversioned writers must not bypass revision checks or physically delete
-- rows that the new manager promises to restore. Their historical definitions stay.
revoke all on function public.admin_upsert_inquiry_reply_template(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_delete_inquiry_reply_template(uuid) from public,anon,authenticated,service_role;

create function private.require_inquiry_template_staff() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  perform 1 from public.profiles where id=actor and role in ('staff','admin') and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='staff_required'; end if;
  return actor;
end $$;
revoke all on function private.require_inquiry_template_staff() from public,anon,authenticated,service_role;

create function public.admin_mutate_inquiry_reply_template(p_operation_id uuid,p_template_id uuid,p_expected_revision integer,p_action text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inquiry_template_staff(); previous public.inquiry_reply_templates; saved public.inquiry_reply_templates;
  existing public.audit_log; request jsonb; receipt jsonb; title_value text; body_value text;
begin
  if p_operation_id is null or p_template_id is null or p_expected_revision is null or p_expected_revision<0
    or p_action is null or p_action not in ('save','archive','restore') or jsonb_typeof(p_values) is distinct from 'object'
  then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
  if p_action='save' then
    if not(p_values ?& array['category','title','body']) or (select count(*) from jsonb_object_keys(p_values))<>3
      or jsonb_typeof(p_values->'category') is distinct from 'string'
      or p_values->>'category' not in ('product','shipping','return','exchange','refund','other')
      or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'body') is distinct from 'string'
    then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
    title_value:=btrim(p_values->>'title',E' \t\r\n'); body_value:=btrim(p_values->>'body',E' \t\r\n');
    if char_length(title_value) not between 1 and 40 or title_value ~ '[[:cntrl:]]' or title_value !~ '[^[:space:]]'
      or char_length(body_value) not between 1 and 2000 or body_value !~ '[^[:space:]]' or translate(body_value,E'\r\n\t','') ~ '[[:cntrl:]]'
    then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
    p_values:=jsonb_build_object('category',p_values->>'category','title',title_value,'body',body_value);
  elsif p_values<>'{}'::jsonb or p_expected_revision=0 then
    raise invalid_parameter_value using message='invalid_inquiry_template';
  end if;
  request:=jsonb_build_object('templateId',p_template_id,'revision',p_expected_revision,'action',p_action,'values',p_values);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_template_operation:'||p_operation_id,0));
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.inquiry_reply_template.managed'
      and existing.target='inquiry_reply_templates:'||p_template_id and existing.diff->'request'=request then
      return existing.diff->'receipt';
    end if;
    raise exception using errcode='PT409',message='inquiry_template_operation_conflict';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_reply_template:'||p_template_id,0));
  select * into previous from public.inquiry_reply_templates where id=p_template_id for update;
  if found then
    if previous.revision<>p_expected_revision then raise exception using errcode='PT409',message='inquiry_template_changed'; end if;
    if p_action='save' then
      if previous.archived_at is not null then raise check_violation using message='inquiry_template_archived'; end if;
      if (previous.category,previous.title,previous.body)=(p_values->>'category',title_value,body_value) then saved:=previous;
      else
        update public.inquiry_reply_templates set category=p_values->>'category',title=title_value,body=body_value,
          revision=revision+1,updated_by=actor where id=p_template_id returning * into saved;
      end if;
    elsif (previous.archived_at is not null)=(p_action='archive') then saved:=previous;
    else
      update public.inquiry_reply_templates set archived_at=case when p_action='archive' then clock_timestamp() else null end,
        revision=revision+1,updated_by=actor where id=p_template_id returning * into saved;
    end if;
  else
    if p_action<>'save' then raise no_data_found using message='inquiry_template_not_found'; end if;
    if p_expected_revision<>0 then raise exception using errcode='PT409',message='inquiry_template_changed'; end if;
    insert into public.inquiry_reply_templates(id,category,title,body,created_by,updated_by)
      values(p_template_id,p_values->>'category',title_value,body_value,actor,actor) returning * into saved;
  end if;
  receipt:=jsonb_build_object('operationId',p_operation_id,'templateId',p_template_id,'action',p_action,'template',to_jsonb(saved));
  insert into public.audit_log(id,actor_id,action,target,diff)
    values(p_operation_id,actor,'admin.inquiry_reply_template.managed','inquiry_reply_templates:'||p_template_id,
      jsonb_build_object('request',request,'before',to_jsonb(previous),'receipt',receipt));
  return receipt;
end $$;
revoke all on function public.admin_mutate_inquiry_reply_template(uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_mutate_inquiry_reply_template(uuid,uuid,integer,text,jsonb) to authenticated;

create function public.admin_get_inquiry_reply_template_operation(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inquiry_template_staff(); existing public.audit_log;
begin
  if p_operation_id is null then raise invalid_parameter_value using message='invalid_inquiry_template_operation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_template_operation:'||p_operation_id,0));
  select * into existing from public.audit_log where id=p_operation_id;
  if not found then return null; end if;
  if existing.actor_id<>actor or existing.action<>'admin.inquiry_reply_template.managed' then
    raise insufficient_privilege using message='inquiry_template_operation_conflict';
  end if;
  return existing.diff->'receipt';
end $$;
revoke all on function public.admin_get_inquiry_reply_template_operation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_inquiry_reply_template_operation(uuid) to authenticated;
notify pgrst,'reload schema';
