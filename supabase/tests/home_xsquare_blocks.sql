\set ON_ERROR_STOP on
-- X SQUARE 홈(ADR-0043) DB 계약: 새 고정 홈 블록(new_arrivals·strip_banner), 그리드형(5열) 상품 모음, 기존 저장 레이아웃 이행.
-- Prepend helpers/goods_kc_fixture.sql; every row, layout change and role switch rolls back.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;end $$;
create function pg_temp.collection_payload(ids jsonb default '[]',layout text default 'grid',item_count integer default 5,shape text default 'square') returns jsonb language sql as $$
 select jsonb_build_object('layout',layout,'image_shape',shape,'item_count',item_count,'good_ids',ids)$$;
create function pg_temp.save_collection(op uuid,id uuid,version timestamptz,title text,payload jsonb,enabled boolean default true)
returns uuid language sql as $$select public.admin_save_home_curation(op,id,'product_collection',null,title,null,null,0,'2020-01-01',null,enabled,null,payload,version)$$;
create function pg_temp.public_collection(id uuid) returns jsonb language sql as $$select value from jsonb_array_elements(public.get_home_product_collections()) where value->>'id'=id::text$$;
-- The migration's data step (20261117120100 §4) verbatim, as a callable body so each saved-layout shape can be replayed.
create function pg_temp.migrate_xsquare_layout() returns void language plpgsql as $$
declare current_blocks jsonb; rebuilt jsonb:='[]'::jsonb; entry jsonb; has_arrivals boolean; has_strip boolean;
begin
  select blocks into current_blocks from public.home_layout_settings where singleton for update;
  if current_blocks is null then return; end if;
  has_arrivals:=exists(select 1 from pg_catalog.jsonb_array_elements(current_blocks) e where e->>'key'='new_arrivals');
  has_strip:=exists(select 1 from pg_catalog.jsonb_array_elements(current_blocks) e where e->>'key'='strip_banner');
  if has_arrivals and has_strip then return; end if;
  for entry in select value from pg_catalog.jsonb_array_elements(current_blocks) with ordinality entries(value,position) order by position loop
    rebuilt:=rebuilt||pg_catalog.jsonb_build_array(entry);
    if entry->>'key'='editor_picks' and not has_arrivals then
      rebuilt:=rebuilt||'[{"key":"new_arrivals","enabled":true}]'::jsonb;
      if not has_strip then rebuilt:=rebuilt||'[{"key":"strip_banner","enabled":true}]'::jsonb; end if;
    elsif entry->>'key'='new_arrivals' and not has_strip then
      rebuilt:=rebuilt||'[{"key":"strip_banner","enabled":true}]'::jsonb;
    end if;
  end loop;
  update public.home_layout_settings set blocks=rebuilt,revision=revision+1,updated_at=clock_timestamp() where singleton;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values('97000000-0000-4000-8000-000000000001','authenticated','authenticated','xsquare-blocks@example.test',now(),'{}','{}');
update public.profiles set role='staff' where id='97000000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('97000000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('xsquare-ip-a','엑스스퀘어 합성 IP A','character',now()),('xsquare-ip-b','엑스스퀘어 합성 IP B','character',now());
insert into public.goods(id,ip_id,name,price) select 'xsquare-good-'||n,case when n<=10 then 'xsquare-ip-a' else 'xsquare-ip-b' end,'엑스스퀘어 합성 '||n,1000 from generate_series(1,12)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'xsquare-good-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'xsquare-good-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'xsquare-good-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'xsquare-good-%';

