\set ON_ERROR_STOP on
-- 상품 일괄 변경: 막힌 상품만 건너뛰고 나머지를 적용한다(20261126150000, 화면 규칙 PR 2 결정 D4).
-- goods_kc_fixture.sql 뒤에 실행한다(공개할 수 있는 상품을 만드는 데 쓴다). 준비물은 모두 rollback된다.
-- 고정하는 계약:
-- 1. 미리보기가 상품마다 건너뛸 이유를 싣는다(공개 준비 미비·대표 카테고리 없음·KC 검토 전·보관·이미 공개).
--    저장은 건너뛴 상품을 빼고 적용하고, 완료 영수증에 건너뛴 상품 이름과 이유를 싣는다.
-- 2. 미리보기의 시험 적용은 아무것도 남기지 않는다(상품 값·감사 기록·지연 제약 검사 시점·잠금 대기 설정).
-- 3. [판매중으로]는 판매중지인 상품만 바꾼다. 소량 재고로 지정한 상품은 건너뛰고 그대로 둔다.
-- 4. 보관·복원·판매가도 상품마다 건너뛴다. 모두 건너뛰면 미리보기는 이유를 돌려주고 저장은 goods_bulk_all_skipped로 거절한다.
-- 5. 이 변경 전에 만든 미리보기(skip 없음)를 저장하면 막힌 상품만 저장 때 건너뛴다. 영수증은 옛 앱이 읽는 키 그대로다.
-- 6. 할인 등록에 보관 상품이 섞이면 그 상품만 건너뛴다. 할인 계산과 다른 건너뛰는 조건은 그대로다.
-- 7. 새 내부 함수는 봉인되고 운영자 계약이 지금 함수 본문과 같다.
-- 8. 미리보기는 고객 쪽 잠금 경로를 막지 않는다: 시험 적용하는 미리보기가 끝난 뒤 매장 전체 잠금(카테고리 트리·그룹 구성)과
--    상품별 저장 잠금이 하나도 남지 않는다. 할인 미리보기는 함께 잡는 그룹 구성 잠금만 남긴다.
--    다른 처리가 상품을 잡고 있을 때 그 상품만 건너뛰는 것은 두 세션이 있어야 볼 수 있어 여기서는 고정하지 않는다.
-- 9. 미리보기 뒤에 상태가 바뀌면: 건너뛴 상품이 바뀐 것은 저장을 막지 않고(그사이 조건을 채워도 이번 저장에는 넣지 않는다),
--    바꿀 상품이 바뀌면 goods_bulk_changed로 전체를 멈춘다.
-- 10. commit 때 검사하는 지연 제약(랜덤 판매 조건)에 막히는 상품은 미리보기에서 건너뛰고, 저장 때도 그 상품만 건너뛴다.
-- 11. 운영자가 아닌 계정은 미리보기도 못 한다. 저장을 부르지 않은 미리보기(DB가 먼저 배포된 동안의 옛 앱)는 아무것도 바꾸지 않는다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.skip_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.skip_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('b1200000-0000-4000-8000-000000000001','authenticated','authenticated','bulk-skip-admin@example.test',now(),'{}','{}',now(),now()),
 ('b1200000-0000-4000-8000-000000000002','authenticated','authenticated','bulk-skip-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='일괄건너뜀검증' where id='b1200000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b1200000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b1200000-0000-4000-8000-000000000011','b1200000-0000-4000-8000-000000000001',now(),now()),
 ('b1200000-0000-4000-8000-000000000012','b1200000-0000-4000-8000-000000000002',now(),now());
insert into public.verticals(key,label,color) values('bulk-skip-tests','일괄 건너뜀 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('bulk-skip-tests','TEST 일괄 건너뜀','bulk-skip-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('b1200000-0000-4000-8000-000000000030','bulk-skip-tests','검증 출고지','hanjin',3000,1000000,'배송 금지 검증 주소',true);
-- ready: 공개할 수 있다. nocat: 대표 카테고리 없음. nokc: KC 검토 전. bare: 대표 이미지·고시 없음. gone: 보관. live: 이미 공개.
insert into public.goods(id,ip_id,name,price,image_path,origin_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('bskip-ready','bulk-skip-tests','TEST 건너뜀 준비됨',10000,'public-media/bskip.webp','b1200000-0000-4000-8000-000000000030','합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'),
 ('bskip-nocat','bulk-skip-tests','TEST 건너뜀 카테고리없음',10000,'public-media/bskip.webp','b1200000-0000-4000-8000-000000000030','합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'),
 ('bskip-nokc','bulk-skip-tests','TEST 건너뜀 KC전',10000,'public-media/bskip.webp','b1200000-0000-4000-8000-000000000030','합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'),
 ('bskip-live','bulk-skip-tests','TEST 건너뜀 공개중',10000,'public-media/bskip.webp','b1200000-0000-4000-8000-000000000030','합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000');
-- lock-a·lock-b: 잠금과 '미리보기 뒤에 바뀜'을 보는 초안 상품. rand: 랜덤 판매 상품(옵션 둘). pair: rand와 함께 고르는 보통 상품.
insert into public.goods(id,ip_id,name,price) values
 ('bskip-bare','bulk-skip-tests','TEST 건너뜀 미비',500),
 ('bskip-gone','bulk-skip-tests','TEST 건너뜀 보관',10000),
 ('bskip-lock-a','bulk-skip-tests','TEST 건너뜀 잠금 A',10000),
 ('bskip-lock-b','bulk-skip-tests','TEST 건너뜀 잠금 B',10000),
 ('bskip-rand','bulk-skip-tests','TEST 건너뜀 랜덤',10000),
 ('bskip-pair','bulk-skip-tests','TEST 건너뜀 랜덤 짝',10000);

create function pg_temp.skip_preview(p_number integer,p_command text,p_ids jsonb,p_values jsonb default '{}') returns jsonb language sql as $$
 select public.admin_preview_goods_bulk(md5('bulk-skip:'||p_number)::uuid,jsonb_build_object('kind','goods','ids',p_ids,'command',p_command,'values',p_values),
  'b1200000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000011');$$;
create function pg_temp.skip_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_goods_bulk(md5('bulk-skip:'||p_number)::uuid,'b1200000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000011');$$;
-- 미리보기 줄의 건너뛴 이유를 {상품: 이유}로 모은다(적용할 상품은 null).
create function pg_temp.skip_reasons(p_preview jsonb) returns jsonb language sql as $$
 select jsonb_object_agg(r->>'id',r->'skip') from jsonb_array_elements(p_preview->'goods') r;$$;
create function pg_temp.skip_receipt_reasons(p_receipt jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(r->>'id',r->'reason'),'{}') from jsonb_array_elements(p_receipt->'skipped') r;$$;
-- 이 트랜잭션이 지금 쥐고 있는 이름 잠금의 종류(없으면 빈 글).
create function pg_temp.skip_held(p_key text) returns text language sql as $$
 select coalesce(string_agg(l.mode,',' order by l.mode),'') from pg_catalog.pg_locks l
  where l.pid=pg_backend_pid() and l.locktype='advisory' and l.objsubid=1 and ((l.classid::bigint<<32)|l.objid::bigint)=hashtextextended(p_key,0);$$;
-- 저장 기록의 미리보기를 이 변경 전 모양으로 되돌린다(줄마다 skip·stock·판매기간 키가 없었다).
create function pg_temp.skip_as_previous_preview(p_number integer) returns void language sql as $$
 update private.goods_bulk_operations set preview=jsonb_set(preview,'{goods}',
   (select jsonb_agg(r-'skip'-'stock'-'saleStartsAt'-'saleEndsAt') from jsonb_array_elements(preview->'goods') r))
  where id=md5('bulk-skip:'||p_number)::uuid;$$;
create temp table bskip_audit_count(n bigint);
create temp table bskip_settings(lock_timeout text);
grant all on bskip_audit_count,bskip_settings to authenticated;

-- 8. 미리보기는 고객 쪽 잠금 경로를 막지 않는다. 준비물이 카테고리 트리 잠금을 잡기 전에 본다.
--    고객 쪽은 카테고리 트리 잠금(카테고리 쿠폰 결제)과 그룹 구성 잠금(취소·반품 재고 복원, 리뷰 '도움이 돼요')을
--    함께 잡는 잠금으로 '시도'하고 못 잡으면 바로 실패한다. 독점 잠금이 남으면 매장 전체에서 그 일이 실패한다.
insert into bskip_settings select current_setting('lock_timeout');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","session_id":"b1200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select pg_temp.skip_assert(pg_temp.skip_held('catalog_category_tree')='' and pg_temp.skip_held('goods-stock-successor-topology:v1')='','fixtures hold neither store-wide lock yet');
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(100,'stop','["bskip-lock-a","bskip-lock-b"]'))
 ='{"bskip-lock-a":null,"bskip-lock-b":null}'::jsonb,'sales-state preview of two drafts');
select pg_temp.skip_assert(pg_temp.skip_held('catalog_category_tree')='' and pg_temp.skip_held('goods-stock-successor-topology:v1')=''
 and pg_temp.skip_held('admin_good:bskip-lock-a')='' and pg_temp.skip_held('admin_good:bskip-lock-b')='',
 'a trial preview keeps no store-wide or per-good lock: category-coupon checkout, cancel/return stock restores and review votes are not blocked');
select pg_temp.skip_assert(coalesce(current_setting('icons.goods_bulk_trial',true),'')<>'on'
 and current_setting('lock_timeout')=(select lock_timeout from bskip_settings),'the trial switch and the lock wait limit do not outlive the preview');
-- 할인 미리보기는 전처럼 읽는 동안 그룹 구성 잠금을 쥐지만, 이제 함께 잡는 잠금이다(전에는 독점이었다).
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(103,'discount','["bskip-lock-a","bskip-lock-b"]',
  jsonb_build_object('mode','rate','value',10,'startsAt',now()+interval '3 days','endsAt',now()+interval '4 days')))
 ='{"bskip-lock-a":null,"bskip-lock-b":null}'::jsonb and pg_temp.skip_held('catalog_category_tree')=''
 and pg_temp.skip_held('goods-stock-successor-topology:v1')='ShareLock','a discount preview keeps only a shared group-topology lock');
