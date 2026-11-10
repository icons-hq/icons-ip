begin;
-- Automatic confirmation is opt-in. Existing deliveries receive no invented
-- deadline; each later first delivery freezes the then-current policy.
create table private.purchase_confirmation_policy (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1 check(revision>0),
 auto_enabled boolean not null default false, auto_after_days integer check(auto_after_days between 1 and 36500),
 buyer_extension_days integer check(buyer_extension_days between 1 and 36500),
 evidence text not null default '' check(char_length(evidence)<=2000), updated_at timestamptz not null default clock_timestamp(),
 check(not auto_enabled or auto_after_days is not null)
);
insert into private.purchase_confirmation_policy(singleton) values(true);
create table private.order_purchase_confirmations (
 order_id uuid primary key references public.orders(id), revision bigint not null default 0,
 policy_snapshot jsonb not null, auto_due_at timestamptz, extension_used boolean not null default false,
 held boolean not null default false, hold_reason text, requested_at timestamptz,
 confirmed_at timestamptz, confirmed_by uuid, confirmation_kind text check(confirmation_kind in ('buyer','automatic'))
);
create table private.purchase_confirmation_events (
 id uuid primary key, order_id uuid not null references public.orders(id), actor_id uuid, session_id uuid,
 kind text not null check(kind in ('request','hold','resume','extend','confirm','automatic')),
 note text not null default '', request jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index purchase_confirmation_event_order on private.purchase_confirmation_events(order_id,created_at,id);
create index purchase_confirmation_due on private.order_purchase_confirmations(auto_due_at,order_id) where not held and confirmed_at is null;
alter table private.purchase_confirmation_policy enable row level security;
alter table private.order_purchase_confirmations enable row level security;
alter table private.purchase_confirmation_events enable row level security;
revoke all on private.purchase_confirmation_policy,private.order_purchase_confirmations,private.purchase_confirmation_events from public,anon,authenticated,service_role;

create function private.purchase_confirmation_policy_document() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',revision,'autoEnabled',auto_enabled,'autoAfterDays',auto_after_days,'buyerExtensionDays',buyer_extension_days,'evidence',evidence,'updatedAt',updated_at)
 from private.purchase_confirmation_policy where singleton;
$$;
revoke all on function private.purchase_confirmation_policy_document() from public,anon,authenticated,service_role;
create function private.purchase_confirmation_identity(p_actor uuid,p_session uuid,p_admin boolean) returns uuid
language plpgsql security definer set search_path='' as $$begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then
  raise insufficient_privilege using message='purchase_confirmation_auth_changed';end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='purchase_confirmation_auth_changed';end if;
 if p_admin then perform private.require_operator_capability('sales.manage',false);
 else perform 1 from public.profiles where id=p_actor for update;perform private.assert_active_user(p_actor);
  if private.is_account_write_fenced(p_actor) then raise insufficient_privilege using message='account_write_fenced';end if;
 end if;return p_actor;
end $$;
revoke all on function private.purchase_confirmation_identity(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.admin_get_purchase_confirmation_policy() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege;end if;
 return private.purchase_confirmation_policy_document();end $$;
revoke all on function public.admin_get_purchase_confirmation_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_purchase_confirmation_policy() to authenticated;
select private.register_operator_rpc_contract('public.admin_get_purchase_confirmation_policy()'::regprocedure,'sales.manage','read',false);
create function public.admin_save_purchase_confirmation_policy(p_values jsonb,p_revision bigint,p_operation_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy private.purchase_confirmation_policy; prior public.audit_log; request jsonb; result jsonb; field text;
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
 result:=private.purchase_confirmation_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_actor,'admin.purchase_confirmation.policy','purchase_confirmation',jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'sales.manage','write',false);

create function private.capture_purchase_confirmation_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.purchase_confirmation_policy;begin
 if new.status='delivered' and old.status is distinct from new.status then
  select * into p from private.purchase_confirmation_policy where singleton;
  insert into private.order_purchase_confirmations(order_id,policy_snapshot,auto_due_at)
   values(new.id,jsonb_build_object('revision',p.revision,'autoEnabled',p.auto_enabled,'autoAfterDays',p.auto_after_days,'buyerExtensionDays',p.buyer_extension_days),
    case when p.auto_enabled then new.delivered_at+make_interval(days=>p.auto_after_days) end) on conflict(order_id) do nothing;
 end if;return null;
end $$;
revoke all on function private.capture_purchase_confirmation_policy() from public,anon,authenticated,service_role;
create trigger order_purchase_confirmation_policy after update of status on public.orders for each row execute function private.capture_purchase_confirmation_policy();

create function private.purchase_confirmation_eligible(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order_id and o.status='delivered' and private.order_all_items_delivered(o.id)
  and exists(select 1 from public.payments p where p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id and p.amount=o.total and p.status='paid')
  and not private.is_account_write_fenced(o.user_id)
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.status in ('requested','processing','needs_review'))
  and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id));