-- 1) 상품 모음 검증: 그리드형은 5·10개와 정사각만, list·full_image의 범위는 그대로.
do $$declare candidate jsonb;begin
 foreach candidate in array array[
  pg_temp.collection_payload('[]','grid',4),pg_temp.collection_payload('[]','grid',6),pg_temp.collection_payload('[]','grid',9),
  pg_temp.collection_payload('[]','grid',11),pg_temp.collection_payload('[]','grid',0),
  pg_temp.collection_payload('[]','grid',5,'portrait'),pg_temp.collection_payload('[]','grid',10,'landscape'),
  pg_temp.collection_payload('[]','grid',5)||'{"item_count":5.5}',pg_temp.collection_payload('[]','carousel',5),
  pg_temp.collection_payload('[]','grid',5)||'{"unknown":true}',pg_temp.collection_payload('["x","x"]','grid',5),
  pg_temp.collection_payload('[]','list',2),pg_temp.collection_payload('[]','list',13),
  pg_temp.collection_payload('[]','full_image',0),pg_temp.collection_payload('[]','full_image',9)] loop
  if private.is_valid_home_product_collection(candidate) then raise exception 'Invalid collection accepted: %',candidate;end if;
 end loop;
 foreach candidate in array array[
  pg_temp.collection_payload('[]','grid',5),pg_temp.collection_payload('[]','grid',10),
  pg_temp.collection_payload((select jsonb_agg('g-'||n) from generate_series(1,100)n),'grid',10),
  pg_temp.collection_payload('[]','list',3,'portrait'),pg_temp.collection_payload('[]','list',12,'landscape'),
  pg_temp.collection_payload('[]','full_image',1,'portrait'),pg_temp.collection_payload('[]','full_image',8,'landscape')] loop
  if not private.is_valid_home_product_collection(candidate) then raise exception 'Valid collection rejected: %',candidate;end if;
 end loop;
end$$;

-- 2) 레이아웃 검증: 새 키는 선택 키이고 한 번만, 필수 키 집합(원래 다섯 개)은 그대로.
do $$declare base jsonb:='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]';
  candidate jsonb;begin
 foreach candidate in array array[base,base||'[{"key":"stories","enabled":false}]',
  base||'[{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":false}]',
  base||'[{"key":"strip_banner","enabled":true},{"key":"new_arrivals","enabled":true},{"key":"stories","enabled":true},{"key":"products:97100000-0000-4000-8000-000000000001","enabled":true}]'] loop
  if not private.is_valid_home_layout_blocks(candidate) then raise exception 'Valid layout rejected: %',candidate;end if;
 end loop;
 foreach candidate in array array[
  base||'[{"key":"new_arrivals","enabled":true},{"key":"new_arrivals","enabled":false}]',
  base||'[{"key":"strip_banner","enabled":true},{"key":"strip_banner","enabled":true}]',
  base||'[{"key":"new_arrival","enabled":true}]',base||'[{"key":"strip-banner","enabled":true}]',base||'[{"key":"NEW_ARRIVALS","enabled":true}]',
  base||'[{"key":"strip_banner","enabled":"yes"}]',base||'[{"key":"new_arrivals","enabled":true,"extra":1}]',
  (base-3)||'[{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":true},{"key":"stories","enabled":true}]',
  (base-0)||'[{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":true},{"key":"stories","enabled":true}]'] loop
  if private.is_valid_home_layout_blocks(candidate) then raise exception 'Invalid layout accepted: %',candidate;end if;
 end loop;
end$$;

-- 3) 운영자 저장 경로: 그리드형 모음을 저장하고, 공개 읽기는 노출 개수만큼 앞에서 자른다. 잘못된 조합은 저장 거절.
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.save_collection('97000000-0000-4000-8000-000000000101','97100000-0000-4000-8000-000000000001',null,'엑스스퀘어 IP',
 pg_temp.collection_payload('["xsquare-good-3","xsquare-good-1","xsquare-good-2","xsquare-good-4","xsquare-good-5","xsquare-good-6","xsquare-good-7"]'));
select 1/case when pg_temp.public_collection('97100000-0000-4000-8000-000000000001')->'payload'=
 pg_temp.collection_payload('["xsquare-good-3","xsquare-good-1","xsquare-good-2","xsquare-good-4","xsquare-good-5"]') then 1 else 0 end as grid_five_public_projection_cuts_to_count;
