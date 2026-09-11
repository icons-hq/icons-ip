-- #492: method-specific fulfillment of already-priced, origin-scoped shipments.
-- No active operating policy, new fee, payment, or customer message is seeded.
create function private.valid_delivery_policy_terms(p_terms jsonb,p_complete boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text; max_length integer;
begin
  if jsonb_typeof(p_terms) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_terms) key
    where key not in ('contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
      'allowDelegate','completionInstructions','cancellationInstructions','approvalReference')) then return false; end if;
  foreach field in array array['contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
    'completionInstructions','cancellationInstructions','approvalReference'] loop
    max_length:=case field when 'contactName' then 100 when 'contactPhone' then 40 else 2000 end;
    if not p_terms?field or jsonb_typeof(p_terms->field) not in ('string','null') then return false; end if;
    if jsonb_typeof(p_terms->field)='string' and (length(btrim(p_terms->>field)) not between 1 and max_length) then return false; end if;
    if p_complete and jsonb_typeof(p_terms->field) is distinct from 'string' then return false; end if;
  end loop;
  return p_terms?'allowDelegate' and jsonb_typeof(p_terms->'allowDelegate') in ('boolean','null')
    and (not p_complete or jsonb_typeof(p_terms->'allowDelegate')='boolean');
end $$;
revoke all on function private.valid_delivery_policy_terms(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.valid_delivery_policy_terms(jsonb,boolean) to postgres;

create table private.fulfillment_delivery_policies (
  id uuid primary key default gen_random_uuid(),
  origin_id uuid not null references public.fulfillment_origins(id) on delete restrict,
  method text not null check(method in ('quick','pickup')),
  state text not null check(state in ('draft','active','stopped')),
  terms jsonb not null check(private.valid_delivery_policy_terms(terms,false)),
  revision integer not null default 1 check(revision>0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  stopped_at timestamptz,
  check(state<>'active' or (private.valid_delivery_policy_terms(terms,true) and activated_at is not null)),
  check(state<>'stopped' or stopped_at is not null)
);
create unique index fulfillment_delivery_policy_active_idx on private.fulfillment_delivery_policies(origin_id,method) where state='active';
revoke all on table private.fulfillment_delivery_policies from public,anon,authenticated,service_role;
grant select,insert,update on private.fulfillment_delivery_policies to postgres;

create function private.freeze_activated_delivery_policy() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id or new.origin_id is distinct from old.origin_id or new.method is distinct from old.method
    or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise check_violation using message='delivery_policy_identity_immutable'; end if;
  if old.activated_at is not null and (new.terms is distinct from old.terms or new.activated_at is distinct from old.activated_at
    or new.state not in ('active','stopped') or (old.state='stopped' and new.state<>'stopped')) then
    raise check_violation using message='activated_delivery_policy_immutable'; end if;
  return new;
end $$;
revoke all on function private.freeze_activated_delivery_policy() from public,anon,authenticated,service_role;
create trigger fulfillment_delivery_policy_frozen before update on private.fulfillment_delivery_policies
  for each row execute function private.freeze_activated_delivery_policy();

alter table public.order_shipments
  add column delivery_method text not null default 'parcel' check(delivery_method in ('parcel','quick','pickup')),
  add column delivery_policy_id uuid references private.fulfillment_delivery_policies(id) on delete restrict,
  add column delivery_method_snapshot jsonb,
  add column delivery_selection_id uuid,
  add column delivery_event_id uuid,
  add constraint shipment_delivery_policy_consistent check((delivery_method='parcel' and delivery_policy_id is null and delivery_method_snapshot is null)
    or (delivery_method in ('quick','pickup') and delivery_policy_id is not null and jsonb_typeof(delivery_method_snapshot)='object' and delivery_selection_id is not null)),
  add constraint shipment_nonparcel_has_no_tracking check(delivery_method='parcel' or (carrier is null and tracking_number is null));

create table private.shipment_delivery_operations (
  id uuid primary key,
  shipment_id uuid not null references public.order_shipments(id) on delete restrict,
  kind text not null check(kind in ('method_selected','quick_handoff','quick_receive','pickup_receive')),
  actor_id uuid references public.profiles(id) on delete set null,
  request_digest bytea not null,
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  recorded_at timestamptz not null default clock_timestamp(),
  check(not evidence ?| array['receiptCode','code','token','confirmationCode'])
);
create index shipment_delivery_operations_history_idx on private.shipment_delivery_operations(shipment_id,recorded_at,id);
revoke all on private.shipment_delivery_operations from public,anon,authenticated,service_role;
grant select,insert on private.shipment_delivery_operations to postgres;

-- The clear confirmation value exists only in the issuing response and customer UI.
create table private.shipment_receipt_confirmations (
  shipment_id uuid primary key references public.order_shipments(id) on delete restrict,
  selection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  confirmation_digest bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0 check(failed_attempts between 0 and 5),
  consumed_at timestamptz,
  consumed_operation_id uuid references private.shipment_delivery_operations(id) on delete restrict,
  check(expires_at>issued_at),
  check((consumed_at is null)=(consumed_operation_id is null))
);
revoke all on private.shipment_receipt_confirmations from public,anon,authenticated,service_role;
grant select,insert,update on private.shipment_receipt_confirmations to postgres;

create function public.admin_list_delivery_policies(p_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  return (select coalesce(jsonb_agg(policy.terms||jsonb_build_object('id',policy.id,'originId',policy.origin_id,'method',policy.method,
    'state',policy.state,'revision',policy.revision,'createdAt',policy.created_at,'activatedAt',policy.activated_at,'stoppedAt',policy.stopped_at)
    order by policy.created_at desc,policy.id),'[]') from private.fulfillment_delivery_policies policy where policy.origin_id=p_origin_id);
end $$;
revoke all on function public.admin_list_delivery_policies(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_delivery_policies(uuid) to authenticated,postgres;

create function public.admin_save_delivery_policy(p_origin_id uuid,p_method text,p_policy_id uuid,p_values jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); policy private.fulfillment_delivery_policies; values_object jsonb:='{}'; field text; state_value text;
  origin public.fulfillment_origins; instant timestamptz:=clock_timestamp();
begin
  if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then
    raise insufficient_privilege using message='admin_required'; end if;
  if p_method is null or p_method not in ('quick','pickup') or jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','contactName','contactPhone','handoffLocation','handoffInstructions',
      'appointmentInstructions','allowDelegate','completionInstructions','cancellationInstructions','approvalReference')) then
    raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  select * into origin from public.fulfillment_origins where id=p_origin_id for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if p_policy_id is not null then
    select * into policy from private.fulfillment_delivery_policies where id=p_policy_id and origin_id=p_origin_id and method=p_method for update;
    if not found then raise no_data_found using message='delivery_policy_not_found'; end if;
    if p_expected_revision is null or policy.revision<>p_expected_revision then raise sqlstate 'PT409' using message='delivery_policy_changed'; end if;
  elsif p_expected_revision is not null or state_value='stopped' then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  if state_value='stopped' then values_object:=policy.terms;
  else
    foreach field in array array['contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
      'completionInstructions','cancellationInstructions','approvalReference'] loop
      if p_values?field and jsonb_typeof(p_values->field) not in ('null','string') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
      values_object:=values_object||jsonb_build_object(field,nullif(btrim(p_values->>field),''));
    end loop;
    values_object:=values_object||jsonb_build_object('allowDelegate',coalesce(p_values->'allowDelegate','null'::jsonb));
    if not private.valid_delivery_policy_terms(values_object,state_value='active') then
      raise check_violation using message='delivery_policy_incomplete'; end if;
  end if;
  if state_value='active' and not origin.is_active then raise check_violation using message='delivery_policy_unavailable'; end if;
  if policy.activated_at is not null and (values_object is distinct from policy.terms or state_value not in ('active','stopped')
    or (policy.state='stopped' and state_value<>'stopped')) then raise check_violation using message='activated_delivery_policy_immutable'; end if;
  if state_value='active' and exists(select 1 from private.fulfillment_delivery_policies existing where existing.origin_id=p_origin_id
    and existing.method=p_method and existing.state='active' and existing.id is distinct from p_policy_id) then
    raise check_violation using message='delivery_policy_already_active'; end if;
  if p_policy_id is null then
    insert into private.fulfillment_delivery_policies(origin_id,method,state,terms,created_by,updated_by,activated_at)
    values(p_origin_id,p_method,state_value,values_object,actor,actor,case when state_value='active' then instant end) returning * into policy;
  else
    if policy.state=state_value and policy.terms=values_object then return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',false); end if;
    update private.fulfillment_delivery_policies set state=state_value,terms=values_object,revision=revision+1,updated_by=actor,updated_at=instant,
      activated_at=case when state_value='active' then coalesce(activated_at,instant) else activated_at end,
      stopped_at=case when state_value='stopped' then coalesce(stopped_at,instant) else stopped_at end where id=policy.id returning * into policy;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_delivery_policy.saved','origin:'||p_origin_id,
    jsonb_build_object('policyId',policy.id,'method',p_method,'state',state_value,'revision',policy.revision));
  return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',true);
end $$;
revoke all on function public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer) to authenticated;

