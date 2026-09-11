-- Internal ownership and evidence references for the operations settings hub.
-- Blank fields remain unset information, never a handoff/sales activation gate.
create table private.operations_contacts (
  scope text not null check (scope in ('operations', 'origin')),
  origin_id uuid references public.fulfillment_origins(id) on delete restrict,
  owner_name text not null default '' check (
    char_length(owner_name) <= 100 and owner_name = btrim(owner_name) and owner_name !~ '[[:cntrl:]]'
  ),
  contact text not null default '' check (
    char_length(contact) <= 200 and contact = btrim(contact) and contact !~ '[[:cntrl:]]'
  ),
  source_reference text not null default '' check (
    char_length(source_reference) <= 500 and source_reference = btrim(source_reference) and source_reference !~ '[[:cntrl:]]'
  ),
  handoff_reference text not null default '' check (
    char_length(handoff_reference) <= 500 and handoff_reference = btrim(handoff_reference) and handoff_reference !~ '[[:cntrl:]]'
  ),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  constraint operations_contacts_scope_origin_check check (
    (scope = 'operations' and origin_id is null) or (scope = 'origin' and origin_id is not null)
  ),
  constraint operations_contacts_scope_origin_key unique nulls not distinct (scope, origin_id)
);
alter table private.operations_contacts enable row level security;
revoke all on table private.operations_contacts from public, anon, authenticated, service_role;
comment on table private.operations_contacts is '운영 담당자와 내부 자료·인수 참고값. 미입력 허용; 실제 인수 완료·판매 활성화·정산 근거를 자동 판정하지 않음';

