\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000012901', 'authenticated', 'authenticated', 'latest-staff@example.test', '{}', '{}'),
  ('00000000-0000-4000-8000-000000012902', 'authenticated', 'authenticated', 'latest-user@example.test', '{}', '{}');
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000012901', 'latest-staff@example.test', 'latest_staff', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'staff'),
  ('00000000-0000-4000-8000-000000012902', 'latest-user@example.test', 'latest_user', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'user')
on conflict (id) do update set role=excluded.role;

select 1 / case when
  has_function_privilege('authenticated', 'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)', 'execute')
then 1 else 0 end as assert_latest_goods_rpc_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000012902', true);
do $$
begin
  begin
    perform public.admin_upsert_home_curation(gen_random_uuid(), gen_random_uuid(), 'best_tab', null, '최근 상품', null, '/shop', 0, '2020-01-01', null, true, 'category', '{"selection_mode":"latest","item_count":3}');
  exception when insufficient_privilege then
    if sqlerrm in ('forbidden','operator_capability_required') then return; end if;
    raise;
  end;
  raise exception 'non-staff automatic curation must be forbidden';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000012901', true);
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000012911', '00000000-0000-4000-8000-000000012921',
  'best_tab', null, '최근 상품', null, '/shop', 0, '2020-01-01', null, true, 'category',
  '{"selection_mode":"latest","item_count":3}'
);
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000012911', '00000000-0000-4000-8000-000000012921',
  'best_tab', null, '최근 상품', null, '/shop', 0, '2020-01-01', null, true, 'category',
  '{"selection_mode":"latest","item_count":3.0}'
);
select 1 / case when payload = '{"selection_mode":"latest","item_count":3}'::jsonb
  then 1 else 0 end as assert_latest_selection_roundtrip
from public.home_curations where id='00000000-0000-4000-8000-000000012921';

do $$
declare invalid_payload jsonb;
begin
  for invalid_payload in select value from jsonb_array_elements('[
    {"selection_mode":"latest"},
    {"selection_mode":"latest","item_count":2},
    {"selection_mode":"latest","item_count":11},
    {"selection_mode":"latest","item_count":3.5},
    {"selection_mode":"latest","item_count":"3"},
    {"selection_mode":"latest","item_count":null},
    {"selection_mode":"latest","item_count":3,"good_ids":["g1"]},
    {"selection_mode":"popular","item_count":3},
    {"selection_mode":null,"item_count":3},
    {"item_count":3},
    {"selection_mode":"latest","item_count":3,"unknown":true}
  ]'::jsonb)
  loop
    begin
      perform public.admin_upsert_home_curation(gen_random_uuid(), gen_random_uuid(), 'best_tab', null, '잘못된 규칙', null, '/shop', 0, '2020-01-01', null, true, 'category', invalid_payload);
      raise exception 'invalid automatic selection accepted: %', invalid_payload;
    exception when invalid_parameter_value then
      if sqlerrm <> 'invalid_curation_payload' then raise; end if;
    end;
  end loop;
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000012911', '00000000-0000-4000-8000-000000012921',
      'best_tab', null, '최근 상품', null, '/shop', 0, '2020-01-01', null, true, 'category',
      '{"selection_mode":"latest","item_count":4}'
    );
    raise exception 'same operation with another selection must conflict';
  exception when unique_violation then
    if sqlerrm <> 'operation_conflict' then raise; end if;
  end;
end;
$$;

-- Existing manual records still round trip using the original payload.
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000012912', '00000000-0000-4000-8000-000000012922',
  'best_tab', null, '직접 선택', null, '/shop', 1, '2020-01-01', null, true, 'popular', '{"good_ids":["g2","g1"]}'
);
select 1 / case when payload = '{"good_ids":["g2","g1"]}'::jsonb then 1 else 0 end as assert_manual_selection_unchanged
from public.home_curations where id='00000000-0000-4000-8000-000000012922';

reset role;
select 1 / case when count(*)=1 then 1 else 0 end as assert_latest_selection_audited_once
from public.audit_log where id='00000000-0000-4000-8000-000000012911'
  and action='admin.home_curation.upserted'
  and diff->'after'->'payload' = '{"selection_mode":"latest","item_count":3}'::jsonb;
rollback;