create function private.shipment_delivery_summary(p_shipment_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('method',shipment.delivery_method,'policy',shipment.delivery_method_snapshot,
    'canIssueReceipt',purchase.status in ('confirmed','shipping')
      and ((shipment.delivery_method='pickup' and shipment.status='ready') or (shipment.delivery_method='quick' and shipment.status='shipping'))
      and not exists(select 1 from public.order_cancellation_requests request where request.order_id=purchase.id and request.status in ('requested','processing','needs_review'))
      and not exists(select 1 from public.order_cancellation_claims claim where claim.order_id=purchase.id),
    'providerName',(select operation.evidence->>'providerName' from private.shipment_delivery_operations operation
      where operation.shipment_id=shipment.id and operation.kind='quick_handoff' order by operation.recorded_at desc,operation.id limit 1))
  from public.order_shipments shipment join public.orders purchase on purchase.id=shipment.order_id where shipment.id=p_shipment_id;
$$;
revoke all on function private.shipment_delivery_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function private.shipment_delivery_summary(uuid) to postgres;
create function public.shipment_delivery_summary(shipment public.order_shipments) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.shipment_delivery_summary(current_shipment.id) from public.order_shipments current_shipment
  join public.orders purchase on purchase.id=current_shipment.order_id where current_shipment.id=shipment.id
    and (purchase.user_id=auth.uid() or public.is_staff() or auth.role()='service_role');
$$;
revoke all on function public.shipment_delivery_summary(public.order_shipments) from public,anon,authenticated,service_role;
grant execute on function public.shipment_delivery_summary(public.order_shipments) to authenticated,service_role,postgres;

create function private.guard_shipment_delivery_method() returns trigger
language plpgsql set search_path='' as $$
declare operation private.shipment_delivery_operations;
begin
  if tg_op='INSERT' then
    if new.delivery_method<>'parcel' then raise check_violation using message='delivery_method_selection_required'; end if;
    return new;
  end if;
  if new.delivery_method is distinct from old.delivery_method or new.delivery_selection_id is distinct from old.delivery_selection_id
    or new.delivery_method_snapshot is distinct from old.delivery_method_snapshot or new.delivery_policy_id is distinct from old.delivery_policy_id then
    select * into operation from private.shipment_delivery_operations where id=new.delivery_selection_id and shipment_id=new.id and kind='method_selected';
    if not found or old.status<>'ready' or new.status<>'ready' or old.exported_at is not null
      or operation.evidence->>'toMethod' is distinct from new.delivery_method
      or operation.evidence->>'fromMethod' is distinct from old.delivery_method then
      raise check_violation using message='delivery_method_selection_required'; end if;
  end if;
  if new.delivery_method<>'parcel' then
    if new.carrier is not null or new.tracking_number is not null or new.exported_at is distinct from old.exported_at then
      raise check_violation using message='delivery_method_evidence_required'; end if;
    if new.status in ('shipping','delivered') and (new.status is distinct from old.status
      or new.shipped_at is distinct from old.shipped_at or new.delivered_at is distinct from old.delivered_at) then
      select * into operation from private.shipment_delivery_operations where id=new.delivery_event_id and shipment_id=new.id;
      if not found or not ((new.delivery_method='quick' and old.status='ready' and new.status='shipping' and operation.kind='quick_handoff')
        or (new.delivery_method='quick' and old.status='shipping' and new.status='delivered' and operation.kind='quick_receive')
        or (new.delivery_method='pickup' and old.status='ready' and new.status='delivered' and operation.kind='pickup_receive')) then
        raise check_violation using message='delivery_method_evidence_required'; end if;
      if (operation.evidence->>'occurredAt')::timestamptz is distinct from
        (case when new.status='shipping' then new.shipped_at else new.delivered_at end) then
        raise check_violation using message='delivery_method_evidence_required'; end if;
      if new.status='delivered' and not exists(select 1 from private.shipment_receipt_confirmations confirmation
        where confirmation.shipment_id=new.id and confirmation.selection_id=new.delivery_selection_id
          and confirmation.consumed_operation_id=new.delivery_event_id and confirmation.consumed_at is not null) then
        raise check_violation using message='delivery_method_evidence_required'; end if;
      perform private.assert_shipment_preorder_ready(new.id);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_shipment_delivery_method() from public,anon,authenticated,service_role;
create trigger shipment_delivery_method_guard before insert or update on public.order_shipments
  for each row execute function private.guard_shipment_delivery_method();

create function public.admin_select_shipment_delivery_method(p_shipment_id uuid,p_method text,p_policy_id uuid,p_customer_request_reference text,
  p_fee_consent_reference text,p_fee_unchanged boolean,p_expected_updated_at timestamptz,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; policy private.fulfillment_delivery_policies;
  operation private.shipment_delivery_operations; evidence jsonb; fingerprint bytea; snapshot jsonb; instant timestamptz:=clock_timestamp();
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if p_method is null or p_method not in ('parcel','quick','pickup') or p_operation_id is null or p_fee_unchanged is distinct from true
    or length(coalesce(btrim(p_customer_request_reference),'')) not between 1 and 2000
    or length(coalesce(btrim(p_fee_consent_reference),'')) not between 1 and 2000
    or (p_method='parcel' and p_policy_id is not null) or (p_method<>'parcel' and p_policy_id is null) then
    raise invalid_parameter_value using message='invalid_delivery_selection'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  fingerprint:=extensions.digest(jsonb_build_object('actor',actor,'method',p_method,'policyId',p_policy_id,
    'request',btrim(p_customer_request_reference),'consent',btrim(p_fee_consent_reference),'expectedAt',p_expected_updated_at)::text,'sha256');
  select * into operation from private.shipment_delivery_operations where id=p_operation_id;
  if found then
    if operation.shipment_id<>shipment.id or operation.kind<>'method_selected' or operation.actor_id is distinct from actor
      or operation.request_digest is distinct from fingerprint then raise sqlstate 'PT409' using message='delivery_operation_conflict'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'shipmentId',shipment.id);
  end if;
  if p_expected_updated_at is null or shipment.updated_at<>p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_delivery_changed'; end if;
  if shipment.status<>'ready' or shipment.exported_at is not null or shipment.carrier is not null or shipment.tracking_number is not null
    or purchase.status not in ('paid','confirmed','shipping') then raise check_violation using message='delivery_method_selection_unavailable'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  if p_method<>'parcel' then
    -- All policy writers lock the origin first; only SHARE is needed by selection.
    perform id from public.fulfillment_origins where id=shipment.origin_id and is_active for share;
    if not found then raise check_violation using message='delivery_policy_unavailable'; end if;
    select * into policy from private.fulfillment_delivery_policies where id=p_policy_id and origin_id=shipment.origin_id and method=p_method for share;
    if not found or policy.state<>'active' or not private.valid_delivery_policy_terms(policy.terms,true) then
      raise check_violation using message='delivery_policy_unavailable'; end if;
    snapshot:=(policy.terms-'approvalReference')||jsonb_build_object('version',1,'policyId',policy.id,'revision',policy.revision,
      'feeRule','order_fee_unchanged','confirmationRule','recipient_code');
  end if;
  evidence:=jsonb_build_object('fromMethod',shipment.delivery_method,'toMethod',p_method,'policyId',p_policy_id,
    'policyRevision',policy.revision,'customerRequestReference',btrim(p_customer_request_reference),'feeConsentReference',btrim(p_fee_consent_reference),
    'shippingFee',shipment.shipping_fee,'orderTotal',purchase.total,'feeRule','order_fee_unchanged');
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(p_operation_id,shipment.id,'method_selected',actor,fingerprint,evidence);
  update public.order_shipments set delivery_method=p_method,delivery_policy_id=p_policy_id,delivery_method_snapshot=snapshot,
    delivery_selection_id=p_operation_id,delivery_event_id=null,updated_at=instant where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_method_selected','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'operationId',p_operation_id,'from',shipment.delivery_method,'to',p_method,'shippingFee',shipment.shipping_fee));
  return jsonb_build_object('ok',true,'replayed',false,'shipmentId',shipment.id);