-- 11. 저장을 부르지 않은 미리보기는 아무것도 바꾸지 않는다. DB가 먼저 배포된 몇 분 동안의 옛 앱이 이렇다:
--     옛 앱은 판매상태 줄의 stock 키와 할인이 아닌 명령의 skip을 받지 않아, 미리보기를 받은 뒤 오류로 끝내고 저장을 부르지 않는다.
reset role;
select pg_temp.skip_assert((select bool_and(stock='ok') from public.goods where id in ('bskip-lock-a','bskip-lock-b'))
 and (select receipt is null from private.goods_bulk_operations where id=md5('bulk-skip:100')::uuid)
 and not exists(select 1 from public.audit_log where target='goods_bulk:'||md5('bulk-skip:100')::uuid::text),'a preview that is never saved changes nothing');
update private.goods_bulk_operations set expires_at=clock_timestamp()-interval '1 second' where id=md5('bulk-skip:100')::uuid;
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(100)->>'error'='goods_bulk_preview_expired','the abandoned preview can no longer be saved after 15 minutes');
reset role;
select pg_temp.skip_assert((select bool_and(stock='ok') from public.goods where id in ('bskip-lock-a','bskip-lock-b')),'the abandoned preview left the goods as they were');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','',true);

-- KC 준비 도우미의 합성 검토자도 운영자로 미리 넣어 둔다(goods_instant_discount_period.sql과 같은 방식).
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','bskip-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in ('bskip-ready','bskip-nocat','bskip-live');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods
 where id in ('bskip-ready','bskip-nocat','bskip-live');
