\set ON_ERROR_STOP on
begin;
select goods_group_edge_test.make_source(10,true);
select goods_group_edge_test.make_source(11);
select goods_group_edge_test.make_source(12);
select goods_group_edge_test.make_source(13);
select goods_group_edge_test.actor();
-- A separately authorized catalogue operator cannot infer or move stored costs.
select public.admin_save_goods_variant_purchase_cost('group-edge-11',goods_group_edge_test.id(1111),4567,'included',null);
select goods_group_edge_test.actor(2);
set local role authenticated;
select 1/case when goods_group_edge_test.preview(11,2)#>'{blockers}' ? 'purchase_cost_permission_required'
 and goods_group_edge_test.preview(11,2)::text not like '%4567%'
 and public.admin_get_goods_group_source('group-edge-11')::text not like '%4567%'
 then 1 else 0 end as assert_cost_permission_and_non_disclosure;
select goods_group_edge_test.actor();
-- Name and first basic option already match the target. Explicit invalidation,
-- rather than an incidental name/attribute change, must require a fresh review.
select goods_group_edge_test.preview(10) as kc_preview \gset
select goods_group_edge_test.confirm((:'kc_preview'::jsonb->>'previewId')::uuid,5010) as kc_receipt \gset
reset role;
set constraints all immediate;
select :'kc_receipt'::jsonb#>>'{group,members,1,goodId}' as kc_child \gset
select 1/case when (select name='TEST 엣지 10 빨강' and published_at is null from public.goods where id='group-edge-10')
 and not private.goods_kc_review_current('group-edge-10') and not private.goods_kc_review_current(:'kc_child')
 then 1 else 0 end as assert_source_kc_review_invalidated_despite_equal_name;
select goods_group_edge_test.assert_error('update public.goods set published_at=now() where id=''group-edge-10''','goods_kc_review_required');
-- A normal unchanged edit keeps the basic unit valid after conversion.
update public.goods set name=name,price=price where id='group-edge-10';
update public.goods_variants set name=name,attributes=attributes where good_id='group-edge-10' and archived_at is null;
select 1/case when (select sum(stock_qty)=31 from public.goods where id in('group-edge-10',:'kc_child')) then 1 else 0 end as assert_noop_preserves_stock;
set constraints all deferred;
-- Global ERP uniqueness still applies after the identity is atomically moved.
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode) values(goods_group_edge_test.id(1121),'EDGE-ERP-UNIQUE','TEST ERP','001122');
select goods_group_edge_test.actor();
set local role authenticated;
select goods_group_edge_test.preview(12) as erp_preview \gset
select goods_group_edge_test.confirm((:'erp_preview'::jsonb->>'previewId')::uuid,5012) as erp_receipt \gset
reset role;
select :'erp_receipt'::jsonb#>>'{group,members,1,variantId}' as erp_target \gset
select goods_group_edge_test.assert_error('insert into private.goods_variant_external_identity(variant_id,erp_code) values(''a6150000-0000-4000-8000-000000001131'',''edge-erp-unique'')','duplicate key');
select 1/case when (select variant_id=:'erp_target' from private.goods_variant_external_identity where erp_code='EDGE-ERP-UNIQUE')
 and not exists(select 1 from private.goods_variant_external_identity where variant_id=goods_group_edge_test.id(1121))
 then 1 else 0 end as assert_erp_identity_one_current_owner;
-- The ordinary media pipeline owns claim/verification/attachment; conversion
-- only adds another binding to the already verified immutable hosted asset.
select public.service_prepare_goods_media_upload(goods_group_edge_test.id(1),goods_group_edge_test.id(6013),'video',4001);
select public.service_begin_goods_media_verification(goods_group_edge_test.id(1),goods_group_edge_test.id(6013));
insert into storage.objects(bucket_id,name,metadata) values('goods-videos','video/a6150000-0000-4000-8000-000000006013.mp4','{"mimetype":"video/mp4","size":4001}');
select public.service_verify_goods_media_upload(goods_group_edge_test.id(1),goods_group_edge_test.id(6013),jsonb_build_object('width',160,'height',120,'durationMs',2000,'byteSize',4001,'sha256',repeat('a',64),'videoCodec','avc1.64000a','audioCodec',null));
select public.service_complete_goods_media_cleanup(goods_group_edge_test.id(6013),'staging');
select jsonb_build_object('video',jsonb_build_object('id',goods_group_edge_test.id(6013),'title','TEST 공유 영상'),'shortclip',null) as media_values \gset
set local role authenticated;
select public.admin_save_good_media('group-edge-13',:'media_values',0,goods_group_edge_test.id(7013));
select goods_group_edge_test.preview(13) as media_preview \gset
select goods_group_edge_test.confirm((:'media_preview'::jsonb->>'previewId')::uuid,5013) as media_receipt \gset
reset role;
select :'media_receipt'::jsonb#>>'{group,members,1,goodId}' as media_child \gset
select 1/case when (select count(*)=2 from private.goods_media_bindings where video_asset_id=goods_group_edge_test.id(6013))
 and (select status='attached' from private.goods_media_assets where id=goods_group_edge_test.id(6013)) then 1 else 0 end as assert_conversion_shares_verified_asset;