end $$;
revoke all on function public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamptz,uuid) to authenticated;

create function public.issue_shipment_receipt_confirmation(p_shipment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; confirmation_value text; instant timestamptz:=clock_timestamp();
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and suspended_at is null) then
    raise insufficient_privilege using message='authentication_required'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id and purchase_row.user_id=actor for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  if purchase.status not in ('confirmed','shipping') or not ((shipment.delivery_method='pickup' and shipment.status='ready')
    or (shipment.delivery_method='quick' and shipment.status='shipping')) then raise check_violation using message='delivery_receipt_code_unavailable'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  confirmation_value:=upper(encode(extensions.gen_random_bytes(6),'hex'));
  insert into private.shipment_receipt_confirmations(shipment_id,selection_id,owner_id,confirmation_digest,issued_at,expires_at)
    values(shipment.id,shipment.delivery_selection_id,actor,extensions.digest(confirmation_value,'sha256'),instant,instant+interval '10 minutes')
    on conflict(shipment_id) do update set selection_id=excluded.selection_id,owner_id=excluded.owner_id,confirmation_digest=excluded.confirmation_digest,
      issued_at=excluded.issued_at,expires_at=excluded.expires_at,failed_attempts=0,consumed_at=null,consumed_operation_id=null;
  return jsonb_build_object('code',confirmation_value,'expiresAt',instant+interval '10 minutes','maxAttempts',5);