select pg_temp.review_goods_kc_fixture('bskip-ready');
select pg_temp.review_goods_kc_fixture('bskip-nocat');
update public.goods set category_id=null where id='bskip-nocat';
select pg_temp.link_goods_type_category_fixture('bskip-nokc');
select pg_temp.publish_goods_kc_fixture('bskip-live');
update public.goods set archived_at=now() where id='bskip-gone';
-- 판매상태: ready는 판매중지, live는 소량 재고로 지정, nokc는 판매중.
update public.goods set stock='soldout' where id='bskip-ready';
update public.goods set stock='low' where id='bskip-live';
select private.change_goods_variant_stock('bskip-nokc',(select id from public.goods_variants where good_id='bskip-nokc'),3);
-- rand: 옵션 둘, 같은 가격의 랜덤 판매 상품. 조건을 채운 채로 지연 검사를 한 번 비운다.
insert into public.goods_variants(good_id,name,attributes,price,sort_order) values('bskip-rand','TEST 옵션 2','{"색상":"파랑"}',10000,1);
update public.goods set option_sale_mode='random' where id='bskip-rand';
do $$ begin
 execute 'set constraints '||private.goods_bulk_deferred_constraints()||' immediate';
 execute 'set constraints '||private.goods_bulk_deferred_constraints()||' deferred';
