begin;
-- 자동 구매확정 소급(2026-10-27 사용자 확정 D11, 네이버 관행 배송완료 + 설정 일수).
-- 정책을 켜면(또는 켜진 채 저장하면) 정책이 꺼져 있던 기간과 구매확정 도입 이전에
-- 배송완료된 주문도 배송완료 시각 + 현재 기간으로 자동 확정 기한을 받는다. 이미 기한을
-- 받은 주문은 그때의 기간을 유지한다. 이 migration은 운영 정책 스위치를 켜지 않는다.

-- 배송완료 시각에 저장할 정책을 읽을 때 정책 저장과 직렬화한다. 저장이 커밋되기를
-- 기다렸다가 새 정책을 읽으므로, 켜는 순간과 겹친 배송완료도 기한 없이 남지 않는다.
create or replace function private.capture_purchase_confirmation_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.purchase_confirmation_policy;begin
 if new.status='delivered' and old.status is distinct from new.status then
  select * into p from private.purchase_confirmation_policy where singleton for share;
  insert into private.order_purchase_confirmations(order_id,policy_snapshot,auto_due_at)
   values(new.id,jsonb_build_object('revision',p.revision,'autoEnabled',p.auto_enabled,'autoAfterDays',p.auto_after_days,'buyerExtensionDays',p.buyer_extension_days),
    case when p.auto_enabled then new.delivered_at+make_interval(days=>p.auto_after_days) end) on conflict(order_id) do nothing;
 end if;return null;
end $$;
revoke all on function private.capture_purchase_confirmation_policy() from public,anon,authenticated,service_role;

-- 기한 없는 배송완료 주문에 현재 정책 기한을 채운다. 정책이 꺼져 있으면 아무것도 하지 않는다.
-- 확정·클레임·보류 판정은 그대로 자동 확정 작업(settle_delivered_orders)이 다시 검사한다.
create function private.backfill_purchase_confirmation_due_dates() returns integer
language plpgsql security definer set search_path='' as $$
declare p private.purchase_confirmation_policy;snapshot jsonb;updated integer:=0;inserted integer:=0;
begin
 select * into p from private.purchase_confirmation_policy where singleton;
 if not p.auto_enabled or p.auto_after_days is null then return 0;end if;
 snapshot:=jsonb_build_object('revision',p.revision,'autoEnabled',true,'autoAfterDays',p.auto_after_days,
  'buyerExtensionDays',p.buyer_extension_days,'retroactive',true);
 update private.order_purchase_confirmations c set revision=c.revision+1,policy_snapshot=snapshot,
  auto_due_at=o.delivered_at+make_interval(days=>p.auto_after_days)
 from public.orders o where o.id=c.order_id and o.status='delivered' and o.delivered_at is not null
  and c.auto_due_at is null and c.confirmed_at is null;
 get diagnostics updated=row_count;
 insert into private.order_purchase_confirmations(order_id,revision,policy_snapshot,auto_due_at)
 select o.id,1,snapshot,o.delivered_at+make_interval(days=>p.auto_after_days) from public.orders o
 where o.status='delivered' and o.delivered_at is not null
  and not exists(select 1 from private.order_purchase_confirmations c where c.order_id=o.id)
 on conflict(order_id) do nothing;
 get diagnostics inserted=row_count;
 return updated+inserted;
end $$;
revoke all on function private.backfill_purchase_confirmation_due_dates() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_save_purchase_confirmation_policy(p_values jsonb, p_revision bigint, p_operation_id uuid, p_actor uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare policy private.purchase_confirmation_policy; prior public.audit_log; request jsonb; result jsonb; field text; retroactive integer;
begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if p_operation_id is null or p_revision is null or p_revision<1 or jsonb_typeof(p_values) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_values))<>5 or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('autoEnabled','autoAfterDays','buyerExtensionDays','evidence','acknowledged'))
  or jsonb_typeof(p_values->'autoEnabled') is distinct from 'boolean' or p_values->'acknowledged' is distinct from 'true'::jsonb
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 1 and 2000 then raise invalid_parameter_value;end if;
 foreach field in array array['autoAfterDays','buyerExtensionDays'] loop
  if p_values->field<>'null'::jsonb and (jsonb_typeof(p_values->field)<>'number' or p_values->>field!~'^[1-9][0-9]*$' or (p_values->>field)::numeric>36500) then raise invalid_parameter_value;end if;
 end loop;
 if p_values->'autoEnabled'='true'::jsonb and p_values->'autoAfterDays'='null'::jsonb then raise invalid_parameter_value;end if;
 select * into policy from private.purchase_confirmation_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation_id;
 if found then
  if prior.actor_id is distinct from p_actor or prior.action<>'admin.purchase_confirmation.policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;
  return prior.diff->'result';end if;
 if policy.revision<>p_revision then raise sqlstate 'PT409' using message='purchase_confirmation_changed';end if;
 update private.purchase_confirmation_policy set revision=revision+1,auto_enabled=(p_values->>'autoEnabled')::boolean,auto_after_days=(p_values->>'autoAfterDays')::integer,
  buyer_extension_days=(p_values->>'buyerExtensionDays')::integer,evidence=btrim(p_values->>'evidence'),updated_at=clock_timestamp() where singleton;
 retroactive:=private.backfill_purchase_confirmation_due_dates();
 result:=private.purchase_confirmation_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_actor,'admin.purchase_confirmation.policy','purchase_confirmation',
  jsonb_build_object('request',request,'result',result,'retroactiveDueDates',retroactive));
 return result;
end $function$;

-- 이미 켜진 환경(예: 스테이징)은 이번 배포에서 한 번 채운다. 꺼진 운영 DB에서는 0건이다.
select private.backfill_purchase_confirmation_due_dates();

select private.register_operator_rpc_contract('public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'sales.manage','write',false);
commit;
