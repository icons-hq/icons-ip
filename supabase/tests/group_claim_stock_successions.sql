\set ON_ERROR_STOP on
-- Synthetic stock lifecycle; all mutations roll back and all actors are explicit.
begin;

-- Test-only access to the preserved physical engine. New dispatch through the
-- old public RPC is sealed; contact-v2 and public denial are covered separately
-- by order_claim_contact.sql. Keep the original JWT actor/capability checks.
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text,p_items jsonb) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,p_items);
$$;
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,'[]'::jsonb);
$$;
revoke all on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) to authenticated;

load 'safeupdate';
create function pg_temp.gs_id(kind text,n integer) returns uuid language sql immutable as $$select md5('group-stock:'||kind||':'||n)::uuid$$;
create function pg_temp.gs_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected group stock rejection: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.gs_id('actor',n),'authenticated','authenticated','group-stock-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST 재고 '||right(id::text,8),role=case when id=pg_temp.gs_id('actor',1) then 'admin'::public.user_role else 'user'::public.user_role end where id in(select pg_temp.gs_id('actor',n) from generate_series(1,3)n);
-- A combined clone can already contain the financial race's committed owner.
-- Stock operations only need primary capabilities; bootstrap one owner solely
-- when this fixture is the first configured operator in the disposable clone.
insert into private.operator_memberships(profile_id,manager_role)
 select pg_temp.gs_id('actor',1),case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end;
update private.operator_access_state set configured=true where id;
select 1/case when (select configured from private.operator_access_state where id)
 and (select count(*)=1 from private.operator_memberships where manager_role='owner') then 1 else 0 end as assert_single_configured_owner;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',1)::text,true);
insert into public.ips(id,title,vertical_key) values('gs-ip','TEST 재고승계','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.gs_id('origin',1),'gs-origin','TEST 반품지','hanjin',0,'TEST 반품 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 select 'gs-good-'||n,'gs-ip','TEST 실제상품 '||n,'문구',1000,'ok',10,pg_temp.gs_id('origin',1) from generate_series(1,8)n;
-- Historical source options remain archived while the product keeps a live default.
insert into public.goods_variants(id,good_id,name,code,price,stock_qty,sort_order,archived_at)
 values(pg_temp.gs_id('old',1),'gs-good-1','전환 전 파랑','GS-OLD-1',1000,0,1,now()),
 (pg_temp.gs_id('old',2),'gs-good-2','첫 전환 후 파랑','GS-OLD-2',1000,0,1,now());
create function pg_temp.gs_variant(n integer) returns uuid language sql stable as $$select id from public.goods_variants where good_id='gs-good-'||n and is_default$$;
insert into private.goods_group_operations(operation_id,actor_id,session_id,command,request_hash)
 values(pg_temp.gs_id('operation',1),pg_temp.gs_id('actor',1),pg_temp.gs_id('session',1),'convert',repeat('1',64));
insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id) values
 (pg_temp.gs_id('old',1),'gs-good-1',pg_temp.gs_id('old',2),'gs-good-2',pg_temp.gs_id('operation',1),0,pg_temp.gs_id('actor',1)),
 (pg_temp.gs_id('old',2),'gs-good-2',pg_temp.gs_variant(3),'gs-good-3',pg_temp.gs_id('operation',1),10,pg_temp.gs_id('actor',1));
insert into private.goods_groups(id,name,option_names,common_good_id,created_by,updated_by)
 values(pg_temp.gs_id('group',1),'TEST 실제상품',array['색상'],'gs-good-3',pg_temp.gs_id('actor',1),pg_temp.gs_id('actor',1));
insert into private.goods_group_members(group_id,good_id,variant_id,option_values,sort_order)
 select pg_temp.gs_id('group',1),'gs-good-'||n,pg_temp.gs_variant(n),array[n::text],n-3 from generate_series(3,4)n;
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.gs_id('order',n),pg_temp.gs_id('actor',2),case when n=1 then 'pending'::public.order_status else 'delivered'::public.order_status end,
 2000,0,'{}',case when n>1 then now()-interval '2 days' end,case when n>1 then now()-interval '1 day' end from generate_series(1,8)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.gs_id('item',n),pg_temp.gs_id('order',n),'gs-good-1',pg_temp.gs_id('old',1),2,1000,'TEST 구매시 상품','문구','gs-ip' from generate_series(1,8)n;