end $$;

-- 7. 새 내부 함수는 아무 롤도 직접 부르지 못하고, 운영자 계약이 지금 본문과 같다.
select pg_temp.skip_assert(not has_function_privilege('authenticated','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('anon','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('service_role','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_trial_good(text,text,jsonb)','execute')
 and not has_function_privilege('service_role','private.goods_bulk_trial_good(text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_deferred_constraints()','execute')
 and not has_function_privilege('anon','private.goods_bulk_deferred_constraints()','execute')
 and not has_function_privilege('service_role','private.goods_bulk_deferred_constraints()','execute')
 and not has_function_privilege('authenticated','private.lock_catalog_category_tree()','execute')
 and not has_function_privilege('service_role','private.lock_catalog_category_tree()','execute')
 and has_function_privilege('authenticated','public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_commit_goods_bulk(uuid,uuid,uuid)','execute'),'new helpers are sealed');
select pg_temp.skip_assert((select count(*)=2 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature in ('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','public.admin_commit_goods_bulk(uuid,uuid,uuid)')
   and c.capability='catalog.manage' and c.guard_kind='write' and c.body_md5=md5(p.prosrc))
 and (select count(*)=3 from private.operator_internal_contracts
  where signature in ('private.goods_bulk_apply_good(text,text,jsonb)','private.goods_bulk_trial_good(text,text,jsonb)','private.goods_bulk_deferred_constraints()')),'operator contracts follow the new bodies');

set local role authenticated;
-- 11. 운영자가 아닌 계정은 미리보기도 못 한다. 미리보기가 저장 함수를 시험 적용하게 됐으므로 저장과 같은 확인을 먼저 한다.
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","session_id":"b1200000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select pg_temp.skip_error($q$select public.admin_preview_goods_bulk(md5('bulk-skip:member')::uuid,'{"kind":"goods","ids":["bskip-ready"],"command":"archive","values":{}}',
 'b1200000-0000-4000-8000-000000000002','b1200000-0000-4000-8000-000000000012')$q$,'operator_capability_required');
reset role;
select pg_temp.skip_assert(not exists(select 1 from private.goods_bulk_operations where id=md5('bulk-skip:member')::uuid)
 and (select archived_at is null from public.goods where id='bskip-ready'),'a non-operator preview stores nothing and tries nothing');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","session_id":"b1200000-0000-4000-8000-000000000011","role":"authenticated"}',true);

-- 1. 공개: 준비된 상품만 적용 대상이고 나머지는 이유와 함께 건너뛴다.
reset role;insert into bskip_audit_count select count(*) from public.audit_log;set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(1,'publish','["bskip-ready","bskip-nocat","bskip-nokc","bskip-bare","bskip-gone","bskip-live"]'))
 ='{"bskip-ready":null,"bskip-nocat":"goods_category_required","bskip-nokc":"goods_kc_review_required","bskip-bare":"goods_publish_incomplete","bskip-gone":"good_archived","bskip-live":"goods_bulk_already_published"}'::jsonb,
 'publish preview names every blocked good and why');
