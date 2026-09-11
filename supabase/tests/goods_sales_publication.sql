\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);

create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047651','authenticated','authenticated','sales-publish-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047652','authenticated','authenticated','sales-publish-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000047651';
update public.profiles set nickname='판매게시검증7652',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000047652';
insert into public.verticals(key,label,color) values('sales-publish-tests','판매 게시 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('sales-publish-tests','판매 게시 검증','sales-publish-tests',now());
insert into public.ip_follows(user_id,ip_id,notify_drops) values('00000000-0000-4000-8000-000000047652','sales-publish-tests',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,image_path,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact,published_at)
 values
 ('sales-policy-slug-before','sales-publish-tests','이름 변경 후 성인 게시','문구',10000,'ok',10,'public-media/sales-publish-fixture.webp',
 '제조사','한국','종이','A5','2026-09','CS','02-000',null),
 ('sales-policy-restock-adult','sales-publish-tests','성인 변경 재고 저장','문구',10000,'soldout',0,'public-media/sales-restock-adult.webp',
 '제조사','한국','종이','A5','2026-09','CS','02-000',null),
 ('sales-policy-restock-closed','sales-publish-tests','결제 중지 재고 저장','문구',10000,'soldout',0,'public-media/sales-restock-closed.webp',
 '제조사','한국','종이','A5','2026-09','CS','02-000',null);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('sales-policy-restock-adult');
select pg_temp.publish_goods_kc_fixture('sales-policy-restock-closed');
insert into public.restock_alerts(user_id,good_id) values
 ('00000000-0000-4000-8000-000000047652','sales-policy-restock-adult'),
 ('00000000-0000-4000-8000-000000047652','sales-policy-restock-closed');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047651',true);
select public.admin_save_goods_price_period('sales-policy-slug-before',
 (select id from public.goods_variants where good_id='sales-policy-slug-before' and is_default),null,
 '{"state":"draft","discountPrice":null,"startsAt":null,"endsAt":null}')->>'id' as period_id \gset
select public.admin_save_good(pg_temp.good_payload('sales-policy-slug-before')||'{"id":"sales-policy-slug-after"}');
select 1/case when public.admin_list_goods_price_periods('sales-policy-slug-after')#>>'{0,id}'=:'period_id'
 and public.admin_list_goods_price_periods('sales-policy-slug-after')#>>'{0,goodId}'='sales-policy-slug-after'
 then 1 else 0 end as assert_draft_slug_rename_preserves_price_period_identity;

-- The same save requests an adult classification and first publication. The final
-- classification must exist before any publication trigger sees the new good.
select pg_temp.review_goods_kc_fixture('sales-policy-slug-after');
select public.admin_save_good(pg_temp.good_payload('sales-policy-slug-after')||'{"sale_restriction":"adult","publish":true}');
reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when exists(select 1 from public.goods where id='sales-policy-slug-after' and published_at is not null and sale_restriction='adult')
 and not exists(select 1 from public.notifications where user_id='00000000-0000-4000-8000-000000047652'
   and source_type='good' and source_id='sales-policy-slug-after')
 then 1 else 0 end as assert_adult_first_publish_does_not_announce_public_drop;

-- Controls must also precede an option-stock change in an existing published good.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047651',true);
select public.admin_save_good(jsonb_set(pg_temp.good_payload('sales-policy-restock-adult'),'{variants,0,stockQty}','10')
 ||'{"stock":"ok","sale_restriction":"adult"}');
select public.admin_save_good(jsonb_set(pg_temp.good_payload('sales-policy-restock-closed'),'{variants,0,stockQty}','10')
 ||'{"stock":"ok","allow_card_payment":false,"allow_bank_transfer":false}');
reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select count(*) from public.restock_alerts where user_id='00000000-0000-4000-8000-000000047652'
 and good_id in ('sales-policy-restock-adult','sales-policy-restock-closed') and status='pending')=2
 and not exists(select 1 from public.notifications where user_id='00000000-0000-4000-8000-000000047652'
   and source_type='good' and source_id in ('sales-policy-restock-adult','sales-policy-restock-closed'))
 then 1 else 0 end as assert_closed_sales_do_not_consume_restock_subscriptions;
rollback;
