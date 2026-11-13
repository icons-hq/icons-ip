\set ON_ERROR_STOP on
-- 1014-103 상담 중 고객의 구매이력: 상담 화면을 여는 모든 운영자 역할(부매니저·대행사 포함)이 그 문의 고객의 주문을
-- 금액·상태와 함께 보고, 열람마다(10분 안 같은 페이지 재조회는 한 번) 감사 기록이 남는다. 범위는 그 문의의 고객뿐이다.
-- 고객 관리의 주문 이력(admin_operator_customer_history)은 지금처럼 주문 조회 권한(sales.read)이 필요하다.
-- 합성 계정·주문·문의는 모두 롤백한다. legacy helper 없이 명시적 매니저 역할로 판정한다.
begin;
create schema inquiry_purchase_test;
create function inquiry_purchase_test.id(n integer) returns uuid language sql immutable as $$
  select ('a1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function inquiry_purchase_test.actor(n integer) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',inquiry_purchase_test.id(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',inquiry_purchase_test.id(n),'role','authenticated')::text,true);
end $$;
create function inquiry_purchase_test.ok(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'inquiry purchase history assertion: %',label;end if;raise notice 'PASS %',label;
end $$;
create function inquiry_purchase_test.error(q text,expected text) returns void language plpgsql as $$ begin
  begin execute q;
  exception when others then if sqlstate=expected or position(expected in sqlerrm)>0 then raise notice 'PASS rejected %',expected;return;end if;raise;end;
  raise exception 'Expected rejection: %',expected;
end $$;
revoke all on all functions in schema inquiry_purchase_test from public;
grant usage on schema inquiry_purchase_test to authenticated;
grant execute on all functions in schema inquiry_purchase_test to authenticated;

select inquiry_purchase_test.ok(not has_function_privilege('anon','public.admin_inquiry_purchase_history(uuid,integer)','execute')
  and not has_function_privilege('service_role','public.admin_inquiry_purchase_history(uuid,integer)','execute')
  and has_function_privilege('authenticated','public.admin_inquiry_purchase_history(uuid,integer)','execute'),'least privilege ACL');
select inquiry_purchase_test.ok((select provolatile='v' and prosecdef from pg_proc where oid='public.admin_inquiry_purchase_history(uuid,integer)'::regprocedure),
  'volatile security definer — writes the view audit through PostgREST');

-- 1 고객 A, 2 고객 B, 3 부매니저, 4 대행사, 5 물류출고관리, 6 계정 주매니저, 7 정지된 부매니저, 8 역할 없는 새 staff, 9 인플루언서.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select inquiry_purchase_test.id(n),'authenticated','authenticated','inquiry-purchase-'||n||'@example.test',now(),
  '{"testFixture":"inquiry-purchase"}','{}',now(),now() from generate_series(1,9)n;
update public.profiles set role=case when id in(inquiry_purchase_test.id(1),inquiry_purchase_test.id(2)) then 'user'::public.user_role else 'staff'::public.user_role end,
  nickname='구매이력 합성 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select inquiry_purchase_test.id(n) from generate_series(1,9)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (inquiry_purchase_test.id(3),'deputy'),(inquiry_purchase_test.id(4),'agency'),(inquiry_purchase_test.id(5),'logistics'),
  (inquiry_purchase_test.id(6),'primary'),(inquiry_purchase_test.id(7),'deputy'),(inquiry_purchase_test.id(9),'influencer');
update public.profiles set suspended_at=now(),suspension_reason='합성 구매이력 권한 검사' where id=inquiry_purchase_test.id(7);

insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
  values(inquiry_purchase_test.id(500),'inquiry-purchase-origin','구매이력 합성 출고지',0,'합성 반송 주소');
insert into public.ips(id,title,vertical_key) values('inquiry-purchase-ip','구매이력 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
  values('inquiry-purchase-good','inquiry-purchase-ip','구매이력 합성 키링','문구',6000,'ok',100,inquiry_purchase_test.id(500));
-- 고객 A 주문 23건(2페이지), 고객 B 주문 2건. A의 101번 주문에 품목 두 줄(수량 2+1).
insert into public.orders(id,user_id,status,total,address,created_at)
select inquiry_purchase_test.id(100+n),inquiry_purchase_test.id(1),case when n=1 then 'delivered'::public.order_status else 'paid'::public.order_status end,
  1000*n,'{}','2026-09-01T00:00:00Z'::timestamptz+n*interval '1 hour' from generate_series(1,23)n;
insert into public.orders(id,user_id,status,total,address,created_at)
select inquiry_purchase_test.id(200+n),inquiry_purchase_test.id(2),'paid',77000+n,'{}','2026-09-02T00:00:00Z'::timestamptz+n*interval '1 hour' from generate_series(1,2)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select inquiry_purchase_test.id(300+n),inquiry_purchase_test.id(101),'inquiry-purchase-good',v.id,case when n=1 then 2 else 1 end,1000,
  case when n=1 then '구매이력 합성 키링' else '구매이력 합성 키링 두번째' end,'문구','inquiry-purchase-ip'
from generate_series(1,2)n join public.goods_variants v on v.good_id='inquiry-purchase-good' and v.is_default;
-- 401: A의 문의(A의 101번 주문 연결), 402: A의 문의에 B의 주문이 연결된 이상 자료(연결 요약을 싣지 않는다), 403: B의 문의.
insert into public.inquiries(id,user_id,category,title,order_id) values
  (inquiry_purchase_test.id(401),inquiry_purchase_test.id(1),'order','합성 배송 문의',inquiry_purchase_test.id(101)),
  (inquiry_purchase_test.id(402),inquiry_purchase_test.id(1),'order','합성 다른 고객 주문 연결',inquiry_purchase_test.id(201)),
  (inquiry_purchase_test.id(403),inquiry_purchase_test.id(2),'etc','합성 기타 문의',null);

set local role authenticated;
select inquiry_purchase_test.actor(3);
create temp table purchase_page1 on commit drop as select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1) as body;
select inquiry_purchase_test.ok((select body->>'inquiryId'=inquiry_purchase_test.id(401)::text and body->>'customerId'=inquiry_purchase_test.id(1)::text
  and (body->>'total')::int=23 and (body->>'page')::int=1 and (body->>'pageSize')::int=20 and jsonb_array_length(body->'items')=20 from purchase_page1),
  'deputy without sales.read reads the inquiry customer order history');
select inquiry_purchase_test.ok((select bool_and(item->>'id' in (select inquiry_purchase_test.id(100+n)::text from generate_series(1,23)n))
  from purchase_page1,jsonb_array_elements(body->'items') item),'only the inquiry customer orders are returned');
select inquiry_purchase_test.ok((select body#>>'{items,0,id}'=inquiry_purchase_test.id(123)::text and (body#>>'{items,0,amount}')::int=23000
  and body#>>'{items,0,status}'='paid' and body#>>'{items,0,orderNumber}' is not null and body#>>'{items,0,title}'='주문 상품'
  and (body#>>'{items,0,itemCount}')::int=0 from purchase_page1),'latest order first with amount, status and order number');
select inquiry_purchase_test.ok((select body#>>'{linkedOrder,id}'=inquiry_purchase_test.id(101)::text and body#>>'{linkedOrder,status}'='delivered'
  and (body#>>'{linkedOrder,amount}')::int=1000 and body#>>'{linkedOrder,title}'='구매이력 합성 키링' and (body#>>'{linkedOrder,quantity}')::int=3
  from purchase_page1),'linked order summary carries status, amount, lead item and quantity');
select inquiry_purchase_test.ok((select not (body::text like '%address%' or body::text like '%payment%' or body::text like '%email%') from purchase_page1),
  'no address, payment or contact fields');
select inquiry_purchase_test.ok((select jsonb_array_length(public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),2)->'items'))=3,'second page');
select inquiry_purchase_test.ok((select (public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),99)->>'page')::int)=2,'out of range page clamps to the last page');
select inquiry_purchase_test.ok((select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(402),1)->'linkedOrder')='null'::jsonb
  and not exists(select 1 from jsonb_array_elements(public.admin_inquiry_purchase_history(inquiry_purchase_test.id(402),1)->'items') item
    where item->>'id' in (inquiry_purchase_test.id(201)::text,inquiry_purchase_test.id(202)::text)),'another customer order linked to the inquiry stays hidden');
select inquiry_purchase_test.ok((select (body->>'total')::int=2 and body->>'customerId'=inquiry_purchase_test.id(2)::text
  from (select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(403),1) body) b),'each inquiry reads its own customer');
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history('a1030000-0000-4000-8000-000000000999',1)$q$,'P0002');
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history(null,1)$q$,'22023');
-- 고객 관리의 주문 이력 길은 넓히지 않는다: 주문 조회 권한이 없는 부매니저는 고객 번호로 주문을 읽지 못한다.
select inquiry_purchase_test.error($q$select public.admin_operator_customer_history(inquiry_purchase_test.id(1),'orders',1)$q$,'42501');
-- 감사 기록은 운영자도 직접 읽지 못한다(플랫폼 관리 권한 RLS).
select inquiry_purchase_test.ok((select count(*) from public.audit_log)=0,'deputy cannot read audit rows directly');

