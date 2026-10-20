\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000013001','authenticated','authenticated','home-rank-staff@example.test','{}','{}'),
 ('00000000-0000-4000-8000-000000013002','authenticated','authenticated','home-rank-user@example.test','{}','{}');
update public.profiles set role='staff',nickname='home_rank_staff' where id='00000000-0000-4000-8000-000000013001';
update public.profiles set nickname='home_rank_user' where id='00000000-0000-4000-8000-000000013002';
insert into public.ips(id,title,vertical_key,published_at) values
 ('home-ranking-ip','홈 자동 선정 검증','character',now()),
 ('home-ranking-draft-ip','초안 IP 검증','character',null);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,sale_restriction,created_at)
select 'home-rank-'||key,case when key='draft-ip' then 'home-ranking-draft-ip' else 'home-ranking-ip' end,
 '집계 검증 '||key,'문구',1000,case when key='soldout' then 'soldout' else 'ok' end,100,
 null,
 (case when key='restricted' then 'adult' else 'none' end)::public.goods_sale_restriction,
 now()-interval '40 days'
from unnest(array['now','yesterday','week-start','month-start','too-old','pending','canceled','refunded','returned','future','no-evidence','draft','draft-ip','restricted','soldout','wished','no-activity','review-today','review-old','review-hidden','review-low']) key;