-- 2. 시험 적용은 아무것도 남기지 않는다.
reset role;
select pg_temp.skip_assert((select published_at is null from public.goods where id='bskip-ready')
 and (select count(*) from public.audit_log)=(select n from bskip_audit_count),'trial leaves no product change and no audit row');
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(1)->>'state'='completed' and pg_temp.skip_commit(1)->>'goodsCount'='1'
 and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(1))
  ='{"bskip-nocat":"goods_category_required","bskip-nokc":"goods_kc_review_required","bskip-bare":"goods_publish_incomplete","bskip-gone":"good_archived","bskip-live":"goods_bulk_already_published"}'::jsonb
 and pg_temp.skip_commit(1)->'skipped' @> '[{"id":"bskip-nocat","name":"TEST 건너뜀 카테고리없음"}]'::jsonb,'publish applies the ready good and reports the rest by name');
select pg_temp.skip_assert((select published_at is not null from public.goods where id='bskip-ready')
 and (select bool_and(published_at is null) from public.goods where id in ('bskip-nocat','bskip-nokc','bskip-bare','bskip-gone')),'only the ready good is public');
-- 시험 적용과 저장이 당겨 본 지연 제약은 여전히 commit 때 검사한다: 기본 옵션을 잠깐 비워도 바로 거절되지 않는다.
reset role;
update public.goods_variants set is_default=false where good_id='bskip-bare';
update public.goods_variants set is_default=true where good_id='bskip-bare';
set local role authenticated;
-- 초안으로: 이미 초안인 상품은 건너뛴다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(2,'unpublish','["bskip-ready","bskip-nokc"]'))
 ='{"bskip-ready":null,"bskip-nokc":"goods_bulk_already_draft"}'::jsonb,'unpublish skips drafts');
select pg_temp.skip_assert(pg_temp.skip_commit(2)->>'goodsCount'='1','unpublish applies to one good');
select pg_temp.skip_assert((select published_at is null from public.goods where id='bskip-ready'),'unpublish applies to the public good');

-- 3. 판매중으로: 판매중지인 상품만 바꾼다. 소량 재고 지정은 그대로다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(3,'start','["bskip-ready","bskip-live","bskip-nokc"]'))
 ='{"bskip-ready":null,"bskip-live":"goods_bulk_not_stopped","bskip-nokc":"goods_bulk_not_stopped"}'::jsonb,'start only takes stopped goods');
select pg_temp.skip_assert((select r->>'stock' from jsonb_array_elements(pg_temp.skip_preview(3,'start','["bskip-ready","bskip-live","bskip-nokc"]')->'goods') r where r->>'id'='bskip-live')='low',
 'preview row carries the sales state');
-- 9. 건너뛴 상품(판매 중인 nokc)이 미리보기 뒤에 한 개 팔려도 저장을 막지 않는다. 건드리지 않을 상품이다.
reset role;
select private.change_goods_variant_stock('bskip-nokc',(select id from public.goods_variants where good_id='bskip-nokc'),2);
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(3)->>'state'='completed' and pg_temp.skip_commit(3)->>'goodsCount'='1' and jsonb_array_length(pg_temp.skip_commit(3)->'skipped')=2,
 'a sale of a skipped good does not stop the save: start applies to one good');
select pg_temp.skip_assert((select stock='ok' from public.goods where id='bskip-ready') and (select stock='low' from public.goods where id='bskip-live')
 and (select stock='ok' from public.goods where id='bskip-nokc'),'low-stock designation survives start');
-- 판매중지: 이미 판매중지인 상품은 건너뛰고, 소량 재고 상품은 판매중지로 바뀐다.
select pg_temp.skip_preview(4,'stop','["bskip-ready"]');select pg_temp.skip_assert(pg_temp.skip_commit(4)->>'state'='completed','stop one');
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(5,'stop','["bskip-ready","bskip-live"]'))
 ='{"bskip-ready":"goods_bulk_already_stopped","bskip-live":null}'::jsonb,'stop skips stopped goods');
select pg_temp.skip_assert(pg_temp.skip_commit(5)->>'goodsCount'='1','stop applies to one good');
select pg_temp.skip_assert((select stock='soldout' from public.goods where id='bskip-live'),'stop applies to the low-stock good');

