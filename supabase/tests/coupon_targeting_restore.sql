\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000004877','authenticated','authenticated','coupon-restore-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',email='coupon-restore-staff@example.test',nickname='coupon_restore_staff',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now()
where id='00000000-0000-4000-8000-000000004877';
insert into public.ips(id,title,vertical_key) values('coupon-restore-ip','쿠폰 복원 합성 IP','character');
-- Target selection is independent from publication. These fixtures stay draft.
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('coupon-restore-a','coupon-restore-ip','복원 대상 합성 A','문구',10000,'ok',5),
 ('coupon-restore-b','coupon-restore-ip','복원 대상 합성 B','문구',10000,'ok',5);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004877',true);
set local role authenticated;
do $$
declare payload jsonb; saved jsonb;
begin
 payload:=jsonb_build_object(
  'target_code','TARGET-RESTORE','target_name','보관 뒤 대상 복원','target_discount_type','fixed','target_discount_value',1000,
  'target_max_discount_amount',null,'target_min_subtotal',0,'target_starts_at',now()-interval '1 day','target_ends_at',null,
  'target_issue_limit',null,'target_status','active','target_grade_benefit',null,'target_previous_code',null,
  'target_recipient_segment','all','target_goods_scope','selected_goods','target_good_ids',jsonb_build_array('coupon-restore-a'),'target_expected_revision',null);
 saved:=public.admin_upsert_coupon_targeted(payload);
 payload:=payload||jsonb_build_object('target_previous_code','TARGET-RESTORE','target_expected_revision',saved->'revision','target_status','archived','target_good_ids','[]'::jsonb);
 saved:=public.admin_upsert_coupon_targeted(payload);
 if not exists(select 1 from public.admin_search_coupons('TARGET-RESTORE','all',20,0)
   where code='TARGET-RESTORE' and status='archived' and goods_scope='selected_goods' and target_good_ids='{}'::text[]) then
  raise exception 'Archived selected-goods coupon did not preserve the empty target list';
 end if;
 payload:=payload||jsonb_build_object('target_expected_revision',saved->'revision','target_status','active','target_good_ids',jsonb_build_array('coupon-restore-b'));
 saved:=public.admin_upsert_coupon_targeted(payload);
 if not exists(select 1 from public.admin_search_coupons('TARGET-RESTORE','active',20,0)
   where code='TARGET-RESTORE' and goods_scope='selected_goods' and target_good_ids=array['coupon-restore-b'] and terms_revision=(saved->>'revision')::integer) then
  raise exception 'Restoring selected goods did not make the coupon retrievable with its new target';
 end if;
end $$;
reset role;
rollback;
