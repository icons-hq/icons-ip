-- Purchase-only restriction: new goods orders are blocked, existing order work,
-- tickets, games and account sign-in remain under their existing contracts.
create table public.goods_purchase_restrictions (
 id uuid primary key,
 user_id uuid not null references public.profiles(id),
 reason_code text not null check(reason_code in ('repeated_purchase','verbal_abuse','business_interference','other')),
 reason_detail text not null check(reason_detail=btrim(reason_detail) and length(reason_detail) between 1 and 200),
 evidence_order_id uuid references public.orders(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 released_by uuid references public.profiles(id),
 released_at timestamptz,
 release_reason text,
 check((released_at is null and released_by is null and release_reason is null)
   or (released_at is not null and released_by is not null and release_reason is not null and release_reason=btrim(release_reason) and length(release_reason) between 1 and 200))
);
create unique index goods_purchase_restrictions_one_active on public.goods_purchase_restrictions(user_id) where released_at is null;
create index goods_purchase_restrictions_history on public.goods_purchase_restrictions(created_at desc,id);
alter table public.goods_purchase_restrictions enable row level security;
revoke all on table public.goods_purchase_restrictions from public,anon,authenticated,service_role;
grant select on table public.goods_purchase_restrictions to authenticated;
create policy goods_purchase_restrictions_staff_read on public.goods_purchase_restrictions for select to authenticated using ((select public.is_staff()));

create function private.require_purchase_restriction_staff() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise insufficient_privilege using message='auth_required'; end if;
 perform 1 from public.profiles where id=actor and role in ('staff','admin') and suspended_at is null for share;
 if not found then raise insufficient_privilege using message='forbidden';end if;
 return actor;
end $$;
revoke all on function private.require_purchase_restriction_staff() from public,anon,authenticated,service_role;

create function public.admin_find_purchase_restriction_customer(p_query text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;q text:=nullif(btrim(p_query),'');
begin
 perform private.require_purchase_restriction_staff();
 if q is null or length(q)>254 then raise invalid_parameter_value using message='invalid_customer_lookup';end if;
 -- Exact identifiers only: an unrelated substring cannot enumerate customers.
 select jsonb_build_object('id',p.id,'nickname',p.nickname,'email',p.email,'eligible',p.role='user',
 'activeRestrictionId',(select r.id from public.goods_purchase_restrictions r where r.user_id=p.id and r.released_at is null))
 into result from public.profiles p where p.id::text=lower(q) or lower(p.email)=lower(q) limit 1;
 return result;
end $$;
revoke all on function public.admin_find_purchase_restriction_customer(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_find_purchase_restriction_customer(text) to authenticated;

create function public.admin_register_purchase_restriction(p_request_id uuid,p_user_id uuid,p_reason_code text,p_reason_detail text,p_evidence_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_purchase_restriction_staff();existing public.goods_purchase_restrictions;detail text:=nullif(btrim(p_reason_detail),'');
begin
 if p_request_id is null or p_user_id is null or p_reason_code is null or p_reason_code not in ('repeated_purchase','verbal_abuse','business_interference','other')
   or detail is null or length(detail)>200 then raise invalid_parameter_value using message='invalid_purchase_restriction';end if;
 -- Same lock as place_order, including direct insert callers through the trigger.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 perform 1 from public.profiles where id=p_user_id and role='user' for share;
 if not found then raise invalid_parameter_value using message='purchase_restriction_customer_not_eligible';end if;
 select * into existing from public.goods_purchase_restrictions where id=p_request_id;
 if found then
  if existing.user_id<>p_user_id or existing.reason_code<>p_reason_code or existing.reason_detail<>detail
    or existing.evidence_order_id is distinct from p_evidence_order_id or existing.created_by<>actor then
    raise check_violation using message='purchase_restriction_request_conflict';end if;
  return jsonb_build_object('id',existing.id,'changed',false,'releasedAt',existing.released_at);
 end if;
 if p_evidence_order_id is not null and not exists(select 1 from public.orders where id=p_evidence_order_id and user_id=p_user_id) then
   raise invalid_parameter_value using message='purchase_restriction_evidence_owner_mismatch';end if;
 if exists(select 1 from public.goods_purchase_restrictions where user_id=p_user_id and released_at is null) then
   raise check_violation using message='purchase_restriction_already_active';end if;
 insert into public.goods_purchase_restrictions(id,user_id,reason_code,reason_detail,evidence_order_id,created_by)
 values(p_request_id,p_user_id,p_reason_code,detail,p_evidence_order_id,actor);
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.purchase_restriction.registered','profile:'||p_user_id::text,
 jsonb_build_object('restrictionId',p_request_id,'reasonCode',p_reason_code,'evidenceOrderId',p_evidence_order_id));
 return jsonb_build_object('id',p_request_id,'changed',true);
end $$;
revoke all on function public.admin_register_purchase_restriction(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_register_purchase_restriction(uuid,uuid,text,text,uuid) to authenticated;

create function public.admin_release_purchase_restriction(p_restriction_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_purchase_restriction_staff();existing public.goods_purchase_restrictions;detail text:=nullif(btrim(p_reason),'');target_user uuid;
begin
 if detail is null or length(detail)>200 then raise invalid_parameter_value using message='invalid_purchase_restriction_release';end if;
 select user_id into target_user from public.goods_purchase_restrictions where id=p_restriction_id;
 if not found then raise no_data_found using message='purchase_restriction_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 select * into existing from public.goods_purchase_restrictions where id=p_restriction_id for update;
 if existing.released_at is not null then return jsonb_build_object('id',existing.id,'changed',false);end if;
 update public.goods_purchase_restrictions set released_by=actor,released_at=clock_timestamp(),release_reason=detail where id=p_restriction_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.purchase_restriction.released','profile:'||target_user::text,
 jsonb_build_object('restrictionId',p_restriction_id));
 return jsonb_build_object('id',p_restriction_id,'changed',true);
end $$;
revoke all on function public.admin_release_purchase_restriction(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_release_purchase_restriction(uuid,text) to authenticated;

create function public.admin_search_purchase_restrictions(p_query text default null,p_state text default 'active',p_limit integer default 20,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;q text:=nullif(btrim(p_query),'');
begin
 perform private.require_purchase_restriction_staff();
 if p_state is null or p_state not in ('all','active','released') or p_limit is null or p_limit not in(20,50,100) or p_offset is null or p_offset<0 or p_offset>100000
   or length(q)>254 then raise invalid_parameter_value using message='invalid_purchase_restriction_search';end if;
 with matched as (
 select r.*,p.nickname,left(split_part(coalesce(p.email,''),'@',1),1)||'***@'||split_part(coalesce(p.email,''),'@',2) masked_email,
  creator.nickname creator_name,releaser.nickname releaser_name
 from public.goods_purchase_restrictions r join public.profiles p on p.id=r.user_id
 join public.profiles creator on creator.id=r.created_by left join public.profiles releaser on releaser.id=r.released_by
 where (p_state='all' or (p_state='active' and r.released_at is null) or (p_state='released' and r.released_at is not null))
  and (q is null or p.id::text=lower(q) or lower(p.email)=lower(q) or position(lower(q) in lower(coalesce(p.nickname,'')))>0 or r.evidence_order_id::text=lower(q))
 ), paged as(select * from matched order by created_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'userId',user_id,'nickname',nickname,'maskedEmail',masked_email,'reasonCode',reason_code,'reasonDetail',reason_detail,
  'evidenceOrderId',evidence_order_id,'createdAt',created_at,'createdBy',creator_name,'releasedAt',released_at,'releasedBy',releaser_name,'releaseReason',release_reason
 ) order by created_at desc,id desc) from paged),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_search_purchase_restrictions(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_purchase_restrictions(text,text,integer,integer) to authenticated;

create function private.assert_goods_purchase_allowed(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if exists(select 1 from public.goods_purchase_restrictions where user_id=p_user_id and released_at is null) then
  raise check_violation using message='goods_purchase_restricted';end if;
end $$;
revoke all on function private.assert_goods_purchase_allowed(uuid) from public,anon,authenticated,service_role;
create function private.guard_goods_order_purchase_restriction() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.assert_goods_purchase_allowed(new.user_id);return new;end $$;
revoke all on function private.guard_goods_order_purchase_restriction() from public,anon,authenticated,service_role;
-- All new goods order paths, including the place_order RPC and trusted imports,
-- pass this boundary. Updates to existing orders and idempotent RPC replays do not.
create trigger goods_order_purchase_restriction before insert on public.orders
 for each row execute function private.guard_goods_order_purchase_restriction();