-- 4. 보관·복원: 재고가 남은 상품·이미 보관된 상품은 건너뛴다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(6,'archive','["bskip-bare","bskip-nokc","bskip-gone"]'))
 ='{"bskip-bare":null,"bskip-nokc":"good_has_stock","bskip-gone":"goods_bulk_already_archived"}'::jsonb,'archive preview');
select pg_temp.skip_assert(pg_temp.skip_commit(6)->>'goodsCount'='1','archive applies to one good');
select pg_temp.skip_assert((select archived_at is not null from public.goods where id='bskip-bare')
 and (select archived_at is null from public.goods where id='bskip-nokc'),'archive applies to the empty good');
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(7,'restore','["bskip-bare","bskip-nokc","bskip-gone"]'))
 ='{"bskip-bare":null,"bskip-nokc":"goods_bulk_not_archived","bskip-gone":null}'::jsonb,'restore preview');
select pg_temp.skip_assert(pg_temp.skip_commit(7)->>'goodsCount'='2','restore applies to two goods');
select pg_temp.skip_assert((select bool_and(archived_at is null) from public.goods where id in ('bskip-bare','bskip-gone')),'restore applies to archived goods');
-- 판매가: 진행·예정 할인이 있는 상품과 1원 미만이 되는 상품은 건너뛴다. 나머지는 계산대로 바뀐다.
select public.admin_save_goods_price_period('bskip-nokc',(select id from public.goods_variants where good_id='bskip-nokc'),null,
 jsonb_build_object('state','active','discountPrice',9000,'startsAt',now()+interval '1 day','endsAt',now()+interval '2 days'),null);
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(8,'price','["bskip-nokc","bskip-bare","bskip-nocat"]','{"mode":"decrease","value":1000}'))
 ='{"bskip-nokc":"active_price_period_requires_reset","bskip-bare":"goods_bulk_price_invalid","bskip-nocat":null}'::jsonb,'price preview');
select pg_temp.skip_assert((select (r->>'nextPrice')::integer=9000 and (r->>'nextMin')::integer=9000 from jsonb_array_elements(pg_temp.skip_preview(8,'price','["bskip-nokc","bskip-bare","bskip-nocat"]','{"mode":"decrease","value":1000}')->'goods') r where r->>'id'='bskip-nocat')
 and (select (r->>'nextPrice')::integer=500 from jsonb_array_elements(pg_temp.skip_preview(8,'price','["bskip-nokc","bskip-bare","bskip-nocat"]','{"mode":"decrease","value":1000}')->'goods') r where r->>'id'='bskip-bare'),
 'skipped price rows keep their current price');
select pg_temp.skip_assert(pg_temp.skip_commit(8)->>'goodsCount'='1','price applies to one good');
select pg_temp.skip_assert((select price=9000 from public.goods where id='bskip-nocat')
 and (select price=10000 from public.goods where id='bskip-nokc') and (select price=500 from public.goods where id='bskip-bare'),'price applies to the unblocked good only');
-- 모두 건너뛰면 미리보기는 이유를 돌려주고 저장은 거절한다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(9,'publish','["bskip-bare"]'))='{"bskip-bare":"goods_publish_incomplete"}'::jsonb,'all-skipped preview still explains');
select pg_temp.skip_assert(pg_temp.skip_commit(9)->>'state'='rejected' and pg_temp.skip_commit(9)->>'error'='goods_bulk_all_skipped','all-skipped commit is rejected');

-- 5. 이 변경 전에 만든 미리보기(skip 없음): 막힌 상품만 저장 때 건너뛴다.
select pg_temp.skip_preview(10,'archive','["bskip-bare","bskip-nokc"]');
reset role;
select pg_temp.skip_as_previous_preview(10);
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(10)->>'state'='completed' and pg_temp.skip_commit(10)->>'goodsCount'='1'
 and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(10))='{"bskip-nokc":"good_has_stock"}'::jsonb,
 'a blocked good found at save time is skipped, not the whole batch');
