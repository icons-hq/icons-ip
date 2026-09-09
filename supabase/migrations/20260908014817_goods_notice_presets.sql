-- #424: named goods-notice templates. Applying a template copies all seven values;
-- it never links existing goods to a live template (#442 owns the goods form).
create table public.goods_notice_presets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name, E' \t\n\r\f\v')),
  maker text not null check (char_length(maker) between 1 and 1000 and maker ~ '[^[:space:]]'),
  origin text not null check (char_length(origin) between 1 and 1000 and origin ~ '[^[:space:]]'),
  material text not null check (char_length(material) between 1 and 1000 and material ~ '[^[:space:]]'),
  size text not null check (char_length(size) between 1 and 1000 and size ~ '[^[:space:]]'),
  made_on text not null check (char_length(made_on) between 1 and 1000 and made_on ~ '[^[:space:]]'),
  as_manager text not null check (char_length(as_manager) between 1 and 1000 and as_manager ~ '[^[:space:]]'),
  as_contact text not null check (char_length(as_contact) between 1 and 1000 and as_contact ~ '[^[:space:]]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Excel's preset-name column must identify one template unambiguously.
create unique index goods_notice_presets_name_unique on public.goods_notice_presets(lower(name));
alter table public.goods_notice_presets enable row level security;
revoke all on public.goods_notice_presets from public, anon, authenticated, service_role;
grant select on public.goods_notice_presets to authenticated;
create policy goods_notice_presets_staff_read on public.goods_notice_presets
  for select to authenticated using ((select public.is_staff()));

create function public.admin_save_goods_notice_preset(
  target_id uuid, target_name text, target_notice jsonb, expected_updated_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r\f\v');
  normalized_notice jsonb;
  previous public.goods_notice_presets;
  saved public.goods_notice_presets;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(normalized_name) not between 1 and 80
    or jsonb_typeof(target_notice) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  if not target_notice ?& array['maker','origin','material','size','madeOn','asManager','asContact']
    or exists (select 1 from jsonb_each(target_notice) as field
      where field.key not in ('maker','origin','material','size','madeOn','asManager','asContact')
        or jsonb_typeof(field.value) <> 'string') then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  select jsonb_object_agg(field.key, btrim(field.value, E' \t\n\r\f\v'))
    into normalized_notice from jsonb_each_text(target_notice) as field;
  if exists (select 1 from jsonb_each_text(normalized_notice) as field
    where char_length(field.value) not between 1 and 1000) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;

  if target_id is not null then
    select * into previous from public.goods_notice_presets where id = target_id for update;
    if not found then raise no_data_found using message = 'goods_notice_preset_not_found'; end if;
    if expected_updated_at is distinct from previous.updated_at then
      raise serialization_failure using message = 'goods_notice_preset_conflict';
    end if;
  end if;

  if target_id is null then
    insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact)
    values (normalized_name,normalized_notice->>'maker',normalized_notice->>'origin',
      normalized_notice->>'material',normalized_notice->>'size',normalized_notice->>'madeOn',
      normalized_notice->>'asManager',normalized_notice->>'asContact') returning * into saved;
  else
    update public.goods_notice_presets set name = normalized_name,
      maker = normalized_notice->>'maker', origin = normalized_notice->>'origin',
      material = normalized_notice->>'material', size = normalized_notice->>'size',
      made_on = normalized_notice->>'madeOn', as_manager = normalized_notice->>'asManager',
      as_contact = normalized_notice->>'asContact',
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  end if;

  insert into public.audit_log(actor_id,action,target,diff)
    values(actor, case when target_id is null then 'catalog.goods_notice_preset.created'
      else 'catalog.goods_notice_preset.updated' end, 'goods_notice_presets:' || saved.id::text,
      jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.id;
end;
$$;
revoke all on function public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz) to authenticated;

create function public.admin_delete_goods_notice_preset(target_id uuid, expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); previous public.goods_notice_presets;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.goods_notice_presets where id = target_id for update;
  if not found then raise no_data_found using message = 'goods_notice_preset_not_found'; end if;
  if expected_updated_at is distinct from previous.updated_at then
    raise serialization_failure using message = 'goods_notice_preset_conflict';
  end if;
  delete from public.goods_notice_presets where id = target_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'catalog.goods_notice_preset.deleted','goods_notice_presets:' || target_id::text,
      jsonb_build_object('before',to_jsonb(previous),'after',null));
end;
$$;
revoke all on function public.admin_delete_goods_notice_preset(uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_goods_notice_preset(uuid,timestamptz) to authenticated;
