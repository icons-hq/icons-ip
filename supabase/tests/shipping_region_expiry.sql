\set ON_ERROR_STOP on
begin;
select 1/case when has_function_privilege('authenticated','public.admin_shipping_region_expiry_metadata(timestamptz)','execute')
  and not has_function_privilege('anon','public.admin_shipping_region_expiry_metadata(timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_shipping_region_expiry_metadata(timestamptz)','execute') then 1 else 0 end as metadata_acl;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000051401','authenticated','authenticated','expiry-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000051402','authenticated','authenticated','expiry-customer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000051401';
insert into public.shipping_carriers(code,label,tracking_url_template,is_active) values('expiry_old','이전 택배사','https://example.test/{trackingNumber}',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
('00000000-0000-4000-8000-000000051410','expiry-a','합성 김포','hanjin',0,'합성',true),
('00000000-0000-4000-8000-000000051411','expiry-b','합성 남양주','hanjin',0,'합성',true),
('00000000-0000-4000-8000-000000051412','expiry-c','비활성 출고지','hanjin',0,'합성',false),
('00000000-0000-4000-8000-000000051413','expiry-d','무기한 정책 출고지','hanjin',0,'합성',true);
insert into private.shipping_region_policies(origin_id,carrier_code,version,status,configuration,starts_at,ends_at,confirmed_by,confirmed_at,updated_by)
select ('00000000-0000-4000-8000-0000000'||origin)::uuid,carrier,version,'active',
  '{"name":"동일한 정책 이름","rules":[{"private":"not-returned"}],"sourceEvidence":"INTERNAL-EVIDENCE"}'::jsonb,
  starts_at::timestamptz,ends_at::timestamptz,'00000000-0000-4000-8000-000000051401',now(),'00000000-0000-4000-8000-000000051401'
from (values
  ('51410','hanjin',1,'2026-09-01T00:00:00Z','2026-09-15Z'),
  ('51410','hanjin',2,'2026-09-15Z','2026-09-30Z'),
  ('51410','expiry_old',1,'2026-09-01T00:00:00Z','2026-09-29Z'),
  ('51411','hanjin',1,'2026-09-01T00:00:00Z','2026-09-27Z'),
  ('51411','hanjin',2,'2026-09-30Z','2026-10-05Z'),
  ('51411','hanjin',3,'2026-10-06Z','2026-10-10Z'),
  ('51412','hanjin',1,'2026-09-01T00:00:00Z','2026-09-29Z'),
  ('51413','hanjin',1,'2026-09-01T00:00:00Z','2026-09-15Z'),
  ('51413','hanjin',2,'2026-09-15Z',null)
) fixture(origin,carrier,version,starts_at,ends_at);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051402',true);
do $$ begin
  perform public.admin_shipping_region_expiry_metadata('2026-09-28Z');
  raise exception 'customer read allowed';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051401',true);
do $$ declare result jsonb; begin
  result:=public.admin_shipping_region_expiry_metadata('2026-09-28Z');
  -- Scope these assertions to this test's synthetic origins so existing unrelated policies do not affect them.
  select coalesce(jsonb_agg(row),'[]') into result from jsonb_array_elements(result) row where row->>'originId' like '%05141_';
  if jsonb_array_length(result)<>3 then raise exception 'wrong candidates: %',result; end if;
  if exists(select 1 from jsonb_array_elements(result) row where row->>'carrierCode'='expiry_old' or row->>'originName' in ('비활성 출고지','무기한 정책 출고지')) then raise exception 'stale or inactive policy included'; end if;
  if not exists(select 1 from jsonb_array_elements(result) row where row->>'originName'='합성 김포' and row->>'version'='2') then raise exception 'current version missing'; end if;
  if (select count(*) from jsonb_array_elements(result) row where row->>'originName'='합성 남양주')<>2 then raise exception 'gap or future expiry missing'; end if;
  if result::text like '%INTERNAL-EVIDENCE%' or result::text like '%rules%' or result::text like '%not-returned%' then raise exception 'configuration leak'; end if;
end $$;
rollback;