end $$;
revoke all on function public.issue_shipment_receipt_confirmation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_shipment_receipt_confirmation(uuid) to authenticated;

create function public.admin_record_shipment_delivery(p_shipment_id uuid,p_kind text,p_evidence jsonb,p_receipt_code text,
  p_expected_updated_at timestamptz,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; operation private.shipment_delivery_operations;
  confirmation private.shipment_receipt_confirmations; evidence jsonb:='{}'; field text; allowed_fields text[]; occurred timestamptz;
  value text; confirmation_value text:=upper(regexp_replace(coalesce(p_receipt_code,''),'[[:space:]-]','','g'));
  fingerprint bytea; instant timestamptz; next_status text; max_length integer;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if p_operation_id is null or p_kind is null or p_kind not in ('quick_handoff','quick_receive','pickup_receive')
    or jsonb_typeof(p_evidence) is distinct from 'object' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  allowed_fields:=case when p_kind='quick_handoff' then array['operatorName','providerName','providerPhone','handoffReference','occurredAt']
    else array['operatorName','receiptReference','recipientKind','occurredAt'] end;
  if exists(select 1 from jsonb_object_keys(p_evidence) key where not key=any(allowed_fields)) then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  foreach field in array allowed_fields loop
    if jsonb_typeof(p_evidence->field) is distinct from 'string' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    value:=btrim(p_evidence->>field);
    max_length:=case when field in ('operatorName','providerName') then 100 when field='providerPhone' then 40 else 2000 end;
    if length(value) not between 1 and max_length then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    evidence:=evidence||jsonb_build_object(field,value);
  end loop;
  if evidence->>'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  begin occurred:=(evidence->>'occurredAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_delivery_evidence'; end;
  evidence:=evidence||jsonb_build_object('occurredAt',occurred);
  if p_kind<>'quick_handoff' and (evidence->>'recipientKind' not in ('self','delegate') or confirmation_value!~'^[0-9A-F]{12}$') then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  if p_kind='quick_handoff' and confirmation_value<>'' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  instant:=clock_timestamp();
  fingerprint:=extensions.digest(jsonb_build_object('actor',actor,'kind',p_kind,'evidence',evidence,'expectedAt',p_expected_updated_at,
    'receiptDigest',case when confirmation_value<>'' then encode(extensions.digest(confirmation_value,'sha256'),'hex') end)::text,'sha256');
  select * into operation from private.shipment_delivery_operations where id=p_operation_id;
  if found then
    if operation.shipment_id<>shipment.id or operation.kind<>p_kind or operation.actor_id is distinct from actor
      or operation.request_digest is distinct from fingerprint then raise sqlstate 'PT409' using message='delivery_operation_conflict'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'shipmentId',shipment.id);
  end if;
  if p_expected_updated_at is null or shipment.updated_at<>p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_delivery_changed'; end if;
  if purchase.status not in ('confirmed','shipping') or not ((shipment.delivery_method='quick' and shipment.status='ready' and p_kind='quick_handoff')
    or (shipment.delivery_method='quick' and shipment.status='shipping' and p_kind='quick_receive')
    or (shipment.delivery_method='pickup' and shipment.status='ready' and p_kind='pickup_receive')) then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  perform private.assert_shipment_preorder_ready(shipment.id);
  if occurred>instant or occurred<greatest(shipment.created_at,coalesce(purchase.confirmed_at,shipment.created_at))
    or (p_kind='quick_receive' and occurred<shipment.shipped_at) then raise check_violation using message='invalid_delivery_evidence'; end if;
  if evidence->>'recipientKind'='delegate' and shipment.delivery_method_snapshot->'allowDelegate' is distinct from 'true'::jsonb then
    raise check_violation using message='delivery_delegate_not_allowed'; end if;
  if p_kind<>'quick_handoff' then
    select * into confirmation from private.shipment_receipt_confirmations where shipment_id=shipment.id for update;
    if not found or confirmation.selection_id is distinct from shipment.delivery_selection_id or confirmation.owner_id<>purchase.user_id
      or confirmation.consumed_at is not null or confirmation.expires_at<=instant or confirmation.failed_attempts>=5 then
      return jsonb_build_object('ok',false,'error','delivery_receipt_code_unavailable'); end if;
    if confirmation.confirmation_digest is distinct from extensions.digest(confirmation_value,'sha256') then
      update private.shipment_receipt_confirmations set failed_attempts=failed_attempts+1 where shipment_id=shipment.id;
      -- Return a failure object so the failed-attempt count commits without a status change.
      return jsonb_build_object('ok',false,'error',case when confirmation.failed_attempts+1>=5 then 'delivery_receipt_code_unavailable'
        else 'delivery_receipt_code_invalid' end,'remainingAttempts',greatest(0,4-confirmation.failed_attempts));
    end if;
  end if;
  evidence:=evidence||jsonb_build_object('selectionId',shipment.delivery_selection_id,'policyId',shipment.delivery_policy_id,
    'policyRevision',shipment.delivery_method_snapshot->'revision');
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(p_operation_id,shipment.id,p_kind,actor,fingerprint,evidence);
  if p_kind<>'quick_handoff' then
    update private.shipment_receipt_confirmations set consumed_at=instant,consumed_operation_id=p_operation_id where shipment_id=shipment.id;
  end if;
  next_status:=case when p_kind='quick_handoff' then 'shipping' else 'delivered' end;
  update public.order_shipments set status=next_status,delivery_event_id=p_operation_id,
    shipped_at=case when p_kind in ('quick_handoff','pickup_receive') then occurred else shipped_at end,
    delivered_at=case when next_status='delivered' then occurred else delivered_at end,updated_at=instant where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_evidence_recorded','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'operationId',p_operation_id,'method',shipment.delivery_method,'kind',p_kind,'occurredAt',occurred));
  return jsonb_build_object('ok',true,'replayed',false,'shipmentId',shipment.id);
