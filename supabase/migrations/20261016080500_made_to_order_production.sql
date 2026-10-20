begin;
create table private.goods_production_settings (
 good_id text primary key references public.goods(id) on update cascade on delete cascade,
 revision bigint not null default 1 check(revision>0),enabled boolean not null default false,
 lead_days integer check(lead_days between 1 and 365),day_basis text not null default 'calendar' check(day_basis in('calendar','business')),
 closed_dates date[] not null default '{}',public_note text not null default '',evidence text not null,
 updated_at timestamptz not null default clock_timestamp(),check(not enabled or lead_days is not null),check(cardinality(closed_dates)<=1000)
);
alter table private.goods_production_settings enable row level security;
revoke all on private.goods_production_settings from public,anon,authenticated,service_role;
alter table public.order_items add column production_terms_snapshot jsonb;
create table private.order_production_jobs (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,
 order_item_id uuid not null references public.order_items(id) on delete cascade,claim_id uuid references public.order_cancellation_requests(id),
 terms jsonb not null,revision bigint not null default 1 check(revision>0),
 state text not null default 'pending' check(state in('pending','started','completed','canceled')),
 basis_at timestamptz,due_at timestamptz,started_at timestamptz,completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((basis_at is null)=(due_at is null)),check(completed_at is null or started_at is not null and completed_at>=started_at),
 check(state not in('started','completed') or started_at is not null),check(state<>'completed' or completed_at is not null)
);
create unique index production_original_once on private.order_production_jobs(order_item_id) where claim_id is null;
create unique index production_replacement_once on private.order_production_jobs(order_item_id,claim_id) where claim_id is not null;
create index production_order_jobs on private.order_production_jobs(order_id,state);
create table private.order_production_events (
 id uuid primary key,job_id uuid not null references private.order_production_jobs(id) on delete cascade,
 actor_id uuid,session_id uuid,kind text not null,request jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.order_production_jobs enable row level security;
alter table private.order_production_events enable row level security;
revoke all on private.order_production_jobs,private.order_production_events from public,anon,authenticated,service_role;

create function private.goods_production_terms(p_good text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'goodId',good_id,'revision',revision,'leadDays',lead_days,'dayBasis',day_basis,'closedDates',to_jsonb(closed_dates),'publicNote',public_note)
 from private.goods_production_settings where good_id=p_good and enabled;
$$;
create function private.goods_production_document(p_good text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'revision',coalesce(s.revision,0),'enabled',coalesce(s.enabled,false),'leadDays',s.lead_days,
  'dayBasis',coalesce(s.day_basis,'calendar'),'closedDates',to_jsonb(coalesce(s.closed_dates,'{}'::date[])),
  'publicNote',coalesce(s.public_note,''),'evidence',coalesce(s.evidence,''),'updatedAt',coalesce(s.updated_at,g.updated_at))
 from public.goods g left join private.goods_production_settings s on s.good_id=g.id where g.id=p_good;
$$;
create function private.production_identity(p_actor uuid,p_session uuid,p_order uuid,p_capability text) returns void language plpgsql security definer set search_path='' as $$
declare parties uuid[];begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then raise insufficient_privilege;end if;
 parties:=case when p_order is null then array[p_actor] else array_append(private.contact_parties(p_order),p_actor) end;
 perform private.gift_lock_subjects(parties);perform private.lock_operator_subjects(parties);perform private.assert_active_user(p_actor);
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise insufficient_privilege;end if;
 perform private.require_operator_capability(p_capability,false);
end $$;
create function public.admin_get_goods_production(p_good text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('catalog.manage',false);return private.goods_production_document(p_good);end $$;
create function public.admin_save_goods_production(p_good text,p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.goods_production_settings;prior public.audit_log;request jsonb;result jsonb;dates date[];entry jsonb;begin
 perform private.production_identity(p_actor,p_session,null,'catalog.manage');
 if p_operation is null or p_revision is null or p_revision<0 or not private.transaction_json_keys(p_values,array['enabled','leadDays','dayBasis','closedDates','publicNote','evidence','confirmed'])
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or coalesce(p_values->>'dayBasis','') not in('calendar','business')
  or p_values->'leadDays'<>'null'::jsonb and(jsonb_typeof(p_values->'leadDays')<>'number' or p_values->>'leadDays'!~'^[1-9][0-9]*$' or (p_values->>'leadDays')::numeric>365)
  or p_values->'enabled'='true'::jsonb and p_values->'leadDays'='null'::jsonb
  or jsonb_typeof(p_values->'closedDates') is distinct from 'array' or jsonb_array_length(p_values->'closedDates')>1000
  or jsonb_typeof(p_values->'publicNote') is distinct from 'string' or char_length(p_values->>'publicNote')>1000
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 2 and 1000
  or ((p_values->>'evidence')||(p_values->>'publicNote'))~'[[:cntrl:]]' or p_values->'confirmed' is distinct from 'true'::jsonb then raise invalid_parameter_value;end if;
 dates:='{}';
 for entry in select value from jsonb_array_elements(p_values->'closedDates') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_parameter_value;end if;
  begin dates:=array_append(dates,(entry#>>'{}')::date);exception when others then raise invalid_parameter_value;end;
 end loop;
 if cardinality(dates)<>(select count(distinct d) from unnest(dates)d) then raise invalid_parameter_value;end if;
 if p_values->>'dayBasis'='calendar' and cardinality(dates)>0 then raise invalid_parameter_value;end if;
 perform 1 from public.goods where id=p_good and archived_at is null for update;if not found then raise no_data_found;end if;
 select * into old from private.goods_production_settings where good_id=p_good for update;
 request:=jsonb_build_object('goodId',p_good,'values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then if prior.actor_id is distinct from p_actor or prior.action<>'admin.goods.production_policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;return prior.diff->'result';end if;
 if coalesce(old.revision,0)<>p_revision then raise sqlstate 'PT409' using message='production_changed';end if;
 if p_values->'enabled'='true'::jsonb then
  perform private.assert_goods_transaction_runtime();
  if exists(select 1 from public.goods_variants where good_id=p_good and preorder_policy_id is not null and archived_at is null) then raise check_violation using message='production_preorder_conflict';end if;
 end if;
 insert into private.goods_production_settings(good_id,revision,enabled,lead_days,day_basis,closed_dates,public_note,evidence)
 values(p_good,p_revision+1,(p_values->>'enabled')::boolean,(p_values->>'leadDays')::integer,p_values->>'dayBasis',array(select d from unnest(dates)d order by d),btrim(p_values->>'publicNote'),btrim(p_values->>'evidence'))
 on conflict(good_id) do update set revision=excluded.revision,enabled=excluded.enabled,lead_days=excluded.lead_days,day_basis=excluded.day_basis,
  closed_dates=excluded.closed_dates,public_note=excluded.public_note,evidence=excluded.evidence,updated_at=clock_timestamp();
 result:=private.goods_production_document(p_good);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.goods.production_policy','good:'||p_good,jsonb_build_object('request',request,'result',result));return result;
end $$;
create function private.production_deadline(p_at timestamptz,p_terms jsonb) returns timestamptz language plpgsql immutable set search_path='' as $$
declare day_value date:=(p_at at time zone 'Asia/Seoul')::date;counted integer:=0;wanted integer:=(p_terms->>'leadDays')::integer;begin
 if p_at is null then return null;end if;
 if wanted is null or wanted not between 1 and 365 then raise invalid_parameter_value;end if;
 while counted<wanted loop
  day_value:=day_value+1;
  if p_terms->>'dayBasis'='calendar' or extract(isodow from day_value)<6 and not(p_terms->'closedDates' ? day_value::text) then counted:=counted+1;end if;
 end loop;
 return ((day_value+1)::timestamp at time zone 'Asia/Seoul')-interval '1 microsecond';
end $$;
create function private.production_item_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare expected jsonb;version integer;begin
 if tg_op='UPDATE' then
  if new.production_terms_snapshot is distinct from old.production_terms_snapshot then raise check_violation using message='production_terms_immutable';end if;return new;
 end if;
 expected:=private.goods_production_terms(new.good_id);
 if expected is null and new.production_terms_snapshot is null then return new;end if;
 select calculation_version into version from public.orders where id=new.order_id;
 if version<>2 or version is null then raise check_violation using message='production_requires_transaction';end if;
 if new.production_terms_snapshot is distinct from expected then raise check_violation using message='production_terms_changed';end if;
 return new;
end $$;
create trigger production_item_guard before insert or update on public.order_items for each row execute function private.production_item_guard();
create function private.production_item_created() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.production_terms_snapshot is not null then insert into private.order_production_jobs(order_id,order_item_id,terms) values(new.order_id,new.id,new.production_terms_snapshot);end if;return new;end $$;
create trigger production_item_created after insert on public.order_items for each row execute function private.production_item_created();
create function private.production_preorder_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.preorder_policy_id is not null and exists(select 1 from private.goods_production_settings where good_id=new.good_id and enabled) then raise check_violation using message='production_preorder_conflict';end if;return new;end $$;
create trigger production_preorder_guard before insert or update of preorder_policy_id on public.goods_variants for each row execute function private.production_preorder_guard();
create function private.production_payment_valid(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o join public.payments p on p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id and p.amount=o.total and p.status='paid'
  join public.payment_attempts a on a.payment_id=p.id and a.purpose='order' and a.ref_id=o.id and a.user_id=o.user_id and a.provider=p.provider and a.amount=p.amount and a.state='approved'
  where o.id=p_order and(exists(select 1 from private.payment_provider_evidence e where e.payment_attempt_id=a.id and e.approved_at is not null)
   or a.provider='bank_transfer' and exists(select 1 from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id)));
$$;
create function private.production_payment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare at_value timestamptz:=clock_timestamp();begin
 if new.purpose<>'order' then return new;end if;
 if new.status='paid' then update private.order_production_jobs set basis_at=at_value,due_at=private.production_deadline(at_value,terms),updated_at=at_value where order_id=new.ref_id and claim_id is null and basis_at is null;
 elsif new.status in('refunded','canceled') then update private.order_production_jobs set state='canceled',revision=revision+1,updated_at=at_value where order_id=new.ref_id and state<>'canceled';end if;
 return new;end $$;
create trigger production_payment_changed after insert or update of status on public.payments for each row execute function private.production_payment_changed();
create function private.production_order_canceled() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status='canceled' then update private.order_production_jobs set state='canceled',revision=revision+1,updated_at=clock_timestamp() where order_id=new.id and state<>'canceled';end if;return new;end $$;
create trigger production_order_canceled after update of status on public.orders for each row execute function private.production_order_canceled();
create function private.production_claim_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare item public.order_items;basis timestamptz;begin
 if new.reshipped_at is not null and(old.reshipped_at is null or old.reshipped_at is distinct from new.reshipped_at) then
  if exists(select 1 from public.order_items i where i.order_id=new.order_id and i.production_terms_snapshot is not null and not exists(select 1 from private.order_production_jobs j where j.order_item_id=i.id and j.claim_id=new.id and j.state='completed')) then raise check_violation using message='production_incomplete';end if;
 end if;
 if new.claim_type='exchange' and new.stage='collected' then
  basis:=coalesce(new.collected_at,clock_timestamp());
  for item in select * from public.order_items where order_id=new.order_id and production_terms_snapshot is not null order by id loop
   insert into private.order_production_jobs(order_id,order_item_id,claim_id,terms,basis_at,due_at) values(new.order_id,item.id,new.id,item.production_terms_snapshot,basis,private.production_deadline(basis,item.production_terms_snapshot)) on conflict do nothing;
  end loop;
 elsif new.stage in('withdrawn','rejected') or new.claim_type<>'exchange' then update private.order_production_jobs set state='canceled',revision=revision+1,updated_at=clock_timestamp() where claim_id=new.id and state<>'canceled';end if;
 return new;
end $$;
create trigger production_claim_changed before update on public.order_cancellation_requests for each row execute function private.production_claim_changed();
create function private.production_shipment_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status in('shipping','delivered') and(new.status is distinct from old.status or new.shipped_at is distinct from old.shipped_at) then
  if exists(select 1 from public.order_shipment_items si join public.order_items i on i.id=si.order_item_id where si.shipment_id=new.id and i.production_terms_snapshot is not null
    and not exists(select 1 from private.order_production_jobs j where j.order_item_id=i.id and j.claim_id is null and j.state='completed')) then raise check_violation using message='production_incomplete';end if;
 end if;
 if new.exported_at is not null and new.exported_at is distinct from old.exported_at and exists(select 1 from public.order_shipment_items si join private.order_production_jobs j on j.order_item_id=si.order_item_id and j.claim_id is null where si.shipment_id=new.id and j.state<>'completed') then raise check_violation using message='production_incomplete';end if;
 return new;end $$;
create trigger production_shipment_guard before update on public.order_shipments for each row execute function private.production_shipment_guard();
create function private.order_production_document(p_order uuid,p_admin boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderId',o.id,'cancelReviewRequired',exists(select 1 from private.order_production_jobs where order_id=o.id and claim_id is null and started_at is not null),
 'canCancel',private.order_cancel_eligible(o.id),'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'itemId',j.order_item_id,'claimId',j.claim_id,'goodId',i.good_id,'goodName',coalesce(i.good_name_snapshot,g.name),'quantity',i.qty,
 'revision',j.revision,'state',j.state,'terms',j.terms,'basisAt',j.basis_at,'dueAt',j.due_at,'startedAt',j.started_at,'completedAt',j.completed_at,
 'canStart',p_admin and j.state='pending' and j.basis_at is not null and private.production_payment_valid(o.id) and(case when j.claim_id is null then o.status in('paid','confirmed') and not exists(select 1 from public.order_cancellation_requests where order_id=o.id and stage not in('completed','rejected','withdrawn')) else exists(select 1 from public.order_cancellation_requests where id=j.claim_id and claim_type='exchange' and stage='collected') end),
 'canComplete',p_admin and j.state='started' and private.production_payment_valid(o.id) and(case when j.claim_id is null then o.status in('paid','confirmed') and not exists(select 1 from public.order_cancellation_requests where order_id=o.id and stage not in('completed','rejected','withdrawn')) else exists(select 1 from public.order_cancellation_requests where id=j.claim_id and claim_type='exchange' and stage='collected') end),
 'history',case when p_admin then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'at',e.created_at,'evidence',e.request->>'evidence') order by e.created_at,e.id) from private.order_production_events e where e.job_id=j.id),'[]') else '[]'::jsonb end) order by j.created_at,j.id)
 from private.order_production_jobs j join public.order_items i on i.id=j.order_item_id join public.goods g on g.id=i.good_id where j.order_id=o.id),'[]'))
 from public.orders o where o.id=p_order;
