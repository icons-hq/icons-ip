-- #426: settings writes belong to active admins and every mutation is audited.
-- Empty business overrides retain the existing application fallback; no contact data is copied here.
create table public.store_settings (
  singleton boolean primary key default true check(singleton),
  business jsonb not null default '{}' check(jsonb_typeof(business)='object'),
  bank_transfer jsonb check(bank_transfer is null or jsonb_typeof(bank_transfer)='object'),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.store_settings(singleton) values(true);
alter table public.store_settings enable row level security;
revoke all on public.store_settings from public,anon,authenticated,service_role;
grant select on public.store_settings to authenticated;
create policy store_settings_staff_read on public.store_settings for select to authenticated using((select public.is_staff()));

create function public.get_storefront_settings() returns jsonb
language sql stable security definer set search_path='' as $$
  select business from public.store_settings where singleton;
$$;
revoke all on function public.get_storefront_settings() from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_settings() to anon,authenticated,service_role;

create function public.get_bank_transfer_settings() returns jsonb
language sql stable security definer set search_path='' as $$
  select bank_transfer from public.store_settings where singleton;
$$;
revoke all on function public.get_bank_transfer_settings() from public,anon,authenticated,service_role;
grant execute on function public.get_bank_transfer_settings() to service_role;

create function public.admin_save_store_settings(target_section text,target_values jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved public.store_settings; normalized jsonb; allowed text[]; filled integer;
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='admin_required';
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

create function private.touch_shipping_carrier_settings() returns trigger
language plpgsql set search_path='' as $$
begin new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond'); return new; end $$;
revoke all on function private.touch_shipping_carrier_settings() from public,anon,authenticated,service_role;
drop trigger shipping_carriers_touch on public.shipping_carriers;
create trigger shipping_carriers_touch before update on public.shipping_carriers for each row execute function private.touch_shipping_carrier_settings();

-- Retire direct staff DML so role changes and audit cannot be bypassed via REST.
drop policy if exists shipping_carriers_staff_write on public.shipping_carriers;
revoke all on public.shipping_carriers from public,anon,authenticated,service_role;
grant select on public.shipping_carriers to anon,authenticated,service_role;
create function public.admin_save_shipping_carrier(target_code text,target_label text,target_url text,target_active boolean,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.shipping_carriers; saved public.shipping_carriers;
  code_value text:=btrim(coalesce(target_code,'')); label_value text:=btrim(coalesce(target_label,'')); url_value text:=btrim(coalesce(target_url,''));
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then raise insufficient_privilege using message='admin_required'; end if;
  if code_value !~ '^[a-z0-9_]{2,32}$' or length(label_value) not between 1 and 60 or target_active is null
    or length(url_value)>500 or position('{trackingNumber}' in url_value)=0
    or url_value !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?[/#?]'
    or url_value ~ '[[:space:]\\]' then raise invalid_parameter_value using message='invalid_shipping_carrier'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_carrier:'||code_value,0));
  select * into previous from public.shipping_carriers where code=code_value for update;
  if found then
    if expected_updated_at is distinct from previous.updated_at then raise serialization_failure using message='store_settings_conflict'; end if;
    update public.shipping_carriers set label=label_value,tracking_url_template=url_value,is_active=target_active
      where code=code_value returning * into saved;
  else
    if expected_updated_at is not null then raise no_data_found using message='shipping_carrier_not_found'; end if;
    insert into public.shipping_carriers(code,label,tracking_url_template,is_active)
      values(code_value,label_value,url_value,target_active) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_carrier.saved','shipping_carriers:'||code_value,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.updated_at;
end $$;
revoke all on function public.admin_save_shipping_carrier(text,text,text,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_shipping_carrier(text,text,text,boolean,timestamptz) to authenticated;

create function public.admin_store_settings_history(row_limit integer default 50)
returns table(id uuid,actor_name text,action text,target text,created_at timestamptz,diff jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  return query select a.id,p.nickname,a.action,a.target,a.created_at,a.diff from public.audit_log a
    left join public.profiles p on p.id=a.actor_id
    where a.action in ('admin.store_settings.updated','admin.shipping_carrier.saved','admin.fulfillment_origin.saved')
    order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(row_limit,50),100));
end $$;
revoke all on function public.admin_store_settings_history(integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_store_settings_history(integer) to authenticated;