create temp table gs_purchase_before as select id,to_jsonb(oi) payload from public.order_items oi where good_id='gs-good-1';
select 1/case when good_id='gs-good-3' and variant_id=pg_temp.gs_variant(3) and hop_count=2 and cardinality(operation_path)=2 then 1 else 0 end as assert_two_hop_resolution
 from private.resolve_goods_stock_successor('gs-good-1',pg_temp.gs_id('old',1));
select pg_temp.gs_error(format('select * from private.resolve_goods_stock_successor(%L,%L)','gs-good-2',pg_temp.gs_id('old',1)),'goods_stock_successor_pair_invalid');
select private.restore_order_item_supply(pg_temp.gs_id('item',1),'TEST 미입금 취소');
select private.restore_order_item_supply(pg_temp.gs_id('item',1),'TEST 중복 취소');
select 1/case when (select stock_qty=12 from public.goods_variants where id=pg_temp.gs_variant(3))
 and (select stock_qty=0 from public.goods_variants where id=pg_temp.gs_id('old',1))
 and (select count(*)=1 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('item',1)) then 1 else 0 end as assert_restore_terminal_once;
-- Terminal archival preserves returned stock and never reactivates the product.
update public.goods_variants set stock_qty=0 where id=pg_temp.gs_variant(3);
update public.goods set archived_at=now() where id='gs-good-3';
select private.restore_order_item_supply(pg_temp.gs_id('item',3),'TEST 보관 상품 반품');
select 1/case when (select stock_qty=2 and archived_at is not null from public.goods where id='gs-good-3') then 1 else 0 end as assert_archived_terminal_stock_preserved;
update public.goods set archived_at=null where id='gs-good-3';
update public.goods_variants set stock_qty=14 where id=pg_temp.gs_variant(3);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,collected_at)
 values(pg_temp.gs_id('claim',2),pg_temp.gs_id('order',2),pg_temp.gs_id('actor',2),'TEST 그룹 교환','exchange','collected','legacy',now());
select 1/case when (public.admin_order_claim_detail(pg_temp.gs_id('claim',2))#>>'{order,items,0,currentGoodId}')='gs-good-3'
 and jsonb_array_length(public.admin_order_claim_detail(pg_temp.gs_id('claim',2))#>'{order,items,0,options}')=2 then 1 else 0 end as assert_current_group_candidates;
select pg_temp.gs_error(format('select pg_temp.record_order_claim_reshipment_physical(%L,%L,%L,%L::jsonb)',pg_temp.gs_id('claim',2),'hanjin','GROUP000002',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.gs_id('item',2),'variantId',pg_temp.gs_variant(5)))::text),'reshipment_variant_unavailable');
set local role authenticated;
select pg_temp.record_order_claim_reshipment_physical(pg_temp.gs_id('claim',2),'hanjin','GROUP000002',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.gs_id('item',2),'variantId',pg_temp.gs_variant(4))));
select public.admin_record_order_claim_reshipment(pg_temp.gs_id('claim',2),'hanjin','GROUP000002',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.gs_id('item',2),'variantId',pg_temp.gs_variant(4))));
reset role;
select pg_temp.gs_error(format('select public.admin_record_order_claim_reshipment(%L,%L,%L,%L::jsonb)',pg_temp.gs_id('claim',2),'hanjin','GROUP000002','[]'),'reshipment_conflict');
select 1/case when (select stock_qty=16 from public.goods_variants where id=pg_temp.gs_variant(3))
 and (select stock_qty=8 from public.goods_variants where id=pg_temp.gs_variant(4))
 and not exists(select 1 from public.order_claim_reshipment_items where claim_id=pg_temp.gs_id('claim',2))
 and (select target_good_id='gs-good-4' and returned_good_id='gs-good-3' and source_good_id='gs-good-1' from private.group_claim_reshipment_allocations where claim_id=pg_temp.gs_id('claim',2))
 then 1 else 0 end as assert_separate_allocation_and_net_stock;
