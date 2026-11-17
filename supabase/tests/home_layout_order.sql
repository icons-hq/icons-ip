\set ON_ERROR_STOP on
begin;
update public.home_layout_settings set blocks=null,revision=0 where singleton;
update public.home_curations set enabled=false where kind in ('band_banner','sales_best','review_best');
select 1 / case when public.get_home_layout_order() is null then 1 else 0 end as assert_unconfigured_keeps_legacy_order;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values
 ('00000000-0000-4000-8000-000000012951','authenticated','authenticated','layout-staff@example.test','{}','{}'),
 ('00000000-0000-4000-8000-000000012952','authenticated','authenticated','layout-user@example.test','{}','{}');
insert into public.profiles(id,email,nickname,birth_date,consents,onboarded_at,role)
values
 ('00000000-0000-4000-8000-000000012951','layout-staff@example.test','layout_staff','2000-01-01','{"terms":true,"privacy":true}',now(),'staff'),
 ('00000000-0000-4000-8000-000000012952','layout-user@example.test','layout_user','2000-01-01','{"terms":true,"privacy":true}',now(),'user')
on conflict(id) do update set role=excluded.role;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
select 'catalog/curation/'||image_id||'.webp','00000000-0000-4000-8000-000000012951','curation','image/webp',1024,1024,'verified',now()+interval '10 minutes',now(),now()
from (values
 ('12121212-1212-4212-8212-121212121201'),('12121212-1212-4212-8212-121212121202'),
 ('12121212-1212-4212-8212-121212121203'),('12121212-1212-4212-8212-121212121204')
) images(image_id);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000012951',true);
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000012961','00000000-0000-4000-8000-000000012971','band_banner',null,'활성 기획전','public-media/catalog/curation/12121212-1212-4212-8212-121212121201.webp','/shop',0,now()-interval '1 hour',null,true);
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000012962','00000000-0000-4000-8000-000000012972','band_banner',null,'숨긴 기획전','public-media/catalog/curation/12121212-1212-4212-8212-121212121202.webp','/shop',1,now()-interval '1 hour',null,false);
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000012963','00000000-0000-4000-8000-000000012973','band_banner',null,'예약 기획전','public-media/catalog/curation/12121212-1212-4212-8212-121212121203.webp','/shop',2,now()+interval '1 day',null,true);

select '[
 {"key":"popular","enabled":true},
 {"key":"band:00000000-0000-4000-8000-000000012972","enabled":true},
 {"key":"category_best","enabled":true},
 {"key":"editor_picks","enabled":true},
 {"key":"hero","enabled":false},
 {"key":"benefits","enabled":false},
 {"key":"band:00000000-0000-4000-8000-000000012971","enabled":true},
 {"key":"band:00000000-0000-4000-8000-000000012973","enabled":true}
]'::jsonb as layout_fixture \gset
select 1 / case when public.admin_save_home_layout('00000000-0000-4000-8000-000000012981',0,:'layout_fixture')=1 then 1 else 0 end as assert_layout_saved;
select 1 / case when public.admin_save_home_layout('00000000-0000-4000-8000-000000012981',0,:'layout_fixture')=1 then 1 else 0 end as assert_layout_idempotent;
select 1 / case when revision=1 and blocks=:'layout_fixture'::jsonb then 1 else 0 end as assert_staff_readback
from public.home_layout_settings where singleton;

do $$
declare candidate jsonb; base jsonb := '[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]';
begin
  for candidate in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,'[]'::jsonb,
    base||'[{"key":"hero","enabled":true}]'::jsonb,
    base||'[{"key":"unknown","enabled":true}]'::jsonb,
    jsonb_set(base,'{0,enabled}','"yes"'),
    jsonb_set(base,'{0,extra}','true'),
    base-0
  )) loop
    begin
      perform public.admin_save_home_layout(gen_random_uuid(),1,candidate);
      raise exception 'invalid layout accepted: %',candidate;
    exception when invalid_parameter_value then
      if sqlerrm<>'invalid_home_layout' then raise; end if;
    end;
  end loop;
  begin
    perform public.admin_save_home_layout(gen_random_uuid(),1,base||'[{"key":"band:00000000-0000-4000-8000-000000099999","enabled":true}]');
    raise exception 'missing campaign accepted';
  exception when no_data_found then if sqlerrm<>'home_layout_block_not_found' then raise; end if; end;
  begin
    perform public.admin_save_home_layout(gen_random_uuid(),0,base);
    raise exception 'stale revision accepted';
  exception when sqlstate 'PT409' then if sqlerrm<>'home_layout_conflict' then raise; end if; end;
  begin
    perform public.admin_save_home_layout('00000000-0000-4000-8000-000000012981',0,base);
    raise exception 'reused operation with changed layout accepted';
  exception when unique_violation then if sqlerrm<>'operation_conflict' then raise; end if; end;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