create function public.admin_operations_contacts()
returns table (
  scope text, origin_id uuid, origin_name text, origin_active boolean,
  owner_name text, contact text, source_reference text, handoff_reference text,
  updated_at timestamptz, updated_by_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return query
  with targets as (
    select 'operations'::text as scope, null::uuid as origin_id,
      null::text as origin_name, null::boolean as origin_active
    union all
    select 'origin'::text, origin.id, origin.name, origin.is_active
      from public.fulfillment_origins origin
  )
  select target.scope, target.origin_id, target.origin_name, target.origin_active,
    coalesce(saved.owner_name, ''), coalesce(saved.contact, ''),
    coalesce(saved.source_reference, ''), coalesce(saved.handoff_reference, ''),
    saved.updated_at,
    case when saved.updated_by is null then null
      else coalesce(nullif(editor.nickname, ''), '관리자') end
  from targets target
  left join private.operations_contacts saved on saved.scope = target.scope
    and saved.origin_id is not distinct from target.origin_id
  left join public.profiles editor on editor.id = saved.updated_by
  order by (target.scope = 'operations') desc, target.origin_name, target.origin_id;
end;
$$;
revoke all on function public.admin_operations_contacts() from public, anon, authenticated, service_role;
grant execute on function public.admin_operations_contacts() to authenticated;

create function public.admin_save_operations_contact(
  target_scope text, target_origin_id uuid, target_values jsonb, expected_updated_at timestamptz
)
returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous private.operations_contacts;
  has_previous boolean;
  owner_value text;
  contact_value text;
  source_value text;
  handoff_value text;
  saved_at timestamptz;
  changed_fields text[];
  audit_target text;
begin
  if actor_id is null or not public.is_staff()
    or not exists (select 1 from public.profiles profile where profile.id = actor_id and profile.role = 'admin') then
    raise insufficient_privilege using message = 'admin_required';
  end if;
  if target_scope is null or target_scope not in ('operations', 'origin')
    or (target_scope = 'operations' and target_origin_id is not null)
    or (target_scope = 'origin' and target_origin_id is null) then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  if jsonb_typeof(target_values) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  if not (target_values ?& array['ownerName', 'contact', 'sourceReference', 'handoffReference'])
    or exists (select 1 from jsonb_object_keys(target_values) supplied_key
      where supplied_key not in ('ownerName', 'contact', 'sourceReference', 'handoffReference'))
    or exists (select 1 from jsonb_each(target_values) field
      where jsonb_typeof(field.value) is distinct from 'string' or (field.value #>> '{}') ~ '[[:cntrl:]]') then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  owner_value := btrim(target_values ->> 'ownerName');
  contact_value := btrim(target_values ->> 'contact');
  source_value := btrim(target_values ->> 'sourceReference');
  handoff_value := btrim(target_values ->> 'handoffReference');
  if char_length(owner_value) > 100 or char_length(contact_value) > 200
    or char_length(source_value) > 500 or char_length(handoff_value) > 500 then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;

  audit_target := 'operations_contact:' || target_scope
    || case when target_origin_id is null then '' else ':' || target_origin_id::text end;
  -- Serialize even the first save, when SELECT FOR UPDATE has no row to lock.
  perform pg_advisory_xact_lock(hashtextextended(audit_target, 0));
  if target_scope = 'origin' then
    perform 1 from public.fulfillment_origins origin where origin.id = target_origin_id for key share;
    if not found then
      raise no_data_found using message = 'operations_contact_origin_not_found';
    end if;
  end if;
  select saved.* into previous from private.operations_contacts saved
    where saved.scope = target_scope and saved.origin_id is not distinct from target_origin_id for update;
  has_previous := found;
  if (case when has_previous then previous.updated_at else null::timestamptz end)
    is distinct from expected_updated_at then
    raise sqlstate 'PT409' using message = 'operations_contact_changed';
  end if;
  if has_previous and previous.owner_name = owner_value and previous.contact = contact_value
    and previous.source_reference = source_value and previous.handoff_reference = handoff_value then
    return previous.updated_at;
  end if;

  changed_fields := array_remove(array[
    case when previous.owner_name is distinct from owner_value then 'ownerName' end,
    case when previous.contact is distinct from contact_value then 'contact' end,
    case when previous.source_reference is distinct from source_value then 'sourceReference' end,
    case when previous.handoff_reference is distinct from handoff_value then 'handoffReference' end
  ], null);
  saved_at := case when has_previous
    then greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    else clock_timestamp() end;
  begin
    if has_previous then
      update private.operations_contacts saved set
        owner_name = owner_value, contact = contact_value, source_reference = source_value,
        handoff_reference = handoff_value, updated_by = actor_id, updated_at = saved_at
      where saved.scope = target_scope and saved.origin_id is not distinct from target_origin_id;
    else
      insert into private.operations_contacts(scope, origin_id, owner_name, contact, source_reference,
        handoff_reference, updated_by, updated_at)
      values(target_scope, target_origin_id, owner_value, contact_value, source_value,
        handoff_value, actor_id, saved_at);
    end if;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'operations_contact_changed';
  end;
  insert into public.audit_log(actor_id, action, target, diff, created_at)
  values(actor_id, 'admin.operations_contact.updated', audit_target,
    jsonb_build_object('scope', target_scope, 'originId', target_origin_id,
      'changedFields', changed_fields, 'previousVersion', previous.updated_at, 'updatedAt', saved_at), saved_at);
  return saved_at;
end;
$$;
revoke all on function public.admin_save_operations_contact(text, uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_operations_contact(text, uuid, jsonb, timestamptz) to authenticated;

create index audit_log_operations_contacts_idx on public.audit_log(created_at desc, id desc)
  where action = 'admin.operations_contact.updated';

create function public.admin_operations_contact_history(row_limit integer default 30)
returns table (
  id uuid, actor_name text, scope text, origin_name text, changed_fields text[], created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if row_limit is null or row_limit not between 1 and 50 then
    raise invalid_parameter_value using message = 'invalid_operations_contact_history_limit';
  end if;
  return query
  select audit.id, coalesce(nullif(actor.nickname, ''), '관리자'), audit.diff ->> 'scope', origin.name,
    array(select jsonb_array_elements_text(audit.diff -> 'changedFields')), audit.created_at
  from public.audit_log audit
  left join public.profiles actor on actor.id = audit.actor_id
  left join public.fulfillment_origins origin on origin.id = (audit.diff ->> 'originId')::uuid
  where audit.action = 'admin.operations_contact.updated'
  order by audit.created_at desc, audit.id desc limit row_limit;
end;
$$;
revoke all on function public.admin_operations_contact_history(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_operations_contact_history(integer) to authenticated;
notify pgrst, 'reload schema';