$$;
create function public.admin_get_order_production(p_order uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.read',false);return private.order_production_document(p_order,true);end $$;
create function public.get_my_order_production(p_order uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not(auth.uid()=any(private.contact_parties(p_order))) or private.is_account_write_fenced(auth.uid()) then raise insufficient_privilege;end if;
 return private.order_production_document(p_order,false);end $$;
create function public.admin_change_order_production(p_job uuid,p_kind text,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare order_key uuid;job private.order_production_jobs;prior private.order_production_events;request jsonb;result jsonb;document jsonb;row_value jsonb;at_value timestamptz:=clock_timestamp();begin
 select order_id into order_key from private.order_production_jobs where id=p_job;if order_key is null then raise no_data_found;end if;
 perform private.production_identity(p_actor,p_session,order_key,'sales.manage');
 if p_kind is null or p_kind not in('start','complete') or p_revision is null or p_revision<1 or p_operation is null or p_evidence is null or char_length(btrim(p_evidence)) not between 2 and 1000 or p_evidence~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 perform id from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 perform id from public.order_cancellation_requests where order_id=order_key order by id for update;
 select * into job from private.order_production_jobs where id=p_job for update;
 request:=jsonb_build_object('jobId',p_job,'kind',p_kind,'revision',p_revision,'sessionId',p_session,'evidence',btrim(p_evidence));
 select * into prior from private.order_production_events where id=p_operation;
 if found then if prior.actor_id is distinct from p_actor or prior.request is distinct from request then raise sqlstate 'PT409' using message='production_operation_conflict';end if;return prior.result;end if;
 if job.revision<>p_revision then raise sqlstate 'PT409' using message='production_changed';end if;
 document:=private.order_production_document(order_key,true);select value into row_value from jsonb_array_elements(document->'jobs') where value->>'id'=p_job::text;
 if (row_value->>case when p_kind='start' then 'canStart' else 'canComplete' end)::boolean is distinct from true then raise check_violation using message='production_transition_unavailable';end if;
 update private.order_production_jobs set state=case when p_kind='start' then 'started' else 'completed' end,revision=revision+1,
 started_at=case when p_kind='start' then at_value else started_at end,completed_at=case when p_kind='complete' then at_value else completed_at end,updated_at=at_value where id=p_job;
 result:=jsonb_build_object('jobId',p_job,'orderId',order_key,'revision',p_revision+1,'state',case when p_kind='start' then 'started' else 'completed' end);
 insert into private.order_production_events(id,job_id,actor_id,session_id,kind,request,result) values(p_operation,p_job,p_actor,p_session,p_kind,request,result);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'order.production.'||p_kind,'order:'||order_key,jsonb_build_object('jobId',p_job,'claimId',job.claim_id,'itemId',job.order_item_id,'revision',p_revision+1,'evidence',btrim(p_evidence)));return result;
end $$;
CREATE OR REPLACE FUNCTION private.calculate_goods_transaction_locked(p_actor uuid, p_selection jsonb, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_id uuid, p_store_credit_amount bigint, p_at timestamp with time zone, p_line_ids jsonb, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb;index integer:=0;good public.goods;owner_row public.goods;variant public.goods_variants;price record;supply record;good_qty numeric;variant_qty numeric;
 custom_inputs jsonb;quantity_error text;priced_lines jsonb:='[]';shipping_lines jsonb:='[]';internal_lines jsonb:='[]';display_lines jsonb:='[]';policies jsonb;volume jsonb;
 discounted jsonb;line jsonb;shipping jsonb;coupon_eval record;coupon_data jsonb;coupon_lines jsonb;coupon_weights jsonb;credit_weights jsonb;
 coupon_allocations jsonb;credit_allocations jsonb;policy private.store_credit_policy;balance jsonb;available numeric;maximum numeric:=0;
 subtotal numeric;volume_total numeric;net numeric;coupon numeric:=0;credit numeric:=p_store_credit_amount;online numeric;customer numeric;
 next_change timestamptz;boundary timestamptz;card_allowed boolean:=true;bank_allowed boolean:=true;selected_policy jsonb;line_coupon numeric;line_credit numeric;
begin
 if p_at is null or not isfinite(p_at) or p_store_credit_amount is null or p_store_credit_amount not between 0 and 999999999999
  or jsonb_typeof(p_line_ids) is distinct from 'array' or jsonb_array_length(p_line_ids)<>jsonb_array_length(p_selection)
  or exists(select 1 from jsonb_array_elements(p_line_ids) id where jsonb_typeof(id) is distinct from 'string'
   or id#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (select count(distinct id) from jsonb_array_elements(p_line_ids) id)<>jsonb_array_length(p_line_ids) then
  raise invalid_parameter_value using message='invalid_transaction_calculation';end if;
 begin perform private.assert_goods_purchase_allowed(p_actor);
 exception when check_violation then
  if sqlerrm<>'goods_purchase_restricted' then raise;end if;
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_restricted','goodId',null)));
 end;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'goodId',v.good_id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues',v.draft_values)),'[]')
  into policies from private.goods_transaction_configs c join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  where c.good_id in(select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection));
 for entry in select value from jsonb_array_elements(p_selection) loop
  select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
   join public.goods owner_good on owner_good.id=private.goods_aggregation_owner(g.id)
   join public.fulfillment_origins origin on origin.id=owner_good.origin_id and origin.is_active
   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
    and (g.sale_starts_at is null or g.sale_starts_at<=p_at) and (g.sale_ends_at is null or g.sale_ends_at>p_at)
    and ip.archived_at is null and ip.published_at is not null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));end if;
  select * into owner_row from public.goods where id=private.goods_aggregation_owner(good.id);
  good.origin_id:=owner_row.origin_id;good.shipping_fee_type:=owner_row.shipping_fee_type;good.individual_fee:=owner_row.individual_fee;
  good.order_quantity_limit_enabled:=owner_row.order_quantity_limit_enabled;good.min_order_qty:=owner_row.min_order_qty;good.max_order_qty:=owner_row.max_order_qty;
  good.member_purchase_limit_enabled:=owner_row.member_purchase_limit_enabled;good.member_lifetime_qty_limit:=owner_row.member_lifetime_qty_limit;
  select * into variant from public.goods_variants where id=(entry->>'variantId')::uuid and good_id=good.id and archived_at is null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select sum((value->>'qty')::numeric) into good_qty from jsonb_array_elements(p_selection) where private.goods_aggregation_owner(value->>'goodId')=owner_row.id;
  quantity_error:=private.check_goods_purchase_quantity(good,p_actor,good_qty::bigint,true);
  if quantity_error is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_limit','goodId',good.id)));end if;
  begin custom_inputs:=private.resolve_goods_custom_inputs(good.id,(entry->>'inputRevision')::integer,entry->'inputValues');
  exception when check_violation or invalid_parameter_value then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','invalid_selection','goodId',good.id)));
  end;
  select * into supply from private.resolve_goods_variant_supply(variant.id,p_at);
  select sum((value->>'qty')::numeric) into variant_qty from jsonb_array_elements(p_selection) where value->>'variantId'=variant.id::text;
  if good.stock='soldout' or supply.available_qty<variant_qty or (supply.mode='preorder' and supply.state<>'open') then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select * into price from private.resolve_goods_variant_price(variant.id,p_at);
  priced_lines:=priced_lines||jsonb_build_array(jsonb_build_object('lineId',p_line_ids->>index,'goodId',owner_row.id,'regularUnitPrice',price.regular_price,
   'unitPrice',price.effective_price,'qty',entry->'qty'));
  shipping_lines:=shipping_lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',entry->'qty',
   'unit_price',price.effective_price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  select value into selected_policy from jsonb_array_elements(policies) where value->>'goodId'=owner_row.id;
  internal_lines:=internal_lines||jsonb_build_array(entry||jsonb_build_object('lineId',p_line_ids->>index,
   'goodName',good.name,'goodType',good.type,'goodIpId',good.ip_id,'originId',good.origin_id,'variantName',variant.name,
   'customInputsSnapshot',custom_inputs,'regularUnitPrice',price.regular_price,'unitPrice',price.effective_price,'pricePeriodId',price.price_period_id,
   'priceStartsAt',price.starts_at,'priceEndsAt',price.ends_at,'volumePolicySnapshot',selected_policy,
   'supplySource',supply.mode,'preorderPolicyId',supply.policy_id,'preorderPolicyRevision',supply.policy_revision,
   'preorderStartsAt',supply.starts_at,'preorderEndsAt',supply.ends_at,'preorderExpectedShipDate',supply.expected_ship_date,
   'productionTermsSnapshot',private.goods_production_terms(good.id),'salesPolicySnapshot',jsonb_build_object('version',2,'allowCardPayment',good.allow_card_payment,'allowBankTransfer',good.allow_bank_transfer,
    'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
    'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
    'saleStartsAt',good.sale_starts_at,'saleEndsAt',good.sale_ends_at,'salePeriodRevision',good.sale_period_revision)));
  select min(moment) into boundary from (
   select schedule.starts_at moment from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.starts_at>p_at
   union all select schedule.ends_at from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.ends_at>p_at
   union all select good.sale_starts_at where good.sale_starts_at>p_at union all select good.sale_ends_at where good.sale_ends_at>p_at
   union all select supply.next_change_at where supply.next_change_at>p_at) moments;
  next_change:=least(next_change,boundary);card_allowed:=card_allowed and good.allow_card_payment;bank_allowed:=bank_allowed and good.allow_bank_transfer;
  index:=index+1;
 end loop;
 if not card_allowed and not bank_allowed then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','payment_method_unavailable','goodId',null)));end if;
 volume:=private.calculate_goods_volume_discounts(priced_lines,policies,p_at);
 -- Restore actual selected IDs before coupon targeting, display and immutable order snapshots.
 select jsonb_agg(v.value||jsonb_build_object('goodId',i.value->>'goodId') order by v.ordinality) into discounted
  from jsonb_array_elements(volume->'lines') with ordinality v(value,ordinality)
  join jsonb_array_elements(internal_lines) i(value) on i.value->>'lineId'=v.value->>'lineId';
 volume:=jsonb_set(volume,'{lines}',discounted);
 subtotal:=(volume->>'subtotal')::numeric;volume_total:=(volume->>'volumeDiscountTotal')::numeric;net:=subtotal-volume_total;
 next_change:=least(next_change,(volume->>'nextChangeAt')::timestamptz);
 shipping:=private.calculate_goods_transaction_shipping(shipping_lines,jsonb_build_object('postalCode',p_address->>'postalCode','address1',p_address->>'address1'),p_delivery_choices,p_at);
 if shipping->>'state'='blocked' then return shipping;end if;
 next_change:=least(next_change,(shipping->>'nextChangeAt')::timestamptz);
 select jsonb_agg(jsonb_build_object('good_id',value->>'goodId','subtotal',(value->>'netSubtotal')::bigint)) into coupon_lines from jsonb_array_elements(volume->'lines');
 if p_user_coupon_id is not null then
  select * into coupon_eval from private.evaluate_coupon_target_lines_at(p_user_coupon_id,p_actor,coupon_lines,p_order_id,p_at);
  if coupon_eval.o_reason is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon:=least(coupon_eval.o_discount,greatest(0,net+(shipping->>'prepaidFee')::numeric-1000));
  if coupon<=0 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon_data:=jsonb_build_object('userCouponId',p_user_coupon_id,'couponCode',coupon_eval.o_coupon_code,'eligibleSubtotal',coupon_eval.o_eligible_subtotal,
   'discount',coupon,'termsSnapshot',coupon_eval.o_terms_snapshot||jsonb_build_object('calculationVersion',2,'eligibleNetSubtotal',coupon_eval.o_eligible_subtotal));
  select min(moment) into boundary from public.user_coupons held join public.coupons definition on definition.code=held.coupon_code
   cross join lateral(values(held.usable_from),(held.expires_at),(definition.starts_at),(definition.ends_at)) moments(moment)
   where held.id=p_user_coupon_id and moment>p_at;
  next_change:=least(next_change,boundary);
 end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',case when p_user_coupon_id is null then 0
   when coupon_data#>>'{termsSnapshot,goodsScope}'='all' or ((coupon_data#>'{termsSnapshot,targetGoodIds}') ? (value->>'goodId')
    or (coupon_data#>'{termsSnapshot,targetGoodIds}') ? private.goods_aggregation_owner(value->>'goodId'))
   then (value->>'netSubtotal')::numeric else 0 end)) into coupon_weights from jsonb_array_elements(volume->'lines');
 coupon_allocations:=private.allocate_transaction_amount(coupon,coupon_weights);
 select * into policy from private.store_credit_policy where singleton;
 perform private.expire_store_credit_lots(p_actor,p_at);balance:=private.store_credit_balance(p_actor);available:=(balance->>'available')::numeric;
 if policy.enabled and (balance->>'debt')::numeric=0 then
  maximum:=least(policy.max_use,available,greatest(0,net-coupon),greatest(0,net+(shipping->>'prepaidFee')::numeric-coupon-1000));end if;
 if credit>0 and (credit<policy.min_use or credit>maximum) then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','store_credit_unavailable','goodId',null)));end if;
 if credit>0 then
  select min(expires_at) into boundary from private.store_credit_lots where user_id=p_actor and available_amount>0 and expires_at>p_at and revoked_at is null;
  next_change:=least(next_change,boundary);
 end if;
 online:=net+(shipping->>'prepaidFee')::numeric-coupon-credit;customer:=online+(shipping->>'collectFee')::numeric;
 if online<1000 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','below_minimum_payment','goodId',null)));end if;
 if customer>9007199254740991 or online>999999999999 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',(value->>'netSubtotal')::numeric-(coupon_allocations->>(value->>'lineId'))::numeric))
  into credit_weights from jsonb_array_elements(volume->'lines');
 credit_allocations:=private.allocate_transaction_amount(credit,credit_weights);
 index:=0;
 for discounted in select value from jsonb_array_elements(volume->'lines') loop
  line:=internal_lines->index;line_coupon:=(coupon_allocations->>(line->>'lineId'))::numeric;line_credit:=(credit_allocations->>(line->>'lineId'))::numeric;
  line:=line||jsonb_build_object('subtotal',(discounted->>'unitPrice')::numeric*(discounted->>'qty')::numeric,
   'volumeUnitDiscount',discounted->'volumeUnitDiscount','volumeDiscountTotal',discounted->'volumeDiscountTotal','netSubtotal',discounted->'netSubtotal',
   'couponDiscount',line_coupon,'storeCreditDiscount',line_credit,'paidGoodsTotal',(discounted->>'netSubtotal')::numeric-line_coupon-line_credit,
   'volumePolicyId',discounted->'policyId');
  internal_lines:=jsonb_set(internal_lines,array[index::text],line);
  display_lines:=display_lines||jsonb_build_array(jsonb_build_object('lineId',line->'lineId','goodId',line->'goodId','variantId',line->'variantId','qty',line->'qty',
   'regularUnitPrice',line->'regularUnitPrice','unitPrice',line->'unitPrice','volumeUnitDiscount',line->'volumeUnitDiscount','subtotal',line->'subtotal',
   'volumeDiscountTotal',line->'volumeDiscountTotal','netSubtotal',line->'netSubtotal','couponDiscount',line->'couponDiscount',
   'storeCreditDiscount',line->'storeCreditDiscount','paidGoodsTotal',line->'paidGoodsTotal','volumePolicyId',line->'volumePolicyId','production',line->'productionTermsSnapshot'));
  index:=index+1;
 end loop;
 return jsonb_build_object('state','calculated','display',jsonb_build_object('calculationVersion',2,'currency','KRW','calculatedAt',p_at,'nextChangeAt',next_change,
  'lines',display_lines,'shipping',shipping->'displayGroups','totals',jsonb_build_object('subtotal',subtotal,'volumeDiscountTotal',volume_total,'netGoodsTotal',net,
   'couponDiscountTotal',coupon,'storeCreditTotal',credit,'prepaidShippingTotal',shipping->'prepaidFee','collectShippingTotal',shipping->'collectFee','onlineTotal',online,'customerTotal',customer),
  'userCouponId',p_user_coupon_id,'storeCreditMaximum',maximum,'paymentMethods',jsonb_build_object('card',card_allowed,'bankTransfer',bank_allowed)),
  'lines',internal_lines,'shippingRaw',shipping->'rawGroups','coupon',coupon_data,'creditPolicy',case when policy.enabled then private.store_credit_policy_for_member(p_actor)-'evidence' else null end);