select pg_temp.skip_assert((select archived_at is not null from public.goods where id='bskip-bare') and (select archived_at is null from public.goods where id='bskip-nokc'),
 'the rest of that batch is applied');
-- 옛 앱은 영수증의 키를 정확히 맞춰 본다: 여섯 키와, 건너뛴 줄의 네 키.
select pg_temp.skip_assert((select array_agg(k order by k) from jsonb_object_keys(pg_temp.skip_commit(10)) k)=array['error','goodsCount','groupsCount','operationId','skipped','state']
 and (select bool_and((select array_agg(k order by k) from jsonb_object_keys(r) k)=array['code','id','name','reason']) from jsonb_array_elements(pg_temp.skip_commit(10)->'skipped') r),
 'the receipt keeps exactly the keys the previous app reads');
reset role;
select pg_temp.skip_assert((select count(*)=1 from public.audit_log where action='catalog.goods_bulk.completed' and target='goods_bulk:'||md5('bulk-skip:10')::uuid::text
  and diff#>'{receipt,skipped}' @> '[{"id":"bskip-nokc","reason":"good_has_stock"}]'::jsonb),'audit keeps the skipped goods');
set local role authenticated;

-- 6. 할인 등록에 보관 상품이 섞이면 그 상품만 건너뛴다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(11,'discount','["bskip-bare","bskip-nocat"]',
  jsonb_build_object('mode','rate','value',10,'startsAt',now()+interval '3 days','endsAt',now()+interval '4 days')))
 ='{"bskip-bare":"good_archived","bskip-nocat":null}'::jsonb,'discount skips the archived good');
-- 9. 건너뛴 상품의 옵션 가격이 미리보기 뒤에 바뀌어도 할인 저장을 막지 않는다.
reset role;
update public.goods_variants set price=price+1 where good_id='bskip-bare';
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(11)->>'goodsCount'='1' and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(11))='{"bskip-bare":"good_archived"}'::jsonb,'discount applies to the rest');
reset role;
select pg_temp.skip_assert((select count(*)=1 and min(discount_price)=8100 from private.goods_variant_price_periods where good_id='bskip-nocat' and state='active')
 and not exists(select 1 from private.goods_variant_price_periods where good_id='bskip-bare'),'discount price is the same calculation');
set local role authenticated;
-- 할인은 적용할 상품이 없으면 전처럼 미리보기부터 거절한다: 모두 보관 상품이면 good_archived, 멈출 할인이 없으면 goods_bulk_no_active_discount.
select pg_temp.skip_error($q$select pg_temp.skip_preview(12,'discount_stop','["bskip-bare"]')$q$,'good_archived');
select pg_temp.skip_error($q$select pg_temp.skip_preview(13,'discount_stop','["bskip-ready"]')$q$,'goods_bulk_no_active_discount');
select pg_temp.skip_error($q$select pg_temp.skip_preview(14,'discount_stop','["bskip-bare","bskip-ready"]')$q$,'goods_bulk_all_skipped');
-- 화면용 값은 쓰는 명령에만 싣는다(판매상태 → stock, 판매기간 → 지금 판매기간).
select pg_temp.skip_assert((select bool_and(r ? 'saleStartsAt' and r ? 'saleEndsAt' and not r ? 'stock') from jsonb_array_elements(pg_temp.skip_preview(15,'period','["bskip-ready"]',
  jsonb_build_object('startsAt',now()+interval '1 day','endsAt',now()+interval '2 days'))->'goods') r)
 and (select bool_and(not r ? 'stock' and not r ? 'saleStartsAt') from jsonb_array_elements(pg_temp.skip_preview(16,'unpublish','["bskip-ready"]')->'goods') r),'display-only keys follow the command');
-- 그 밖의 명령은 줄과 응답의 키가 전과 같다. 건너뛸 상품이 없으면 옛 앱도 그대로 읽는다.
select pg_temp.skip_assert((select array_agg(k order by k) from jsonb_object_keys(pg_temp.skip_preview(16,'unpublish','["bskip-ready"]')) k)=array['expiresAt','goods','groups','operationId','request','state']
 and (select bool_and((select array_agg(k order by k) from jsonb_object_keys(r) k)
   =array['archived','code','discounts','id','name','nextMax','nextMin','nextPrice','price','priceMax','priceMin','published','skip','stopped'])
  from jsonb_array_elements(pg_temp.skip_preview(16,'unpublish','["bskip-ready"]')->'goods') r),'rows of the other commands keep the previous keys');

