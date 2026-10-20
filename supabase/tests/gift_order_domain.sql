\set ON_ERROR_STOP on
-- Rollback-only domain/privacy test. Prepend helpers/goods_kc_fixture.sql.
begin;
create function pg_temp.gift_assert(p boolean,p_message text) returns void language plpgsql as $$begin if p is distinct from true then raise exception '%',p_message;end if;end$$;
create function pg_temp.gift_id(n integer) returns uuid language sql immutable as $$select ('93942000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select pg_temp.gift_id(n),'authenticated','authenticated','gift-domain-'||n||'@example.test',now(),'{"testFixture":"gift-domain"}','{}' from generate_series(1,3)n;
update public.profiles set nickname='선물검증'||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(pg_temp.gift_id(1),pg_temp.gift_id(2),pg_temp.gift_id(3));
insert into public.ips(id,title,vertical_key,published_at) values('gift-domain-ip','선물 검증 IP','character',now());
insert into public.goods(id,ip_id,name,type,price) values('gift-domain-good','gift-domain-ip','선물 검증 상품','문구',10000);
update public.goods_variants set stock_qty=100 where good_id='gift-domain-good';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values(('47c47700'||left(md5('gift-domain-good'),24))::uuid,'authenticated','authenticated','gift-kc@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('gift-domain-good'),24))::uuid,'primary');
update private.operator_access_state set configured=true where id;
select pg_temp.publish_goods_kc_fixture('gift-domain-good');
create temp table gift_test_values(key text primary key,value jsonb);grant all on gift_test_values to authenticated,service_role;
insert into gift_test_values values('selection',(select jsonb_build_array(jsonb_build_object('goodId',good_id,'variantId',id,'qty',2,'inputRevision',0,'inputValues','{}'::jsonb)) from public.goods_variants where good_id='gift-domain-good' and is_default));
select pg_temp.gift_assert(not has_table_privilege('authenticated','private.gift_intents','select,insert,update,delete'),'gift table direct ACL');
select pg_temp.gift_assert(not has_table_privilege('service_role','private.gift_recipient_addresses','select,insert,update,delete'),'service recipient address direct ACL');
select pg_temp.gift_assert(not has_function_privilege('authenticated','public.service_begin_gift_claim_session(text,text)','execute'),'guest session service ACL');
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
do $$begin
 begin perform public.create_my_gift(pg_temp.gift_id(10),(select value from gift_test_values where key='selection'),'메시지',pg_temp.gift_id(100),pg_temp.gift_id(1));raise exception 'closed runtime allowed gift';exception when object_not_in_prerequisite_state then null;end;
end$$;
reset role;update private.gift_runtime set enabled=true,privacy_ready=true where singleton;
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.create_my_gift(pg_temp.gift_id(10),(select value from gift_test_values where key='selection'),'안녕하세요',pg_temp.gift_id(100),pg_temp.gift_id(1));
 perform pg_temp.gift_assert(result#>>'{receipt,kind}'='created' and result#>>'{receipt,revision}'='1' and result#>>'{gift,party}'='sender','create outcome');
 result:=public.issue_my_gift_link(pg_temp.gift_id(10),1,repeat('a',64),pg_temp.gift_id(101),pg_temp.gift_id(1));
 perform pg_temp.gift_assert(result#>>'{gift,revision}'='2' and result->>'generation'='1','issue link outcome');
 begin perform public.close_my_gift(pg_temp.gift_id(10),1,pg_temp.gift_id(102),pg_temp.gift_id(1));raise exception 'stale close allowed';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;set local role service_role;
select pg_temp.gift_assert(public.service_begin_gift_claim_session(repeat('a',64),repeat('b',64))>clock_timestamp(),'claim session created');
reset role;set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
do $$declare invitation jsonb;result jsonb;begin
 invitation:=public.read_my_gift_invitation(repeat('b',64));perform pg_temp.gift_assert(invitation->>'id'=pg_temp.gift_id(10)::text and not invitation ?| array['address','senderId','recipientId','total','tokenHash'],'safe invitation');
 perform pg_temp.gift_assert(public.get_my_gift(pg_temp.gift_id(10)) is null,'preaccept not a recipient');
 result:=public.respond_to_gift(pg_temp.gift_id(10),repeat('b',64),true,'{"recipientName":"비공개 수취인","phone":"01000001234","postalCode":"54321","address1":"GIFT-PRIVATE-ADDRESS-ONE","address2":"상세 101호"}',2,pg_temp.gift_id(103),pg_temp.gift_id(2));
 perform pg_temp.gift_assert(result#>>'{gift,party}'='recipient' and result#>>'{gift,address,address1}'='GIFT-PRIVATE-ADDRESS-ONE','accepted recipient address');
 perform pg_temp.gift_assert(public.read_my_gift_invitation(repeat('b',64)) is null,'consumed invitation not readable');
 result:=public.respond_to_gift(pg_temp.gift_id(10),repeat('b',64),true,'{"recipientName":"비공개 수취인","phone":"01000001234","postalCode":"54321","address1":"GIFT-PRIVATE-ADDRESS-ONE","address2":"상세 101호"}',2,pg_temp.gift_id(103),pg_temp.gift_id(2));
 perform pg_temp.gift_assert(result#>>'{receipt,revision}'='3' and result#>>'{gift,revision}'='3','accepted replay same receipt');
 result:=public.update_my_gift_address(pg_temp.gift_id(10),'{"recipientName":"비공개 수취인","phone":"01000001234","postalCode":"54321","address1":"GIFT-PRIVATE-ADDRESS-TWO"}',3,pg_temp.gift_id(104),pg_temp.gift_id(2));
 perform pg_temp.gift_assert(result#>>'{gift,address,address1}'='GIFT-PRIVATE-ADDRESS-TWO' and result#>>'{gift,revision}'='4','address update CAS');
end$$;
select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
do $$declare result jsonb;begin
 result:=public.get_my_gift(pg_temp.gift_id(10));perform pg_temp.gift_assert(result->'address'='null'::jsonb and result::text not like '%GIFT-PRIVATE-ADDRESS%' and result::text not like '%54321%','sender PII blocked');
 result:=public.create_my_gift(pg_temp.gift_id(10),(select value from gift_test_values where key='selection'),'안녕하세요',pg_temp.gift_id(100),pg_temp.gift_id(1));
 perform pg_temp.gift_assert(result#>>'{receipt,revision}'='1' and result#>>'{gift,revision}'='4','immutable original receipt separated from later state');
 begin perform public.update_my_gift_address(pg_temp.gift_id(10),'{"recipientName":"불가","phone":"01000001234","postalCode":"54321","address1":"불가"}',4,pg_temp.gift_id(105),pg_temp.gift_id(1));raise exception 'sender changed recipient address';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.gift_id(3)::text,true);
do $$begin perform pg_temp.gift_assert(public.get_my_gift(pg_temp.gift_id(10)) is null,'third-party gift hidden');
 begin perform public.respond_to_gift(pg_temp.gift_id(10),repeat('b',64),true,'{"recipientName":"불가","phone":"01000001234","postalCode":"54321","address1":"불가"}',2,pg_temp.gift_id(106),pg_temp.gift_id(3));raise exception 'second recipient accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Identity cascade changes the source fingerprint without taking a reverse gift row lock.
insert into gift_test_values values('sourceBefore',(select private.gift_source(g) from private.gift_intents g where id=pg_temp.gift_id(10)));
do $$begin begin update public.goods set id='gift-domain-good-renamed' where id='gift-domain-good';raise exception 'published slug unexpectedly mutable';exception when check_violation then if sqlerrm<>'goods_slug_locked' then raise;end if;end;end$$;
select pg_temp.gift_assert((select private.gift_source(g)=v.value from private.gift_intents g,gift_test_values v where g.id=pg_temp.gift_id(10) and v.key='sourceBefore'),'published identity remains fixed');
-- These two pending rows only exercise read privacy, not financial creation.
select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
insert into public.orders(id,user_id,status,total,address,checkout_key,payment_method,expires_at) values
 (pg_temp.gift_id(20),pg_temp.gift_id(1),'pending',1000,null,pg_temp.gift_id(21),'card',now()+interval '15 minutes'),
 (pg_temp.gift_id(22),pg_temp.gift_id(1),'pending',1000,'{"recipientName":"일반","phone":"01000009999","postalCode":"12345","address1":"일반 주문"}',pg_temp.gift_id(23),'card',now()+interval '15 minutes');
select private.bind_goods_transaction_delivery_snapshot(pg_temp.gift_id(20),pg_temp.gift_id(1),(select private.gift_source(g) from private.gift_intents g where id=pg_temp.gift_id(10)),
 (select address from private.gift_recipient_addresses where gift_id=pg_temp.gift_id(10)),'[{"destinationPostalCode":"54321","matchedAddressPrefix":"GIFT-PRIVATE-REGION"}]');
update private.order_delivery_private_snapshots set address=jsonb_set(address,'{address1}','"GIFT-PRIVATE-ADDRESS-THREE"'),address_revision=1 where order_id=pg_temp.gift_id(20);
set local role authenticated;
select pg_temp.gift_assert((select count(*)=0 from public.orders where id=pg_temp.gift_id(20)),'gift order directly hidden from sender');
select pg_temp.gift_assert((select count(*)=1 from public.orders where id=pg_temp.gift_id(22)),'normal order direct read unchanged');
select pg_temp.gift_assert(not public.gift_direct_order_read_allowed(pg_temp.gift_id(999)),'unknown order privacy helper does not reveal existence');
select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select pg_temp.gift_assert((public.get_my_gift(pg_temp.gift_id(10))#>>'{address,address1}')='GIFT-PRIVATE-ADDRESS-THREE','ordered recipient reads current owner address');
select pg_temp.gift_assert(public.get_my_gift(pg_temp.gift_id(10))#>'{order,total}'='null'::jsonb,'recipient price redacted');
reset role;
select pg_temp.gift_assert(not exists(select 1 from public.audit_log where action like 'gift.%' and (diff::text like '%GIFT-PRIVATE%' or diff::text like '%54321%' or diff::text like '%tokenHash%')),'audit has no PII/token');
select jsonb_build_object('giftDomain',true,'sender',private.gift_detail(pg_temp.gift_id(1),pg_temp.gift_id(10)),'recipient',private.gift_detail(pg_temp.gift_id(2),pg_temp.gift_id(10)));
rollback;