exception when numeric_value_out_of_range then
 return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));
end $function$
;
CREATE OR REPLACE FUNCTION private.place_goods_transaction(p_actor uuid, p_source jsonb, p_selection jsonb, p_address jsonb, p_quote_id uuid, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<transaction_place>>
declare selection jsonb;address jsonb;existing private.order_goods_transactions;quoted private.goods_transaction_quotes;calculation jsonb;
 order_id uuid;at_time timestamptz;expires timestamptz;request_salt uuid:=gen_random_uuid();receipt jsonb;totals jsonb;line jsonb;coupon jsonb;
 raw_group jsonb;component jsonb;shipment_id uuid;shipping_snapshot jsonb;reserved_credit bigint;item_id uuid;delivery_terms jsonb;
begin
 perform private.lock_goods_transaction_source(p_actor,p_source);
 if p_quote_id is null or p_checkout_key is null or p_payment_method is null then raise invalid_parameter_value using message='invalid_transaction_place';end if;
 selection:=private.normalize_goods_transaction_selection(p_selection);address:=private.normalize_goods_transaction_address(p_address);
 -- Durable success replay is intentionally before quote expiry/PII cleanup,
 -- current cart, current source lifecycle, and present-day price calculations.
 select * into existing from private.order_goods_transactions where actor_id=p_actor and checkout_key=p_checkout_key;
 if found then
  if existing.quote_id<>p_quote_id or existing.source_kind<>p_source->>'kind' or existing.source_id<>(p_source->>'id')::uuid
   or existing.source_revision<>p_source->>'revision' or existing.request_digest is distinct from
    private.goods_transaction_request_digest(existing.request_salt,p_source,selection,address,p_quote_id,p_payment_method) then
   raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
  return existing.order_id;
 end if;
 if exists(select 1 from public.orders where user_id=p_actor and checkout_key=p_checkout_key) then raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
 perform private.assert_goods_transaction_actor(p_actor);
 select * into quoted from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_actor for update;
 if not found or quoted.source is distinct from p_source or quoted.selection is distinct from selection or quoted.address is distinct from address then
  raise sqlstate 'PT409' using message='transaction_quote_changed';end if;
 if quoted.order_id is not null then raise sqlstate 'PT409' using message='transaction_quote_already_used';end if;
 if quoted.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 if p_source->>'kind'='gift' and to_regprocedure('private.bind_goods_transaction_delivery_snapshot(uuid,uuid,jsonb,jsonb,jsonb)') is null then
  raise check_violation using message='gift_delivery_owner_not_ready';end if;
 expires:=case when p_payment_method='bank_transfer' then clock_timestamp()+interval '24 hours' else clock_timestamp()+interval '15 minutes' end;
 insert into public.orders(user_id,status,total,shipping_fee,address,expires_at,checkout_key,payment_method,calculation_version)
  values(p_actor,'pending',0,0,case when p_source->>'kind'='gift' then null else address end,expires,p_checkout_key,p_payment_method,2) returning id into order_id;
 perform private.assert_first_purchase_checkout(p_actor,order_id);
 perform private.lock_goods_transaction_catalog(p_actor,selection,quoted.user_coupon_id);
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 if quoted.expires_at<=at_time then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 calculation:=private.calculate_goods_transaction_locked(p_actor,selection,address,quoted.delivery_choices,quoted.user_coupon_id,quoted.store_credit_amount,at_time,quoted.line_ids,order_id);
 if calculation->>'state'<>'calculated' or private.goods_transaction_calculation_contract(calculation) is distinct from private.goods_transaction_calculation_contract(quoted.calculation) then
  raise sqlstate 'PT409' using message='transaction_quote_changed';end if;
 if not (calculation#>>array['display','paymentMethods',case when p_payment_method='bank_transfer' then 'bankTransfer' else 'card' end])::boolean then
  raise check_violation using message='transaction_payment_method_unavailable';end if;
 totals:=calculation#>'{display,totals}';receipt:=jsonb_build_object('orderId',order_id,'quoteId',p_quote_id,'display',calculation->'display');
 insert into private.order_goods_transactions(order_id,actor_id,source_kind,source_id,source_revision,quote_id,checkout_key,request_digest,request_salt,original_receipt)
  values(order_id,p_actor,p_source->>'kind',(p_source->>'id')::uuid,p_source->>'revision',p_quote_id,p_checkout_key,
   private.goods_transaction_request_digest(request_salt,p_source,selection,address,p_quote_id,p_payment_method),request_salt,receipt);
 update private.goods_transaction_quotes set order_id=transaction_place.order_id where id=p_quote_id;
 if p_source->>'kind'='gift' then
  perform private.bind_goods_transaction_delivery_snapshot(order_id,p_actor,p_source,address,calculation->'shippingRaw');
 end if;
 for line in select value from jsonb_array_elements(calculation->'lines') loop
  if line->>'supplySource'='stock' then perform private.change_goods_variant_stock(line->>'goodId',(line->>'variantId')::uuid,-(line->>'qty')::bigint);end if;
  item_id:=(line->>'lineId')::uuid;
  insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
   regular_unit_price_snapshot,price_period_id,price_evaluated_at,sales_policy_snapshot,supply_source,preorder_policy_id,preorder_expected_ship_date,
   preorder_snapshot,custom_inputs_snapshot,volume_unit_discount,volume_discount_total,volume_discount_snapshot,production_terms_snapshot)
  values(item_id,order_id,line->>'goodId',(line->>'variantId')::uuid,(line->>'qty')::integer,(line->>'unitPrice')::integer,
   line->>'goodName',line->>'goodType',line->>'goodIpId',(line->>'regularUnitPrice')::integer,(line->>'pricePeriodId')::uuid,at_time,line->'salesPolicySnapshot',
   line->>'supplySource',(line->>'preorderPolicyId')::uuid,(line->>'preorderExpectedShipDate')::date,
   case when line->>'supplySource'='preorder' then jsonb_build_object('version',1,'policyId',line->'preorderPolicyId','policyRevision',line->'preorderPolicyRevision',
    'startsAt',line->'preorderStartsAt','endsAt',line->'preorderEndsAt','expectedShipDate',line->'preorderExpectedShipDate') end,
   nullif(line->'customInputsSnapshot','null'::jsonb),(line->>'volumeUnitDiscount')::bigint,(line->>'volumeDiscountTotal')::bigint,
   jsonb_build_object('calculationVersion',2,'policy',line->'volumePolicySnapshot','applied',line->>'volumePolicyId' is not null),nullif(line->'productionTermsSnapshot','null'::jsonb));
  if line->>'supplySource'='preorder' then perform private.reserve_goods_preorder_item(item_id,at_time);end if;
  insert into private.order_price_allocations(order_item_id,order_id,calculation_version,subtotal,volume_discount,net_subtotal,coupon_discount,store_credit_discount,paid_goods_total)
   values(item_id,order_id,2,(line->>'subtotal')::bigint,(line->>'volumeDiscountTotal')::bigint,(line->>'netSubtotal')::bigint,
    (line->>'couponDiscount')::bigint,(line->>'storeCreditDiscount')::bigint,(line->>'paidGoodsTotal')::bigint);
 end loop;
 coupon:=calculation->'coupon';
 if quoted.user_coupon_id is not null then
  perform private.reserve_first_purchase_coupon(order_id,p_actor,coupon->>'couponCode');
  update public.user_coupons set status='used',used_at=at_time,used_order_id=order_id where id=quoted.user_coupon_id and user_id=p_actor and status<>'used';
  if not found then raise check_violation using message='coupon_already_used';end if;
  insert into public.coupon_redemptions(user_coupon_id,coupon_code,user_id,order_id,discount_amount,eligible_subtotal,terms_snapshot)
   values(quoted.user_coupon_id,coupon->>'couponCode',p_actor,order_id,(coupon->>'discount')::bigint,(coupon->>'eligibleSubtotal')::bigint,coupon->'termsSnapshot');
 end if;
 reserved_credit:=private.reserve_order_store_credits_explicit(order_id,p_actor,(totals->>'netGoodsTotal')::bigint,(totals->>'couponDiscountTotal')::bigint,
  (totals->>'prepaidShippingTotal')::bigint,quoted.store_credit_amount,at_time);
 if reserved_credit<>(totals->>'storeCreditTotal')::bigint then raise check_violation using message='transaction_credit_snapshot_mismatch';end if;
 shipping_snapshot:=private.goods_transaction_public_shipping(p_source->>'kind',calculation->'shippingRaw');
 update public.orders set total=(totals->>'onlineTotal')::bigint,shipping_fee=(totals->>'prepaidShippingTotal')::bigint,
  store_credit_policy_snapshot=nullif(calculation->'creditPolicy','null'::jsonb),
  volume_discount_total=(totals->>'volumeDiscountTotal')::bigint,discount_total=(totals->>'couponDiscountTotal')::bigint,
  store_credit_total=reserved_credit,shipping_collect_total=(totals->>'collectShippingTotal')::bigint,shipping_fee_breakdown=shipping_snapshot where id=order_id;
 perform private.create_order_shipments(order_id);
 for raw_group in select value from jsonb_array_elements(calculation->'shippingRaw') loop
  update public.order_shipments set shipping_collect_fee=(raw_group->>'collectFee')::bigint
   where order_shipments.order_id=transaction_place.order_id and origin_id=(raw_group->>'originId')::uuid returning id into shipment_id;
  for component in select value from jsonb_array_elements(raw_group->'components') loop
   select value into delivery_terms from jsonb_array_elements(raw_group->'deliveryTerms') where value->>'goodId'=component->>'goodId';
   insert into private.shipping_charge_components(order_id,shipment_id,good_id,origin_id,calculation_version,payment_mode,base_fee,regional_fee,total_fee,
    delivery_policy_id,collect_contract_id,terms_snapshot)
   values(order_id,shipment_id,component->>'goodId',(raw_group->>'originId')::uuid,2,component->>'paymentMode',(component->>'baseFee')::bigint,
    (component->>'regionalFee')::bigint,(component->>'totalFee')::bigint,(component->>'deliveryPolicyId')::uuid,(raw_group->>'collectContractId')::uuid,
    jsonb_build_object('deliveryTerms',delivery_terms,'regionalPolicyId',raw_group->'policyId','regionalPolicyVersion',raw_group->'policyVersion',
     'regionStatus',raw_group->'regionStatus','collectContract',raw_group->'collectContractSnapshot'));
  end loop;
  if (raw_group->>'collectFee')::bigint>0 then
   insert into private.shipping_collect_obligations(shipment_id,order_id,amount,contract_snapshot)
    values(shipment_id,order_id,(raw_group->>'collectFee')::bigint,raw_group->'collectContractSnapshot');
   insert into private.shipping_collect_events(operation_id,shipment_id,event,amount,evidence)
    values(gen_random_uuid(),shipment_id,'planned',(raw_group->>'collectFee')::bigint,jsonb_build_object('orderId',order_id,'quoteId',p_quote_id));
  end if;
 end loop;
 if not private.goods_order_snapshot_matches(order_id,(totals->>'onlineTotal')::bigint,(totals->>'prepaidShippingTotal')::bigint) then
  raise check_violation using message='transaction_order_snapshot_mismatch';end if;
 if quoted.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 perform private.assert_order_goods_sale_period(order_id);
 if p_payment_method='bank_transfer' then
  perform public.prepare_goods_payment_attempt(p_actor,order_id,'bank_transfer');
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(p_actor,'order_bank_transfer_pending','입금 안내를 확인해주세요',format('%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
    to_char((totals->>'onlineTotal')::bigint,'FM999,999,999,999,999,999'),private.bank_transfer_deposit_code(order_id)),
    '/checkout/'||order_id::text,'order',order_id::text,'order:bank_transfer_pending:'||order_id::text) on conflict(user_id,dedupe_key) do nothing;
 end if;
 return order_id;
end $function$
;
CREATE OR REPLACE FUNCTION private.request_order_claim_for_parties(p_order_id uuid, p_actor uuid, p_user_id uuid, p_gift_id uuid, p_claim_type text, p_reason text, p_reason_type text, p_bank_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_account_holder text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  claim_at timestamptz;
  gift private.gift_intents;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_claim_id uuid;
  v_has_unresolved_attempt boolean;
  v_masked_account text;
  v_masked_holder text;
  v_payment_count integer;
begin
  if p_claim_type is null or p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type';
  end if;
  if p_reason_type is null or p_reason_type not in ('change_of_mind', 'defect') then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;
  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  -- Actor is the actual requester; p_user_id is exclusively the financial owner.
  if p_gift_id is null then
    if p_actor is distinct from p_user_id then return jsonb_build_object('outcome','not_found','claimId',v_claim_id);end if;
    -- Preserve the ordinary-order intake lock graph unchanged.
  else
    select * into gift from private.gift_intents where id=p_gift_id and order_id=p_order_id;
    if not found or p_actor is null or p_user_id is distinct from gift.sender_id or not(p_actor=gift.sender_id or p_actor=gift.recipient_id)
      or p_actor<>gift.sender_id and p_claim_type='cancel' then return jsonb_build_object('outcome','not_found','claimId',v_claim_id);end if;
    perform private.gift_lock_subjects(array[p_actor,gift.sender_id,gift.recipient_id]);
    if p_actor<>gift.sender_id and (p_bank_name is not null or p_account_number is not null or p_account_holder is not null) then
      raise insufficient_privilege using message='gift_payer_refund_account_required';end if;
  end if;

  -- Common intake/dispatch lock order: order → shipments → payment attempts/payments.
  select orders.user_id, orders.status, orders.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return jsonb_build_object('outcome','not_found','claimId',v_claim_id);
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
      )
  )
  into v_has_unresolved_attempt;

  claim_at:=case when p_gift_id is null then now() else clock_timestamp() end;
  if v_status = 'canceled' then
    return jsonb_build_object('outcome','already_canceled','claimId',v_claim_id);
  end if;

  -- 반품·교환은 배송 중부터 접수하되 전체 실물 회수는 후속 단계에서 검사한다.
  -- Customer cancellation is available only before order confirmation.
  if p_claim_type in ('return', 'exchange') then
    if not private.order_return_intake_eligible(p_order_id) then
      return jsonb_build_object('outcome','not_claimable','claimId',v_claim_id);
    end if;
  elsif not private.order_cancel_eligible(p_order_id) then
    return jsonb_build_object('outcome','not_cancelable','claimId',v_claim_id);
  end if;

  -- 교환도 청약철회 기한을 준용한다(변심 7일 · 하자 3개월). 판정의 진실원은
  -- 계속 order_withdrawal_deadline_passed 하나다.
  if public.order_withdrawal_deadline_passed(v_delivered_at, p_reason_type, claim_at) then
    return jsonb_build_object('outcome','deadline_expired','claimId',v_claim_id);
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return jsonb_build_object('outcome','already_requested','claimId',v_claim_id);
  end if;

  -- status는 적지 않는다. 투영은 private.order_claim_status_for_stage 하나가 만든다.
  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage,
    requested_at
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    p_claim_type,
    'requested',
    claim_at
  )
  returning id into v_claim_id;
  if p_gift_id is not null then
    insert into private.gift_claim_parties(claim_id,gift_id,payer_id,recipient_id,actual_requester)
    values(v_claim_id,p_gift_id,gift.sender_id,gift.recipient_id,p_actor);
    insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'gift.claim_requested','order:'||p_order_id,
      jsonb_build_object('giftId',p_gift_id,'claimId',v_claim_id,'claimType',p_claim_type,'reasonType',p_reason_type,'requesterParty',case when p_actor=gift.sender_id then 'sender' else 'recipient' end));
  end if;


  /*
   * 환불계좌는 무통장 환불의 유일한 경로이고 카드 fallback의 안전망이다.
   * 세 칸이 모두 있을 때만 저장한다 — 반쪽 계좌는 송금에 쓸 수 없다.
   *
   * 교환에는 저장하지 않는다. 교환의 종결은 재출고이고 어떤 경로로도 돈이
   * 돌아가지 않으므로 계좌를 받을 목적 자체가 없다. 화면은 반품에만 폼을
   * 보이지만 API로는 실어 보낼 수 있으므로 접수 함수가 거른다. 취소·반품은
   * 결제사 취소가 막혔을 때 송금이 유일한 경로라 계속 받고, 보관 기간은
   * 종결 stage에서 seal_order_claim_refund_account가 잡는다.
   */
  if p_claim_type <> 'exchange'
    and p_bank_name is not null
    and p_account_number is not null
    and p_account_holder is not null
  then
    v_masked_account := public.mask_refund_account_number(p_account_number);
    v_masked_holder := public.mask_refund_account_holder(p_account_holder);

    insert into private.claim_refund_accounts (
      claim_id,
      bank_name,
      account_number,
      account_holder,
      masked_account,
      masked_holder
    )
    values (
      v_claim_id,
      btrim(p_bank_name),
      p_account_number,
      btrim(p_account_holder),
      btrim(p_bank_name) || ' ' || v_masked_account,
      v_masked_holder
    );
  end if;

  -- 결제 이력이 없는 pending 주문은 예전처럼 즉시 종결한다.
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and not v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests
    set
      stage = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_claim_id;

    return jsonb_build_object('outcome','completed','claimId',v_claim_id);
  end if;

  /*
   * 자동 승인 — paid(발주확인 전) 변심 취소.
   *
   * 아직 발주확인도 하지 않은 주문의 변심 취소를 사람이 판단할 이유가 없다.
   * 스마트스토어와 같은 경계다. confirmed부터는 발송 준비가 시작됐으므로
   * 운영자 판단으로 남긴다.
   *
   * 승인의 실질(durable claim + 환불 intent)은 admin_decide_order_cancellation의
   * 승인 분기와 같다. decided_by는 null로 남긴다 — 사람이 누른 적이 없다.
   */
  if p_claim_type = 'cancel'
    and v_status = 'paid'
    and not exists(select 1 from private.order_production_jobs where order_id=p_order_id and claim_id is null and started_at is not null)
    and p_reason_type = 'change_of_mind'
  then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (p_order_id, p_user_id, v_status)
    on conflict (order_id) do nothing;

    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      cancellation_request_id
    )
    select
      payment.id,
      payment.amount,
      p_reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      v_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded')
    on conflict (payment_id) do update
    set
      cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case
        when public.refunds.status = 'done' then 'done'
        else 'requested'
      end;

    select count(*)::integer
    into v_payment_count
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');

    update public.order_cancellation_requests
    set
      stage = 'processing',
      decided_at = now(),
      provider_started_at = now(),
      updated_at = now()
    where id = v_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_user_id,
      'order.claim_auto_approved',
      'order:' || p_order_id::text,
      jsonb_build_object(
        'claimId', v_claim_id,
        'claimType', 'cancel',
        'from', 'requested',
        'to', 'processing',
        'previousOrderStatus', v_status::text,
        'reasonType', p_reason_type,
        'paymentCount', v_payment_count
      )
    );

    perform private.notify_order_claim(
      v_claim_id,
      'auto_approved',
      '취소 요청이 접수됐어요',
      '발송 전 주문이라 자동으로 승인됐습니다. 결제 취소 처리를 시작합니다.'
    );

    return jsonb_build_object('outcome','auto_approved','claimId',v_claim_id);
  end if;

  perform private.notify_order_claim(
    v_claim_id,
    'requested',
    '클레임 요청이 접수됐어요',
    '요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다.'
  );

  return jsonb_build_object('outcome','requested','claimId',v_claim_id);