-- 9. 미리보기 뒤에 상태가 바뀌면.
-- 건너뛴 상품이 그사이 조건을 채워도 이번 저장에는 넣지 않는다(운영자가 확인한 것은 '이 상품은 건너뜀'이다).
reset role;update public.goods set stock='soldout' where id='bskip-lock-b';set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(101,'stop','["bskip-lock-a","bskip-lock-b"]'))
 ='{"bskip-lock-a":null,"bskip-lock-b":"goods_bulk_already_stopped"}'::jsonb,'stop preview skips the stopped draft');
reset role;update public.goods set stock='ok' where id='bskip-lock-b';set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(101)->>'goodsCount'='1'
 and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(101))='{"bskip-lock-b":"goods_bulk_already_stopped"}'::jsonb,'a good skipped in the preview stays skipped with the reviewed reason');
select pg_temp.skip_assert((select stock='soldout' from public.goods where id='bskip-lock-a') and (select stock='ok' from public.goods where id='bskip-lock-b'),
 'the skipped good is left alone even though it could be changed now');
-- 바꿀 상품이 그사이 바뀌면(재고가 움직였다) 전체를 멈춘다. 건너뛴 상품과 다르다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(102,'start','["bskip-lock-a","bskip-lock-b"]'))
 ='{"bskip-lock-a":null,"bskip-lock-b":"goods_bulk_not_stopped"}'::jsonb,'start preview takes the stopped draft');
reset role;
select private.change_goods_variant_stock('bskip-lock-a',(select id from public.goods_variants where good_id='bskip-lock-a'),4);
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(102)->>'state'='rejected' and pg_temp.skip_commit(102)->>'error'='goods_bulk_changed','a change to a good to be changed stops the whole save');
select pg_temp.skip_assert((select stock='soldout' from public.goods where id='bskip-lock-a'),'nothing is applied after that stop');

-- 10. commit 때 검사하는 지연 제약(랜덤 판매 조건). rand의 옵션 상한을 서로 다르게 만들어 둔다(검사를 거치지 않는 경로로 어긋난 상태).
reset role;
set local session_replication_role=replica;
update public.goods_variants set order_max_qty=1 where good_id='bskip-rand' and not is_default;
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(110,'price','["bskip-rand","bskip-pair"]','{"mode":"increase","value":1000}'))
 ='{"bskip-rand":"random_option_limit_mismatch","bskip-pair":null}'::jsonb,'a good blocked only by a commit-time rule is skipped in the preview');
-- 이 변경 전에 만든 미리보기처럼 skip이 없어도, 저장은 그 상품만 건너뛴다(전에는 함수가 완료를 돌려준 뒤 commit에서 통째로 실패했다).
select pg_temp.skip_preview(111,'price','["bskip-rand","bskip-pair"]','{"mode":"increase","value":1000}');
reset role;
select pg_temp.skip_as_previous_preview(111);
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(111)->>'state'='completed' and pg_temp.skip_commit(111)->>'goodsCount'='1'
 and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(111))='{"bskip-rand":"random_option_limit_mismatch"}'::jsonb,'the save skips that good alone');
reset role;
select pg_temp.skip_assert((select price=10000 from public.goods where id='bskip-rand') and (select bool_and(price=10000) from public.goods_variants where good_id='bskip-rand')
 and (select price=11000 from public.goods where id='bskip-pair'),'the blocked good keeps its price, the other one is changed');
-- 건너뛴 상품의 검사는 남지 않는다: 지금 지연 제약을 당겨도 통과한다(이 트랜잭션은 commit될 수 있다).
do $$ begin
 execute 'set constraints '||private.goods_bulk_deferred_constraints()||' immediate';
 execute 'set constraints '||private.goods_bulk_deferred_constraints()||' deferred';
end $$;
rollback;
