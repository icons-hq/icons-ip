\set ON_ERROR_STOP on
-- 상품 일괄 변경: 막힌 상품만 건너뛰고 나머지를 적용한다(20261126120000, 화면 규칙 PR 2 결정 D4).
-- goods_kc_fixture.sql 뒤에 실행한다(공개할 수 있는 상품을 만드는 데 쓴다). 준비물은 모두 rollback된다.
-- 고정하는 계약:
-- 1. 미리보기가 상품마다 건너뛸 이유를 싣는다(공개 준비 미비·대표 카테고리 없음·KC 검토 전·보관·이미 공개).
--    저장은 건너뛴 상품을 빼고 적용하고, 완료 영수증에 건너뛴 상품 이름과 이유를 싣는다.
-- 2. 미리보기의 시험 적용은 아무것도 남기지 않는다(상품 값·감사 기록·지연 제약 검사 시점).
-- 3. [판매중으로]는 판매중지인 상품만 바꾼다. 소량 재고로 지정한 상품은 건너뛰고 그대로 둔다.
-- 4. 보관·복원·판매가도 상품마다 건너뛴다. 모두 건너뛰면 미리보기는 이유를 돌려주고 저장은 goods_bulk_all_skipped로 거절한다.
-- 5. 이 변경 전에 만든 미리보기(skip 없음)를 저장하면 막힌 상품만 저장 때 건너뛴다.
-- 6. 할인 등록에 보관 상품이 섞이면 그 상품만 건너뛴다. 할인 계산과 다른 건너뛰는 조건은 그대로다.
-- 7. 새 내부 함수는 봉인되고 운영자 계약이 지금 함수 본문과 같다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.skip_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.skip_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('b1200000-0000-4000-8000-000000000001','authenticated','authenticated','bulk-skip-admin@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='일괄건너뜀검증' where id='b1200000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b1200000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b1200000-0000-4000-8000-000000000011','b1200000-0000-4000-8000-000000000001',now(),now());
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
insert into public.goods(id,ip_id,name,price) values
 ('bskip-bare','bulk-skip-tests','TEST 건너뜀 미비',500),
 ('bskip-gone','bulk-skip-tests','TEST 건너뜀 보관',10000);
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
create temp table bskip_audit_count(n bigint);
grant all on bskip_audit_count to authenticated;

-- 7. 새 내부 함수는 아무 롤도 직접 부르지 못하고, 운영자 계약이 지금 본문과 같다.
select pg_temp.skip_assert(not has_function_privilege('authenticated','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('anon','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('service_role','private.goods_bulk_apply_good(text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_trial_good(text,text,jsonb)','execute')
 and not has_function_privilege('service_role','private.goods_bulk_trial_good(text,text,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_commit_goods_bulk(uuid,uuid,uuid)','execute'),'new helpers are sealed');
select pg_temp.skip_assert((select count(*)=2 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature in ('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','public.admin_commit_goods_bulk(uuid,uuid,uuid)')
   and c.capability='catalog.manage' and c.guard_kind='write' and c.body_md5=md5(p.prosrc))
 and (select count(*)=2 from private.operator_internal_contracts
  where signature in ('private.goods_bulk_apply_good(text,text,jsonb)','private.goods_bulk_trial_good(text,text,jsonb)')),'operator contracts follow the new bodies');

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
-- 시험 적용이 당겨 본 지연 제약은 여전히 commit 때 검사한다: 기본 옵션을 잠깐 비워도 바로 거절되지 않는다.
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
select pg_temp.skip_assert(pg_temp.skip_commit(3)->>'goodsCount'='1' and jsonb_array_length(pg_temp.skip_commit(3)->'skipped')=2,'start applies to one good');
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
update private.goods_bulk_operations set preview=jsonb_set(preview,'{goods}',(select jsonb_agg(r-'skip') from jsonb_array_elements(preview->'goods') r))
 where id=md5('bulk-skip:10')::uuid;
set local role authenticated;
select pg_temp.skip_assert(pg_temp.skip_commit(10)->>'state'='completed' and pg_temp.skip_commit(10)->>'goodsCount'='1'
 and pg_temp.skip_receipt_reasons(pg_temp.skip_commit(10))='{"bskip-nokc":"good_has_stock"}'::jsonb,
 'a blocked good found at save time is skipped, not the whole batch');
select pg_temp.skip_assert((select archived_at is not null from public.goods where id='bskip-bare') and (select archived_at is null from public.goods where id='bskip-nokc'),
 'the rest of that batch is applied');
reset role;
select pg_temp.skip_assert((select count(*)=1 from public.audit_log where action='catalog.goods_bulk.completed' and target='goods_bulk:'||md5('bulk-skip:10')::uuid::text
  and diff#>'{receipt,skipped}' @> '[{"id":"bskip-nokc","reason":"good_has_stock"}]'::jsonb),'audit keeps the skipped goods');
set local role authenticated;

-- 6. 할인 등록에 보관 상품이 섞이면 그 상품만 건너뛴다.
select pg_temp.skip_assert(pg_temp.skip_reasons(pg_temp.skip_preview(11,'discount','["bskip-bare","bskip-nocat"]',
  jsonb_build_object('mode','rate','value',10,'startsAt',now()+interval '3 days','endsAt',now()+interval '4 days')))
 ='{"bskip-bare":"good_archived","bskip-nocat":null}'::jsonb,'discount skips the archived good');
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
reset role;
rollback;