select 1/case when (public.admin_order_claim_detail(pg_temp.gs_id('claim',2))#>>'{claim,reshippedItems,0,name}')='TEST 실제상품 4'
 and (public.admin_order_claim_detail(pg_temp.gs_id('claim',2))#>>'{order,items,0,name}')='TEST 구매시 상품'
 and (select good_id='gs-good-4' and generation_kind='exchange' and generation_id=pg_temp.gs_id('claim',2) from private.order_item_physical_unit(pg_temp.gs_id('item',2)))
 then 1 else 0 end as assert_latest_physical_not_original_purchase;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',2)::text,true);
select 1/case when public.get_my_order_claim_reshipment_items(pg_temp.gs_id('order',2))#>>'{0,items,0,name}'='TEST 실제상품 4' then 1 else 0 end as assert_owner_actual_fulfillment_read;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',3)::text,true);
select pg_temp.gs_error(format('select public.get_my_order_claim_reshipment_items(%L)',pg_temp.gs_id('order',2)),'order_not_found');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',1)::text,true);
select private.restore_order_item_supply(pg_temp.gs_id('item',2),'TEST 교환품 반품');
select private.restore_order_item_supply(pg_temp.gs_id('item',2),'TEST 교환품 반품 재시도');
select 1/case when (select stock_qty=10 from public.goods_variants where id=pg_temp.gs_variant(4))
 and (select count(*)=2 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('item',2)) then 1 else 0 end as assert_last_exchange_generation_restored_once;
-- Overflow fails before a restoration receipt or partial stock survives.
update public.goods_variants set stock_qty=2147483647 where id=pg_temp.gs_variant(3);
select pg_temp.gs_error(format('select private.restore_order_item_supply(%L,%L)',pg_temp.gs_id('item',4),'TEST 상한'),'insufficient_or_overflowing_stock');
select 1/case when not exists(select 1 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('item',4))
 and (select stock_qty=2147483647 from public.goods_variants where id=pg_temp.gs_variant(3)) then 1 else 0 end as assert_overflow_atomicity;
update public.goods_variants set stock_qty=16 where id=pg_temp.gs_variant(3);
select pg_temp.gs_error('update private.group_stock_restorations set qty=qty+1 where qty>0','goods_group_history_immutable');
-- Unallocated preorder capacity is not physical stock. Allocated units follow
-- the current successor once, while the historical supply snapshot stays fixed.
insert into private.goods_preorder_policies(id,variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at,stopped_by,stopped_at)
 values(pg_temp.gs_id('preorder',1),pg_temp.gs_id('old',1),'stopped',100,now()-interval '7 days',now()-interval '1 day',current_date,
 'TEST 과거 공급승인',pg_temp.gs_id('actor',1),pg_temp.gs_id('actor',1),now()-interval '7 days',pg_temp.gs_id('actor',1),now());
insert into public.orders(id,user_id,status,total,address)
 select pg_temp.gs_id('order',n),pg_temp.gs_id('actor',2),'pending',2000,'{}' from generate_series(10,11)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
 supply_source,preorder_policy_id,preorder_expected_ship_date,preorder_snapshot)
 select pg_temp.gs_id('item',n),pg_temp.gs_id('order',n),'gs-good-1',pg_temp.gs_id('old',1),2,1000,'TEST 예약 구매','문구','gs-ip',
 'preorder',p.id,p.expected_ship_date,jsonb_build_object('policyId',p.id,'policyRevision',p.revision,'startsAt',p.starts_at,'endsAt',p.ends_at,'expectedShipDate',p.expected_ship_date)
 from generate_series(10,11)n cross join private.goods_preorder_policies p where p.id=pg_temp.gs_id('preorder',1);
insert into private.goods_preorder_reservations(order_item_id,order_id,policy_id,qty,state,allocated_at,allocated_by,allocation_reference)
 select pg_temp.gs_id('item',n),pg_temp.gs_id('order',n),pg_temp.gs_id('preorder',1),2,case when n=10 then 'reserved' else 'allocated' end,
 case when n=11 then now() end,case when n=11 then pg_temp.gs_id('actor',1) end,case when n=11 then 'TEST 실입고' end from generate_series(10,11)n;
select private.restore_order_item_supply(pg_temp.gs_id('item',10),'TEST 미배정 예약 취소');
select 1/case when (select state='released' from private.goods_preorder_reservations where order_item_id=pg_temp.gs_id('item',10))
 and (select stock_qty=16 from public.goods_variants where id=pg_temp.gs_variant(3))
 and not exists(select 1 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('item',10)) then 1 else 0 end as assert_mapped_preorder_capacity_only;
select private.restore_order_item_supply(pg_temp.gs_id('item',11),'TEST 실입고 예약 취소');
select private.restore_order_item_supply(pg_temp.gs_id('item',11),'TEST 실입고 예약 취소 재시도');
select 1/case when (select state='returned' from private.goods_preorder_reservations where order_item_id=pg_temp.gs_id('item',11))
 and (select stock_qty=18 from public.goods_variants where id=pg_temp.gs_variant(3))
 and (select count(*)=1 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('item',11)) then 1 else 0 end as assert_mapped_allocated_preorder_once;
-- Aggregate stock includes archived options. A net-neutral transfer at INT_MAX
-- must apply its negative delta first, and a +1 aggregate overflow must fail.
update public.goods_variants set stock_qty=2147483647 where id=pg_temp.gs_variant(8);
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order,archived_at)
 values(pg_temp.gs_id('archived',8),'gs-good-8','TEST 보관 재고',1000,0,1,now());