select updated_at as version_one from public.home_curations where id='97100000-0000-4000-8000-000000000001' \gset
select pg_temp.save_collection('97000000-0000-4000-8000-000000000102','97100000-0000-4000-8000-000000000001',:'version_one','엑스스퀘어 IP',
 pg_temp.collection_payload('["xsquare-good-1","xsquare-good-2","xsquare-good-3","xsquare-good-4","xsquare-good-5","xsquare-good-6","xsquare-good-7","xsquare-good-8","xsquare-good-9","xsquare-good-10","xsquare-good-11","xsquare-good-12"]','grid',10));
select 1/case when jsonb_array_length(pg_temp.public_collection('97100000-0000-4000-8000-000000000001')#>'{payload,good_ids}')=10
 and (pg_temp.public_collection('97100000-0000-4000-8000-000000000001')#>>'{payload,item_count}')::integer=10 then 1 else 0 end as grid_ten_public_projection_cuts_to_count;
select updated_at as version_two from public.home_curations where id='97100000-0000-4000-8000-000000000001' \gset
select pg_temp.expect_error(format($q$select pg_temp.save_collection(gen_random_uuid(),'97100000-0000-4000-8000-000000000001',%L,'일곱',pg_temp.collection_payload('[]','grid',7))$q$,:'version_two'),'invalid_curation_product_collection');
select pg_temp.expect_error(format($q$select pg_temp.save_collection(gen_random_uuid(),'97100000-0000-4000-8000-000000000001',%L,'세로',pg_temp.collection_payload('[]','grid',5,'portrait'))$q$,:'version_two'),'invalid_curation_product_collection');
select pg_temp.expect_error(format($q$select pg_temp.save_collection(gen_random_uuid(),'97100000-0000-4000-8000-000000000001',%L,'가로',pg_temp.collection_payload('[]','grid',10,'landscape'))$q$,:'version_two'),'invalid_curation_product_collection');
-- 그리드형을 목록형(정사각 3개)으로 바꿔도 후보 100개 모음은 그대로 다룬다.
select pg_temp.save_collection(gen_random_uuid(),'97100000-0000-4000-8000-000000000001',:'version_two','목록으로',
 pg_temp.collection_payload('["xsquare-good-1","xsquare-good-2","xsquare-good-3"]','list',3));
select 1/case when pg_temp.public_collection('97100000-0000-4000-8000-000000000001')#>>'{payload,layout}'='list' then 1 else 0 end as grid_to_list_change_allowed;
select updated_at as version_three from public.home_curations where id='97100000-0000-4000-8000-000000000001' \gset
select pg_temp.save_collection(gen_random_uuid(),'97100000-0000-4000-8000-000000000001',:'version_three','엑스스퀘어 IP',
 pg_temp.collection_payload('["xsquare-good-1","xsquare-good-2","xsquare-good-3","xsquare-good-4","xsquare-good-5"]'));

-- 4) 레이아웃 순서: 새 고정 키와 그리드형 모음 키가 저장 순서 그대로 공개되고, 저장되지 않은 stories만 맨 뒤에 붙는다.
select public.admin_save_home_layout('97000000-0000-4000-8000-000000000201',(select revision from public.home_layout_settings where singleton),
 '[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":true},
   {"key":"products:97100000-0000-4000-8000-000000000001","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]');
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when public.get_home_layout_order()=array['hero','editor_picks','new_arrivals','strip_banner','products:97100000-0000-4000-8000-000000000001','category_best','popular','benefits','stories'] then 1 else 0 end as saved_order_with_new_blocks_is_public_order;
reset role;
-- 숨긴 새 블록은 맨 뒤 자동 추가로 되살아나지 않고, 키가 없으면 stories 뒤에 new_arrivals → strip_banner 순서로 붙는다.
update public.home_layout_settings set blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"strip_banner","enabled":false},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"stories","enabled":true}]' where singleton;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
-- 저장되지 않은 활성 모음(products:…)은 새 고정 키보다 앞에 붙는다(고정 키 자리는 활성 모음 뒤부터).
select 1/case when public.get_home_layout_order()=array['hero','editor_picks','category_best','popular','benefits','stories','products:97100000-0000-4000-8000-000000000001','new_arrivals'] then 1 else 0 end as hidden_blocks_stay_hidden_missing_blocks_append_last;
reset role;