select inquiry_purchase_test.actor(4);
select inquiry_purchase_test.ok((select (public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)->>'total')::int)=23,'agency reads it too');
select inquiry_purchase_test.actor(6);
select inquiry_purchase_test.ok((select (public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)->>'total')::int)=23,'primary manager reads it');
select inquiry_purchase_test.actor(9);
select inquiry_purchase_test.ok((select (public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)->>'total')::int)=23,'influencer reads it');
select inquiry_purchase_test.actor(5);
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)$q$,'42501');
select inquiry_purchase_test.actor(7);
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)$q$,'42501');
select inquiry_purchase_test.actor(8);
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)$q$,'42501');
select inquiry_purchase_test.actor(1);
select inquiry_purchase_test.error($q$select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)$q$,'42501');
reset role;

-- 감사: 첫 열람과 다른 페이지는 남고, 10분 안에 같은 페이지의 똑같은 목록을 다시 읽으면(상담 화면 다시 그리기) 겹쳐 남기지 않는다.
select inquiry_purchase_test.ok((select count(*) from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and target='inquiries:'||inquiry_purchase_test.id(401) and actor_id=inquiry_purchase_test.id(3))=2,'deputy views of pages 1 and 2 are audited once each');
select inquiry_purchase_test.ok((select diff->>'customerId'=inquiry_purchase_test.id(1)::text and (diff->>'total')::int=23
  and jsonb_array_length(diff->'orderIds')=20 and diff->'orderIds'->>0=inquiry_purchase_test.id(123)::text
  and diff->>'linkedOrderId'=inquiry_purchase_test.id(101)::text
  from public.audit_log where action='admin.inquiry.purchase_history_viewed' and target='inquiries:'||inquiry_purchase_test.id(401)
    and actor_id=inquiry_purchase_test.id(3) and diff->>'page'='1'),'audit names the inquiry, customer, operator, shown orders and linked order');