-- Publish through the same current KC review boundary as real catalog goods.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013001',true);
do $$ declare good_key text; variant_ids jsonb; fingerprint text;
begin
 for good_key in select id from public.goods where id like 'home-rank-%' loop
  select jsonb_agg(id) into variant_ids from public.goods_variants where good_id=good_key and archived_at is null;
  fingerprint:=public.admin_read_goods_kc(good_key)->>'contextFingerprint';
  perform public.admin_save_goods_kc(good_key,jsonb_build_array(jsonb_build_object(
   'family','other','scheme','not_applicable','productCategory','','modelName','',
   'businessRole','','businessName','','identifier','','publicNote','',
   'variantIds',variant_ids,'basis','',
   'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))),
   'reviewed',null,fingerprint,true);
 end loop;
end $$;
reset role;
update public.goods set published_at=now() where id like 'home-rank-%' and id<>'home-rank-draft';

-- Direct synthetic ledgers exercise aggregation, not checkout creation. Amounts
-- deliberately exceed incidental local QA orders so the top ranks are stable.
create function pg_temp.add_rank_order(target integer,good_key text,quantity integer,approved timestamptz,
  order_state public.order_status default 'paid',payment_state public.payment_status default 'paid',bank boolean default false)
returns uuid language plpgsql as $$
declare purchase uuid:=('10000000-0000-4000-8000-'||lpad(target::text,12,'0'))::uuid;
 payment uuid:=('20000000-0000-4000-8000-'||lpad(target::text,12,'0'))::uuid;
 attempt uuid:=('30000000-0000-4000-8000-'||lpad(target::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,address,created_at,payment_method)
 values(purchase,'00000000-0000-4000-8000-000000013002',order_state,quantity::bigint*1000,'{}',now()-interval '90 days',
   case when bank then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end);
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,'home-rank-'||good_key,id,quantity,1000,'합성 집계 상품','문구','home-ranking-ip'
 from public.goods_variants where good_id='home-rank-'||good_key and is_default;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 values(payment,'00000000-0000-4000-8000-000000013002','order',purchase,
  case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,
  quantity::bigint*1000,payment_state,'home-rank-payment-'||target);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,
  '00000000-0000-4000-8000-000000013002','order',purchase,quantity::bigint*1000,'approved','home-rank-attempt-'||target,
  'home-rank-order-'||target,'home-rank-product-'||target,payment,now()+interval '10 minutes');
 if approved is not null then
  if bank then insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo)
   values(purchase,attempt,'00000000-0000-4000-8000-000000013001',approved,'합성 계좌이체 확인');
  else insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',approved); end if;
 end if;
 return purchase;
end $$;

select date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as rank_today \gset
select pg_temp.add_rank_order(13011,'now',500000,:'rank_today'::timestamptz+(now()-:'rank_today'::timestamptz)/2);
select pg_temp.add_rank_order(13012,'yesterday',800000,:'rank_today'::timestamptz-interval '1 microsecond','done');
select pg_temp.add_rank_order(13013,'week-start',700000,:'rank_today'::timestamptz-interval '7 days','shipping');
select pg_temp.add_rank_order(13014,'month-start',1000000,:'rank_today'::timestamptz-interval '30 days','confirmed');
select pg_temp.add_rank_order(13015,'too-old',9900000,:'rank_today'::timestamptz-interval '30 days 1 microsecond');
select pg_temp.add_rank_order(13016,'pending',9900000,now()-interval '1 minute','pending');
select pg_temp.add_rank_order(13017,'canceled',9900000,now()-interval '1 minute','canceled','refunded');
select pg_temp.add_rank_order(13018,'refunded',9900000,now()-interval '1 minute','done','refunded');
select pg_temp.add_rank_order(13019,'returned',9900000,now()-interval '1 minute');
select pg_temp.add_rank_order(13020,'future',9900000,now()+interval '1 hour');
select pg_temp.add_rank_order(13021,'no-evidence',9900000,null);
select pg_temp.add_rank_order(13022,'draft',9900000,now()-interval '1 minute');
select pg_temp.add_rank_order(13023,'draft-ip',9900000,now()-interval '1 minute');
select pg_temp.add_rank_order(13024,'restricted',9900000,now()-interval '1 minute');
select pg_temp.add_rank_order(13025,'soldout',400000,now()-interval '1 minute');
select pg_temp.add_rank_order(13026,'wished',900000,:'rank_today'::timestamptz-interval '12 hours','delivered','paid',true);
select pg_temp.add_rank_order(13027,'no-activity',9900000,now()-interval '1 minute');
update public.payments set user_id='00000000-0000-4000-8000-000000013001' where id='20000000-0000-4000-8000-000000013027';
select pg_temp.add_rank_order(13028,'no-activity',9900000,now()-interval '1 minute');
update public.payments set amount=amount+100 where id='20000000-0000-4000-8000-000000013028';
update public.payment_attempts set amount=amount+100 where id='30000000-0000-4000-8000-000000013028';
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage,status,completed_at)
values('10000000-0000-4000-8000-000000013019','00000000-0000-4000-8000-000000013002','합성 완료 반품','return','completed','completed',now());
insert into public.wishlists(user_id,good_id) values('00000000-0000-4000-8000-000000013002','home-rank-wished');

set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
select public.get_home_sales_rankings() as ranking \gset
select 1/case when :'ranking'::jsonb#>>'{realtime,0}'='home-rank-now'
 and :'ranking'::jsonb#>>'{realtime,1}'='home-rank-soldout'
 and :'ranking'::jsonb->'realtime' ? 'home-rank-wished'
 then 1 else 0 end as assert_current_day_paid_quantity_and_wishlist_fill;
select 1/case when :'ranking'::jsonb#>>'{daily,0}'='home-rank-wished'
 and :'ranking'::jsonb#>>'{daily,1}'='home-rank-yesterday'
 and :'ranking'::jsonb#>>'{weekly,2}'='home-rank-week-start'
 and :'ranking'::jsonb->'monthly'='["home-rank-month-start","home-rank-wished","home-rank-yesterday","home-rank-week-start"]'::jsonb
 then 1 else 0 end as assert_kst_previous_day_week_month_edges_and_bank_confirmation;
