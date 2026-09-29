-- #509: optional reusable KC classification drafts, without identity or evidence.
alter table public.goods_notice_presets add column kc_template jsonb
  check(kc_template is null or jsonb_typeof(kc_template)='object');

create function private.normalize_goods_notice_kc_template(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare model jsonb;
begin
  if value is null or value='null'::jsonb then return null; end if;
  if jsonb_typeof(value) is distinct from 'object' then raise invalid_parameter_value using message='invalid_goods_notice_kc_template'; end if;
  if not value ?& array['family','scheme','publicNote'] or (select count(*) from jsonb_object_keys(value))<>3
    or jsonb_typeof(value->'family') is distinct from 'string' or coalesce(value->>'family','')=''
    or jsonb_typeof(value->'scheme') is distinct from 'string' or coalesce(value->>'scheme','')=''
    or jsonb_typeof(value->'publicNote') is distinct from 'string'
    or (value->>'scheme'<>'not_applicable' and private.goods_kc_trim(value->>'publicNote')<>'') then
    raise invalid_parameter_value using message='invalid_goods_notice_kc_template';
  end if;
  -- Reuse the model-domain combination and text checks; template-only fields are allowlisted above.
  model:=private.normalize_goods_kc_models(jsonb_build_array(jsonb_build_object(
    'family',value->'family','scheme',value->'scheme','publicNote',value->'publicNote',
    'productCategory','','modelName','','businessRole','','businessName','','identifier','',
    'variantIds','[]'::jsonb,'basis','','evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration','')
  )))->0;
  if model->>'family'='' or model->>'scheme'='' then raise invalid_parameter_value using message='invalid_goods_notice_kc_template'; end if;
  return jsonb_build_object('family',model->'family','scheme',model->'scheme','publicNote',model->'publicNote');
end $$;
revoke all on function private.normalize_goods_notice_kc_template(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.normalize_goods_notice_kc_template(jsonb) to postgres;

create or replace function public.admin_save_goods_notice_preset(
  target_id uuid, target_name text, target_notice jsonb, expected_updated_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r\f\v');
  normalized_notice jsonb;
  normalized_kc jsonb;
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
      where field.key not in ('maker','origin','material','size','madeOn','asManager','asContact','kcTemplate')
        or (field.key<>'kcTemplate' and jsonb_typeof(field.value) <> 'string')) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  select jsonb_object_agg(field.key, btrim(field.value, E' \t\n\r\f\v'))
    into normalized_notice from jsonb_each_text(target_notice) as field where field.key<>'kcTemplate';
  if target_notice ? 'kcTemplate' then normalized_kc:=private.normalize_goods_notice_kc_template(target_notice->'kcTemplate'); end if;
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
    insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact,kc_template)
    values (normalized_name,normalized_notice->>'maker',normalized_notice->>'origin',
      normalized_notice->>'material',normalized_notice->>'size',normalized_notice->>'madeOn',
      normalized_notice->>'asManager',normalized_notice->>'asContact',normalized_kc) returning * into saved;
  else
    update public.goods_notice_presets set name = normalized_name,
      maker = normalized_notice->>'maker', origin = normalized_notice->>'origin',
      material = normalized_notice->>'material', size = normalized_notice->>'size',
      made_on = normalized_notice->>'madeOn', as_manager = normalized_notice->>'asManager',
      as_contact = normalized_notice->>'asContact',
      kc_template = case when target_notice ? 'kcTemplate' then normalized_kc else previous.kc_template end,
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