end;
$function$
;

alter function private.order_cancel_eligible(uuid) rename to order_cancel_eligible_before_production;
revoke all on function private.order_cancel_eligible_before_production(uuid) from public,anon,authenticated,service_role;
create function private.order_cancel_eligible(target_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.order_cancel_eligible_before_production(target_order) or exists(select 1 from public.orders o where o.id=target_order and o.status in('paid','confirmed')
  and exists(select 1 from private.order_production_jobs where order_id=o.id and claim_id is null)
  and o.shipped_at is null and o.delivered_at is null and not exists(select 1 from public.order_shipments s where s.order_id=o.id and(s.status<>'ready' or s.shipped_at is not null or s.delivered_at is not null)));
$$;
create function public.get_goods_transaction_offers_v2(p_good_ids text[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row.value||jsonb_build_object('production',private.goods_production_terms(row.value->>'goodId')) order by row.ordinality),'[]')
 from jsonb_array_elements(public.get_goods_transaction_offers(p_good_ids)) with ordinality row(value,ordinality);
$$;
revoke all on function private.goods_production_terms(text) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.goods_production_terms(text)'::regprocedure);
revoke all on function private.goods_production_document(text) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.goods_production_document(text)'::regprocedure);
revoke all on function private.production_identity(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_identity(uuid,uuid,uuid,text)'::regprocedure);
revoke all on function private.production_deadline(timestamptz,jsonb) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_deadline(timestamptz,jsonb)'::regprocedure);
revoke all on function private.production_item_guard() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_item_guard()'::regprocedure);
revoke all on function private.production_item_created() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_item_created()'::regprocedure);
revoke all on function private.production_preorder_guard() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_preorder_guard()'::regprocedure);
revoke all on function private.production_payment_valid(uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_payment_valid(uuid)'::regprocedure);
revoke all on function private.production_payment_changed() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_payment_changed()'::regprocedure);
revoke all on function private.production_order_canceled() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_order_canceled()'::regprocedure);
revoke all on function private.production_claim_changed() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_claim_changed()'::regprocedure);
revoke all on function private.production_shipment_guard() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.production_shipment_guard()'::regprocedure);
revoke all on function private.order_production_document(uuid,boolean) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.order_production_document(uuid,boolean)'::regprocedure);
revoke all on function private.order_cancel_eligible_before_production(uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.order_cancel_eligible_before_production(uuid)'::regprocedure);
revoke all on function private.order_cancel_eligible(uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.order_cancel_eligible(uuid)'::regprocedure);
revoke all on function public.admin_get_goods_production(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_production(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_goods_production(text)'::regprocedure,'catalog.manage','read',false);
revoke all on function public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'catalog.manage','manual',false);
revoke all on function public.admin_get_order_production(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_order_production(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_order_production(uuid)'::regprocedure,'sales.read','read',false);
revoke all on function public.get_my_order_production(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_production(uuid) to authenticated;
revoke all on function public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text) to authenticated;
select private.register_operator_rpc_contract('public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)'::regprocedure,'sales.manage','manual',false);
revoke all on function public.get_goods_transaction_offers_v2(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_transaction_offers_v2(text[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