$$;
revoke all on function private.purchase_confirmation_eligible(uuid) from public,anon,authenticated,service_role;
create function private.purchase_confirmation_document(p_order_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderId',o.id,'revision',coalesce(c.revision,0),'status',o.status,'confirmedAt',o.done_at,'confirmationKind',c.confirmation_kind,
  'autoDueAt',c.auto_due_at,'automaticActive',p.auto_enabled and c.auto_due_at is not null,'held',coalesce(c.held,false),'holdReason',c.hold_reason,
  'extensionUsed',coalesce(c.extension_used,false),'extensionDays',(c.policy_snapshot->>'buyerExtensionDays')::integer,'requestedAt',c.requested_at,
  'canConfirm',private.purchase_confirmation_eligible(o.id) and not coalesce(c.held,false),
  'canExtend',private.purchase_confirmation_eligible(o.id) and not coalesce(c.held,false) and p.auto_enabled and c.auto_due_at is not null and not c.extension_used and (c.policy_snapshot->>'buyerExtensionDays')::integer is not null,
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'note',e.note,'at',e.created_at) order by e.created_at,e.id) from private.purchase_confirmation_events e where e.order_id=o.id),'[]'))
 from public.orders o left join private.order_purchase_confirmations c on c.order_id=o.id cross join private.purchase_confirmation_policy p where o.id=p_order_id and p.singleton;
