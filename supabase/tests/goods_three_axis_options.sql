\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000063201','authenticated','authenticated','goods-three-axes@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000063201';
insert into public.verticals(key,label,color) values ('goods-three-axes','3축 옵션 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('goods-three-axes','3축 옵션 검증','goods-three-axes',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063201',true);
select public.admin_save_good('{"id":"three-axis-source","code":"AXIS3-SOURCE","ip_id":"goods-three-axes","name":"3축 옵션 상품","price":1000,"variant_baseline":[],"variants":[{"name":"빨강 / M / 기본","attributes":{"색상":"빨강","사이즈":"M","구성":"기본"},"code":"AXIS3-RED","extraPrice":500,"stockQty":4},{"name":"파랑 / L / 선물","attributes":{"색상":"파랑","사이즈":"L","구성":"선물"},"code":"AXIS3-BLUE","extraPrice":1000,"stockQty":3}]}');
select 1 / case when (select count(*) from public.goods_variants where good_id='three-axis-source' and archived_at is null)=2
 and exists(select 1 from public.goods_variants where code='AXIS3-RED' and price=1500 and stock_qty=4 and attributes='{"색상":"빨강","사이즈":"M","구성":"기본"}'::jsonb)
 and exists(select 1 from public.goods_variants where code='AXIS3-BLUE' and price=2000 and stock_qty=3 and attributes='{"색상":"파랑","사이즈":"L","구성":"선물"}'::jsonb)
 then 1 else 0 end as assert_three_axes_saved_and_read_back;
reset role;

create function pg_temp.three_axis_payload() returns jsonb language sql as $$
 select to_jsonb(g)||jsonb_build_object('previous_id',g.id,
 'variants',(select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,'extraPrice',v.price-g.price,'stockQty',v.stock_qty,'expectedStockQty',v.stock_qty) order by v.sort_order,v.id) from public.goods_variants v where v.good_id=g.id and v.archived_at is null),
 'variant_baseline',(select jsonb_agg(v.id::text order by v.id) from public.goods_variants v where v.good_id=g.id and v.archived_at is null))
 from public.goods g where g.id='three-axis-source'
$$;
select pg_temp.three_axis_payload() as opened_snapshot \gset
select id as source_red_id from public.goods_variants where code='AXIS3-RED' \gset
select id as source_blue_id from public.goods_variants where code='AXIS3-BLUE' \gset
-- A sale after the editor opened must survive a metadata-only save.
update public.goods_variants set stock_qty=3 where id=:'source_red_id'::uuid;
set local role authenticated;
select public.admin_save_good(:'opened_snapshot'::jsonb||'{"name":"3축 메타데이터 수정"}');
select 1 / case when exists(select 1 from public.goods_variants where id=:'source_red_id'::uuid and code='AXIS3-RED' and stock_qty=3 and attributes='{"색상":"빨강","사이즈":"M","구성":"기본"}'::jsonb)
 and exists(select 1 from public.goods_variants where id=:'source_blue_id'::uuid and code='AXIS3-BLUE' and stock_qty=3 and attributes='{"색상":"파랑","사이즈":"L","구성":"선물"}'::jsonb)
 and (select stock_qty from public.goods where id='three-axis-source')=6
 then 1 else 0 end as assert_three_axis_ids_and_concurrent_stock_preserved;
reset role;

select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/three-axis-fixture.webp',notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',notice_as_manager='CS',notice_as_contact='02-000'
where id='three-axis-source';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063201',true);
select pg_temp.review_goods_kc_fixture('three-axis-source');
set local role authenticated;
select public.admin_clone_good('00000000-0000-4000-8000-000000063202','three-axis-source','three-axis-clone','AXIS3-CLONE','3축 복사 상품');
select 1 / case when public.admin_read_goods_kc('three-axis-source')->>'status'='reviewed'
 and public.admin_read_goods_kc('three-axis-clone')->>'status'='unreviewed'
 and (select count(*) from public.goods_variants where good_id='three-axis-clone')=2
 and not exists(select 1 from public.goods_variants where good_id='three-axis-clone' and (stock_qty<>0 or id in (:'source_red_id'::uuid,:'source_blue_id'::uuid)))
 and (select jsonb_agg(attributes order by name) from public.goods_variants where good_id='three-axis-clone')=(select jsonb_agg(attributes order by name) from public.goods_variants where good_id='three-axis-source')
 then 1 else 0 end as assert_clone_preserves_three_axes_with_new_ids_zero_stock_and_fresh_kc;
reset role;
select pg_temp.three_axis_payload() as reviewed_snapshot \gset
set local role authenticated;
select public.admin_save_good(jsonb_set(:'reviewed_snapshot'::jsonb,'{variants,0,attributes,구성}','"한정"'::jsonb));
select 1 / case when public.admin_read_goods_kc('three-axis-source')->>'status'='unreviewed'
 and exists(select 1 from public.goods_variants where id=:'source_red_id'::uuid and attributes->>'구성'='한정' and stock_qty=3)
 then 1 else 0 end as assert_third_axis_change_invalidates_kc_without_replacing_variant;
reset role;
select 1 / case when exists(select 1 from public.audit_log where action='admin.good.options_saved' and actor_id='00000000-0000-4000-8000-000000063201')
 and exists(select 1 from public.audit_log where action='admin.good.kc_invalidated' and target='goods:three-axis-source')
 and exists(select 1 from public.audit_log where action='admin.catalog.good.cloned' and id='00000000-0000-4000-8000-000000063202')
 then 1 else 0 end as assert_three_axis_changes_are_audited;
rollback;
