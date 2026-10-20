-- Release exactly the selected records; a later restriction for the same buyer
-- must never be released by retrying an older operation.
create function private.purchase_restriction_release_receipt(p_operation_id uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select a.diff->'result' || jsonb_build_object('rows',(
  select jsonb_agg(item || jsonb_build_object('customerRestricted',case when item->>'userId' is null then null else
   exists(select 1 from public.goods_purchase_restrictions r where r.user_id=(item->>'userId')::uuid and r.released_at is null) end) order by ordinal)
  from jsonb_array_elements(a.diff->'result'->'rows') with ordinality x(item,ordinal)
 )) from public.audit_log a where a.id=p_operation_id and a.actor_id=p_actor and a.action='admin.purchase_restriction.bulk_released';
$$;
revoke all on function private.purchase_restriction_release_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_release_purchase_restrictions(p_operation_id uuid,p_restriction_ids uuid[],p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ids uuid[]; reason text:=nullif(btrim(p_reason),''); request jsonb; replay jsonb;
 target uuid; target_user uuid; existing public.goods_purchase_restrictions; rows jsonb:='[]'; result jsonb; outcome text;
begin
 perform private.require_actor_operator_capability(actor,'sales.restrictions',false);
 if p_operation_id is null or cardinality(p_restriction_ids) not between 1 and 100 or p_restriction_ids is null
  or array_position(p_restriction_ids,null) is not null or reason is null or char_length(reason)>200 or reason ~ '[[:cntrl:]]'
  or (select count(distinct id) from unnest(p_restriction_ids) id)<>cardinality(p_restriction_ids)
 then raise invalid_parameter_value using message='invalid_purchase_restriction_bulk_release';end if;
 select array_agg(id order by id) into ids from unnest(p_restriction_ids) id;
 request:=jsonb_build_object('restrictionIds',ids,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('purchase_restriction_release:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.purchase_restriction.bulk_released',request);
 if replay is not null then return private.purchase_restriction_release_receipt(p_operation_id,actor);end if;
 -- Same customer lock as registration, single release, and order creation.
 for target_user in select distinct user_id from public.goods_purchase_restrictions where id=any(ids) order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,0));
 end loop;
 foreach target in array ids loop
  select * into existing from public.goods_purchase_restrictions where id=target for update;
  if not found then
   rows:=rows||jsonb_build_array(jsonb_build_object('id',target,'userId',null,'outcome','not_found','releasedAt',null));
   continue;
  end if;
  if existing.released_at is null then
   perform public.admin_release_purchase_restriction(target,reason);
   select * into existing from public.goods_purchase_restrictions where id=target;
   outcome:='released';
  else outcome:='already_released';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',target,'userId',existing.user_id,'outcome',outcome,'releasedAt',existing.released_at));
 end loop;
 result:=jsonb_build_object('id',p_operation_id,'reason',reason,'completedAt',clock_timestamp(),'rows',rows);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.purchase_restriction.bulk_released',
  'purchase_restriction_release:'||p_operation_id::text,jsonb_build_object('request',request,'result',result));
 return private.purchase_restriction_release_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_release_purchase_restrictions(uuid,uuid[],text) from public,anon,authenticated,service_role;
grant execute on function public.admin_release_purchase_restrictions(uuid,uuid[],text) to authenticated;

create function public.admin_get_purchase_restriction_release(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 perform private.require_actor_operator_capability(actor,'sales.restrictions',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_purchase_restriction_bulk_release';end if;
 -- Waiting for the dispatch transaction distinguishes rollback from in-flight.
 perform pg_advisory_xact_lock(hashtextextended('purchase_restriction_release:'||p_operation_id::text,0));
 return private.purchase_restriction_release_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_get_purchase_restriction_release(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_purchase_restriction_release(uuid) to authenticated;

do $$begin
 perform private.register_operator_rpc_contract('public.admin_release_purchase_restrictions(uuid,uuid[],text)'::regprocedure,'sales.restrictions','write',false);
 perform private.register_operator_rpc_contract('public.admin_get_purchase_restriction_release(uuid)'::regprocedure,'sales.restrictions','read',false);
 perform private.register_operator_internal_contract('private.purchase_restriction_release_receipt(uuid,uuid)'::regprocedure);
end $$;