set local role authenticated;
select public.admin_save_good_media(:'media_child',:'media_values',1,goods_group_edge_test.id(7014)) as media_noop \gset
select 1/case when public.admin_save_good_media(:'media_child',:'media_values',1,goods_group_edge_test.id(7014))=:'media_noop'::jsonb then 1 else 0 end as assert_child_media_noop_replay;
select goods_group_edge_test.assert_error(format('select public.admin_save_good_media(%L,%L,0,%L)','group-edge-11',:'media_values',goods_group_edge_test.id(7015)),'goods_media_asset_unavailable');
select public.admin_save_good_media('group-edge-13','{"video":null,"shortclip":null}',1,goods_group_edge_test.id(7016));
reset role;
select 1/case when (select status='attached' from private.goods_media_assets where id=goods_group_edge_test.id(6013))
 and (select count(*)=1 from private.goods_media_bindings where video_asset_id=goods_group_edge_test.id(6013))
 and not exists(select 1 from jsonb_array_elements(public.service_claim_goods_media_cleanup(100)) value where value->>'id'=goods_group_edge_test.id(6013)::text)
 then 1 else 0 end as assert_remaining_child_binding_blocks_retirement_and_cleanup;
set local role authenticated;
select public.admin_save_good_media(:'media_child','{"video":null,"shortclip":null}',2,goods_group_edge_test.id(7017));
reset role;
select 1/case when (select status='retired' and expires_at>clock_timestamp()+interval '6 days 23 hours' from private.goods_media_assets where id=goods_group_edge_test.id(6013))
 and not exists(select 1 from private.goods_media_bindings where video_asset_id=goods_group_edge_test.id(6013)) then 1 else 0 end as assert_last_reference_starts_retention;
-- A stale/unconfirmed provider attempt is a commitment even when the associated
-- order is no longer pending. Each of the four unresolved states must block.
do $$declare n integer;attempt_state text;blocked jsonb;begin
 for n,attempt_state in select * from (values(40,'prepared'),(41,'confirming'),(42,'unknown'),(43,'needs_review')) states(n,state) loop
  perform goods_group_edge_test.make_source(n);
  insert into public.orders(id,user_id,status,total,address,created_at,delivered_at)
   values(goods_group_edge_test.id(10000+n),goods_group_edge_test.id(3),'delivered',10000,'{}',now()-interval '2 days',now()-interval '1 day');
  insert into public.order_items(order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_name_snapshot,qty,unit_price)
   select goods_group_edge_test.id(10000+n),v.good_id,v.id,'TEST 이전 구매','문구','group-edge-ip',v.name,1,10000
    from public.goods_variants v where v.good_id='group-edge-'||n and v.is_default;
  insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,expires_at,claim_token,claim_expires_at)
   values(goods_group_edge_test.id(11000+n),'toss',goods_group_edge_test.id(3),'order',goods_group_edge_test.id(10000+n),10000,
    attempt_state::public.payment_attempt_state,'TEST-group-attempt-'||n,'TEST-group-order-'||n,'TEST-group-product-'||n,now()+interval '1 hour',
    case when attempt_state='confirming' then goods_group_edge_test.id(12000+n) end,case when attempt_state='confirming' then now()+interval '1 hour' end);
  perform goods_group_edge_test.actor();
  blocked:=goods_group_edge_test.preview(n);
  if blocked->>'state'<>'blocked' or not (blocked->'blockers' ? 'payment_pending') then raise exception 'Unresolved attempt did not block: %, %',attempt_state,blocked;end if;
 end loop;
end$$;
set constraints all immediate;
rollback;