select 1/case when not exists(select 1 from jsonb_each(:'ranking'::jsonb) p,
 jsonb_array_elements_text(p.value) id where id in ('home-rank-too-old','home-rank-pending','home-rank-canceled','home-rank-refunded','home-rank-returned','home-rank-future','home-rank-no-evidence','home-rank-draft','home-rank-draft-ip','home-rank-restricted','home-rank-no-activity'))
 then 1 else 0 end as assert_ineligible_sales_never_fill_rankings;
reset role;

-- Visible review statistics and representative content must be identical for a
-- guest and staff even when the staff session can read hidden review rows.
insert into public.reviews(user_id,good_id,order_id,rating,body,created_at) values
 ('00000000-0000-4000-8000-000000013002','home-rank-now','10000000-0000-4000-8000-000000013011',4,'최근 공개 리뷰입니다.',:'rank_today'::timestamptz-interval '7 days'),
 ('00000000-0000-4000-8000-000000013002','home-rank-now','10000000-0000-4000-8000-000000013012',5,'오래된 높은 평점 대표 후기입니다.',:'rank_today'::timestamptz-interval '20 days'),
 ('00000000-0000-4000-8000-000000013002','home-rank-review-today','10000000-0000-4000-8000-000000013011',5,'오늘 작성한 공개 리뷰입니다.',:'rank_today'),
 ('00000000-0000-4000-8000-000000013002','home-rank-review-old','10000000-0000-4000-8000-000000013011',5,'최근 칠일 밖 공개 리뷰입니다.',:'rank_today'::timestamptz-interval '7 days 1 microsecond'),
 ('00000000-0000-4000-8000-000000013002','home-rank-review-low','10000000-0000-4000-8000-000000013011',2,'평점 조건 미달 리뷰입니다.',:'rank_today'::timestamptz-interval '1 day'),
 ('00000000-0000-4000-8000-000000013002','home-rank-draft','10000000-0000-4000-8000-000000013011',5,'초안 상품의 공개 리뷰입니다.',:'rank_today'::timestamptz-interval '1 day');
insert into public.reviews(user_id,good_id,order_id,rating,body,status,hidden_reason,hidden_at,created_at) values
 ('00000000-0000-4000-8000-000000013002','home-rank-now','10000000-0000-4000-8000-000000013013',1,'노출되면 안 되는 블라인드 후기','hidden','합성 검수',now(),now()),
 ('00000000-0000-4000-8000-000000013002','home-rank-review-hidden','10000000-0000-4000-8000-000000013011',5,'노출되면 안 되는 블라인드 후기','hidden','합성 검수',now(),now());