select private.apply_group_physical_stock_deltas(jsonb_build_array(
 jsonb_build_object('goodId','gs-good-8','variantId',pg_temp.gs_variant(8),'delta',-1),
 jsonb_build_object('goodId','gs-good-8','variantId',pg_temp.gs_id('archived',8),'delta',1)));
select 1/case when (select stock_qty=2147483647 from public.goods where id='gs-good-8')
 and (select stock_qty=1 from public.goods_variants where id=pg_temp.gs_id('archived',8)) then 1 else 0 end as assert_net_neutral_at_aggregate_ceiling;
select pg_temp.gs_error(format('select private.apply_group_physical_stock_deltas(%L::jsonb)',
 jsonb_build_array(jsonb_build_object('goodId','gs-good-8','variantId',pg_temp.gs_id('archived',8),'delta',1))::text),'stock_aggregate_overflow');

-- A later exchange may swap two zero-stock group members. Net all return and
-- outgoing quantities before applying any movement; no spare stock is needed.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 values(pg_temp.gs_id('order',9),pg_temp.gs_id('actor',2),'delivered',4000,0,'{}',now()-interval '2 days',now()-interval '1 day');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.gs_id('swap-item',n),pg_temp.gs_id('order',9),'gs-good-'||n,pg_temp.gs_variant(n),2,1000,'TEST 스왑 구매 '||n,'문구','gs-ip' from generate_series(3,4)n;
update public.goods_variants set stock_qty=0 where id in(pg_temp.gs_variant(3),pg_temp.gs_variant(4));
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,collected_at)
 values(pg_temp.gs_id('claim',9),pg_temp.gs_id('order',9),pg_temp.gs_id('actor',2),'TEST 재고0 스왑','exchange','collected','legacy',now());
select pg_temp.record_order_claim_reshipment_physical(pg_temp.gs_id('claim',9),'hanjin','GROUP000009',jsonb_build_array(
 jsonb_build_object('orderItemId',pg_temp.gs_id('swap-item',3),'variantId',pg_temp.gs_variant(4)),
 jsonb_build_object('orderItemId',pg_temp.gs_id('swap-item',4),'variantId',pg_temp.gs_variant(3))));
select 1/case when (select count(*)=2 from private.group_claim_reshipment_allocations where claim_id=pg_temp.gs_id('claim',9))
 and (select bool_and(stock_qty=0) from public.goods_variants where id in(pg_temp.gs_variant(3),pg_temp.gs_variant(4)))
 then 1 else 0 end as assert_zero_spare_stock_two_product_swap;
-- Converting the product AFTER this exchange follows the physical good 4, not
-- the original good 3. This fixture models the immutable conversion receipt.
delete from private.goods_group_members where good_id='gs-good-4';
select pg_temp.gs_variant(4) as former_four \gset
update public.goods_variants set is_default=false,archived_at=now() where id=:'former_four';
insert into public.goods_variants(good_id,name,price,stock_qty,is_default,sort_order)
 values('gs-good-4','전환 후 잔류 옵션',1000,0,true,1);
insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id)
 values(:'former_four','gs-good-4',pg_temp.gs_variant(7),'gs-good-7',pg_temp.gs_id('operation',1),0,pg_temp.gs_id('actor',1));