$$;
revoke all on function private.purchase_confirmation_document(uuid) from public,anon,authenticated,service_role;
create function public.get_my_purchase_confirmation(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not exists(select 1 from public.orders where id=p_order_id and user_id=auth.uid()) then raise insufficient_privilege;end if;
 return private.purchase_confirmation_document(p_order_id);end $$;
create function public.admin_get_purchase_confirmation(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege;end if;
 return private.purchase_confirmation_document(p_order_id);end $$;
revoke all on function public.get_my_purchase_confirmation(uuid),public.admin_get_purchase_confirmation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_purchase_confirmation(uuid),public.admin_get_purchase_confirmation(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_purchase_confirmation(uuid)'::regprocedure,'sales.manage','read',false);

-- Keep other notification types verbatim while adding this operational notice.
do $$declare c record;begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.notifications'::regclass and contype='c' and pg_get_constraintdef(oid) like 'CHECK ((type = ANY%' loop
  execute format('alter table public.notifications drop constraint %I',c.conname);
  execute format('alter table public.notifications add constraint %I %s',c.conname,replace(c.definition,'ARRAY[','ARRAY[''purchase_confirmation''::text, '));
 end loop;
end $$;

create function private.change_purchase_confirmation(p_order_id uuid,p_kind text,p_note text,p_revision bigint,p_operation_id uuid,p_actor uuid,p_session uuid,p_admin boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;c private.order_purchase_confirmations;e private.purchase_confirmation_events;request jsonb;at_value timestamptz;active boolean;
begin
 perform private.purchase_confirmation_identity(p_actor,p_session,p_admin);
 if p_operation_id is null or p_revision is null or p_revision<0 or p_kind is null
  or (p_admin and p_kind not in ('request','hold','resume')) or (not p_admin and p_kind not in ('confirm','extend'))
  or p_note is null or char_length(p_note)>500 or p_kind='hold' and char_length(btrim(p_note))<1 then raise invalid_parameter_value;end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found or not p_admin and o.user_id is distinct from p_actor then raise insufficient_privilege;end if;
 request:=jsonb_build_object('kind',p_kind,'note',p_note,'revision',p_revision,'admin',p_admin);
 select * into e from private.purchase_confirmation_events where id=p_operation_id;
 if found then
  if e.order_id<>p_order_id or e.actor_id is distinct from p_actor or e.session_id is distinct from p_session or e.request is distinct from request then raise sqlstate 'PT409' using message='purchase_confirmation_operation_conflict';end if;
  return private.purchase_confirmation_document(p_order_id);end if;
 insert into private.order_purchase_confirmations(order_id,policy_snapshot) values(p_order_id,'{"revision":0,"autoEnabled":false,"autoAfterDays":null,"buyerExtensionDays":null}') on conflict(order_id) do nothing;
 select * into c from private.order_purchase_confirmations where order_id=p_order_id for update;
 if c.revision<>p_revision then raise sqlstate 'PT409' using message='purchase_confirmation_changed';end if;
 if not private.purchase_confirmation_eligible(p_order_id) then raise check_violation using message='purchase_confirmation_unavailable';end if;
 at_value:=clock_timestamp();
 if p_kind='confirm' then
  if c.held then raise check_violation using message='purchase_confirmation_held';end if;
  update private.order_purchase_confirmations set confirmed_at=at_value,confirmed_by=p_actor,confirmation_kind='buyer' where order_id=p_order_id;
  update public.orders set status='done',done_at=at_value where id=p_order_id;
 elsif p_kind='extend' then
  select auto_enabled into active from private.purchase_confirmation_policy where singleton;
  if c.held or not active or c.extension_used or c.auto_due_at is null or (c.policy_snapshot->>'buyerExtensionDays')::integer is null then raise check_violation using message='purchase_confirmation_extension_unavailable';end if;
  update private.order_purchase_confirmations set extension_used=true,auto_due_at=greatest(at_value,c.auto_due_at)+make_interval(days=>(c.policy_snapshot->>'buyerExtensionDays')::integer) where order_id=p_order_id;
 elsif p_kind='hold' then
  if c.held then raise check_violation using message='purchase_confirmation_held';end if;
  update private.order_purchase_confirmations set held=true,hold_reason=btrim(p_note) where order_id=p_order_id;
 elsif p_kind='resume' then
  if not c.held then raise check_violation using message='purchase_confirmation_not_held';end if;
  update private.order_purchase_confirmations set held=false,hold_reason=null where order_id=p_order_id;
 elsif p_kind='request' then
  if c.held or c.requested_at is not null then raise check_violation using message='purchase_confirmation_already_requested';end if;
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(o.user_id,'purchase_confirmation','구매확정을 확인해주세요','받으신 굿즈를 확인하셨다면 주문 상세에서 구매확정을 진행할 수 있습니다. 반품·교환 신청 자격은 별도로 유지됩니다.',
    '/orders/'||o.id,'purchase_confirmation',o.id::text,'purchase-confirmation:'||o.id) on conflict(user_id,dedupe_key) do nothing;
  update private.order_purchase_confirmations set requested_at=at_value where order_id=p_order_id;
 end if;
 update private.order_purchase_confirmations set revision=revision+1 where order_id=p_order_id;
 insert into private.purchase_confirmation_events(id,order_id,actor_id,session_id,kind,note,request,created_at) values(p_operation_id,p_order_id,p_actor,p_session,p_kind,btrim(p_note),request,at_value);
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'order.purchase_confirmation.'||p_kind,'order:'||p_order_id,jsonb_build_object('operationId',p_operation_id,'revision',c.revision+1));
 return private.purchase_confirmation_document(p_order_id);
end $$;
revoke all on function private.change_purchase_confirmation(uuid,text,text,bigint,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public.confirm_my_purchase(p_order_id uuid,p_kind text,p_revision bigint,p_operation_id uuid,p_actor uuid,p_session uuid,p_acknowledged boolean) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if p_acknowledged is distinct from true then raise invalid_parameter_value;end if;
 return private.change_purchase_confirmation(p_order_id,p_kind,'',p_revision,p_operation_id,p_actor,p_session,false);end $$;
create function public.admin_change_purchase_confirmation(p_order_id uuid,p_kind text,p_note text,p_revision bigint,p_operation_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 return private.change_purchase_confirmation(p_order_id,p_kind,p_note,p_revision,p_operation_id,p_actor,p_session,true);end $$;
revoke all on function public.confirm_my_purchase(uuid,text,bigint,uuid,uuid,uuid,boolean),public.admin_change_purchase_confirmation(uuid,text,text,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_my_purchase(uuid,text,bigint,uuid,uuid,uuid,boolean),public.admin_change_purchase_confirmation(uuid,text,text,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_change_purchase_confirmation(uuid,text,text,bigint,uuid,uuid,uuid)'::regprocedure,'sales.manage','write',false);

create or replace function public.settle_delivered_orders() returns integer language plpgsql security definer set search_path='' as $$
declare item record;c private.order_purchase_confirmations;at_value timestamptz;n integer:=0;
begin
 -- A global stop immediately halts all automatic confirmation, including orders
 -- with an older enabled snapshot. Changes never invent dates for old orders.
 if not (select auto_enabled from private.purchase_confirmation_policy where singleton) then return 0;end if;
 for item in select o.id from public.orders o join private.order_purchase_confirmations c on c.order_id=o.id
  where o.status='delivered' and not c.held and c.confirmed_at is null and c.auto_due_at<=clock_timestamp()
   and private.purchase_confirmation_eligible(o.id)
  order by c.auto_due_at,o.id limit 1000 for update of o skip locked loop
  select * into c from private.order_purchase_confirmations where order_id=item.id for update;
  at_value:=clock_timestamp();
  if not (select auto_enabled from private.purchase_confirmation_policy where singleton) or c.held or c.confirmed_at is not null or c.auto_due_at>at_value
   or not private.purchase_confirmation_eligible(item.id) then continue;end if;
  update private.order_purchase_confirmations set revision=revision+1,confirmed_at=at_value,confirmation_kind='automatic' where order_id=item.id;
  insert into private.purchase_confirmation_events(id,order_id,kind,note,request,created_at) values(gen_random_uuid(),item.id,'automatic','',jsonb_build_object('policy',c.policy_snapshot,'dueAt',c.auto_due_at),at_value);
  update public.orders set status='done',done_at=at_value where id=item.id and status='delivered';
  n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.settle_delivered_orders() from public,anon,authenticated,service_role;
grant execute on function public.settle_delivered_orders() to service_role;
commit;