select inquiry_purchase_test.ok((select diff->'linkedOrderId'='null'::jsonb from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and target='inquiries:'||inquiry_purchase_test.id(403) and actor_id=inquiry_purchase_test.id(3)),'an inquiry without a linked order records none');
-- 같은 10분 안이라도 보여 준 목록이 바뀌면(고객의 새 주문) 새 열람으로 남긴다.
insert into public.orders(id,user_id,status,total,address,created_at)
  values(inquiry_purchase_test.id(124),inquiry_purchase_test.id(1),'paid',24000,'{}','2026-09-03T00:00:00Z');
set local role authenticated;
select inquiry_purchase_test.actor(3);
select (public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1)#>>'{items,0,id}')=inquiry_purchase_test.id(124)::text as new_order_shown;
select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1) is not null as same_list_redraw;
reset role;
select inquiry_purchase_test.ok((select count(*) from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and target='inquiries:'||inquiry_purchase_test.id(401) and actor_id=inquiry_purchase_test.id(3) and diff->>'page'='1')=2
  and exists(select 1 from public.audit_log where action='admin.inquiry.purchase_history_viewed' and target='inquiries:'||inquiry_purchase_test.id(401)
    and actor_id=inquiry_purchase_test.id(3) and diff->>'page'='1' and diff->'orderIds'->>0=inquiry_purchase_test.id(124)::text and (diff->>'total')::int=24),
  'a changed list inside the window is audited again; redrawing the same list is not');
select inquiry_purchase_test.ok((select count(distinct actor_id) from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and target='inquiries:'||inquiry_purchase_test.id(401))=4,'each viewing operator has its own audit');
select inquiry_purchase_test.ok(not exists(select 1 from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and actor_id in(inquiry_purchase_test.id(5),inquiry_purchase_test.id(7),inquiry_purchase_test.id(8),inquiry_purchase_test.id(1))),'rejected callers leave no view audit');
update public.audit_log set created_at=clock_timestamp()-interval '11 minutes'
where action='admin.inquiry.purchase_history_viewed' and target='inquiries:'||inquiry_purchase_test.id(401) and actor_id=inquiry_purchase_test.id(3) and diff->>'page'='1';
set local role authenticated;
select inquiry_purchase_test.actor(3);
select public.admin_inquiry_purchase_history(inquiry_purchase_test.id(401),1) is not null as reread_after_window;
reset role;
select inquiry_purchase_test.ok((select count(*) from public.audit_log where action='admin.inquiry.purchase_history_viewed'
  and target='inquiries:'||inquiry_purchase_test.id(401) and actor_id=inquiry_purchase_test.id(3) and diff->>'page'='1')=3,'a view after the 10 minute window is audited again');
select inquiry_purchase_test.ok((select capability='cs.manage' and guard_kind='read' and not legacy_admin_only from private.operator_rpc_contracts
  where signature='public.admin_inquiry_purchase_history(uuid,integer)'),'registered operator RPC contract');
rollback;
