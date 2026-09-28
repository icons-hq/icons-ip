-- #512: opt-in per-category notices. Existing threads and creation remain unchanged.
alter table public.store_settings add column inquiry_auto_replies jsonb not null
  default '{"order":{"enabled":false,"body":""},"claim":{"enabled":false,"body":""},"good":{"enabled":false,"body":""},"account":{"enabled":false,"body":""},"etc":{"enabled":false,"body":""}}'::jsonb
  check(jsonb_typeof(inquiry_auto_replies)='object');
-- The existing staff-only RLS and sealed DML apply to the new column as well.

create or replace function public.admin_save_store_settings(target_section text,target_values jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved public.store_settings; normalized jsonb; allowed text[]; filled integer; category text; notice jsonb; body_value text;
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='admin_required';
  end if;
  if target_section='inquiry_auto_replies' then
    if jsonb_typeof(target_values) is distinct from 'object' then
      raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
    end if;
    if not target_values ?& array['order','claim','good','account','etc']
      or (select count(*) from jsonb_object_keys(target_values))<>5 then
      raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
    end if;
    normalized:='{}'::jsonb;
    for category,notice in select key,value from jsonb_each(target_values) loop
      if jsonb_typeof(notice) is distinct from 'object' then
        raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
      end if;
      if jsonb_typeof(notice->'enabled') is distinct from 'boolean'
        or jsonb_typeof(notice->'body') is distinct from 'string'
        or (select count(*) from jsonb_object_keys(notice))<>2 then
        raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
      end if;
      -- Match JavaScript trim while preserving newlines inside operator-authored text.
      body_value:=btrim(notice->>'body',E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
      if length(body_value)>2000 or ((notice->>'enabled')::boolean and body_value='')
        or regexp_replace(body_value,E'[\t\n\r]','','g') ~ '[[:cntrl:]]' then
        raise invalid_parameter_value using message='invalid_inquiry_auto_reply_body';
      end if;
      normalized:=normalized||jsonb_build_object(category,jsonb_build_object('enabled',notice->'enabled','body',body_value));
    end loop;
    select * into previous from public.store_settings where singleton for update;
    if expected_updated_at is distinct from previous.updated_at then
      raise serialization_failure using message='store_settings_conflict';
    end if;
    update public.store_settings set inquiry_auto_replies=normalized,
      updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
      where singleton returning * into saved;
    insert into public.audit_log(actor_id,action,target,diff)
      values(actor,'admin.store_settings.updated','store_settings:inquiry_auto_replies',
        jsonb_build_object('before',previous.inquiry_auto_replies,'after',normalized));
    return saved.updated_at;
  end if;
  if target_section not in ('business','bank_transfer') or target_section is null or jsonb_typeof(target_values) is distinct from 'object' then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  allowed:=case target_section when 'business' then array['companyName','representative','registrationNumber','mailOrderNumber','address','phone','email','hostingProvider'] else array['bank','accountNumber','holder'] end;
  if exists(select 1 from jsonb_each(target_values) where not(key=any(allowed)) or jsonb_typeof(value)<>'string') then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  select coalesce(jsonb_object_agg(key,btrim(value,E' \t\n\r\f\v')),'{}') into normalized from jsonb_each_text(target_values);
  if exists(select 1 from jsonb_each_text(normalized) where length(value)>500 or value ~ '[[:cntrl:]]')
    or (target_section='business' and coalesce(normalized->>'email','')<>'' and normalized->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  if target_section='bank_transfer' then
    select count(*) into filled from jsonb_each_text(normalized) where value<>'';
    if not normalized ?& allowed or filled not in (0,3) then raise invalid_parameter_value using message='incomplete_bank_account'; end if;
  end if;
  select * into previous from public.store_settings where singleton for update;
  if expected_updated_at is distinct from previous.updated_at then raise serialization_failure using message='store_settings_conflict'; end if;
  update public.store_settings set
    business=case when target_section='business' then normalized else business end,
    bank_transfer=case when target_section='bank_transfer' then normalized else bank_transfer end,
    updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond') where singleton returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_settings.updated','store_settings:'||target_section,
    jsonb_build_object('before',case target_section when 'business' then previous.business else previous.bank_transfer end,
      'after',normalized));
  return saved.updated_at;
end $$;
revoke all on function public.admin_save_store_settings(text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_settings(text,jsonb,timestamptz) to authenticated;