end $$;
revoke all on function public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamptz,uuid) to authenticated;

create function public.admin_read_shipment_delivery(p_shipment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare shipment public.order_shipments; purchase public.orders; has_claim boolean;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into purchase from public.orders where id=shipment.order_id;
  has_claim:=exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in ('requested','processing','needs_review'))
    or exists(select 1 from public.order_cancellation_claims where order_id=purchase.id);
  return jsonb_build_object('shipmentId',shipment.id,'orderId',purchase.id,'originId',shipment.origin_id,'status',shipment.status,
    'orderStatus',purchase.status,'updatedAt',shipment.updated_at,'shippingFee',shipment.shipping_fee,'exportedAt',shipment.exported_at,
    'canSelect',not has_claim and shipment.status='ready' and shipment.exported_at is null and shipment.carrier is null
      and shipment.tracking_number is null and purchase.status in ('paid','confirmed','shipping'),
    'canTransition',not has_claim and purchase.status in ('confirmed','shipping')
      and ((shipment.delivery_method='quick' and shipment.status in ('ready','shipping')) or (shipment.delivery_method='pickup' and shipment.status='ready')),
    'preorderReady',private.shipment_preorder_allocation_ready(shipment.id),'summary',private.shipment_delivery_summary(shipment.id),
    'policies',public.admin_list_delivery_policies(shipment.origin_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',operation.id,'kind',operation.kind,'evidence',operation.evidence,
      'actorName',profile.nickname,'recordedAt',operation.recorded_at) order by operation.recorded_at,operation.id),'[]')
      from private.shipment_delivery_operations operation left join public.profiles profile on profile.id=operation.actor_id where operation.shipment_id=shipment.id));