-- 5) 이행: 저장된 옛 레이아웃에 new_arrivals(editor_picks 뒤)와 strip_banner를 켠 채 끼우고, 이미 있는 키는 건드리지 않는다.
update public.home_layout_settings set blocks='[{"key":"hero","enabled":false},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":false},{"key":"benefits","enabled":true},{"key":"stories","enabled":true},{"key":"products:97100000-0000-4000-8000-000000000001","enabled":true}]',revision=7 where singleton;
select pg_temp.migrate_xsquare_layout();
select 1/case when blocks='[{"key":"hero","enabled":false},{"key":"editor_picks","enabled":true},{"key":"new_arrivals","enabled":true},{"key":"strip_banner","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":false},{"key":"benefits","enabled":true},{"key":"stories","enabled":true},{"key":"products:97100000-0000-4000-8000-000000000001","enabled":true}]'::jsonb
 and revision=8 and private.is_valid_home_layout_blocks(blocks) then 1 else 0 end as old_layout_gets_new_blocks_after_editor_picks from public.home_layout_settings where singleton;
select pg_temp.migrate_xsquare_layout();
select 1/case when revision=8 then 1 else 0 end as migration_is_idempotent from public.home_layout_settings where singleton;
-- 운영자가 strip_banner만 숨겨 둔 경우: new_arrivals만 더하고 숨김 키는 제자리에 둔다.
update public.home_layout_settings set blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"strip_banner","enabled":false}]',revision=1 where singleton;
select pg_temp.migrate_xsquare_layout();
select 1/case when blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"new_arrivals","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"strip_banner","enabled":false}]'::jsonb and revision=2 then 1 else 0 end as hidden_strip_stays_and_only_arrivals_is_added from public.home_layout_settings where singleton;
-- new_arrivals만 있고 숨겨져 있으면: strip_banner를 그 바로 뒤에 켠 채 더한다.
update public.home_layout_settings set blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"new_arrivals","enabled":false}]',revision=1 where singleton;
select pg_temp.migrate_xsquare_layout();
select 1/case when blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"new_arrivals","enabled":false},{"key":"strip_banner","enabled":true}]'::jsonb and revision=2 then 1 else 0 end as strip_follows_existing_hidden_arrivals from public.home_layout_settings where singleton;
-- 저장된 레이아웃이 없으면(코드 기본 순서) 아무것도 바꾸지 않는다.
update public.home_layout_settings set blocks=null,revision=0 where singleton;
select pg_temp.migrate_xsquare_layout();
select 1/case when blocks is null and revision=0 then 1 else 0 end as unconfigured_layout_untouched from public.home_layout_settings where singleton;

-- 6) 접근 권한과 운영자 계약: 공개 순서 RPC만 anon·authenticated 실행, 검증 함수는 봉인, 세 함수 모두 계약 지문이 등록돼 있다.
select 1/case when has_function_privilege('anon','public.get_home_layout_order()','execute')
 and has_function_privilege('authenticated','public.get_home_layout_order()','execute')
 and not has_function_privilege('service_role','public.get_home_layout_order()','execute')
 and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid='public.get_home_layout_order()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then 1 else 0 end as layout_order_rpc_acl_unchanged;
select 1/case when bool_and(not has_function_privilege(r,p,'execute')) then 1 else 0 end as validators_sealed
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['private.is_valid_home_product_collection(jsonb)','private.is_valid_home_layout_blocks(jsonb)'])p;
select 1/case when (select count(*) from private.operator_internal_contracts where signature in
 ('private.is_valid_home_product_collection(jsonb)','private.is_valid_home_layout_blocks(jsonb)','public.get_home_layout_order()'))=3 then 1 else 0 end as redefined_functions_keep_internal_contracts;
rollback;