-- 저장 레이아웃에 없는 고정 블록은 맨 뒤에 stories → new_arrivals → strip_banner 순서로 붙는다(X SQUARE 홈).
select 1 / case when public.get_home_layout_order()=array['popular','category_best','editor_picks','band:00000000-0000-4000-8000-000000012971','stories','new_arrivals','strip_banner'] then 1 else 0 end as assert_public_only_visible_order;
do $$ begin
  begin perform blocks from public.home_layout_settings; exception when insufficient_privilege then return; end;
  raise exception 'anonymous layout metadata read must be denied';
end; $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000012952',true);
select 1 / case when count(*)=0 then 1 else 0 end as assert_user_cannot_read_admin_metadata from public.home_layout_settings;
do $$ begin
  begin perform public.admin_save_home_layout(gen_random_uuid(),1,'[]');
  exception when insufficient_privilege then if sqlerrm in ('forbidden','operator_capability_required') then return; end if; raise; end;
  raise exception 'non-staff layout write must be denied';
end; $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000012951',true);
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000012964','00000000-0000-4000-8000-000000012974','band_banner',null,'추가된 기획전','public-media/catalog/curation/12121212-1212-4212-8212-121212121204.webp','/shop',0,now()-interval '1 hour',null,true);
select 1 / case when public.get_home_layout_order()=array['popular','category_best','editor_picks','band:00000000-0000-4000-8000-000000012971','band:00000000-0000-4000-8000-000000012974','stories','new_arrivals','strip_banner'] then 1 else 0 end as assert_new_campaign_appends;

reset role;
-- A curation can change kind independently. Old layout references cannot render it.
update public.home_curations set kind='benefit' where id='00000000-0000-4000-8000-000000012971';
select 1 / case when public.get_home_layout_order()=array['popular','category_best','editor_picks','band:00000000-0000-4000-8000-000000012974','stories','new_arrivals','strip_banner'] then 1 else 0 end as assert_stale_campaign_key_ignored;
select 1 / case when count(*)=1 then 1 else 0 end as assert_layout_audit_once
from public.audit_log where id='00000000-0000-4000-8000-000000012981' and action='admin.home_layout.saved';
select 1 / case when
  not has_function_privilege('anon','public.admin_save_home_layout(uuid,bigint,jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_save_home_layout(uuid,bigint,jsonb)','execute')
  and not has_function_privilege('service_role','public.get_home_layout_order()','execute')
  and not has_table_privilege('authenticated','public.home_layout_settings','update')
then 1 else 0 end as assert_layout_acl_sealed;

-- X SQUARE 홈: 새 고정 키(new_arrivals·strip_banner)는 저장 순서대로 공개되고, 숨긴 키는 맨 뒤에 되살아나지 않는다.
-- 필수 키 집합(원래 다섯 개)은 그대로라 새 키가 없는 옛 저장값도 위에서 계속 저장됐다.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000012951',true);
select public.admin_save_home_layout('00000000-0000-4000-8000-000000012982',(select revision from public.home_layout_settings where singleton),'[
 {"key":"hero","enabled":true},
 {"key":"editor_picks","enabled":true},
 {"key":"new_arrivals","enabled":true},
 {"key":"strip_banner","enabled":false},
 {"key":"category_best","enabled":true},
 {"key":"popular","enabled":true},
 {"key":"benefits","enabled":false}
]');
reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
select 1 / case when public.get_home_layout_order()=array['hero','editor_picks','new_arrivals','category_best','popular','band:00000000-0000-4000-8000-000000012974','stories'] then 1 else 0 end as assert_new_fixed_blocks_follow_saved_order_and_hidden_stays_hidden;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000012951',true);
do $$
declare base jsonb := '[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]';
  revision_now bigint;
begin
  select revision into revision_now from public.home_layout_settings where singleton;
  -- 새 키도 한 번만, 이름 그대로, 필수 키 없이는 저장되지 않는다.
  begin
    perform public.admin_save_home_layout(gen_random_uuid(),revision_now,base||'[{"key":"new_arrivals","enabled":true},{"key":"new_arrivals","enabled":false}]');
    raise exception 'duplicate new fixed block accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_home_layout' then raise; end if; end;
  begin
    perform public.admin_save_home_layout(gen_random_uuid(),revision_now,base||'[{"key":"strip-banner","enabled":true}]');
    raise exception 'misspelled fixed block accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_home_layout' then raise; end if; end;
  begin
    perform public.admin_save_home_layout(gen_random_uuid(),revision_now,(base-3)||'[{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":true}]');
    raise exception 'layout without a required original block accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_home_layout' then raise; end if; end;
end;
$$;
reset role;
select 1 / case when
  has_function_privilege('anon','public.get_home_layout_order()','execute')
  and has_function_privilege('authenticated','public.get_home_layout_order()','execute')
  and not has_function_privilege('service_role','public.get_home_layout_order()','execute')
  and not has_function_privilege('anon','private.is_valid_home_layout_blocks(jsonb)','execute')
  and not has_function_privilege('authenticated','private.is_valid_home_layout_blocks(jsonb)','execute')
then 1 else 0 end as assert_layout_acl_still_sealed_after_new_blocks;
rollback;