set local role anon;
select public.get_home_review_candidates(array['home-rank-now','home-rank-review-today','home-rank-review-old','home-rank-review-low','home-rank-review-hidden','home-rank-draft']) as review_candidates \gset
select 1/case when jsonb_array_length(:'review_candidates')=4
 and not exists(select 1 from jsonb_array_elements(:'review_candidates') c where c->>'goodId' in ('home-rank-review-hidden','home-rank-draft'))
 and (select c->>'ratingAverage' from jsonb_array_elements(:'review_candidates') c where c->>'goodId'='home-rank-now')='4.50'
 and (select c#>>'{representative,body}' from jsonb_array_elements(:'review_candidates') c where c->>'goodId'='home-rank-now')='오래된 높은 평점 대표 후기입니다.'
 and (select c->>'recentReviewAt' from jsonb_array_elements(:'review_candidates') c where c->>'goodId'='home-rank-now') is not null
 and not exists(select 1 from jsonb_array_elements(:'review_candidates') c where c->>'goodId' in ('home-rank-review-today','home-rank-review-old') and c->>'recentReviewAt' is not null)
 then 1 else 0 end as assert_visible_review_statistics_week_edges_and_representative;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013001',true);
select 1/case when public.get_home_review_candidates(array['home-rank-now','home-rank-review-today','home-rank-review-old','home-rank-review-low','home-rank-review-hidden','home-rank-draft'])=:'review_candidates'::jsonb then 1 else 0 end as assert_staff_does_not_leak_hidden_reviews;

select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013051','00000000-0000-4000-8000-000000013061','sales_best',null,'판매량 BEST',null,'/shop',0,now()-interval '1 day',null,true,null,'{"exposure_mode":"all","period":"weekly"}');
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013052','00000000-0000-4000-8000-000000013062','review_best',null,'베스트리뷰',null,'/shop',0,now()-interval '1 day',null,true,null,'{"selection_mode":"rating"}');
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013053','00000000-0000-4000-8000-000000013063','review_best',null,'직접 고른 후기',null,'/shop',0,now()-interval '1 day',null,true,null,'{"selection_mode":"manual","good_ids":["home-rank-now","home-rank-review-old"]}');
select public.admin_upsert_home_curation('00000000-0000-4000-8000-000000013051','00000000-0000-4000-8000-000000013061','sales_best',null,'판매량 BEST',null,'/shop',0,now()-interval '1 day',null,true,null,'{"exposure_mode":"all","period":"weekly"}');

do $$ declare candidate jsonb;
begin
 for candidate in select value from jsonb_array_elements('[null,{}, {"exposure_mode":"all"},{"exposure_mode":"all","period":"yearly"},{"exposure_mode":"all","period":"daily","good_ids":[]}]') loop
  begin perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'sales_best',null,'잘못된 BEST',null,'/shop',0,now(),null,true,null,candidate); raise exception 'invalid sales rule accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_curation_payload' then raise; end if; end;
 end loop;
 for candidate in select value from jsonb_array_elements('[null,{}, {"selection_mode":"rating","good_ids":[]},{"selection_mode":"manual"},{"selection_mode":"manual","good_ids":["g1","g1"]},{"selection_mode":"manual","good_ids":[123]}]') loop
  begin perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'review_best',null,'잘못된 리뷰',null,'/shop',0,now(),null,true,null,candidate); raise exception 'invalid review rule accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_curation_payload' then raise; end if; end;
 end loop;
end $$;

reset role;
update public.home_layout_settings set blocks=null,revision=0 where singleton;
set local role authenticated;
select '[{"key":"reviews:00000000-0000-4000-8000-000000013062","enabled":true},{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"sales:00000000-0000-4000-8000-000000013061","enabled":false}]'::jsonb as ranked_layout \gset
select public.admin_save_home_layout(gen_random_uuid(),0,:'ranked_layout');
select 1/case when (public.get_home_layout_order())[1]='reviews:00000000-0000-4000-8000-000000013062'
 and not ('sales:00000000-0000-4000-8000-000000013061'=any(public.get_home_layout_order())) then 1 else 0 end as assert_ranked_modules_order_and_hidden_state;
do $$ begin
 begin perform public.admin_save_home_layout(gen_random_uuid(),1,'[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true},{"key":"sales:00000000-0000-4000-8000-000000013062","enabled":true}]');
 raise exception 'wrong module kind accepted'; exception when no_data_found then if sqlerrm<>'home_layout_block_not_found' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013002',true);
do $$ begin
 begin perform public.admin_upsert_home_curation(gen_random_uuid(),gen_random_uuid(),'review_best',null,'리뷰',null,'/shop',0,now(),null,true,null,'{"selection_mode":"rating"}');
 raise exception 'non-staff write accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 1/case when not has_function_privilege('service_role','public.get_home_sales_rankings()','execute')
 and not has_function_privilege('service_role','public.get_home_review_candidates(text[])','execute')
 and not has_function_privilege('authenticated','private.is_valid_home_ranked_curation(text,jsonb)','execute')
 and has_function_privilege('anon','public.get_home_sales_rankings()','execute')
 and has_function_privilege('anon','public.get_home_review_candidates(text[])','execute')
 and (select count(*) from public.audit_log where id='00000000-0000-4000-8000-000000013051')=1
 then 1 else 0 end as assert_public_minimal_acl_staff_write_and_idempotent_audit;
rollback;
