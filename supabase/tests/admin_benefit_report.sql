\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-'||lpad((64000+i)::text,12,'0'))::uuid,'authenticated','authenticated','benefit-report-'||i||'@example.test','{}','{}',now(),now() from generate_series(1,1005)i;
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000064001';
insert into public.coupons(code,name,discount_type,discount_value,starts_at,recipient_segment) values
 ('BR-QA-COUPON','첫 구매 50% 표기','fixed',1000,'2026-01-01','first_purchase'),
 ('BR-QA-SECOND','재구매 혜택','percent',10,'2026-01-01','repeat_purchase');
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at)
select ('00000000-0000-4000-8000-'||lpad((65000+i)::text,12,'0'))::uuid,'BR-QA-COUPON',('00000000-0000-4000-8000-'||lpad((64000+i)::text,12,'0'))::uuid,'admin_grant',
 case when i=2 then '2026-09-30T23:59:59+09:00'::timestamptz when i=1005 then '2026-10-02T00:00:00+09:00'::timestamptz else '2026-10-01T00:00:00+09:00'::timestamptz end
from generate_series(2,1005)i;
insert into public.orders(id,user_id,status,total,created_at) values
 ('00000000-0000-4000-8000-000000067001','00000000-0000-4000-8000-000000064002','paid',5000,'2026-10-01'),
 ('00000000-0000-4000-8000-000000067002','00000000-0000-4000-8000-000000064003','done',7000,'2026-10-01'),
 ('00000000-0000-4000-8000-000000067003','00000000-0000-4000-8000-000000064004','pending',8000,'2026-10-01'),
 ('00000000-0000-4000-8000-000000067004','00000000-0000-4000-8000-000000064005','canceled',9000,'2026-10-01');
insert into public.coupon_redemptions(user_coupon_id,coupon_code,user_id,order_id,discount_amount,status,applied_at,released_at) values
 ('00000000-0000-4000-8000-000000065002','BR-QA-COUPON','00000000-0000-4000-8000-000000064002','00000000-0000-4000-8000-000000067001',1000,'applied','2026-10-01T00:00:00+09:00',null),
 ('00000000-0000-4000-8000-000000065003','BR-QA-COUPON','00000000-0000-4000-8000-000000064003','00000000-0000-4000-8000-000000067002',2000,'applied','2026-10-01T23:59:59+09:00',null),
 ('00000000-0000-4000-8000-000000065004','BR-QA-COUPON','00000000-0000-4000-8000-000000064004','00000000-0000-4000-8000-000000067003',3000,'applied','2026-10-01T23:59:59+09:00',null),
 ('00000000-0000-4000-8000-000000065005','BR-QA-COUPON','00000000-0000-4000-8000-000000064005','00000000-0000-4000-8000-000000067004',4000,'released','2026-09-29T12:00:00+09:00','2026-10-01T12:00:00+09:00');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064001',true);
do $$declare r jsonb;begin
 r:=public.admin_benefit_report('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','BR-QA-');
 if r->'summary' <> '{"issued":1002,"paidUses":2,"discountAmount":3000,"orderAmount":12000,"released":1,"cohortPaidUses":1}'::jsonb then raise exception 'wrong report %',r;end if;
 if jsonb_array_length(r->'daily')<>1 or r->'daily'->0->>'date'<>'2026-10-01' then raise exception 'KST boundary %',r;end if;
 if (public.admin_benefit_report('2026-10-01','2026-10-02','50%')->>'couponCount')::int<>1
 or(public.admin_benefit_report('2026-10-01','2026-10-02','50_')->>'couponCount')::int<>0 then raise exception 'literal search';end if;
 if(public.admin_benefit_report('2026-10-01','2026-10-02','BR-QA-',p_discount:='percent')->>'couponCount')::int<>0 then raise exception 'type filter';end if;
 r:=public.admin_benefit_report('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BR-QA-COUPON',p_limit:=2,p_offset:=2);
 if(r->>'useCount')::int<>4 or jsonb_array_length(r->'uses')<>2 then raise exception 'details total pagination %',r;end if;
 begin perform public.admin_benefit_report('2026-01-01','2027-01-03');raise exception 'unbounded accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_benefit_report('2026-01-01','infinity');raise exception 'infinity accepted';exception when invalid_parameter_value then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064002',true);
do $$begin begin perform public.admin_benefit_report('2026-10-01','2026-10-02');raise exception 'nonstaff accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_benefit_report(timestamptz,timestamptz,text,text,text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_benefit_report(timestamptz,timestamptz,text,text,text,text,integer,integer)','execute') then 1 else 0 end as sealed_report;
rollback;