select private.restore_order_item_supply(pg_temp.gs_id('swap-item',3),'TEST 교환 후 다시 전환된 상품의 반품');
select private.restore_order_item_supply(pg_temp.gs_id('swap-item',3),'TEST 같은 반품 재시도');
select 1/case when (select stock_qty=12 from public.goods_variants where id=pg_temp.gs_variant(7))
 and (select stock_qty=0 from public.goods_variants where id=:'former_four')
 and exists(select 1 from private.group_stock_restorations where order_item_id=pg_temp.gs_id('swap-item',3) and generation_kind='exchange'
  and source_good_id='gs-good-4' and target_good_id='gs-good-7' and cardinality(operation_path)=1)
 then 1 else 0 end as assert_latest_physical_after_further_conversion;
-- The same immutable projection is recipient-only on gift orders.
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.gs_id('gift',2),pg_temp.gs_id('actor',2),pg_temp.gs_id('actor',3),'ordered','TEST 결제자','TEST 수령자',now()+interval '1 day',pg_temp.gs_id('order',2),'test');
select 1/case when private.gift_claim_context(pg_temp.gs_id('actor',2),pg_temp.gs_id('gift',2))->'reshipmentHistory'='[]'::jsonb
 and private.gift_claim_context(pg_temp.gs_id('actor',3),pg_temp.gs_id('gift',2))#>>'{reshipmentHistory,0,items,0,name}'='TEST 실제상품 4'
 then 1 else 0 end as assert_gift_payer_recipient_physical_history_privacy;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',2)::text,true);
select pg_temp.gs_error(format('select public.get_my_order_claim_reshipment_items(%L)',pg_temp.gs_id('order',2)),'order_not_found');
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',3)::text,true);
select 1/case when public.get_my_order_claim_reshipment_items(pg_temp.gs_id('order',2))#>>'{0,items,0,name}'='TEST 실제상품 4' then 1 else 0 end as assert_recipient_reader;
reset role;
select set_config('request.jwt.claim.sub',pg_temp.gs_id('actor',1)::text,true);
-- Corrupt topology is rejected, never silently truncated or redirected.
do $$begin begin
 insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id)
 values(pg_temp.gs_variant(3),'gs-good-3',pg_temp.gs_id('old',1),'gs-good-1',pg_temp.gs_id('operation',1),0,pg_temp.gs_id('actor',1));
 perform private.resolve_goods_stock_successor('gs-good-1',pg_temp.gs_id('old',1));
 raise exception 'cycle accepted';
 exception when check_violation then if sqlerrm<>'goods_stock_successor_invalid' then raise;end if;end;end$$;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 select 'gs-chain-'||n,'gs-ip','TEST 승계 체인 '||n,'문구',1000,'soldout',0 from generate_series(1,130)n;
insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id)
 select s.id,s.good_id,t.id,t.good_id,pg_temp.gs_id('operation',1),0,pg_temp.gs_id('actor',1)
 from generate_series(1,129)n join public.goods_variants s on s.good_id='gs-chain-'||n and s.is_default
 join public.goods_variants t on t.good_id='gs-chain-'||(n+1) and t.is_default;
select 1/case when hop_count=99 and good_id='gs-chain-130' then 1 else 0 end as assert_full_supported_family_depth
 from private.resolve_goods_stock_successor('gs-chain-31',(select id from public.goods_variants where good_id='gs-chain-31' and is_default));
select pg_temp.gs_error(format('select private.resolve_goods_stock_successor(%L,%L)','gs-chain-1',(select id from public.goods_variants where good_id='gs-chain-1' and is_default)),'goods_stock_successor_invalid');

select 1/case when not exists(select 1 from gs_purchase_before old join public.order_items oi on oi.id=old.id where old.payload<>to_jsonb(oi)) then 1 else 0 end as assert_purchase_snapshots_unchanged;
select 1/case when not has_table_privilege('authenticated','private.group_claim_reshipment_allocations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.group_stock_restorations','select,insert,update,delete')
 and not has_function_privilege('authenticated','private.order_item_physical_unit(uuid)','execute')
 and not has_function_privilege('anon','public.get_my_order_claim_reshipment_items(uuid)','execute') then 1 else 0 end as assert_private_stock_and_customer_reader_acl;
set constraints all immediate;
rollback;
