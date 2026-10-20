\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000061301','authenticated','authenticated','restriction-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000061302','authenticated','authenticated','restriction-buyer@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000061303','authenticated','authenticated','restriction-other@example.test','{}','{}',now(),now());
update public.profiles set role='staff',nickname='restriction_staff' where id='00000000-0000-4000-8000-000000061301';
update public.profiles set nickname='restriction_buyer',email='restriction-buyer@example.test',birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='00000000-0000-4000-8000-000000061302';
-- Prepend helpers/goods_kc_fixture.sql in this same connection.
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values
 ('00000000-0000-4000-8000-000000061301','restriction-test','합성 출고지',0,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key,published_at) values('restriction-test','합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('restriction-good','restriction-test','합성 상품','문구',10000,'ok',100,'00000000-0000-4000-8000-000000061301');
select pg_temp.publish_goods_kc_fixture('restriction-good');
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select '00000000-0000-4000-8000-000000061302',good_id,id,1 from public.goods_variants where good_id='restriction-good' and is_default;
select set_config('test.restriction_order',public.place_order(
 '00000000-0000-4000-8000-000000061302'::uuid,
 '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,
 '78000000-0000-4000-8000-000000061301'::uuid,'card'::public.order_payment_method)::text,true);
insert into public.orders(id,user_id,status,total,address) values
 ('70000000-0000-4000-8000-000000061303','00000000-0000-4000-8000-000000061303','pending',10000,'{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061301',true);
select 1/case when public.admin_find_purchase_restriction_customer('restriction-buyer@example.test')->>'id'='00000000-0000-4000-8000-000000061302'
 and public.admin_find_purchase_restriction_customer('restriction-buyer') is null then 1 else 0 end as exact_identifier_lookup;
do $$begin
 begin perform public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061302','00000000-0000-4000-8000-000000061302','other','합성 근거','70000000-0000-4000-8000-000000061303');
 raise exception 'wrong buyer evidence accepted';exception when invalid_parameter_value then if sqlerrm<>'purchase_restriction_evidence_owner_mismatch' then raise;end if;end;
 begin perform public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061301','00000000-0000-4000-8000-000000061301','other','직원');
 raise exception 'staff restricted';exception when invalid_parameter_value then if sqlerrm<>'purchase_restriction_customer_not_eligible' then raise;end if;end;
end$$;
select public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061302','00000000-0000-4000-8000-000000061302','repeated_purchase','검증용 반복 구매 근거',current_setting('test.restriction_order')::uuid);
select 1/case when (public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061302','00000000-0000-4000-8000-000000061302','repeated_purchase','검증용 반복 구매 근거',current_setting('test.restriction_order')::uuid)->>'changed')::boolean=false
 and public.admin_search_purchase_restrictions(p_query:='restriction_buyer')->>'total'='1'
 and public.admin_search_purchase_restrictions(p_query:='restriction_buyer')#>>'{rows,0,maskedEmail}'='r***@example.test'
 then 1 else 0 end as registration_replay_and_masked_list;
do $$begin
 begin perform public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061304','00000000-0000-4000-8000-000000061302','other','중복');raise exception 'second active accepted';
 exception when check_violation then if sqlerrm<>'purchase_restriction_already_active' then raise;end if;end;
 begin perform public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061302','00000000-0000-4000-8000-000000061302','other','내용 변경');raise exception 'changed replay accepted';
 exception when check_violation then if sqlerrm<>'purchase_restriction_request_conflict' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061302',true);
select 1/case when (select count(*) from public.goods_purchase_restrictions)=0 then 1 else 0 end as customer_cannot_read_ledger;
do $$begin
 begin perform public.admin_find_purchase_restriction_customer('restriction-buyer@example.test');raise exception 'customer lookup bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_search_purchase_restrictions();raise exception 'customer list bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_release_purchase_restriction('76000000-0000-4000-8000-000000061302','자가 해제');raise exception 'customer release bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061305','00000000-0000-4000-8000-000000061303','other','타인 등록');raise exception 'customer register bypass';exception when insufficient_privilege then null;end;
 begin perform public.place_order('{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb, '78000000-0000-4000-8000-000000061302'::uuid,'card'::public.order_payment_method);raise exception 'blocked buyer created order';
 exception when check_violation then if sqlerrm<>'goods_purchase_restricted' then raise;end if;end;
end$$;
select 1/case when public.place_order('{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'78000000-0000-4000-8000-000000061301'::uuid,'card'::public.order_payment_method)=current_setting('test.restriction_order')::uuid then 1 else 0 end as existing_checkout_replay_is_not_a_new_purchase;
reset role;
do $$begin
 begin insert into public.orders(user_id,status,total,address) values('00000000-0000-4000-8000-000000061302','pending',0,'{}');raise exception 'direct insert bypass';
 exception when check_violation then if sqlerrm<>'goods_purchase_restricted' then raise;end if;end;
end$$;
update public.orders set address='{"deliveryNote":"기존 주문은 처리 유지"}' where id=current_setting('test.restriction_order')::uuid;
select 1/case when (select suspended_at is null from public.profiles where id='00000000-0000-4000-8000-000000061302')
 and (select address->>'deliveryNote' from public.orders where id=current_setting('test.restriction_order')::uuid)='기존 주문은 처리 유지'
 and (select count(*) from public.audit_log where action='admin.purchase_restriction.registered' and target='profile:00000000-0000-4000-8000-000000061302')=1
 then 1 else 0 end as existing_order_and_account_unchanged_single_audit;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061301',true);
select public.admin_release_purchase_restriction('76000000-0000-4000-8000-000000061302','해제 검증 근거');
select 1/case when (public.admin_release_purchase_restriction('76000000-0000-4000-8000-000000061302','반복 해제')->>'changed')::boolean=false
 and public.admin_search_purchase_restrictions(p_query:='restriction_buyer',p_state:='released')->>'total'='1'
 and public.admin_search_purchase_restrictions(p_query:='restriction_buyer',p_state:='active')->>'total'='0'
 and public.admin_register_purchase_restriction('76000000-0000-4000-8000-000000061302','00000000-0000-4000-8000-000000061302','repeated_purchase','검증용 반복 구매 근거',current_setting('test.restriction_order')::uuid)->>'releasedAt' is not null
 then 1 else 0 end as release_history_and_old_register_replay_never_restricts_again;
reset role;
insert into public.orders(user_id,status,total,address) values('00000000-0000-4000-8000-000000061302','pending',0,'{}');
select 1/case when (select count(*) from public.audit_log where action='admin.purchase_restriction.released' and target='profile:00000000-0000-4000-8000-000000061302')=1
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('admin_find_purchase_restriction_customer','admin_register_purchase_restriction','admin_release_purchase_restriction','admin_search_purchase_restrictions','require_purchase_restriction_staff','assert_goods_purchase_allowed','guard_goods_order_purchase_restriction')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or(n.nspname='private' and has_function_privilege('authenticated',p.oid,'execute')))) then 1 else 0 end as audit_and_execute_boundaries;
rollback;