end $$;
revoke all on function public.admin_read_shipment_delivery(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_shipment_delivery(uuid) to authenticated;

-- Preserve the regional fee and preorder projections supplied by preceding migrations.
alter function private.order_shipment_records(uuid) rename to order_shipment_records_before_delivery_methods;
revoke all on function private.order_shipment_records_before_delivery_methods(uuid) from public,anon,authenticated,service_role;
grant execute on function private.order_shipment_records_before_delivery_methods(uuid) to postgres;
create function private.order_shipment_records(target_order uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(row.value||jsonb_build_object('delivery',private.shipment_delivery_summary((row.value->>'id')::uuid)) order by row.ordinality),'[]')
  from jsonb_array_elements(private.order_shipment_records_before_delivery_methods(target_order)) with ordinality row(value,ordinality);
$$;
revoke all on function private.order_shipment_records(uuid) from public,anon,authenticated,service_role;
grant execute on function private.order_shipment_records(uuid) to postgres;
alter function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) set schema private;
alter function private.admin_search_shipments(text,uuid,text,date,date,integer,integer) rename to admin_search_shipments_before_delivery_methods;
revoke all on function private.admin_search_shipments_before_delivery_methods(text,uuid,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.admin_search_shipments_before_delivery_methods(text,uuid,text,date,date,integer,integer) to postgres;
create function public.admin_search_shipments(p_tab text,p_origin_id uuid default null,p_query text default null,
  p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.admin_search_shipments_before_delivery_methods(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset);
  return jsonb_set(result,'{rows}',(select coalesce(jsonb_agg(row.value||jsonb_build_object('delivery',private.shipment_delivery_summary((row.value->>'id')::uuid))
    order by row.ordinality),'[]') from jsonb_array_elements(result->'rows') with ordinality row(value,ordinality)));
end $$;
revoke all on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) to authenticated;

create function private.lock_parcel_shipment(p_shipment_id uuid) returns void
language plpgsql set search_path='' as $$
declare method text;
begin
  perform purchase.id from public.orders purchase join public.order_shipments shipment on shipment.order_id=purchase.id
    where shipment.id=p_shipment_id for update of purchase;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select delivery_method into method from public.order_shipments where id=p_shipment_id for update;
  if method<>'parcel' then raise check_violation using message='delivery_method_evidence_required'; end if;
end $$;
revoke all on function private.lock_parcel_shipment(uuid) from public,anon,authenticated,service_role;
grant execute on function private.lock_parcel_shipment(uuid) to postgres;
alter function public.admin_update_shipment_status(uuid,text,text,text) set schema private;
alter function private.admin_update_shipment_status(uuid,text,text,text) rename to admin_update_shipment_status_before_delivery_methods;
revoke all on function private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text) to postgres;
create function public.admin_update_shipment_status(p_shipment_id uuid,p_status text,p_carrier text,p_tracking_number text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_parcel_shipment(p_shipment_id);
  perform private.admin_update_shipment_status_before_delivery_methods(p_shipment_id,p_status,p_carrier,p_tracking_number);
end $$;
revoke all on function public.admin_update_shipment_status(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_shipment_status(uuid,text,text,text) to authenticated,postgres;
alter function public.admin_update_shipment_tracking(uuid,text,text) set schema private;
alter function private.admin_update_shipment_tracking(uuid,text,text) rename to admin_update_shipment_tracking_before_delivery_methods;
revoke all on function private.admin_update_shipment_tracking_before_delivery_methods(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_update_shipment_tracking_before_delivery_methods(uuid,text,text) to postgres;
create function public.admin_update_shipment_tracking(p_shipment_id uuid,p_carrier text,p_tracking_number text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_parcel_shipment(p_shipment_id);
  perform private.admin_update_shipment_tracking_before_delivery_methods(p_shipment_id,p_carrier,p_tracking_number);
end $$;
revoke all on function public.admin_update_shipment_tracking(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_shipment_tracking(uuid,text,text) to authenticated,postgres;

alter function public.admin_shipment_export(uuid[]) set schema private;
alter function private.admin_shipment_export(uuid[]) rename to admin_shipment_export_before_delivery_methods;
revoke all on function private.admin_shipment_export_before_delivery_methods(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_shipment_export_before_delivery_methods(uuid[]) to postgres;
create function public.admin_shipment_export(target_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if exists(select 1 from public.order_shipments where id=any(target_ids) and delivery_method<>'parcel') then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  return private.admin_shipment_export_before_delivery_methods(target_ids);
end $$;
revoke all on function public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_export(uuid[]) to authenticated;

-- Non-parcel transitions have customer-visible order instructions; the existing
-- parcel email format/outbox is deliberately limited to its original method.
create or replace function private.enqueue_dispatched_shipment_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='ready' and new.status='shipping' and new.delivery_method='parcel' then
    insert into public.order_shipment_email_jobs(order_id,shipment_id) values(new.order_id,new.id) on conflict(shipment_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.enqueue_dispatched_shipment_email() from public,anon,authenticated,service_role;
alter function public.admin_enqueue_shipment_emails(jsonb) set schema private;
alter function private.admin_enqueue_shipment_emails(jsonb) rename to admin_enqueue_shipment_emails_before_delivery_methods;
revoke all on function private.admin_enqueue_shipment_emails_before_delivery_methods(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_enqueue_shipment_emails_before_delivery_methods(jsonb) to postgres;
create function public.admin_enqueue_shipment_emails(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_rows)='array' and exists(select 1 from jsonb_array_elements(target_rows) row
    join public.order_shipments shipment on shipment.id::text=row->>'shipmentId' where shipment.delivery_method<>'parcel') then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  return private.admin_enqueue_shipment_emails_before_delivery_methods(target_rows);
end $$;
revoke all on function public.admin_enqueue_shipment_emails(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_enqueue_shipment_emails(jsonb) to authenticated;
notify pgrst,'reload schema';
