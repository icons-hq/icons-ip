\set ON_ERROR_STOP on
begin;
create function pg_temp.release_id(kind text,n integer) returns uuid language sql immutable as $$select md5('restriction-release:'||kind||':'||n)::uuid$$;
create function pg_temp.expect_release_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected release error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.release_id('user',n),'authenticated','authenticated','restriction-release-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,110)n;
update public.profiles set role='staff' where id in(select pg_temp.release_id('user',n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.release_id('user',1),'primary'),(pg_temp.release_id('user',2),'primary'),(pg_temp.release_id('user',3),'logistics'),(pg_temp.release_id('user',4),'influencer');
insert into public.orders(id,user_id,status,total,address) values(pg_temp.release_id('order',1),pg_temp.release_id('user',5),'pending',1000,'{"synthetic":true}');
insert into public.goods_purchase_restrictions(id,user_id,reason_code,reason_detail,created_by)
select pg_temp.release_id('restriction',n),pg_temp.release_id('user',n),'other','합성 등록 근거',pg_temp.release_id('user',1) from generate_series(5,104)n;
update public.goods_purchase_restrictions set released_at=now()-interval '1 minute',released_by=pg_temp.release_id('user',2),release_reason='기존 해제 사유' where id=pg_temp.release_id('restriction',6);
create temp table release_before as select to_jsonb(o) as data from public.orders o where id=pg_temp.release_id('order',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',1)::text,true);
select public.admin_release_purchase_restrictions(pg_temp.release_id('op',1),array[pg_temp.release_id('restriction',5),pg_temp.release_id('restriction',6),pg_temp.release_id('restriction',999)],'합성 일괄 해제') as result \gset
select 1/case when (select count(*) from jsonb_array_elements(:'result'::jsonb->'rows')r where r->>'outcome'='released')=1
 and (select count(*) from jsonb_array_elements(:'result'::jsonb->'rows')r where r->>'outcome'='already_released')=1
 and (select count(*) from jsonb_array_elements(:'result'::jsonb->'rows')r where r->>'outcome'='not_found')=1
 and public.admin_get_purchase_restriction_release(pg_temp.release_id('op',1))=:'result'::jsonb then 1 else 0 end as mixed_outcomes_and_readback;
select 1/case when public.admin_release_purchase_restrictions(pg_temp.release_id('op',1),array[pg_temp.release_id('restriction',999),pg_temp.release_id('restriction',6),pg_temp.release_id('restriction',5)],'합성 일괄 해제')=:'result'::jsonb then 1 else 0 end as replay_order_independent;
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',1),array[pg_temp.release_id('restriction',5)],'변경 사유')$q$,'23505');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),'{}','사유')$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),null,'사유')$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[null::uuid],'사유')$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[pg_temp.release_id('restriction',7),pg_temp.release_id('restriction',7)],'사유')$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[pg_temp.release_id('restriction',7)],' ')$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[pg_temp.release_id('restriction',7)],repeat('가',201))$q$,'22023');
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array(select pg_temp.release_id('restriction',n)from generate_series(5,105)n),'사유')$q$,'22023');
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',2)::text,true);
select 1/case when public.admin_get_purchase_restriction_release(pg_temp.release_id('op',1)) is null then 1 else 0 end as actor_bound_read;
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',1),array[pg_temp.release_id('restriction',5),pg_temp.release_id('restriction',6),pg_temp.release_id('restriction',999)],'합성 일괄 해제')$q$,'23505');
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',3)::text,true);
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[pg_temp.release_id('restriction',7)],'사유')$q$,'42501');
select pg_temp.expect_release_error($q$select public.admin_get_purchase_restriction_release(pg_temp.release_id('op',1))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',5)::text,true);
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',2),array[pg_temp.release_id('restriction',7)],'사유')$q$,'42501');
reset role;
-- A new restriction for a previously released buyer is outside the old receipt.
insert into public.goods_purchase_restrictions(id,user_id,reason_code,reason_detail,created_by)
 values(pg_temp.release_id('restriction',105),pg_temp.release_id('user',5),'other','별도 새 등록',pg_temp.release_id('user',1));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',1)::text,true);
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_release_purchase_restrictions(pg_temp.release_id('op',1),
 array[pg_temp.release_id('restriction',5),pg_temp.release_id('restriction',6),pg_temp.release_id('restriction',999)],'합성 일괄 해제')->'rows')r
 where r->>'id'=pg_temp.release_id('restriction',5)::text and (r->>'customerRestricted')::boolean) then 1 else 0 end as replay_preserves_new_restriction;
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',4)::text,true);
select public.admin_release_purchase_restrictions(pg_temp.release_id('op',3),array(select pg_temp.release_id('restriction',n)from generate_series(5,104)n),'100건 제한 해제');
reset role;
select 1/case when not exists(select 1 from public.goods_purchase_restrictions where id in(select pg_temp.release_id('restriction',n)from generate_series(5,104)n) and released_at is null)
 and (select released_at is null from public.goods_purchase_restrictions where id=pg_temp.release_id('restriction',105))
 and (select release_reason='기존 해제 사유' from public.goods_purchase_restrictions where id=pg_temp.release_id('restriction',6))
 and (select data from release_before)=(select to_jsonb(o) from public.orders o where id=pg_temp.release_id('order',1))
 and (select count(*) from public.audit_log where action='admin.purchase_restriction.bulk_released' and actor_id in(pg_temp.release_id('user',1),pg_temp.release_id('user',4)))=2
 and (select count(*) from public.audit_log where action='admin.purchase_restriction.released' and diff->>'restrictionId'=pg_temp.release_id('restriction',5)::text)=1
 then 1 else 0 end as cap_and_no_unrelated_changes;
-- An unexpected row failure rolls back every earlier row and its audit.
insert into public.goods_purchase_restrictions(id,user_id,reason_code,reason_detail,created_by)
select pg_temp.release_id('restriction',n),pg_temp.release_id('user',n),'other','오류 검사',pg_temp.release_id('user',1) from generate_series(106,107)n;
create function pg_temp.fail_bulk_release() returns trigger language plpgsql as $$
begin if new.id=greatest(pg_temp.release_id('restriction',106),pg_temp.release_id('restriction',107)) then raise exception 'synthetic_unexpected_failure';end if;return new;end $$;
create trigger test_bulk_release_failure before update on public.goods_purchase_restrictions for each row execute function pg_temp.fail_bulk_release();
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.release_id('user',1)::text,true);
select pg_temp.expect_release_error($q$select public.admin_release_purchase_restrictions(pg_temp.release_id('op',4),array[pg_temp.release_id('restriction',106),pg_temp.release_id('restriction',107)],'실패 검사')$q$,'synthetic_unexpected_failure');
reset role;
select 1/case when (select count(*) from public.goods_purchase_restrictions where id in(pg_temp.release_id('restriction',106),pg_temp.release_id('restriction',107)) and released_at is null)=2
 and not exists(select 1 from public.audit_log where id=pg_temp.release_id('op',4)) then 1 else 0 end as unexpected_failure_rolls_back;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.release_id('user',1);
set local role authenticated;
select pg_temp.expect_release_error($q$select public.admin_get_purchase_restriction_release(pg_temp.release_id('op',1))$q$,'42501');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_release_purchase_restrictions(uuid,uuid[],text)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_release_purchase_restrictions(uuid,uuid[],text)','EXECUTE')
 and not has_function_privilege('authenticated','private.purchase_restriction_release_receipt(uuid,uuid)','EXECUTE') then 1 else 0 end as sealed_internal_and_public_roles;
rollback;
