\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000042101','authenticated','authenticated','goods-publish@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042101';
insert into public.verticals(key,label,color) values ('goods-publish','상품 게시 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('goods-publish','상품 게시 검증','goods-publish',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042101',true);
select public.admin_save_good('{"ip_id":"goods-publish","name":"Minimal draft"}') as draft \gset
select 1 / case when exists(select 1 from public.goods where id=:'draft'::jsonb->>'id'
 and published_at is null and first_published_at is null and notice_maker is null and type='')
then 1 else 0 end as assert_name_and_ip_are_sufficient_for_draft;
do $$ begin
  perform public.admin_set_good_published('minimal-draft',true);
  raise exception 'incomplete draft was published';
exception when check_violation then
  if sqlerrm<>'goods_publish_incomplete' then raise; end if;
end $$;
select 1 / case when not exists(select 1 from public.search_public_content('Minimal',20) where kind='good') then 1 else 0 end as assert_draft_absent_from_search;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',price=12000,image_path='public-media/publish-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',notice_as_manager='CS',notice_as_contact='02-000-0000'
where id='minimal-draft';
update public.goods_variants set stock_qty=5 where good_id='minimal-draft';
update public.profiles set nickname='goods_publisher',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id='00000000-0000-4000-8000-000000042101';
insert into public.ip_follows(user_id,ip_id) values('00000000-0000-4000-8000-000000042101','goods-publish');
select pg_temp.review_goods_kc_fixture('minimal-draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042101',true);
select public.admin_save_good(to_jsonb(good)||jsonb_build_object('previous_id',good.id,'publish',true)) from public.goods good where id='minimal-draft';
select 1 / case when not public.admin_set_good_published('minimal-draft',true) then 1 else 0 end as assert_publish_idempotent;
select 1 / case when exists(select 1 from public.goods where id='minimal-draft' and published_at is not null and first_published_at is not null)
 and exists(select 1 from public.search_public_content('Minimal',20) where kind='good' and id='minimal-draft')
 and exists(select 1 from public.notifications where source_type='good' and source_id='minimal-draft' and type='drop_published')
 then 1 else 0 end as assert_published_good_visible_and_announced;
insert into public.cart_items(user_id,good_id,qty, variant_id) values('00000000-0000-4000-8000-000000042101','minimal-draft',1, (select id from public.goods_variants where good_id='minimal-draft' and is_default));
reset role;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000042101',
 '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}',
 '10000000-0000-4000-8000-000000042101','card') as order_id \gset
reset role;
set local role authenticated;
select public.admin_set_good_published('minimal-draft',false);
select 1 / case when not public.admin_set_good_published('minimal-draft',false) then 1 else 0 end as assert_unpublish_idempotent;
select 1 / case when not exists(select 1 from public.search_public_content('Minimal',20) where kind='good') then 1 else 0 end as assert_unpublished_search_hidden;
insert into public.cart_items(user_id,good_id,qty, variant_id) values('00000000-0000-4000-8000-000000042101','minimal-draft',1, (select id from public.goods_variants where good_id='minimal-draft' and is_default));
reset role;
set local role service_role;
do $$ declare method public.order_payment_method; begin
 foreach method in array array['card','bank_transfer']::public.order_payment_method[] loop
  begin
   perform public.place_order('00000000-0000-4000-8000-000000042101',
    '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}',gen_random_uuid(),method);
   raise exception 'draft purchase accepted';
  exception when check_violation then if sqlerrm<>'catalog_item_unavailable' then raise; end if; end;
 end loop;
end $$;
select 1 / case when public.place_order('00000000-0000-4000-8000-000000042101',
 '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}',
 '10000000-0000-4000-8000-000000042101','card')=:'order_id'::uuid then 1 else 0 end as assert_frozen_order_retry_survives_unpublish;
reset role;
select 1 / case when (select stock_qty from public.goods where id='minimal-draft')=4
 and (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000042101')=1
 and (select good_name_snapshot from public.order_items where order_id=:'order_id')='Minimal draft'
 then 1 else 0 end as assert_rejected_orders_preserve_inventory_and_history;
insert into public.restock_alerts(user_id,good_id) values('00000000-0000-4000-8000-000000042101','minimal-draft');
update public.goods_variants set stock_qty=0 where good_id='minimal-draft';
update public.goods_variants set stock_qty=2 where good_id='minimal-draft';
select 1 / case when exists(select 1 from public.restock_alerts where good_id='minimal-draft' and status='pending')
 then 1 else 0 end as assert_draft_restock_does_not_notify;
do $$ begin
 begin
  update public.goods set id='new-public-url' where id='minimal-draft';
  raise exception 'public slug renamed';
 exception when check_violation then if sqlerrm<>'goods_slug_locked' then raise; end if; end;
end $$;
select 1 / case when not has_function_privilege('anon','public.admin_set_good_published(text,boolean)','execute')
 and not has_function_privilege('service_role','public.admin_set_good_published(text,boolean)','execute')
 and has_function_privilege('authenticated','public.admin_set_good_published(text,boolean)','execute')
 then 1 else 0 end as assert_publish_acl;
select set_config('request.jwt.claim.sub','',true);
insert into public.goods(id,ip_id,name,type,price,published_at) values('archive-published-good','goods-publish','보관 검증','문구',1000,null);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('archive-published-good');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042101',true);
set local role authenticated;
select public.admin_archive_good('archive-published-good');
select public.admin_unarchive_good('archive-published-good');
select 1 / case when exists(select 1 from public.goods where id='archive-published-good' and archived_at is null and published_at is null and first_published_at is not null)
 then 1 else 0 end as assert_restore_returns_to_draft_without_unlocking_url;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 perform public.admin_set_good_published('minimal-draft',true);
 raise exception 'anonymous publication accepted';
exception when insufficient_privilege then null; end $$;
rollback;
