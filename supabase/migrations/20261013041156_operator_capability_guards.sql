-- Capability enforcement: named RPCs, mixed public/customer branches and RLS.
-- Existing signatures/ACLs are preserved. Small SQL mutation adapters explicitly
-- become PL/pgSQL so authorization runs before their delegated mutation.

create function private.operator_artwork_capability(p_kind text)
returns text language sql immutable set search_path='' as $$
 select case p_kind when 'good' then 'catalog.manage' when 'curation' then 'store.manage'
   when 'ip' then 'platform.manage' when 'card' then 'platform.manage' when 'event' then 'platform.manage' end;
$$;
revoke all on function private.operator_artwork_capability(text) from public,anon,authenticated,service_role;

create function private.operator_alert_capability(p_category text)
returns text language sql immutable set search_path='' as $$
 select case p_category when 'orders' then 'sales.read' when 'claims' then 'sales.manage'
   when 'inquiries' then 'cs.manage' when 'questions' then 'cs.manage' when 'reviews' then 'cs.manage' end;
$$;
revoke all on function private.operator_alert_capability(text) from public,anon,authenticated,service_role;

create function private.guard_operator_owner_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.operator_memberships where profile_id=old.id and manager_role='owner') then
  if tg_op='DELETE' or (tg_op='UPDATE' and (new.role not in ('staff','admin') or new.suspended_at is not null)) then
   raise check_violation using message='operator_owner_transfer_required';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.guard_operator_owner_profile() from public,anon,authenticated,service_role;
create trigger operator_owner_profile_guard before update of role,suspended_at or delete on public.profiles
 for each row execute function private.guard_operator_owner_profile();

create function private.guard_operator_owner_fence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.operator_memberships where profile_id=new.subject_user_id and manager_role='owner') then
  raise check_violation using message='operator_owner_transfer_required';
 end if;
 return new;
end $$;
revoke all on function private.guard_operator_owner_fence() from public,anon,authenticated,service_role;
create trigger operator_owner_fence_guard before insert or update of subject_user_id on private.account_action_fences
 for each row execute function private.guard_operator_owner_fence();

create function private.enforce_operator_owner_available() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (select configured from private.operator_access_state where id) and
   (select count(*) from private.operator_memberships m join public.profiles p on p.id=m.profile_id
    where m.manager_role='owner' and p.role in ('staff','admin') and p.suspended_at is null
      and not exists(select 1 from private.account_action_fences f where f.subject_user_id=p.id))<>1 then
  raise check_violation using message='operator_owner_required';
 end if;
 return null;
end $$;
revoke all on function private.enforce_operator_owner_available() from public,anon,authenticated,service_role;
create constraint trigger operator_owner_membership_invariant after insert or update or delete on private.operator_memberships
 deferrable initially deferred for each row execute function private.enforce_operator_owner_available();
create constraint trigger operator_owner_setup_invariant after insert or update on private.operator_access_state
 deferrable initially deferred for each row execute function private.enforce_operator_owner_available();

-- A durable authorization only completes the provider operation already started;
-- it does not authorize another cancellation after the actor loses access.
create table private.operator_cancellation_authorizations (
 request_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 actor_id uuid not null,
 authorized_at timestamptz not null default clock_timestamp(),
 primary key(request_id,actor_id)
);
alter table private.operator_cancellation_authorizations enable row level security;
revoke all on private.operator_cancellation_authorizations from public,anon,authenticated,service_role;

create function private.can_finish_operator_cancellation(p_request_id uuid,p_actor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_actor_id is not null and (
  private.has_operator_capability(p_actor_id,'sales.manage') or exists(
   select 1 from private.operator_cancellation_authorizations a
   join public.order_cancellation_requests r on r.id=a.request_id
   where a.request_id=p_request_id and a.actor_id=p_actor_id
     and r.status in ('processing','needs_review','completed')
  )
 );
$$;
revoke all on function private.can_finish_operator_cancellation(uuid,uuid) from public,anon,authenticated,service_role;


-- private.require_purchase_restriction_staff()
CREATE OR REPLACE FUNCTION private.require_purchase_restriction_staff()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.require_operator_capability('sales.restrictions',false);
end $function$;

-- private.require_inquiry_template_staff()
CREATE OR REPLACE FUNCTION private.require_inquiry_template_staff()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.require_operator_capability('cs.manage',false);
end $function$;

-- private.require_seller_claim_staff()
CREATE OR REPLACE FUNCTION private.require_seller_claim_staff()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.require_operator_capability('sales.manage',false);
end $function$;

-- private.assert_store_credit_admin()
CREATE OR REPLACE FUNCTION private.assert_store_credit_admin()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.require_operator_capability('marketing.manage',true);
end $function$;

-- private.can_manage_goods_purchase_costs()
CREATE OR REPLACE FUNCTION private.can_manage_goods_purchase_costs()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.has_operator_capability('platform.manage',true);
$function$;

-- private.guard_goods_import_cost_confidentiality()
CREATE OR REPLACE FUNCTION private.guard_goods_import_cost_confidentiality()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.requires_admin:=coalesce(new.requires_admin,false)
    or private.has_operator_capability(new.actor_id,'platform.manage',true)
    or jsonb_path_exists(new.plan,'$[*].target.variants[*].purchaseCost');
  if tg_op='UPDATE' then new.requires_admin:=new.requires_admin or old.requires_admin; end if;
  return new;
end $function$;

-- admin_activate_shipping_notice_template(uuid,timestamp with time zone,text)
CREATE OR REPLACE FUNCTION public.admin_activate_shipping_notice_template(target_id uuid, expected_updated_at timestamp with time zone, evidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_evidence text := btrim(coalesce(evidence, ''), E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.shipping_notice_templates where id = target_id for update;
  if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
  if previous.status <> 'draft' then raise check_violation using message = 'shipping_notice_template_not_draft'; end if;
  if previous.updated_at is distinct from expected_updated_at then
    raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
  end if;
  if char_length(btrim(previous.shipping_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.return_exchange_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.cs_name, E' \t\n\r')) = 0
    or (char_length(btrim(previous.cs_phone, E' \t\n\r')) = 0 and char_length(btrim(previous.cs_email, E' \t\n\r')) = 0)
    or char_length(normalized_evidence) = 0 or char_length(normalized_evidence) > 2000
    or private.has_disallowed_shipping_notice_control(normalized_evidence) then
    raise check_violation using message = 'shipping_notice_template_required';
  end if;
  update public.shipping_notice_templates set
    status = 'active', confirmation_evidence = normalized_evidence,
    confirmed_by = actor, confirmed_at = clock_timestamp(),
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.shipping_notice_template.activated', 'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved)));
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at, 'status', saved.status);
end;
$function$;

-- admin_add_customer_note(uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.admin_add_customer_note(target_user_id uuid, target_body text, operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); normalized_body text:=btrim(target_body); written boolean;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_user_id]);
  perform private.require_operator_capability('platform.manage',false);

 if actor is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if normalized_body is null or char_length(normalized_body) not between 1 and 2000 or normalized_body !~ '[^[:space:]]'
 then raise invalid_parameter_value using message='customer_note_invalid'; end if;
 if operation_id is null then raise invalid_parameter_value using message='customer_note_operation_required'; end if;
 perform 1 from public.profiles where id=target_user_id for key share;
 if not found then raise no_data_found using message='customer_not_found'; end if;
 insert into public.customer_notes(id,customer_id,author_id,body)
 values(operation_id,target_user_id,actor,normalized_body) on conflict(id) do nothing returning true into written;
 if coalesce(written,false) then
  insert into public.audit_log(actor_id,action,target,diff)
  values(actor,'admin.customer.note_added','profile:'||target_user_id,jsonb_build_object('noteId',operation_id));
 elsif not exists(select 1 from public.customer_notes where id=operation_id and customer_id=target_user_id
   and author_id=actor and body=normalized_body) then raise invalid_parameter_value using message='customer_note_operation_conflict';
 end if;
 return coalesce(written,false);
end;
$function$;

-- admin_add_inquiry_internal_note(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_add_inquiry_internal_note(target_inquiry_id uuid, target_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''), E' \t\n\r');
  v_note_id uuid;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_note_body';
  end if;
  perform 1 from public.inquiries where id = target_inquiry_id for update;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  insert into public.inquiry_internal_notes(inquiry_id, author_id, body)
    values (target_inquiry_id, v_actor, v_body) returning id into v_note_id;
  insert into public.audit_log(actor_id, action, target, diff)
    values (v_actor, 'admin.inquiry.note_added', 'inquiries:' || target_inquiry_id::text,
      jsonb_build_object('noteId', v_note_id));
  return v_note_id;
end;
$function$;

-- admin_add_order_note(uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.admin_add_order_note(target_order_id uuid, target_body text, operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := (select auth.uid()); body text := btrim(target_body); written boolean;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='staff_required';
 end if;
 if body is null or char_length(body) not between 1 and 2000 then
  raise invalid_parameter_value using message='note_body_invalid';
 end if;
 if operation_id is null then
  raise invalid_parameter_value using message='note_operation_required';
 end if;
 perform 1 from public.orders where id=target_order_id for key share;
 if not found then raise no_data_found using message='order_not_found'; end if;
 insert into public.audit_log(id,actor_id,action,target,diff)
 values(operation_id,actor,'admin.order.note','order:'||target_order_id,jsonb_build_object('body',body))
 on conflict(id) do nothing returning true into written;
 if not coalesce(written,false) and not exists(
   select 1 from public.audit_log where id=operation_id and actor_id=actor
     and action='admin.order.note' and target='order:'||target_order_id and diff->>'body'=body
 ) then raise invalid_parameter_value using message='note_operation_conflict'; end if;
 return coalesce(written,false);
end;
$function$;

-- admin_adjust_loyalty_grade(uuid,loyalty_grade,text)
CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty_grade(p_user_id uuid, p_grade loyalty_grade, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  v_current public.loyalty_grade;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),p_user_id]);
  perform private.require_operator_capability('marketing.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_note is null then
    raise check_violation using message = 'note_required';
  end if;

  select profile.loyalty_grade
  into v_current
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'member_missing' using errcode = 'P0002';
  end if;

  if v_current is distinct from p_grade then
    update public.profiles
    set loyalty_grade = p_grade
    where id = p_user_id;

    insert into public.loyalty_grade_events (
      user_id, previous_grade, next_grade, reason, actor_id, note
    )
    values (p_user_id, v_current, p_grade, 'manual_adjustment', actor_id, v_note);

    -- 수동 승급도 자동 산정과 같은 대우다(US7) — 혜택 쿠폰과 승급 알림을 함께 준다.
    if p_grade > v_current then
      perform private.grant_grade_benefit_coupons(p_user_id, v_current, p_grade);

      insert into public.notifications (
        user_id, type, title, body, link_path, source_type, source_id, dedupe_key
      )
      values (
        p_user_id,
        'loyalty_grade_upgraded',
        '회원 등급이 올랐어요',
        format('%s 등급이 되었어요. 등급 혜택 쿠폰은 쿠폰함에서 확인할 수 있어요.', upper(p_grade::text)),
        '/my/coupons',
        'profile',
        p_user_id::text,
        'loyalty:upgrade:' || p_user_id::text || ':' || p_grade::text
      )
      on conflict (user_id, dedupe_key) do update set
        read_at = null,
        created_at = now();
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'loyalty.grade.adjust',
    'profiles:' || p_user_id::text,
    jsonb_build_object('from', v_current, 'to', p_grade, 'note', v_note)
  );
end;
$function$;

-- admin_adjust_stock(uuid,text,uuid,integer,integer,text)
CREATE OR REPLACE FUNCTION public.admin_adjust_stock(target_adjustment_id uuid, target_good_id text, target_variant_id uuid, target_expected_stock_qty integer, target_delta integer, target_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid()); normalized_reason text:=btrim(target_reason,E' \t\n\r\f\v');
  previous_stock integer; next_stock bigint; existing public.audit_log; requested_diff jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null then raise sqlstate '28000' using message='auth_required'; end if;
  if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if target_adjustment_id is null then raise null_value_not_allowed using message='invalid_adjustment_id'; end if;
  if target_variant_id is null then raise invalid_parameter_value using message='goods_variant_required'; end if;
  if target_expected_stock_qty is null or target_expected_stock_qty<0 then raise invalid_parameter_value using message='invalid_expected_stock_qty'; end if;
  if target_delta is null or target_delta=0 then raise invalid_parameter_value using message='invalid_stock_delta'; end if;
  if normalized_reason is null or char_length(normalized_reason) not between 1 and 200 then raise invalid_parameter_value using message='invalid_stock_reason'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_stock_adjustment:'||target_adjustment_id::text,0));
  next_stock:=target_expected_stock_qty::bigint+target_delta::bigint;
  requested_diff:=jsonb_build_object('variantId',target_variant_id,'from',target_expected_stock_qty,'delta',target_delta,'to',next_stock,'reason',normalized_reason);
  select * into existing from public.audit_log where id=target_adjustment_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.good.stock_adjusted'
      and existing.target='goods:'||target_good_id and existing.diff=requested_diff then return (existing.diff->>'to')::integer; end if;
    raise unique_violation using message='adjustment_conflict';
  end if;
  perform 1 from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if exists(select 1 from public.goods where id=target_good_id and archived_at is not null) then raise check_violation using message='catalog_archived'; end if;
  select stock_qty into previous_stock from public.goods_variants where id=target_variant_id and good_id=target_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if previous_stock<>target_expected_stock_qty then raise exception using message='stock_changed'; end if;
  next_stock:=private.change_goods_variant_stock(target_good_id,target_variant_id,target_delta::bigint);
  insert into public.audit_log(id,actor_id,action,target,diff)
    values(target_adjustment_id,actor,'admin.good.stock_adjusted','goods:'||target_good_id,requested_diff);
  return next_stock::integer;
end $function$;

-- admin_adjust_store_credit(uuid,uuid,bigint,timestamp with time zone,text,bigint)
CREATE OR REPLACE FUNCTION public.admin_adjust_store_credit(p_operation_id uuid, p_user_id uuid, p_amount bigint, p_expires_at timestamp with time zone, p_reason text, p_expected_available bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; policy private.store_credit_policy; operation private.store_credit_operations; payload jsonb; before_balance jsonb; after_balance jsonb; outstanding bigint; take bigint; lot private.store_credit_lots;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),p_user_id]);
  perform private.require_operator_capability('marketing.manage',true);

  actor:=private.assert_store_credit_admin();
  if p_operation_id is null or p_user_id is null or p_amount is null or p_amount=0 or abs(p_amount::numeric)>999999999999
    or p_expected_available is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
    or not exists(select 1 from public.profiles where id=p_user_id) then raise invalid_parameter_value using message='invalid_store_credit_adjustment'; end if;
  payload:=jsonb_build_object('userId',p_user_id,'amount',p_amount,'expiresAt',p_expires_at,'reason',btrim(p_reason),'expectedAvailable',p_expected_available);
  perform pg_advisory_xact_lock(hashtextextended('store_credit_operation:'||p_operation_id::text,0));
  select * into operation from private.store_credit_operations where operation_id=p_operation_id;
  if found then
    if operation.actor_id<>actor or operation.kind<>'adjustment' or operation.payload is distinct from payload then raise exception using errcode='PT409',message='store_credit_operation_conflict'; end if;
    return operation.result;
  end if;
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then raise insufficient_privilege using message='account_deletion_in_progress'; end if;
  select * into policy from private.store_credit_policy where singleton for share;
  if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
  perform private.expire_store_credit_lots(p_user_id,clock_timestamp());
  before_balance:=private.store_credit_balance(p_user_id);
  if (before_balance->>'available')::bigint<>p_expected_available then raise exception using errcode='PT409',message='store_credit_balance_conflict'; end if;
  if p_amount>0 then
    if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+make_interval(days=>policy.validity_days)
      then raise check_violation using message='store_credit_expiry_invalid'; end if;
    if p_amount>(before_balance->>'debt')::bigint and (before_balance->>'available')::bigint+(before_balance->>'reserved')::bigint+p_amount-(before_balance->>'debt')::bigint>policy.max_balance
      then raise check_violation using message='store_credit_balance_limit'; end if;
    perform private.issue_store_credit_lot(p_user_id,p_amount,p_expires_at,'admin',null,actor,p_operation_id,btrim(p_reason));
  else
    if p_expires_at is not null then raise invalid_parameter_value using message='store_credit_debit_expiry'; end if;
    outstanding:=-p_amount;
    if (before_balance->>'available')::bigint<outstanding then raise check_violation using message='store_credit_insufficient'; end if;
    for lot in select * from private.store_credit_lots where user_id=p_user_id and available_amount>0 order by expires_at,id for update loop
      take:=least(outstanding,lot.available_amount);
      update private.store_credit_lots set available_amount=available_amount-take,revoked_amount=revoked_amount+take where id=lot.id;
      insert into public.store_credit_ledger(user_id,kind,amount,available_delta,lot_id,actor_id,operation_id,reason)
        values(p_user_id,'adjustment_debit',-take,-take,lot.id,actor,p_operation_id,btrim(p_reason));
      outstanding:=outstanding-take; exit when outstanding=0;
    end loop;
  end if;
  after_balance:=private.store_credit_balance(p_user_id);
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.adjusted','store_credit:'||p_user_id::text,
    jsonb_build_object('before',before_balance,'after',after_balance,'request',payload,'operationId',p_operation_id));
  insert into private.store_credit_operations(operation_id,actor_id,kind,payload,result) values(p_operation_id,actor,'adjustment',payload,after_balance);
  return after_balance;
end $function$;

-- admin_allocate_goods_preorders(text,uuid[],jsonb,text)
CREATE OR REPLACE FUNCTION public.admin_allocate_goods_preorders(p_good_id text, p_order_item_ids uuid[], p_expected_stock jsonb, p_receipt_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); order_key uuid; variant_row record; reservation_row record; expected_qty numeric; allocated_count integer:=0;
  evidence_value text:=nullif(btrim(p_receipt_reference),'');
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not coalesce(public.has_operator_capability('sales.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if cardinality(p_order_item_ids) is null or cardinality(p_order_item_ids) not between 1 and 100
    or cardinality(p_order_item_ids)<>(select count(distinct id) from unnest(p_order_item_ids) id)
    or jsonb_typeof(p_expected_stock) is distinct from 'object' or evidence_value is null or length(evidence_value)>2000 then
    raise invalid_parameter_value using message='invalid_preorder_allocation';
  end if;
  if (select count(*) from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    where reservation.order_item_id=any(p_order_item_ids) and item.good_id=p_good_id)<>cardinality(p_order_item_ids) then
    raise check_violation using message='preorder_reservation_missing';
  end if;
  -- Existing order-first shipment/cancellation writers and receipt allocation
  -- share this order -> goods -> option -> reservation locking sequence.
  for order_key in select purchase.id from public.orders purchase where exists(select 1 from private.goods_preorder_reservations reservation
    where reservation.order_id=purchase.id and reservation.order_item_id=any(p_order_item_ids)) order by purchase.id for update loop
    if exists(select 1 from private.goods_preorder_reservations reservation where reservation.order_id=order_key
      and reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved') then
      if not exists(select 1 from public.orders where id=order_key and status in ('paid','confirmed','shipping')) then
        raise check_violation using message='preorder_payment_required';
      end if;
      perform private.assert_order_dispatch_allowed(order_key);
    end if;
  end loop;
  if exists(select 1 from private.goods_preorder_reservations where order_item_id=any(p_order_item_ids) and state not in ('reserved','allocated')) then
    raise check_violation using message='preorder_reservation_released';
  end if;
  perform good.id from public.goods good where exists(select 1 from public.order_items item where item.id=any(p_order_item_ids) and item.good_id=good.id)
    order by good.id for update;
  perform variant.id from public.goods_variants variant where exists(select 1 from public.order_items item where item.id=any(p_order_item_ids) and item.variant_id=variant.id)
    order by variant.id for update;
  perform reservation.order_item_id from private.goods_preorder_reservations reservation where reservation.order_item_id=any(p_order_item_ids)
    order by reservation.order_item_id for update;
  for variant_row in select variant.id,variant.good_id,variant.stock_qty,sum(reservation.qty::bigint)::bigint qty
    from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    join public.goods_variants variant on variant.id=item.variant_id
    where reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved' group by variant.id order by variant.good_id,variant.id loop
    if jsonb_typeof(p_expected_stock->variant_row.id::text) is distinct from 'number'
      or p_expected_stock->>variant_row.id::text !~ '^(0|[1-9][0-9]*)$' then raise invalid_parameter_value using message='invalid_preorder_allocation'; end if;
    expected_qty:=(p_expected_stock->>variant_row.id::text)::numeric;
    if expected_qty<>variant_row.stock_qty then raise sqlstate 'PT409' using message='preorder_physical_stock_changed'; end if;
    if variant_row.stock_qty<variant_row.qty then raise check_violation using message='preorder_physical_stock_shortfall'; end if;
    perform private.change_goods_variant_stock(variant_row.good_id,variant_row.id,-variant_row.qty);
  end loop;
  for reservation_row in select reservation.*,item.good_id,item.variant_id from private.goods_preorder_reservations reservation
    join public.order_items item on item.id=reservation.order_item_id where reservation.order_item_id=any(p_order_item_ids) and reservation.state='reserved'
    order by reservation.order_item_id loop
    update private.goods_preorder_reservations set state='allocated',allocated_at=clock_timestamp(),allocated_by=actor,allocation_reference=evidence_value
      where order_item_id=reservation_row.order_item_id;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'order.preorder_stock_allocated','order:'||reservation_row.order_id::text,
      jsonb_build_object('orderItemId',reservation_row.order_item_id,'goodId',reservation_row.good_id,'variantId',reservation_row.variant_id,
        'policyId',reservation_row.policy_id,'qty',reservation_row.qty,'physicalStockDelta',-reservation_row.qty,'receiptReference',evidence_value));
    allocated_count:=allocated_count+1;
  end loop;
  if allocated_count>0 then
    update public.order_shipments shipment set updated_at=clock_timestamp() where exists(select 1 from public.order_shipment_items link
      where link.shipment_id=shipment.id and link.order_item_id=any(p_order_item_ids));
  end if;
  return jsonb_build_object('allocatedItems',allocated_count,'alreadyAllocatedItems',cardinality(p_order_item_ids)-allocated_count);
end $function$;

-- admin_answer_inquiry(uuid,text,text[])
CREATE OR REPLACE FUNCTION public.admin_answer_inquiry(target_inquiry_id uuid, target_body text, target_image_paths text[] DEFAULT '{}'::text[])
 RETURNS TABLE(message_id uuid, recipient_id uuid, recipient_email text, inquiry_reference bigint, inquiry_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_thread public.inquiries%rowtype;
  v_message_id uuid;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  select *
  into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;
  if v_thread.status = 'closed' then
    raise check_violation using message = 'inquiry_closed';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (target_inquiry_id, 'staff', v_actor, v_body, v_paths)
  returning id into v_message_id;

  update public.inquiries as thread
  set
    status = 'answered',
    handled_by = v_actor,
    answered_at = coalesce(thread.answered_at, now()),
    last_message_at = now()
  where thread.id = target_inquiry_id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_thread.user_id,
    'inquiry_answered',
    '문의에 답변이 등록됐어요',
    left('문의 #' || v_thread.reference::text || ' — ' || v_thread.title, 500),
    '/my/inquiries/' || target_inquiry_id::text,
    'inquiry',
    target_inquiry_id::text,
    'inquiry:answered:' || v_message_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.inquiry.answered',
    'inquiries:' || target_inquiry_id::text,
    jsonb_build_object(
      'messageId', v_message_id,
      'previousStatus', v_thread.status,
      'attachmentCount', cardinality(v_paths)
    )
  );

  return query
    select
      v_message_id,
      v_thread.user_id,
      profile.email,
      v_thread.reference,
      v_thread.title
    from public.profiles as profile
    where profile.id = v_thread.user_id;
end;
$function$;

-- admin_answer_product_question(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_answer_product_question(target_question_id uuid, target_answer_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_answer text := btrim(coalesce(target_answer_body, ''), E' \t\n\r\f\v');
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('cs.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_answer) not between 1 and 2000 then
    raise exception 'invalid_question_answer' using errcode = '22023';
  end if;

  select question.user_id, question.good_id, question.answer_body
    into v_user_id, v_good_id, v_previous
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set answer_body = normalized_answer,
      answered_at = now(),
      answered_by = actor_id
  where id = target_question_id;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.answer',
    'product_questions:' || target_question_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'answerLength', char_length(normalized_answer)
    )
  );

  -- body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답변
  -- 저장까지 함께 되돌아간다 — 이름을 잘라서라도 답변은 남긴다.
  insert into public.notifications (
    user_id, type, title, body, link_path, source_type, source_id, dedupe_key
  )
  values (
    v_user_id,
    'product_question_answered',
    -- 용어 규율(CONTEXT.md): 공개 상품 Q&A를 1:1 '문의'와 섞어 부르지 않는다.
    '상품 Q&A에 답변이 등록됐어요',
    left(coalesce(v_good_name, '굿즈'), 100) || ' 질문에 ICONS 운영자가 답변을 남겼습니다.',
    '/my/questions',
    'product_question',
    target_question_id::text,
    'product_question_answered:' || target_question_id::text
  )
  on conflict (user_id, dedupe_key) do update set
    title = excluded.title,
    body = excluded.body,
    read_at = null,
    created_at = now();
end;
$function$;

-- admin_apply_shipping_notice_template(text,uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_apply_shipping_notice_template(target_good_id text, target_template_id uuid, expected_good_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  template public.shipping_notice_templates;
  previous public.goods;
  saved public.goods;
  snapshot jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.goods where id = target_good_id for update;
  if not found then raise no_data_found using message = 'good_not_found'; end if;
  if expected_good_updated_at is null or previous.updated_at is distinct from expected_good_updated_at then
    raise exception using errcode = 'PT409', message = 'good_shipping_notice_conflict';
  end if;
  if previous.archived_at is not null then raise check_violation using message='good_archived'; end if;
  if target_template_id is not distinct from previous.shipping_notice_template_id then
    return jsonb_build_object('goodId',previous.id,'templateId',previous.shipping_notice_template_id,
      'templateVersion',previous.shipping_notice_template_version,'updatedAt',previous.updated_at);
  end if;
  if target_template_id is null then
    update public.goods set
      shipping_notice_template_id = null,
      shipping_notice_template_version = null,
      shipping_notice_snapshot = null,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_good_id returning * into saved;
    insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'catalog.good.shipping_notice_template_cleared', 'goods:' || saved.id,
        jsonb_build_object('before', jsonb_build_object(
          'templateId', previous.shipping_notice_template_id,
          'templateVersion', previous.shipping_notice_template_version,
          'snapshot', previous.shipping_notice_snapshot
        ), 'after', null));
    return jsonb_build_object('goodId', saved.id, 'templateId', null, 'templateVersion', null, 'updatedAt', saved.updated_at);
  end if;
  select * into template from public.shipping_notice_templates where id = target_template_id;
  if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
  if template.status <> 'active' then raise check_violation using message = 'shipping_notice_template_not_active'; end if;
  snapshot := jsonb_build_object(
    'templateId', template.id,
    'templateVersion', template.version,
    'code', template.code,
    'name', template.name,
    'shippingNotice', template.shipping_notice,
    'returnExchangeNotice', template.return_exchange_notice,
    'csName', template.cs_name,
    'csPhone', template.cs_phone,
    'csEmail', template.cs_email
  );
  update public.goods set
    shipping_notice_template_id = template.id,
    shipping_notice_template_version = template.version,
    shipping_notice_snapshot = snapshot,
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_good_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.good.shipping_notice_template_applied', 'goods:' || saved.id,
      jsonb_build_object('before', jsonb_build_object(
        'templateId', previous.shipping_notice_template_id,
        'templateVersion', previous.shipping_notice_template_version,
        'snapshot', previous.shipping_notice_snapshot
      ), 'after', jsonb_build_object(
        'templateId', saved.shipping_notice_template_id,
        'templateVersion', saved.shipping_notice_template_version,
        'snapshot', saved.shipping_notice_snapshot
      )));
  return jsonb_build_object(
    'goodId', saved.id,
    'templateId', saved.shipping_notice_template_id,
    'templateVersion', saved.shipping_notice_template_version,
    'updatedAt', saved.updated_at
  );
end;
$function$;

-- admin_apply_shipping_settings_template(uuid,uuid,integer,timestamp with time zone,jsonb)
CREATE OR REPLACE FUNCTION public.admin_apply_shipping_settings_template(p_request_id uuid, p_template_id uuid, p_expected_revision integer, p_expected_origin_updated_at timestamp with time zone, p_goods jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); payload jsonb; existing private.shipping_settings_applications;
 template public.shipping_settings_templates; origin public.fulfillment_origins; good public.goods; previous jsonb; item jsonb;
 ids text[]; target_count integer; result jsonb; results jsonb:='[]';
begin
  perform private.require_operator_capability('catalog.manage',false);

 if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_request_id is null or p_template_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_origin_updated_at is null
  or jsonb_typeof(p_goods) is distinct from 'array' then raise invalid_parameter_value using message='invalid_shipping_settings_application'; end if;
 if jsonb_array_length(p_goods) not between 1 and 100 then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 for item in select value from jsonb_array_elements(p_goods) loop
  if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['id','updatedAt'])
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','updatedAt'))
   or jsonb_typeof(item->'id') is distinct from 'string' or char_length(item->>'id') not between 1 and 120
   or jsonb_typeof(item->'updatedAt') is distinct from 'string' or (item->>'updatedAt')::timestamptz is null
  then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 end loop;
 select array_agg(value->>'id' order by value->>'id'),count(distinct value->>'id') into ids,target_count from jsonb_array_elements(p_goods);
 if target_count<>jsonb_array_length(p_goods) then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 payload:=jsonb_build_object('templateId',p_template_id,'revision',p_expected_revision,'originUpdatedAt',p_expected_origin_updated_at,
  'goods',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_goods)));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_settings_apply:'||p_request_id,0));
 select * into existing from private.shipping_settings_applications where id=p_request_id;
 if found then
  if existing.actor_id<>actor or existing.payload<>payload then raise exception using errcode='PT409',message='shipping_settings_request_conflict'; end if;
  return existing.result;
 end if;
 select * into template from public.shipping_settings_templates where id=p_template_id for share;
 if not found or not template.enabled then raise check_violation using message='shipping_settings_template_unavailable'; end if;
 if template.revision<>p_expected_revision then raise exception using errcode='PT409',message='shipping_settings_template_changed'; end if;
 -- Lock every target before inspecting/applying any copied field. A conflict
 -- aborts the statement so neither a prefix nor its audits can be committed.
 perform g.id from public.goods g where g.id=any(ids) order by g.id for update;
 if (select count(*) from public.goods g where g.id=any(ids) and g.archived_at is null)<>target_count then
  raise check_violation using message='shipping_settings_goods_unavailable'; end if;
 if exists(select 1 from jsonb_array_elements(p_goods) x join public.goods g on g.id=x->>'id'
  where g.updated_at is distinct from (x->>'updatedAt')::timestamptz) then
  raise exception using errcode='PT409',message='shipping_settings_goods_changed'; end if;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid for share;
 if not found or not origin.is_active then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 if origin.updated_at is distinct from p_expected_origin_updated_at then raise exception using errcode='PT409',message='shipping_settings_origin_changed'; end if;
 for good in select * from public.goods where id=any(ids) order by id loop
  previous:=private.good_shipping_settings(good);
  -- Reuse existing validation and the null/zero contract for claim guidance.
  perform public.admin_save_good_claim_policy(good.id,template.settings->'claimPolicy',good.updated_at);
  update public.goods set origin_id=origin.id,shipping_fee_type=template.settings->>'feeType',
   individual_fee=(template.settings->>'individualFee')::bigint,
   shipping_settings_template_id=template.id,shipping_settings_template_revision=template.revision,
   shipping_settings_snapshot=jsonb_build_object('templateId',template.id,'templateRevision',template.revision,'name',template.name,
    'settings',template.settings,'appliedAt',clock_timestamp(),'originUpdatedAt',origin.updated_at)
  where id=good.id returning * into good;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.good.shipping_settings_applied','goods:'||good.id,
   jsonb_build_object('requestId',p_request_id,'templateId',template.id,'templateRevision',template.revision,
    'before',previous,'after',private.good_shipping_settings(good),'originUpdatedAt',origin.updated_at));
  results:=results||jsonb_build_array(jsonb_build_object('id',good.id,'updatedAt',good.updated_at));
 end loop;
 result:=jsonb_build_object('requestId',p_request_id,'templateId',template.id,'templateRevision',template.revision,'appliedCount',target_count,'goods',results);
 insert into private.shipping_settings_applications(id,actor_id,payload,result) values(p_request_id,actor,payload,result);
 return result;
end $function$;

-- admin_archive_card(text)
CREATE OR REPLACE FUNCTION public.admin_archive_card(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('card', $1, true));
end;
$function$;

-- admin_archive_category(uuid,uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_archive_category(target_operation_id uuid, target_category_id uuid, target_expected_updated_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
  changed boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or target_expected_updated_at is null then raise invalid_parameter_value using message = 'invalid_category_operation'; end if;
  request_payload := jsonb_build_object('category_id', target_category_id, 'expected_updated_at', target_expected_updated_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.archived' and existing_diff -> 'request' = request_payload then
      return coalesce((existing_diff ->> 'changed')::boolean, true);
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  select * into category_row from public.catalog_categories where id = target_category_id for update;
  if not found then raise no_data_found using message = 'category_not_found'; end if;
  if category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
  if category_row.archived_at is not null then
    changed := false;
  else
    if exists (select 1 from public.catalog_categories where parent_id = target_category_id and archived_at is null) then raise check_violation using message = 'category_has_active_children'; end if;
    update public.catalog_categories set archived_at = pg_catalog.now(), updated_at = pg_catalog.now() where id = target_category_id;
    changed := true;
  end if;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.archived', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload, 'changed', changed));
  return changed;
end;
$function$;

-- admin_archive_cs_reply_template(uuid,boolean,integer)
CREATE OR REPLACE FUNCTION public.admin_archive_cs_reply_template(p_id uuid, p_archived boolean, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.cs_reply_templates; saved public.cs_reply_templates;
begin
  perform private.require_operator_capability('cs.manage',false);

 if actor is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_archived is null or p_expected_revision is null then raise invalid_parameter_value using message='invalid_cs_reply_template'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cs_reply_template:'||p_id::text,0));
 select * into previous from public.cs_reply_templates where id=p_id for update;
 if not found then raise no_data_found using message='cs_reply_template_not_found'; end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
 if (previous.archived_at is not null)=p_archived then return to_jsonb(previous); end if;
 update public.cs_reply_templates set archived_at=case when p_archived then clock_timestamp() else null end,
   revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.cs_reply_template.archived','cs_reply_templates:'||p_id::text,
   jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
 return to_jsonb(saved);
end $function$;

-- admin_archive_event(text)
CREATE OR REPLACE FUNCTION public.admin_archive_event(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('event', $1, true));
end;
$function$;

-- admin_archive_good(text)
CREATE OR REPLACE FUNCTION public.admin_archive_good(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('catalog.manage',false);
return (select private.set_catalog_archived('good', $1, true));
end;
$function$;

-- admin_archive_ip(text)
CREATE OR REPLACE FUNCTION public.admin_archive_ip(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('ip', $1, true));
end;
$function$;

-- admin_assign_good_category(uuid,text,uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_assign_good_category(target_operation_id uuid, target_good_id text, target_category_id uuid, target_expected_updated_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed boolean; replay boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.catalog.category.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  changed:=private.admin_assign_good_category_before_additional(target_operation_id,target_good_id,target_category_id,target_expected_updated_at);
  if not replay then perform private.apply_goods_additional_categories(target_good_id,private.goods_additional_category_ids(target_good_id)); end if;
  return changed;
end $function$;

-- admin_bank_deposit_queue(bank_deposit_status,integer)
CREATE OR REPLACE FUNCTION public.admin_bank_deposit_queue(p_status bank_deposit_status DEFAULT 'unmatched'::bank_deposit_status, p_limit integer DEFAULT 30)
 RETURNS TABLE(deposit_id uuid, source text, external_id text, deposited_at timestamp with time zone, depositor_name text, amount bigint, raw_reference text, status bank_deposit_status, matched_order_id uuid, suggested_order_id uuid, suggested_order_code text, suggested_confidence text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  return query
  select
    deposit.id,
    deposit.source,
    deposit.external_id,
    deposit.deposited_at,
    deposit.depositor_name,
    deposit.amount,
    deposit.raw_reference,
    deposit.status,
    deposit.matched_order_id,
    suggestion.order_id,
    case
      when suggestion.order_id is null then null
      else private.bank_transfer_deposit_code(suggestion.order_id)
    end,
    suggestion.confidence
  from public.bank_deposits as deposit
  left join lateral private.suggest_bank_deposit_order(
    deposit.depositor_name,
    deposit.amount
  ) as suggestion on deposit.status = 'unmatched'
  where deposit.status = coalesce(p_status, 'unmatched')
  order by deposit.deposited_at desc
  limit v_limit;
end;
$function$;

-- admin_begin_order_cancellation_reconcile(uuid)
CREATE OR REPLACE FUNCTION public.admin_begin_order_cancellation_reconcile(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_request_status text;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status
  into v_request_status
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id,v_actor);

  if v_request_status = 'processing' then
    return;
  end if;

  if v_request_status <> 'needs_review' then
    raise exception using message = 'cancellation_request_not_reconcilable';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'requested'
  where cancellation_request_id = p_request_id
    and status = 'failed';

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = coalesce(decided_by, v_actor),
    decided_at = coalesce(decided_at, now()),
    provider_started_at = coalesce(provider_started_at, now()),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_reconcile_started',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'needs_review',
      'to', 'processing'
    )
  );
end;
$function$;

-- admin_benefit_report(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_benefit_report(p_from timestamp with time zone, p_to timestamp with time zone, p_query text DEFAULT ''::text, p_discount text DEFAULT 'all'::text, p_segment text DEFAULT 'all'::text, p_code text DEFAULT ''::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb; needle text := btrim(coalesce(p_query,'')); pattern text;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('marketing.manage',false) then
  raise insufficient_privilege using message='staff_required';
 end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
  or p_to<=p_from or p_to-p_from>interval '366 days' or length(needle)>100
  or p_discount is null or p_discount not in('all','fixed','percent')
  or p_segment is null or p_segment not in('all','first_purchase','repeat_purchase')
  or p_code is null or length(p_code)>24 or p_limit is null or p_limit not between 1 and 10000
  or p_offset is null or p_offset<0 then
  raise invalid_parameter_value using message='invalid_benefit_report';
 end if;
 pattern := '%'||replace(replace(replace(needle,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with definitions as materialized (
  select c.code,c.name from public.coupons c
  where (needle='' or c.code ilike pattern escape E'\\' or c.name ilike pattern escape E'\\')
   and (p_discount='all' or c.discount_type=p_discount)
   and (p_segment='all' or c.recipient_segment=p_segment)
   and (p_code='' or c.code=p_code)
 ), issued as materialized (
  select u.*, exists(select 1 from public.coupon_redemptions r join public.orders o on o.id=r.order_id
    where r.user_coupon_id=u.id and r.status='applied' and o.status=any(private.revenue_order_statuses())) as cohort_paid
  from public.user_coupons u join definitions d on d.code=u.coupon_code
  where u.issued_at>=p_from and u.issued_at<p_to
 ), redemptions as materialized (
  select r.*,o.total,case when r.status='released' then 'released'
    when o.status=any(private.revenue_order_statuses()) then 'paid'
    when o.status='pending' then 'pending' else 'other' end as report_status
  from public.coupon_redemptions r join definitions d on d.code=r.coupon_code
  join public.orders o on o.id=r.order_id
  where (r.applied_at>=p_from and r.applied_at<p_to) or (r.released_at>=p_from and r.released_at<p_to)
 ), events as materialized (
  select coupon_code,(issued_at at time zone 'Asia/Seoul')::date as date,
   1::bigint as issued,0::bigint as paid_uses,0::bigint as discount_amount,0::bigint as order_amount,
   0::bigint as released,cohort_paid::integer::bigint as cohort_paid_uses from issued
  union all
  select coupon_code,(applied_at at time zone 'Asia/Seoul')::date,0,1,discount_amount,total,0,0
   from redemptions where report_status='paid' and applied_at>=p_from and applied_at<p_to
  union all
  select coupon_code,(released_at at time zone 'Asia/Seoul')::date,0,0,0,0,1,0
   from redemptions where report_status='released' and released_at>=p_from and released_at<p_to
 ), coupon_totals as materialized (
  select d.code,d.name,coalesce(sum(e.issued),0) as issued,coalesce(sum(e.paid_uses),0) as "paidUses",
   coalesce(sum(e.discount_amount),0) as "discountAmount",coalesce(sum(e.order_amount),0) as "orderAmount",
   coalesce(sum(e.released),0) as released,coalesce(sum(e.cohort_paid_uses),0) as "cohortPaidUses"
  from definitions d join events e on e.coupon_code=d.code group by d.code,d.name
 ), daily as (
  select date,sum(issued) as issued,sum(paid_uses) as "paidUses",sum(discount_amount) as "discountAmount",
   sum(order_amount) as "orderAmount",sum(released) as released,sum(cohort_paid_uses) as "cohortPaidUses"
  from events group by date
 )
 select jsonb_build_object(
  'summary',(select jsonb_build_object('issued',coalesce(sum(issued),0),'paidUses',coalesce(sum(paid_uses),0),
   'discountAmount',coalesce(sum(discount_amount),0),'orderAmount',coalesce(sum(order_amount),0),
   'released',coalesce(sum(released),0),'cohortPaidUses',coalesce(sum(cohort_paid_uses),0)) from events),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by date) from daily d),'[]'::jsonb),
  'coupons',coalesce((select jsonb_agg(to_jsonb(c) order by "discountAmount" desc,code)
   from (select * from coupon_totals order by "discountAmount" desc,code limit p_limit offset case when p_code='' then p_offset else 0 end)c),'[]'::jsonb),
  'couponCount',(select count(*) from coupon_totals),
  'uses',case when p_code='' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'orderId',r.order_id,'appliedAt',r.applied_at,'releasedAt',r.released_at,
    'status',r.report_status,'discountAmount',r.discount_amount,'orderAmount',r.total)
    order by r.applied_at desc,r.id)
   from(select * from redemptions order by applied_at desc,id limit p_limit offset p_offset)r),'[]'::jsonb) end,
  'useCount',case when p_code='' then 0 else(select count(*) from redemptions) end
 ) into v_result;
 return v_result;
end;$function$;

-- admin_cancel_unpaid_bank_transfer_order(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_cancel_unpaid_bank_transfer_order(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider = 'bank_transfer'
  for update;

  if found then
    if v_attempt.state not in ('prepared', 'needs_review', 'unknown') then
      raise object_not_in_prerequisite_state using message = 'bank_transfer_attempt_not_cancelable';
    end if;

    if exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    ) then
      raise object_not_in_prerequisite_state using message = 'bank_transfer_payment_exists';
    end if;

    update public.payment_attempts
    set state = 'canceled',
        claim_token = null,
        claim_expires_at = null
    where id = v_attempt.id;
  end if;

  perform public.cancel_order(v_order.id, v_reason);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_canceled',
    'order:' || v_order.id::text,
    jsonb_build_object(
      'reason', v_reason,
      'amount', v_order.total,
      'attemptState', v_attempt.state
    )
  );
end;
$function$;

-- admin_change_shipment_preorder_date(uuid,date,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_change_shipment_preorder_date(p_shipment_id uuid, p_expected_ship_date date, p_reason text, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; changed_at timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not coalesce(public.has_operator_capability('sales.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_expected_ship_date is null or p_expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>2000 or p_expected_updated_at is null then
    raise invalid_parameter_value using message='invalid_preorder_shipment_promise';
  end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  if shipment.status<>'ready' or purchase.status not in ('pending','paid','confirmed','shipping') then
    raise check_violation using message='preorder_shipment_already_dispatched';
  end if;
  if shipment.original_expected_ship_date is null then raise check_violation using message='shipment_not_preorder'; end if;
  if shipment.updated_at is distinct from p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_promise_changed'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  if shipment.expected_ship_date=p_expected_ship_date then return jsonb_build_object('changed',false,'updatedAt',shipment.updated_at); end if;
  insert into private.order_shipment_promise_changes(shipment_id,from_date,to_date,reason,actor_id,created_at)
    values(shipment.id,shipment.expected_ship_date,p_expected_ship_date,btrim(p_reason),actor,changed_at);
  update public.order_shipments set expected_ship_date=p_expected_ship_date,updated_at=changed_at where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.preorder_promise_changed','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'originalDate',shipment.original_expected_ship_date,'fromDate',shipment.expected_ship_date,
      'toDate',p_expected_ship_date,'reason',btrim(p_reason)));
  return jsonb_build_object('changed',true,'updatedAt',changed_at,'orderId',purchase.id);
end $function$;

-- admin_claims_report(timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_claims_report(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_count bigint;
  v_result jsonb;
begin
  if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not public.has_operator_capability('stats.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  select count(*)
  into v_order_count
  from public.orders
  where orders.status = any (private.revenue_order_statuses())
    and orders.created_at >= p_from
    and orders.created_at < p_to;

  with scoped as (
    select
      request.id,
      request.claim_type,
      request.reason_type,
      request.stage,
      request.requested_at,
      request.completed_at
    from public.order_cancellation_requests as request
    where request.requested_at >= p_from
      and request.requested_at < p_to
  ),
  by_type as (
    select
      scoped.claim_type,
      count(*) as total,
      count(*) filter (where scoped.stage = 'completed') as completed,
      count(*) filter (where scoped.stage = 'rejected') as rejected,
      count(*) filter (where scoped.stage not in ('completed', 'rejected')) as open_count
    from scoped
    group by scoped.claim_type
  ),
  by_reason as (
    select
      scoped.claim_type,
      scoped.reason_type,
      count(*) as total
    from scoped
    group by scoped.claim_type, scoped.reason_type
  ),
  -- 환급 소요시간은 접수(requested_at)부터 환불 완료(completed_at)까지다.
  -- 배송·반품 정책이 약속한 "반환받은 날부터 3영업일"과 기산점이 다르므로
  -- 화면에서 SLA 준수율이라고 부르지 않고 접수→완료 소요로 적는다.
  refund_speed as (
    select
      count(*) as completed_count,
      avg(extract(epoch from (refund.completed_at - scoped.requested_at)) / 3600.0) as avg_hours,
      count(*) filter (
        where refund.completed_at - scoped.requested_at <= interval '72 hours'
      ) as within_72h
    from public.refunds as refund
    join scoped on scoped.id = refund.cancellation_request_id
    -- refunds.status는 'requested|done|failed'다. 'completed'는 클레임 stage의
    -- 값이라 여기서 쓰면 항상 0건이 된다.
    where refund.status = 'done'
      and refund.completed_at is not null
  )
  select jsonb_build_object(
    'orderCount', v_order_count,
    'claimCount', coalesce((select sum(by_type.total) from by_type), 0),
    'byType', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_type.claim_type,
          'total', by_type.total,
          'completed', by_type.completed,
          'rejected', by_type.rejected,
          'open', by_type.open_count,
          -- 분모가 0이면 비율이 아니라 null이다. 0%로 적으면 "클레임이 없다"로
          -- 읽히지만 실제로는 "판매가 없었다"이다.
          'ratePerMille', case
            when v_order_count = 0 then null
            else round((by_type.total::numeric / v_order_count) * 1000, 1)
          end
        )
        order by by_type.total desc, by_type.claim_type
      )
      from by_type
    ), '[]'::jsonb),
    'byReason', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_reason.claim_type,
          'reasonType', by_reason.reason_type,
          'total', by_reason.total
        )
        order by by_reason.claim_type, by_reason.total desc
      )
      from by_reason
    ), '[]'::jsonb),
    'refunds', (
      select jsonb_build_object(
        'completedCount', refund_speed.completed_count,
        'averageHours', case
          when refund_speed.avg_hours is null then null
          else round(refund_speed.avg_hours::numeric, 1)
        end,
        'within72h', refund_speed.within_72h
      )
      from refund_speed
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- admin_clone_good(uuid,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_clone_good(target_operation_id uuid, target_source_good_id text, target_new_id text DEFAULT NULL::text, target_new_code text DEFAULT NULL::text, target_new_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved jsonb; replay boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.goods.clone.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  saved:=private.admin_clone_good_before_custom_inputs(target_operation_id,target_source_good_id,target_new_id,target_new_code,target_new_name);
  if not replay then
    update public.goods copied set custom_inputs_enabled=source.custom_inputs_enabled,custom_input_fields=source.custom_input_fields
      from public.goods source where source.id=saved->>'sourceGoodId' and copied.id=saved->>'id';
  end if;
  return saved;
end $function$;

-- admin_close_inquiry(uuid)
CREATE OR REPLACE FUNCTION public.admin_close_inquiry(target_inquiry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_status text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  select thread.status
  into v_status
  from public.inquiries as thread
  where thread.id = target_inquiry_id
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  -- 이미 닫힌 문의를 다시 닫아도 실패로 만들지 않는다. 목록에서 두 번 눌린 종결이
  -- 오류 배너로 돌아오면 운영자가 "안 닫혔다"고 읽는다.
  if v_status = 'closed' then
    return;
  end if;

  update public.inquiries as thread
  set
    status = 'closed',
    closed_at = now(),
    handled_by = coalesce(thread.handled_by, v_actor)
  where thread.id = target_inquiry_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.inquiry.closed',
    'inquiries:' || target_inquiry_id::text,
    jsonb_build_object('previousStatus', v_status)
  );
end;
$function$;

-- admin_commit_goods_import_group(uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_commit_goods_import_group(target_batch uuid, target_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if exists(select 1 from public.admin_goods_imports where id=target_batch and actor_id=auth.uid() and requires_admin)
    and not private.can_manage_goods_purchase_costs() then
    raise insufficient_privilege using message='purchase_cost_admin_required';
  end if;
  return private.admin_commit_goods_import_group_before_purchase_cost(target_batch,target_index);
end $function$;

-- admin_complete_shipments(uuid[])
CREATE OR REPLACE FUNCTION public.admin_complete_shipments(target_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare shipment_key uuid;results jsonb:='[]'::jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if cardinality(target_ids) is null or cardinality(target_ids) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipment_selection';end if;
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s where s.order_id=o.id and s.id=any(target_ids)) order by o.id for update;
 for shipment_key in select distinct id from unnest(target_ids) id order by id loop
  begin
   perform public.admin_update_shipment_status(shipment_key,'delivered',null,null);
   results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',true));
  exception when others then results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',false,'error',sqlerrm));end;
 end loop;
 return results;
end $function$;

-- admin_confirm_bank_deposit(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.admin_confirm_bank_deposit(p_deposit_id uuid, p_order_id uuid, p_memo text)
 RETURNS payment_attempt_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_deposit public.bank_deposits%rowtype;
  v_outcome public.payment_attempt_state;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- 잠금 순서: orders → bank_deposits → payment_attempts → payments.
  -- 주문을 먼저 잡아 #256의 확정·연장·취소와 같은 순서를 유지한다. 입금 행을
  -- 먼저 잡으면 같은 주문을 두 운영자가 서로 다른 순서로 잠가 교착이 난다.
  perform 1
  from public.orders
  where orders.id = p_order_id
  for update;

  select deposit.* into v_deposit
  from public.bank_deposits as deposit
  where deposit.id = p_deposit_id
  for update;

  if not found then
    raise no_data_found using message = 'deposit_not_found';
  end if;

  if v_deposit.status <> 'unmatched' then
    raise object_not_in_prerequisite_state using message = 'deposit_already_decided';
  end if;

  v_outcome := public.admin_confirm_bank_transfer_deposit(p_order_id, p_memo);

  -- finalizer가 approved가 아닌 값(needs_review 등)을 돌려주면 주문은 결제완료가
  -- 아니다. 그때 입금을 matched로 닫으면 "돈은 들어왔고 주문은 안 된" 건이
  -- 큐에서 사라진다 — 정합화가 끝날 때까지 큐에 남겨 둔다. attempt는 이미
  -- 종결 상태라 재확정은 막히고, 사람이 원장을 보고 처리해야 한다.
  if v_outcome = 'approved' then
    update public.bank_deposits
    set
      status = 'matched',
      matched_order_id = p_order_id,
      matched_at = now(),
      decided_by = v_actor,
      decision_note = btrim(coalesce(p_memo, ''))
    where id = v_deposit.id;
  else
    update public.bank_deposits
    set
      decided_by = v_actor,
      decision_note = btrim(coalesce(p_memo, ''))
        || ' / 확정 실패: ' || v_outcome::text
    where id = v_deposit.id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    case when v_outcome = 'approved'
      then 'admin.bank_deposit.matched'
      else 'admin.bank_deposit.match_failed'
    end,
    'order:' || p_order_id::text,
    jsonb_build_object(
      'depositId', v_deposit.id,
      'source', v_deposit.source,
      'externalId', v_deposit.external_id,
      'amount', v_deposit.amount,
      'depositorName', v_deposit.depositor_name,
      'outcome', v_outcome
    )
  );

  return v_outcome;
end;
$function$;

-- admin_confirm_bank_transfer_deposit(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_confirm_bank_transfer_deposit(p_order_id uuid, p_memo text)
 RETURNS payment_attempt_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_memo text := btrim(coalesce(p_memo, ''));
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_claim_token uuid := extensions.gen_random_uuid();
  v_outcome public.payment_attempt_state;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_memo) not between 5 and 200 then
    raise check_violation using message = 'invalid deposit memo';
  end if;

  -- 전역 잠금 순서: orders → payment_attempts → payments.
  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider = 'bank_transfer'
  for update;

  if not found then
    raise no_data_found using message = 'bank_transfer_attempt_not_found';
  end if;

  -- 만료 스윕이 이미 attempt를 닫았으면 여기서 멈춘다. finalizer는 종결 상태를
  -- 그대로 되돌려 주므로 그냥 부르면 "확인했는데 아무 일도 없다"가 된다.
  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using message = 'bank_transfer_attempt_not_confirmable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = v_claim_token,
    claim_expires_at = now() + interval '5 minutes'
  where id = v_attempt.id;

  insert into public.bank_transfer_confirmations (order_id, attempt_id, confirmed_by, memo)
  values (v_order.id, v_attempt.id, v_actor, v_memo);

  v_outcome := public.finalize_goods_payment_attempt(
    v_attempt.id,
    v_claim_token,
    'approved',
    'bank_transfer:' || v_attempt.id::text,
    null,
    null,
    null,
    'bank_transfer',
    null,
    now()
  );

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_confirmed',
    'order:' || v_order.id::text,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'amount', v_order.total,
      'depositCode', private.bank_transfer_deposit_code(v_order.id),
      'memo', v_memo,
      'outcome', v_outcome
    )
  );

  return v_outcome;
end;
$function$;

-- admin_coupon_target_goods(coupons)
CREATE OR REPLACE FUNCTION public.admin_coupon_target_goods(target_coupon coupons)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'code',g.code,'name',g.name,'archivedAt',g.archived_at) order by g.code,g.id)
   from public.goods g where g.id in(select unnest(c.target_good_ids) from public.coupons c where c.code=target_coupon.code)),'[]');
end $function$;

-- admin_create_settled_export(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.admin_create_settled_export(p_request_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=(select auth.uid()); start_date date; end_date date; query_text text; date_basis text; normalized jsonb;
 receipt private.settled_export_receipts; captured jsonb; order_count integer; item_count integer;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_request_id is null or p_filters is null or jsonb_typeof(p_filters)<>'object'
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','query','dateField')) then
  raise check_violation using message='settled_export_invalid_filters'; end if;
 if exists(select 1 from jsonb_each(p_filters) e where jsonb_typeof(e.value) not in('string','null')) then
  raise check_violation using message='settled_export_invalid_filters'; end if;
 begin
  if nullif(p_filters->>'from','') is not null then
   if (p_filters->>'from') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format; end if;
   start_date:=(p_filters->>'from')::date;
  end if;
  if nullif(p_filters->>'to','') is not null then
   if (p_filters->>'to') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format; end if;
   end_date:=(p_filters->>'to')::date;
  end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise check_violation using message='settled_export_invalid_filters';
 end;
 date_basis:=coalesce(nullif(p_filters->>'dateField',''),'ordered');
 if date_basis not in ('ordered','paid','confirmed','shipped','delivered','settled') then raise check_violation using message='settled_export_invalid_filters';end if;
 query_text:=nullif(btrim(p_filters->>'query'),'');
 if start_date>end_date or char_length(query_text)>100 then raise check_violation using message='settled_export_invalid_filters'; end if;
 normalized:=jsonb_build_object('from',start_date,'to',end_date,'query',coalesce(query_text,''));
 if date_basis<>'ordered' then normalized:=normalized||jsonb_build_object('dateField',date_basis);end if;
 perform pg_advisory_xact_lock(hashtextextended('settled-export:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.settled_export_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.filters<>normalized then raise check_violation using message='settled_export_request_conflict'; end if;
  return jsonb_build_object('id',receipt.id,'capturedAt',receipt.payload->>'capturedAt','orderCount',jsonb_array_length(receipt.payload->'orders'));
 end if;
 -- This STABLE SQL function uses one statement snapshot for every source table.
 captured:=private.collect_settled_export_for_date(start_date,end_date,query_text,date_basis);
 order_count:=jsonb_array_length(captured->'orders');
 select coalesce(sum(jsonb_array_length(value->'items')),0) into item_count from jsonb_array_elements(captured->'orders');
 if order_count=0 then raise check_violation using message='settled_export_empty'; end if;
 if order_count>1000 or item_count>10000 then raise check_violation using message='settled_export_limit'; end if;
 insert into private.settled_export_receipts(actor_id,request_id,filters,payload)
 values(actor,p_request_id,normalized,captured||jsonb_build_object('filters',normalized)) returning * into receipt;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.settled_export.created','settled_export:'||receipt.id,
  jsonb_build_object('filters',normalized,'orderCount',order_count,'itemCount',item_count,'capturedAt',captured->>'capturedAt'));
 return jsonb_build_object('id',receipt.id,'capturedAt',captured->>'capturedAt','orderCount',order_count);
end $function$;

-- admin_customer_detail(uuid,text,integer)
CREATE OR REPLACE FUNCTION public.admin_customer_detail(target_user_id uuid, target_tab text DEFAULT 'overview'::text, target_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare customer jsonb; counts jsonb; rows jsonb := '[]'::jsonb; total bigint:=0; page integer; page_size constant integer:=20;
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('platform.manage',false) then
  raise insufficient_privilege using message='staff_required';
 end if;
 if target_tab is null or target_tab not in ('overview','orders','inquiries','claims','coupons','notes') then
  raise invalid_parameter_value using message='customer_tab_invalid';
 end if;
 if not exists(select 1 from public.profiles where id=target_user_id) then return null; end if;
 select jsonb_build_object('id',m.profile_id,'nickname',m.nickname,'email',m.email,'role',m.role,
   'createdAt',m.created_at,'consents',jsonb_build_object('terms',coalesce(m.consents->'terms'='true'::jsonb,false),
     'privacy',coalesce(m.consents->'privacy'='true'::jsonb,false),'marketing',coalesce(m.consents->'marketing'='true'::jsonb,false)),
   'suspendedAt',m.suspended_at,'suspensionReason',m.suspension_reason,'loyaltyGrade',p.loyalty_grade,
   'goodsOrderCount',m.goods_order_count,'ticketOrderCount',m.ticket_order_count,
   'submittedReportCount',m.submitted_report_count,'receivedReportCount',m.received_report_count)
 into customer from public.admin_get_member_detail(target_user_id) m join public.profiles p on p.id=m.profile_id;
 select jsonb_build_object('orders',(select count(*) from public.orders where user_id=target_user_id),
  'inquiries',(select count(*) from public.inquiries where user_id=target_user_id),
  'claims',(select count(*) from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id),
  'coupons',(select count(*) from public.user_coupons where user_id=target_user_id),'notes',(select count(*) from public.customer_notes where customer_id=target_user_id)) into counts;
 total:=coalesce((counts->>target_tab)::bigint,0);
 page:=least(greatest(coalesce(target_page,1),1),greatest(1,(total+page_size-1)/page_size)::integer);
 if target_tab='orders' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'amount',r.total,
   'createdAt',r.created_at,'title',coalesce((select i.good_name_snapshot from public.order_items i where i.order_id=r.id order by i.id limit 1),'주문 상품'),
   'itemCount',(select count(*) from public.order_items i where i.order_id=r.id)) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select o.id,o.status,o.total,o.created_at from public.orders o where o.user_id=target_user_id
   order by o.created_at desc,o.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='inquiries' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'status',r.status,
   'createdAt',r.created_at,'orderId',r.order_id) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select i.id,i.title,i.status,i.created_at,i.order_id from public.inquiries i where i.user_id=target_user_id
   order by i.created_at desc,i.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='claims' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'orderId',r.order_id,'claimType',r.claim_type,
   'status',r.stage,'createdAt',r.requested_at,'title',r.reason) order by r.requested_at desc,r.id desc),'[]'::jsonb)
  into rows from (select c.id,c.order_id,c.claim_type,c.stage,c.requested_at,c.reason
   from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id
   order by c.requested_at desc,c.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='coupons' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.name,'code',r.coupon_code,
   'status',case when r.status='used' then 'used' when r.expires_at<=now() then 'expired' else 'active' end,
   'createdAt',r.issued_at,'expiresAt',r.expires_at,'orderId',r.used_order_id)
   order by r.issued_at desc,r.id desc),'[]'::jsonb)
  into rows from (select h.id,h.coupon_code,c.name,h.status,h.issued_at,least(h.expires_at,c.ends_at) as expires_at,h.used_order_id
   from public.user_coupons h join public.coupons c on c.code=h.coupon_code where h.user_id=target_user_id
   order by h.issued_at desc,h.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='notes' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'body',r.body,'createdAt',r.created_at,
   'authorName',coalesce(p.nickname,'탈퇴한 운영자')) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select n.id,n.body,n.author_id,n.created_at from public.customer_notes n where n.customer_id=target_user_id
   order by n.created_at desc,n.id desc limit page_size offset (page-1)*page_size) r
   left join public.profiles p on p.id=r.author_id;
 end if;
 return jsonb_build_object('customer',customer,'counts',counts,'tab',target_tab,'page',page,'pageSize',page_size,'total',total,'items',rows);
end;
$function$;

-- admin_customer_report(timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_customer_report(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not public.has_operator_capability('stats.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  with signups as (
    select
      (profile.created_at at time zone 'Asia/Seoul')::date as kst_date,
      count(*) as total
    from public.profiles as profile
    where profile.created_at >= p_from
      and profile.created_at < p_to
    group by 1
  ),
  buyers as (
    select
      orders.user_id,
      count(*) as order_count
    from public.orders
    where orders.status = any (private.revenue_order_statuses())
      and orders.created_at >= p_from
      and orders.created_at < p_to
    group by orders.user_id
  ),
  inquiries as (
    select
      count(*) as total,
      count(*) filter (where inquiry.answered_at is null and inquiry.closed_at is null)
        as unanswered,
      avg(
        extract(epoch from (inquiry.answered_at - inquiry.created_at)) / 3600.0
      ) filter (where inquiry.answered_at is not null) as avg_first_response_hours
    from public.inquiries as inquiry
    where inquiry.created_at >= p_from
      and inquiry.created_at < p_to
  ),
  -- 블라인드된 리뷰는 평점 분포에서 뺀다. 공개 표면의 평균(good_review_stats)이
  -- 그렇게 계산되므로, 여기만 포함하면 운영자가 보는 평점과 구매자가 보는
  -- 평점이 갈린다(#254).
  reviews as (
    select
      count(*) as total,
      avg(review.rating) as average_rating,
      count(*) filter (where review.admin_reply is null) as unanswered,
      count(*) filter (where review.rating = 1) as rating_1,
      count(*) filter (where review.rating = 2) as rating_2,
      count(*) filter (where review.rating = 3) as rating_3,
      count(*) filter (where review.rating = 4) as rating_4,
      count(*) filter (where review.rating = 5) as rating_5
    from public.reviews as review
    where review.status = 'visible'
      and review.created_at >= p_from
      and review.created_at < p_to
  )
  select jsonb_build_object(
    'signups', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', to_char(signups.kst_date, 'YYYY-MM-DD'), 'total', signups.total)
        order by signups.kst_date
      )
      from signups
    ), '[]'::jsonb),
    'signupTotal', coalesce((select sum(signups.total) from signups), 0),
    'buyerCount', coalesce((select count(*) from buyers), 0),
    -- 재구매자는 기간 안에서 두 번 이상 산 사람이다. 기간을 넘는 재구매는 이
    -- 정의로 잡히지 않으며, 그래서 "기간 내 재구매율"이라고 적는다.
    'repeatBuyerCount', coalesce((select count(*) from buyers where buyers.order_count > 1), 0),
    'inquiries', (
      select jsonb_build_object(
        'total', inquiries.total,
        'unanswered', inquiries.unanswered,
        'averageFirstResponseHours', case
          when inquiries.avg_first_response_hours is null then null
          else round(inquiries.avg_first_response_hours::numeric, 1)
        end
      )
      from inquiries
    ),
    'reviews', (
      select jsonb_build_object(
        'total', reviews.total,
        'unanswered', reviews.unanswered,
        -- 리뷰가 없으면 평균은 0이 아니라 값 없음이다. 0점은 존재할 수 없는
        -- 평점이라 화면에 찍히는 순간 거짓말이 된다.
        'averageRating', case
          when reviews.average_rating is null then null
          else round(reviews.average_rating::numeric, 2)
        end,
        'distribution', jsonb_build_array(
          reviews.rating_1,
          reviews.rating_2,
          reviews.rating_3,
          reviews.rating_4,
          reviews.rating_5
        )
      )
      from reviews
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- admin_decide_order_cancellation(uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_decide_order_cancellation(p_request_id uuid, p_decision text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_request record;
  v_payment_count integer;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise check_violation using message = 'invalid cancellation decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request.status <> 'requested' then
    raise exception using message = 'cancellation_request_not_decidable';
  end if;

  -- status만으로는 부족하다. 새 stage는 전부 'requested'로 투영된다.
  if v_request.claim_type <> 'cancel' or v_request.stage <> 'requested' then
    raise exception using message = 'claim_requires_claim_console';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    update public.order_cancellation_requests
    set
      status = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.cancellation_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'from', 'requested',
        'to', 'rejected',
        'reason', p_note
      )
    );
    return;
  end if;

  if not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_request.reason_type,
    v_request.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  insert into public.order_cancellation_claims (
    order_id,
    requested_by,
    previous_status
  )
  values (
    v_order_id,
    v_request.requested_by,
    v_order_status
  )
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
    v_request.reason,
    case when refund.status = 'done' then 'done' else 'requested' end,
    p_request_id
  from public.payments as payment
  left join public.refunds as refund on refund.payment_id = payment.id
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
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
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded');

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = now(),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'requested',
      'to', 'processing',
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_request.reason_type,
      'paymentCount', v_payment_count
    )
  );
end;
$function$;

-- admin_decide_order_claim(uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_decide_order_claim(p_claim_id uuid, p_decision text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_claim record;
  v_next_stage text;
  v_payment_count integer;
  /*
   * 보류를 벗긴 실질 단계.
   *
   * on_hold는 절차의 단계가 아니라 그 위에 덮인 표시다. 보류 중인 클레임을
   * 판정할 때 stage만 보면 processing에서 건 보류가 "아직 착수 전"으로 보인다.
   * lib/orders/claims.ts의 orderClaimEffectiveStage와 같은 정의다.
   */
  v_effective_stage text;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('review', 'approve', 'reject', 'hold', 'resume') then
    raise check_violation using message = 'invalid claim decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if v_order_id is null then
    raise no_data_found using message = 'claim_not_found';
  end if;

  -- 잠금 순서: 주문 → 클레임. admin_decide_order_cancellation과 같다.
  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if v_claim.stage in ('completed', 'rejected') then
    raise exception using message = 'claim_not_decidable';
  end if;

  v_effective_stage := case
    when v_claim.stage = 'on_hold' then coalesce(v_claim.held_from, 'requested')
    else v_claim.stage
  end;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    /*
     * 거절은 처리에 착수하기 전에만 가능하다.
     *
     * processing·needs_review는 이미 durable claim과 refunds(status='requested')를
     * 열어 둔 상태다. 그 상태에서 요청만 rejected로 닫으면 주문은 "취소 진행 중"인
     * 채로 남고 complete_order_cancellation_request가 cancellation_request_not_processing
     * 으로 막아 돈이 갇힌다. needs_review는 Korpay 수동 복구 seam까지 함께 닫혀
     * 복구 경로가 하나도 남지 않는다. 그 단계에서 되돌릴 일이 있으면 거절이 아니라
     * 보류·정합화로 처리한다.
     */
    if v_effective_stage not in ('requested', 'in_review', 'collecting', 'collected') then
      raise exception using message = 'claim_not_rejectable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'rejected',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'rejected',
      '클레임 요청이 거절됐어요',
      '요청이 거절됐습니다. 사유: ' || p_note
    );
    return 'rejected';
  end if;

  if p_decision = 'hold' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid hold reason';
    end if;
    if v_claim.stage = 'on_hold' then
      return 'on_hold';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'on_hold',
      held_from = v_claim.stage,
      hold_reason = p_note,
      held_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_held',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'on_hold',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'held',
      '클레임 처리가 보류됐어요',
      '처리가 보류됐습니다. 사유: ' || p_note
    );
    return 'on_hold';
  end if;

  if p_decision = 'resume' then
    if v_claim.stage <> 'on_hold' then
      raise exception using message = 'claim_not_held';
    end if;

    v_next_stage := coalesce(v_claim.held_from, 'requested');

    -- status를 여기서 계산하지 않는다. held_from이 needs_review면 이 자리에서
    -- 'requested'를 적어 투영 CHECK에 막혔고, 보류가 영원히 풀리지 않았다(F3).
    update public.order_cancellation_requests
    set
      stage = v_next_stage,
      held_from = null,
      hold_reason = null,
      held_at = null,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_resumed',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'on_hold',
        'to', v_next_stage
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'resumed',
      '클레임 처리가 재개됐어요',
      '보류가 해제되어 처리가 다시 시작됐습니다.'
    );
    return v_next_stage;
  end if;

  if p_decision = 'review' then
    if v_claim.stage <> 'requested' then
      raise exception using message = 'claim_not_decidable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'in_review',
      decided_by = v_actor,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_in_review',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'requested',
        'to', 'in_review'
      )
    );
    return 'in_review';
  end if;

  -- 승인.
  if v_claim.stage not in ('requested', 'in_review') then
    raise exception using message = 'claim_not_decidable';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if v_claim.claim_type='cancel' and not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;
  if v_claim.claim_type in ('return','exchange') and not private.order_all_items_delivered(v_order_id) then raise exception using message='order_not_claimable'; end if;
  perform private.prepare_claim_collections(p_claim_id);

  -- Money/deadline approval continues to use the original request time.
  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_claim.reason_type,
    v_claim.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  -- 취소는 회수할 물건이 없으므로 곧장 환불 처리로 간다. 반품·교환은 수거부터다.
  if v_claim.claim_type = 'cancel' then
    v_next_stage := 'processing';
  else
    v_next_stage := 'collecting';
  end if;

  if v_next_stage = 'processing' then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (v_order_id, v_claim.requested_by, v_order_status)
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
      v_claim.reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      p_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
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
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');
  end if;

  update public.order_cancellation_requests
  set
    stage = v_next_stage,
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = case when v_next_stage = 'processing' then now() else provider_started_at end,
    collecting_at = case when v_next_stage = 'collecting' then now() else collecting_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', v_next_stage,
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_claim.reason_type,
      'paymentCount', coalesce(v_payment_count, 0)
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'approved',
    '클레임 요청이 승인됐어요',
    case
      when v_next_stage = 'collecting'
        then '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.'
      else '요청이 승인됐습니다. 결제 취소 처리를 시작합니다.'
    end
  );

  return v_next_stage;
end;
$function$;

-- admin_delete_erp_items(text[])
CREATE OR REPLACE FUNCTION public.admin_delete_erp_items(p_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_requested integer;
  v_deleted integer;
  v_items jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if v_actor is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_codes is null
     or pg_catalog.cardinality(p_codes) not between 1 and 500
     or exists (select 1 from pg_catalog.unnest(p_codes) as requested(code) where requested.code is null) then
    raise invalid_parameter_value using message = 'invalid_erp_item_codes';
  end if;
  select pg_catalog.count(distinct requested.code)::integer into v_requested
  from pg_catalog.unnest(p_codes) as requested(code);

  -- 반입과 같은 잠금으로 직렬화해 지우는 중인 코드가 동시에 다시 반입되며 섞이지 않게 한다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.erp_items.import', 0));

  with deleted as (
    delete from public.erp_items as item
    where item.code = any(p_codes)
    returning item.code, item.name, item.category, item.sale_price, item.barcode, item.imported_at, item.imported_by
  )
  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code', deleted.code,
      'name', deleted.name,
      'category', deleted.category,
      'sale_price', deleted.sale_price,
      'barcode', deleted.barcode,
      'imported_at', deleted.imported_at,
      'imported_by', deleted.imported_by
    ) order by deleted.code), '[]'::jsonb)
  into v_deleted, v_items
  from deleted;

  if v_deleted > 0 then
    insert into public.audit_log (actor_id, action, target, diff)
    values (v_actor, 'admin.erp_items.deleted', 'erp_items', pg_catalog.jsonb_build_object(
      'requested', v_requested,
      'deleted', v_deleted,
      'items', v_items));
  end if;

  return pg_catalog.jsonb_build_object(
    'requested', v_requested,
    'deleted', v_deleted,
    'missing', v_requested - v_deleted);
end;
$function$;

-- admin_delete_faq_entry(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_delete_faq_entry(target_id uuid, expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := (select auth.uid()); previous public.faq_entries;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message = 'staff_required'; end if;
  select * into previous from public.faq_entries where id = target_id for update;
  if not found then raise no_data_found using message = 'faq_not_found'; end if;
  if expected_updated_at is distinct from previous.updated_at then
    raise sqlstate 'PT409' using message = 'faq_conflict';
  end if;
  delete from public.faq_entries where id = target_id;
  insert into public.audit_log(actor_id,action,target,diff)
  values(actor,'faq.delete','faq:' || target_id::text,jsonb_build_object('before',to_jsonb(previous),'after',null));
end;
$function$;

-- admin_delete_goods_notice_preset(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_delete_goods_notice_preset(target_id uuid, expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := (select auth.uid()); previous public.goods_notice_presets;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.goods_notice_presets where id = target_id for update;
  if not found then raise no_data_found using message = 'goods_notice_preset_not_found'; end if;
  if expected_updated_at is distinct from previous.updated_at then
    raise sqlstate 'PT409' using message = 'goods_notice_preset_conflict';
  end if;
  delete from public.goods_notice_presets where id = target_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'catalog.goods_notice_preset.deleted','goods_notice_presets:' || target_id::text,
      jsonb_build_object('before',to_jsonb(previous),'after',null));
end;
$function$;

-- admin_enqueue_shipment_emails(jsonb)
CREATE OR REPLACE FUNCTION public.admin_enqueue_shipment_emails(target_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_rows)='array' and exists(select 1 from jsonb_array_elements(target_rows) row
    join public.order_shipments shipment on shipment.id::text=row->>'shipmentId' where shipment.delivery_method<>'parcel') then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  return private.admin_enqueue_shipment_emails_before_delivery_methods(target_rows);
end $function$;

-- admin_estimate_notification_recipients(text,text)
CREATE OR REPLACE FUNCTION public.admin_estimate_notification_recipients(target_scope text, target_ip_id text DEFAULT NULL::text)
 RETURNS TABLE(scope text, ip_id text, ip_title text, recipient_count bigint, can_send boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_scope text := pg_catalog.btrim(target_scope, E' \t\n\r\f\v');
  normalized_ip_id text := nullif(
    pg_catalog.btrim(target_ip_id, E' \t\n\r\f\v'),
    ''
  );
  selected_ip_title text;
  estimated_recipient_count bigint;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_scope is null
    or normalized_scope not in ('all', 'ip_followers')
  then
    raise exception 'invalid_notification_scope' using errcode = '22023';
  end if;

  if normalized_scope = 'all' then
    if normalized_ip_id is not null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;

    select pg_catalog.count(*)
      into estimated_recipient_count
    from public.profiles;
  else
    if normalized_ip_id is null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;

    select ip.title
      into selected_ip_title
    from public.ips as ip
    where ip.id = normalized_ip_id;

    if not found then
      raise exception 'ip_not_found' using errcode = 'P0002';
    end if;

    select pg_catalog.count(*)
      into estimated_recipient_count
    from public.ip_follows as follow
    where follow.ip_id = normalized_ip_id;
  end if;

  return query
    select
      normalized_scope,
      normalized_ip_id,
      selected_ip_title,
      estimated_recipient_count,
      estimated_recipient_count > 0;
end;
$function$;

-- admin_execute_purchase_restriction_batch(uuid,boolean)
CREATE OR REPLACE FUNCTION public.admin_execute_purchase_restriction_batch(p_batch_id uuid, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); batch private.purchase_restriction_batches; saved private.purchase_restriction_batches;
 row jsonb; rows jsonb:='[]'; target_user uuid; request_id uuid; registered integer:=0; skipped integer:=0; failed integer:=0; reply jsonb; active_id uuid;
begin
  perform private.require_operator_capability('sales.restrictions',false);

 if p_batch_id is null or p_confirmed is distinct from true then raise invalid_parameter_value using message='purchase_restriction_batch_confirmation_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into batch from private.purchase_restriction_batches where id=p_batch_id for update;
 if not found then raise no_data_found using message='purchase_restriction_batch_not_found'; end if;
 if batch.actor_id<>actor then raise insufficient_privilege using message='purchase_restriction_batch_actor_mismatch'; end if;
 if batch.result is not null then return private.purchase_restriction_batch_json(batch,actor); end if;
 if batch.created_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='PT409',message='purchase_restriction_batch_expired'; end if;
 if not exists(select 1 from jsonb_array_elements(batch.preview)x where x->>'status'='ready') then raise check_violation using message='purchase_restriction_batch_no_ready_targets'; end if;
 -- Global UUID order prevents two overlapping batches from deadlocking while
 -- retaining the same per-customer lock used by single registration and orders.
 for target_user in select (x->>'userId')::uuid from jsonb_array_elements(batch.preview)x where x->>'status'='ready' order by (x->>'userId')::uuid loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,0));
 end loop;
 if batch.created_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='PT409',message='purchase_restriction_batch_expired'; end if;
 for row in select x from jsonb_array_elements(batch.preview)x order by (x->>'rowNumber')::integer loop
  if row->>'status'<>'ready' then
   row:=row||jsonb_build_object('outcome','skipped','error',row->>'status');skipped:=skipped+1;
  else
   target_user:=(row->>'userId')::uuid;
   request_id:=(md5(p_batch_id::text||':purchase-restriction:'||target_user::text))::uuid;
   begin
    reply:=public.admin_register_purchase_restriction(request_id,target_user,batch.payload->>'reasonCode',batch.payload->>'reasonDetail',nullif(row->>'evidenceOrderId','')::uuid);
    if reply->>'releasedAt' is not null then
     row:=row||jsonb_build_object('outcome','failed','error','request_already_released','restrictionId',request_id);failed:=failed+1;
    else
     row:=row||jsonb_build_object('outcome','registered','error',null,'restrictionId',request_id);registered:=registered+1;
    end if;
   exception when check_violation or invalid_parameter_value then
    if sqlerrm='purchase_restriction_already_active' then
     select id into active_id from public.goods_purchase_restrictions where user_id=target_user and released_at is null;
     row:=row||jsonb_build_object('outcome','skipped','error','already_active','restrictionId',active_id);skipped:=skipped+1;
    elsif sqlerrm='purchase_restriction_customer_not_eligible' then
     row:=row||jsonb_build_object('outcome','failed','error','not_eligible');failed:=failed+1;
    elsif sqlerrm='purchase_restriction_evidence_owner_mismatch' then
     row:=row||jsonb_build_object('outcome','failed','error','evidence_owner_mismatch');failed:=failed+1;
    else raise; end if;
   end;
  end if;
  rows:=rows||jsonb_build_array(row);
 end loop;
 update private.purchase_restriction_batches set result=jsonb_build_object('rows',rows,'registeredCount',registered,'skippedCount',skipped,'failedCount',failed),
  completed_at=clock_timestamp() where id=p_batch_id returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.purchase_restriction.batch_completed','purchase_restriction_batch:'||p_batch_id,
  jsonb_build_object('mode',batch.payload->>'mode','registeredCount',registered,'skippedCount',skipped,'failedCount',failed));
 return private.purchase_restriction_batch_json(saved,actor);
end $function$;

-- admin_execute_store_credit_batch(uuid)
CREATE OR REPLACE FUNCTION public.admin_execute_store_credit_batch(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; batch private.store_credit_batches; policy private.store_credit_policy; recipient private.store_credit_batch_recipients;
 before_balance jsonb; v_result jsonb; failure text; after_balance jsonb; rows jsonb:='[]';
begin
  perform private.lock_operator_subjects(array[(select auth.uid())] || coalesce((select array_agg(user_id order by user_id) from private.store_credit_batch_recipients where batch_id=p_id),'{}'::uuid[]));
  perform private.require_operator_capability('marketing.manage',true);

 actor:=private.assert_store_credit_admin();
 perform pg_advisory_xact_lock(hashtextextended('store_credit_batch:'||p_id::text,0));
 select * into batch from private.store_credit_batches where id=p_id for update;
 if not found or batch.actor_id<>actor then raise insufficient_privilege using message='store_credit_batch_not_found'; end if;
 if batch.status<>'prepared' then return batch.result; end if;
 -- This subtransaction rolls every grant/expiry/audit back if any recipient fails.
 begin
  select * into policy from private.store_credit_policy where singleton for share;
  if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
  if policy.version<>batch.policy_version or batch.created_at<clock_timestamp()-interval '15 minutes' then raise exception using errcode='PT409',message='store_credit_preview_stale'; end if;
  if batch.expires_at<=clock_timestamp() then raise check_violation using message='store_credit_expiry_invalid'; end if;
  for recipient in select * from private.store_credit_batch_recipients where batch_id=p_id order by user_id loop
   perform private.lock_store_credit_account(recipient.user_id);
   perform private.assert_active_user(recipient.user_id);
   if private.is_account_write_fenced(recipient.user_id) then raise insufficient_privilege using message='customer_unavailable'; end if;
   perform private.expire_store_credit_lots(recipient.user_id,clock_timestamp());
   before_balance:=private.store_credit_balance(recipient.user_id);
   if before_balance is distinct from recipient.expected_balance then raise exception using errcode='PT409',message='store_credit_balance_conflict'; end if;
  end loop;
  for recipient in select * from private.store_credit_batch_recipients where batch_id=p_id order by user_id loop
   after_balance:=public.admin_adjust_store_credit(recipient.operation_id,recipient.user_id,batch.amount,batch.expires_at,batch.reason,(recipient.expected_balance->>'available')::bigint);
   rows:=rows||jsonb_build_array(jsonb_build_object('userId',recipient.user_id,'operationId',recipient.operation_id,'balance',after_balance));
  end loop;
  v_result:=batch.result||jsonb_build_object('status','completed','completedCount',(batch.result->>'count')::integer,'failedCount',0,'completedRows',rows,'finishedAt',clock_timestamp());
 exception when others then
  failure:=sqlerrm;
  -- Do not return arbitrary SQL internals to clients.
  if failure not in ('store_credit_disabled','store_credit_preview_stale','store_credit_expiry_invalid','store_credit_balance_conflict','store_credit_balance_limit','customer_unavailable','account_suspended','account_deletion_in_progress') then failure:='store_credit_batch_failed'; end if;
  v_result:=batch.result||jsonb_build_object('status','failed','completedCount',0,'failedCount',(batch.result->>'count')::integer,'error',failure,'finishedAt',clock_timestamp());
 end;
 update private.store_credit_batches set status=v_result->>'status',result=v_result,finished_at=clock_timestamp() where id=p_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.batch_'||(v_result->>'status'),'store_credit_batch:'||p_id::text,
  jsonb_build_object('count',v_result->'count','amount',batch.amount,'gross',v_result->'gross','offset',v_result->'offset','error',v_result->'error'));
 return v_result;
end $function$;

-- admin_export_store_credit_console(text,text,date,date,text)
CREATE OR REPLACE FUNCTION public.admin_export_store_credit_console(p_mode text, p_query text DEFAULT ''::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_kind text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; payload jsonb;
begin
  perform private.require_operator_capability('marketing.manage',true);

 actor:=private.assert_store_credit_admin();
 payload:=public.admin_search_store_credit_console(p_mode,p_query,p_from,p_to,p_kind,1,10000);
 if (payload->>'total')::bigint>10000 then raise check_violation using message='store_credit_export_limit'; end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.exported','store_credit_console',
  jsonb_build_object('mode',p_mode,'query',p_query,'from',p_from,'to',p_to,'kind',p_kind,'rows',payload->'total'));
 return payload||jsonb_build_object('capturedAt',clock_timestamp());
end $function$;

-- admin_extend_bank_transfer_deadline(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_extend_bank_transfer_deadline(p_order_id uuid, p_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_new_expiry timestamptz;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid extension reason';
  end if;

  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  if v_order.bank_transfer_extended_at is not null then
    raise object_not_in_prerequisite_state using message = 'bank_transfer_already_extended';
  end if;

  v_new_expiry := now() + interval '24 hours';

  update public.orders
  set expires_at = v_new_expiry,
      bank_transfer_extended_at = now()
  where id = v_order.id;

  -- attempt TTL이 곧 입금 기한이다. 주문만 늘리고 attempt를 두면 확인 시점에
  -- 만료된 attempt가 남는다.
  update public.payment_attempts
  set expires_at = v_new_expiry
  where purpose = 'order'
    and ref_id = v_order.id
    and provider = 'bank_transfer'
    and state = 'prepared';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_extended',
    'order:' || v_order.id::text,
    jsonb_build_object(
      'from', v_order.expires_at,
      'to', v_new_expiry,
      'reason', v_reason
    )
  );

  return v_new_expiry;
end;
$function$;

-- admin_find_goods_for_shipping_notice_template(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_find_goods_for_shipping_notice_template(target_template_id uuid, search_query text DEFAULT ''::text)
 RETURNS TABLE(id text, name text, template_id uuid, template_version integer, published_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
return query with params as (
    select btrim(coalesce(search_query,'')) needle,
      '%'||replace(replace(replace(btrim(coalesce(search_query,'')),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%' pattern
  )
  select good.id,good.name,good.shipping_notice_template_id,good.shipping_notice_template_version,good.published_at,good.updated_at
  from public.goods good cross join params
  where (select auth.uid()) is not null and public.has_operator_capability('catalog.read',false)
    and char_length(coalesce(search_query,''))<=100
    and good.archived_at is null
    and (target_template_id is null or good.shipping_notice_template_id=target_template_id)
    and (params.needle='' or good.id ilike params.pattern escape E'\\' or good.name ilike params.pattern escape E'\\')
  order by good.updated_at desc,good.id
  limit 100;
end;
$function$;

-- admin_find_purchase_restriction_customer(text)
CREATE OR REPLACE FUNCTION public.admin_find_purchase_restriction_customer(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;q text:=nullif(btrim(p_query),'');
begin
  if not public.has_operator_capability('sales.restrictions',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 perform (select auth.uid());
 if q is null or length(q)>254 then raise invalid_parameter_value using message='invalid_customer_lookup';end if;
 -- Exact identifiers only: an unrelated substring cannot enumerate customers.
 select jsonb_build_object('id',p.id,'nickname',p.nickname,'email',p.email,'eligible',p.role='user',
 'activeRestrictionId',(select r.id from public.goods_purchase_restrictions r where r.user_id=p.id and r.released_at is null))
 into result from public.profiles p where p.id::text=lower(q) or lower(p.email)=lower(q) limit 1;
 return result;
end $function$;

-- admin_find_store_credit_customers(text)
CREATE OR REPLACE FUNCTION public.admin_find_store_credit_customers(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

 perform private.assert_store_credit_admin();
 if length(btrim(coalesce(p_query,''))) not between 2 and 200 then raise invalid_parameter_value using message='store_credit_query_invalid'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,
  'maskedEmail',case when position('@' in email)>0 then left(email,1)||'***@'||split_part(email,'@',2) else '' end,
  'eligible',suspended_at is null and not exists(select 1 from private.account_action_fences fence where fence.subject_user_id=customers.id)) order by nickname,id),'[]')
  from (select id,nickname,email,suspended_at from public.profiles
   where id::text=btrim(p_query) or lower(email)=lower(btrim(p_query)) or nickname ilike '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%'
   order by nickname,id limit 50) customers);
end $function$;

-- admin_get_goods_announcement(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_goods_announcement(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.announcements',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.announcements',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  select jsonb_build_object('id',n.id,'reference',n.reference,'title',n.title,'body',n.body,'format',n.body_format,'category',n.category,
    'device',n.device,'enabled',n.enabled,'important',n.important,'allGoods',n.all_goods,'startsAt',n.starts_at,'endsAt',n.ends_at,
    'createdAt',n.created_at,'updatedAt',n.updated_at,'revision',n.revision,
    'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'archived',g.archived_at is not null)
      order by g.name,g.id) from public.goods_announcement_goods links join public.goods g on g.id=links.good_id where links.announcement_id=n.id),'[]'))
    into result from public.goods_announcements n where n.id=p_id;
  return result;
end $function$;

-- admin_get_goods_attributes(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_get_goods_attributes(p_category_id uuid, p_good_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare schema_data jsonb; document_data jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_category_id is not null then
    if not exists(select 1 from public.catalog_categories where id=p_category_id) then raise no_data_found using message='category_not_found'; end if;
    select jsonb_build_object('categoryId',p_category_id,'revision',revision,'fields',fields) into schema_data from public.catalog_category_attribute_schemas where category_id=p_category_id;
    schema_data:=coalesce(schema_data,jsonb_build_object('categoryId',p_category_id,'revision',0,'fields','[]'::jsonb));
  end if;
  if p_good_id is not null and not exists(select 1 from public.goods where id=p_good_id) then raise no_data_found using message='good_not_found'; end if;
  select jsonb_build_object('revision',revision,'entries',entries) into document_data from public.goods_attribute_values where good_id=p_good_id;
  return jsonb_build_object('schema',schema_data,'document',coalesce(document_data,'{"revision":0,"entries":[]}'::jsonb));
end $function$;

-- admin_get_goods_draft(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_goods_draft(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.admin_goods_drafts;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  select * into d from public.admin_goods_drafts where id=p_id and owner_id=auth.uid();
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  return private.goods_draft_summary(d)||jsonb_build_object('values',d.form_values);
end $function$;

-- admin_get_goods_relation(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_goods_relation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  return private.goods_relation_document(p_id);
end $function$;

-- admin_get_inquiry_reply_template_operation(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_inquiry_reply_template_operation(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); existing public.audit_log;
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if p_operation_id is null then raise invalid_parameter_value using message='invalid_inquiry_template_operation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_template_operation:'||p_operation_id,0));
  select * into existing from public.audit_log where id=p_operation_id;
  if not found then return null; end if;
  if existing.actor_id<>actor or existing.action<>'admin.inquiry_reply_template.managed' then
    raise insufficient_privilege using message='inquiry_template_operation_conflict';
  end if;
  return existing.diff->'receipt';
end $function$;

-- admin_get_loyalty_policy()
CREATE OR REPLACE FUNCTION public.admin_get_loyalty_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not exists(select 1 from public.profiles where id=auth.uid() and private.has_operator_capability(id,'marketing.manage',true) and suspended_at is null)
    then raise insufficient_privilege using message='admin_required'; end if;
  return jsonb_build_object('policy',(select jsonb_build_object('tiers',tiers,'revision',revision,'updatedAt',updated_at) from public.loyalty_settings where singleton),
    'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'grade',grade_benefit,'status',status) order by grade_benefit,code)
      from public.coupons where grade_benefit in ('silver','gold','platinum')),'[]'::jsonb));
end $function$;

-- admin_get_member_detail(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_member_detail(target_profile_id uuid)
 RETURNS TABLE(profile_id uuid, email text, nickname text, role user_role, created_at timestamp with time zone, consents jsonb, suspended_at timestamp with time zone, suspension_reason text, goods_order_count bigint, ticket_order_count bigint, submitted_report_count bigint, received_report_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.email, E' \t\n\r\f\v'), ''),
      '이메일 없음'
    ),
    coalesce(
      nullif(pg_catalog.btrim(profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || pg_catalog.left(profile.id::text, 6)
    ),
    profile.role,
    profile.created_at,
    profile.consents,
    profile.suspended_at,
    profile.suspension_reason,
    (
      select pg_catalog.count(*)
      from public.orders as goods_order
      where goods_order.user_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from public.ticket_orders as ticket_order
      where ticket_order.user_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from public.reports as submitted_report
      where submitted_report.reporter_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from private.report_subjects as received_report
      where received_report.target_user_id = profile.id
    )::bigint
  from public.profiles as profile
  where profile.id = target_profile_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$function$;

-- admin_get_order_delay_notice(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_order_delay_notice(target_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 select jsonb_build_object('id',n.id,'title',n.title,'customerBody',n.customer_body,'expectedShipDate',n.expected_ship_date,
  'createdAt',n.created_at,'expiresAt',n.expires_at,'requestedAt',n.requested_at,
  'emailEnabled',(select enabled from private.order_delay_notice_delivery_control where singleton),'targets',coalesce((
   select jsonb_agg(jsonb_build_object('id',t.id,'orderId',t.order_id,'buyerName',t.buyer_name,'recipientEmail',t.recipient_email,
    'shipmentIds',t.shipment_ids,'shipmentLabels',t.shipment_labels,'messageBody',t.message_body,'inAppStatus',t.in_app_status,
    'emailStatus',case when i.state in ('accepted','sent','delivered','delayed') then 'sent'
      when i.state in ('bounced','complained','failed') then 'failed' when i.state='suppressed' then 'suppressed' else t.email_status end,
    'emailProviderState',i.state,'errorCode',case when i.state in ('bounced','complained','failed') then 'provider_rejected'
      when i.state='suppressed' then 'provider_suppressed' else t.error_code end,
    'retryable',t.retryable and coalesce(i.accepted_at is null,true) and coalesce(i.state not in ('needs_review','failed','bounced','complained','suppressed'),true),
    'attempts',t.attempts) order by t.order_id)
   from private.order_delay_notice_targets t left join private.email_intents i on i.id=t.email_intent_id where t.notice_id=n.id),'[]'))
 into result from private.order_delay_notices n where n.id=target_notice;
 if result is null then raise no_data_found using message='delay_notice_not_found';end if;
 return result;
end $function$;

-- admin_get_purchase_restriction_batch(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_purchase_restriction_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); batch private.purchase_restriction_batches;
begin
  if not public.has_operator_capability('sales.restrictions',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 -- A readback waits for an in-flight execution of this exact request. It must
 -- not misreport an uncommitted execution as a safely retryable prepared batch.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into batch from private.purchase_restriction_batches where id=p_batch_id;
 if not found then return null; end if;
 return private.purchase_restriction_batch_json(batch,actor);
end $function$;

-- admin_get_seller_claim_intake(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_seller_claim_intake(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  perform (select auth.uid());
  if p_request_id is null then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  -- A readback must wait for an in-flight submission using the same request key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:' || p_request_id, 0));
  return private.seller_claim_intake_json(p_request_id);
end $function$;

-- admin_get_store_credit_batch(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_store_credit_batch(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

 actor:=private.assert_store_credit_admin();
 return (select result||jsonb_build_object('canExecute',actor_id=actor and status='prepared') from private.store_credit_batches where id=p_id);
end $function$;

-- admin_get_store_credit_history(uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_get_store_credit_history(p_user_id uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

  perform private.assert_store_credit_admin();
  if not exists(select 1 from public.profiles where id=p_user_id) then raise no_data_found using message='customer_not_found'; end if;
  return private.store_credit_history(p_user_id,p_page);
end $function$;

-- admin_get_store_credit_policy()
CREATE OR REPLACE FUNCTION public.admin_get_store_credit_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;
 perform private.assert_store_credit_admin(); return private.store_credit_policy_json(); end $function$;

-- admin_goods_active_stock_qty(goods)
CREATE OR REPLACE FUNCTION public.admin_goods_active_stock_qty(goods)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='admin_only'; end if;
 return (select coalesce(sum(stock_qty),0)::integer from public.goods_variants
   where good_id=($1).id and archived_at is null);
end;
$function$;

-- admin_goods_console_export_candidates(text,text,text,text,uuid,text,jsonb)
CREATE OR REPLACE FUNCTION public.admin_goods_console_export_candidates(p_query text DEFAULT ''::text, p_ip_id text DEFAULT ''::text, p_status text DEFAULT 'active'::text, p_stock text DEFAULT 'all'::text, p_category_id uuid DEFAULT NULL::uuid, p_readiness text DEFAULT 'all'::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(good_id text, option_rows integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return query select (matched.good).id, greatest(1,(select count(*)::integer from public.goods_variants variant
    where variant.good_id = (matched.good).id and (variant.archived_at is null or variant.is_default)))
    from private.admin_goods_console_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness,p_filters) matched
    order by (matched.good).id;
end $function$;

-- admin_goods_export_candidates(text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_goods_export_candidates(search_text text DEFAULT ''::text, ip_filter text DEFAULT ''::text, status_filter text DEFAULT 'active'::text, stock_filter text DEFAULT 'all'::text)
 RETURNS TABLE(good_id text, option_rows integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
 return query select good.id,greatest(1,(select count(*)::integer from public.goods_variants variant
   where variant.good_id=good.id and (variant.archived_at is null or variant.is_default)))
 from public.admin_search_goods(search_text) good where (ip_filter='' or good.ip_id=ip_filter)
 and case status_filter when 'all' then true when 'archived' then good.archived_at is not null
   when 'draft' then good.archived_at is null and good.published_at is null
   when 'published' then good.archived_at is null and good.published_at is not null else good.archived_at is null end
 and case stock_filter when 'soldout' then good.stock='soldout' or public.admin_goods_active_stock_qty(good)=0
   when 'ok' then good.stock='ok' and public.admin_goods_active_stock_qty(good)>0
   when 'low' then good.stock='low' and public.admin_goods_active_stock_qty(good)>0 else true end
 order by good.id;
end;
$function$;

-- admin_goods_import_records(text[],text[])
CREATE OR REPLACE FUNCTION public.admin_goods_import_records(target_codes text[] DEFAULT '{}'::text[], target_ids text[] DEFAULT '{}'::text[])
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return query select jsonb_set(entry.value,'{good,additional_category_ids}',to_jsonb(private.goods_additional_category_ids(entry.value#>>'{good,id}')))
    from private.admin_goods_import_records_before_additional_categories(target_codes,target_ids) entry(value);
end $function$;

-- admin_goods_low_stock_option_count(goods)
CREATE OR REPLACE FUNCTION public.admin_goods_low_stock_option_count(goods)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='admin_only'; end if;
 return (select count(*)::integer from public.goods_variants
   where good_id=($1).id and archived_at is null and low_stock_threshold is not null and stock_qty<=low_stock_threshold);
end;
$function$;

-- admin_goods_manual_recovery_attempts(uuid[])
CREATE OR REPLACE FUNCTION public.admin_goods_manual_recovery_attempts(p_order_ids uuid[])
 RETURNS TABLE(order_id uuid, request_id uuid, attempt_id uuid, provider_order_id text, state text, amount bigint, currency text, manual_recovery_available boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and private.has_operator_capability(profile.id,'sales.manage',true)
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  if p_order_ids is null or pg_catalog.cardinality(p_order_ids) = 0 then
    return;
  end if;

  if pg_catalog.cardinality(p_order_ids) > 100 then
    raise invalid_parameter_value using message = 'too many order ids';
  end if;

  return query
  select
    attempt.ref_id,
    request.id,
    attempt.id,
    attempt.provider_order_id,
    attempt.state::text,
    attempt.amount,
    attempt.currency,
    (
      (
        attempt.state in ('approved', 'unknown', 'needs_review')
        or (
          attempt.state = 'confirming'
          and (
            attempt.claim_expires_at is null
            or attempt.claim_expires_at <= pg_catalog.now()
          )
        )
      )
      and not exists (
        select 1
        from private.goods_payment_manual_recovery_claims as manual_claim
        where manual_claim.attempt_id = attempt.id
          and manual_claim.expires_at > pg_catalog.now()
      )
    ) as manual_recovery_available
  from public.payment_attempts as attempt
  join public.order_cancellation_requests as request
    on request.order_id = attempt.ref_id
   and request.status in ('processing', 'needs_review')
  join public.order_cancellation_claims as cancellation_claim
    on cancellation_claim.order_id = attempt.ref_id
   and cancellation_claim.requested_by = request.requested_by
  where attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = any(p_order_ids)
  order by attempt.ref_id;
end;
$function$;

-- admin_goods_workspace_export_candidates(text,text,text,text,uuid,text)
CREATE OR REPLACE FUNCTION public.admin_goods_workspace_export_candidates(p_query text DEFAULT ''::text, p_ip_id text DEFAULT ''::text, p_status text DEFAULT 'active'::text, p_stock text DEFAULT 'all'::text, p_category_id uuid DEFAULT NULL::uuid, p_readiness text DEFAULT 'all'::text)
 RETURNS TABLE(good_id text, option_rows integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  return query select (matched.good).id,greatest(1,(select count(*)::integer from public.goods_variants variant
    where variant.good_id=(matched.good).id and (variant.archived_at is null or variant.is_default)))
    from private.admin_goods_workspace_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness) matched order by (matched.good).id;
end $function$;

-- admin_grant_draw_tickets(uuid,uuid,uuid,integer,text)
CREATE OR REPLACE FUNCTION public.admin_grant_draw_tickets(target_operation_id uuid, target_profile_id uuid, target_pool_id uuid, target_quantity integer, target_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_profile_id]);
  perform private.require_operator_capability('platform.manage',false);

  perform private.require_card_rewards_enabled();
  return public.admin_grant_draw_tickets_unguarded(
    target_operation_id,
    target_profile_id,
    target_pool_id,
    target_quantity,
    target_reason
  );
end;
$function$;

-- admin_hide_community_comment(uuid,uuid)
CREATE OR REPLACE FUNCTION public.admin_hide_community_comment(target_comment_id uuid, target_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  previous_status public.post_status;
  target_ip_id text;
  target_post_id uuid;
  linked_report_target public.report_target;
  linked_report_target_id text;
  linked_report_status public.report_status;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select comments.post_id
    into target_post_id
    from public.comments
    where comments.id = target_comment_id;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  select posts.ip_id
    into target_ip_id
    from public.posts
    where posts.id = target_post_id
    for update;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  select comments.status
    into previous_status
    from public.comments
    where comments.id = target_comment_id
      and comments.post_id = target_post_id
    for update;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  if target_report_id is not null then
    select reports.target_type, reports.target_id, reports.status
      into linked_report_target, linked_report_target_id, linked_report_status
      from public.reports
      where reports.id = target_report_id
      for update;

    if not found then
      raise exception 'report_not_found' using errcode = '22023';
    end if;

    if linked_report_target <> 'comment'
      or linked_report_target_id <> target_comment_id::text then
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;
  end if;

  if previous_status = 'hidden' then
    if target_report_id is not null and linked_report_status <> 'resolved' then
      raise exception 'comment_already_hidden' using errcode = '22023';
    end if;

    return jsonb_build_object('ipId', target_ip_id);
  end if;

  update public.comments
  set status = 'hidden'
  where id = target_comment_id;

  if target_report_id is not null then
    update public.reports
    set status = 'resolved'
    where id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'community_comment_hide',
    'comment:' || target_comment_id::text,
    jsonb_build_object(
      'from', previous_status,
      'to', 'hidden',
      'reportId', target_report_id
    )
  );

  return jsonb_build_object('ipId', target_ip_id);
end;
$function$;

-- admin_hide_community_post(uuid,uuid)
CREATE OR REPLACE FUNCTION public.admin_hide_community_post(target_post_id uuid, target_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  previous_status post_status;
  target_ip_id text;
  linked_report_target report_target;
  linked_report_target_id text;
  linked_report_post_id uuid;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select posts.status, posts.ip_id
    into previous_status, target_ip_id
    from public.posts
    where posts.id = target_post_id
    for update;

  if not found then
    raise exception 'post_not_found' using errcode = '22023';
  end if;

  update public.posts
  set status = 'hidden'
  where posts.id = target_post_id;

  if target_report_id is not null then
    select reports.target_type, reports.target_id
      into linked_report_target, linked_report_target_id
      from public.reports
      where reports.id = target_report_id
      for update;

    if not found then
      raise exception 'report_not_found' using errcode = '22023';
    end if;

    if linked_report_target = 'post' then
      if linked_report_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;

      linked_report_post_id := linked_report_target_id::uuid;
    elsif linked_report_target = 'comment' then
      if linked_report_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;

      select comments.post_id
        into linked_report_post_id
        from public.comments
        where comments.id = linked_report_target_id::uuid;

      if not found then
        raise exception 'report_target_mismatch' using errcode = '22023';
      end if;
    else
      /* 'user'와 'review'가 여기로 온다. 둘 다 포스트 숨김으로는 해소되지 않는다. */
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;

    if linked_report_post_id <> target_post_id then
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;

    update public.reports
    set status = 'resolved'
    where reports.id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'community_post_hide',
    'post:' || target_post_id::text,
    jsonb_build_object('from', previous_status, 'to', 'hidden', 'reportId', target_report_id)
  );

  return jsonb_build_object('ipId', target_ip_id);
end;
$function$;

-- admin_ignore_bank_deposit(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_ignore_bank_deposit(p_deposit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid ignore reason';
  end if;

  update public.bank_deposits
  set
    status = 'ignored',
    decided_by = v_actor,
    decision_note = v_reason
  where id = p_deposit_id
    and status = 'unmatched';

  if not found then
    raise no_data_found using message = 'deposit_not_ignorable';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.bank_deposit.ignored',
    'bank_deposit:' || p_deposit_id::text,
    jsonb_build_object('reason', v_reason)
  );
end;
$function$;

-- admin_import_erp_items(jsonb)
CREATE OR REPLACE FUNCTION public.admin_import_erp_items(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_row record;
  v_existing public.erp_items;
  v_category text;
  v_sale_price integer;
  v_barcode text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_rejected jsonb[] := array[]::jsonb[];
  v_changed_codes text[] := array[]::text[];
  v_now timestamptz := pg_catalog.now();
begin
  perform private.require_operator_capability('platform.manage',false);

  if v_actor is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_rows is null
     or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) not between 1 and 5000 then
    raise invalid_parameter_value using message = 'invalid_erp_item_rows';
  end if;

  -- 같은 ERP 코드를 다른 순서로 잠그는 동시 반입끼리 교착하지 않도록 반입을 직렬화한다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.erp_items.import', 0));

  for v_row in
    with input as (
      select element.value as item, element.ordinality::integer as ord
      from pg_catalog.jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
    ), normalized as (
      select
        input.ord,
        case
          when pg_catalog.jsonb_typeof(input.item -> 'row') = 'number'
            and (input.item ->> 'row') ~ '^[0-9]{1,9}$'
          then (input.item ->> 'row')::integer
          else input.ord
        end as source_row,
        case
          when pg_catalog.jsonb_typeof(input.item -> 'code') = 'string'
          then pg_catalog.left(
            pg_catalog.regexp_replace(input.item ->> 'code', '[\u0001-\u001f\u007f-\u009f]', ' ', 'g'), 120)
        end as raw_code,
        normalized_row.*
      from input
      cross join lateral private.normalize_erp_item_row(input.item) as normalized_row
    )
    select
      normalized.*,
      coalesce(
        normalized.o_reason is null
          and normalized.ord < pg_catalog.max(normalized.ord)
            filter (where normalized.o_reason is null)
            over (partition by normalized.o_code),
        false
      ) as superseded
    from normalized
    order by normalized.ord
  loop
    if v_row.o_reason is not null or v_row.superseded then
      v_rejected := pg_catalog.array_append(v_rejected, pg_catalog.jsonb_build_object(
        'row', v_row.source_row,
        'code', coalesce(v_row.o_code, v_row.raw_code),
        'reason', coalesce(v_row.o_reason, 'duplicate_code')));
      continue;
    end if;

    select * into v_existing
    from public.erp_items as item
    where item.code = v_row.o_code
    for update;

    if not found then
      insert into public.erp_items (code, name, category, sale_price, barcode, imported_at, imported_by, updated_at)
      values (v_row.o_code, v_row.o_name, v_row.o_category, v_row.o_sale_price, v_row.o_barcode, v_now, v_actor, v_now);
      v_inserted := v_inserted + 1;
      if pg_catalog.cardinality(v_changed_codes) < 100 then
        v_changed_codes := pg_catalog.array_append(v_changed_codes, v_row.o_code);
      end if;
      continue;
    end if;

    v_category := case when v_row.o_has_category then v_row.o_category else v_existing.category end;
    v_sale_price := case when v_row.o_has_sale_price then v_row.o_sale_price else v_existing.sale_price end;
    v_barcode := case when v_row.o_has_barcode then v_row.o_barcode else v_existing.barcode end;

    if (v_existing.name, v_existing.category, v_existing.sale_price, v_existing.barcode)
       is not distinct from (v_row.o_name, v_category, v_sale_price, v_barcode) then
      v_unchanged := v_unchanged + 1;
    else
      update public.erp_items as item
      set name = v_row.o_name,
          category = v_category,
          sale_price = v_sale_price,
          barcode = v_barcode,
          imported_at = v_now,
          imported_by = v_actor,
          updated_at = v_now
      where item.code = v_row.o_code;
      v_updated := v_updated + 1;
      if pg_catalog.cardinality(v_changed_codes) < 100 then
        v_changed_codes := pg_catalog.array_append(v_changed_codes, v_row.o_code);
      end if;
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.erp_items.imported', 'erp_items', pg_catalog.jsonb_build_object(
    'rows', pg_catalog.jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'rejected', pg_catalog.cardinality(v_rejected),
    'changed_codes', pg_catalog.to_jsonb(v_changed_codes),
    'changed_codes_truncated', v_inserted + v_updated > pg_catalog.cardinality(v_changed_codes)));

  return pg_catalog.jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'rejected', pg_catalog.to_jsonb(v_rejected));
end;
$function$;

-- admin_import_shipment_tracking(text,text,text)
CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking(p_reference text, p_carrier text, p_tracking_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;changed boolean;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 perform o.id from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=shipment_key for update of o;
 select * into shipment from public.order_shipments where id=shipment_key for update;
 changed:=shipment.status='ready';
 if changed then perform public.admin_update_shipment_status(shipment.id,'shipping',p_carrier,p_tracking_number);
 else perform public.admin_update_shipment_tracking(shipment.id,p_carrier,p_tracking_number);end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',changed);
end $function$;

-- admin_import_shipment_tracking_batch(jsonb)
CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking_batch(target_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb;shipment_key uuid;completed jsonb;results jsonb:='[]'::jsonb;seen uuid[]:='{}'::uuid[];
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 -- Hold all existing target order locks in one stable order before per-row savepoints.
 -- Different files may list the same warehouses in opposite orders.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s
   where s.order_id=o.id and exists(select 1 from jsonb_array_elements(target_rows) row_value
     where lower(btrim(row_value->>'reference')) in (s.id::text,o.id::text,right(s.id::text,8),right(o.id::text,8)))) order by o.id for update;
 for input in select value from jsonb_array_elements(target_rows) loop
  begin
   if jsonb_typeof(input) is distinct from 'object' then raise invalid_parameter_value using message='invalid_tracking_row';end if;
   shipment_key:=private.resolve_shipment_reference(input->>'reference');
   if shipment_key=any(seen) then raise check_violation using message='duplicate_shipment_reference';end if;
   completed:=public.admin_import_shipment_tracking(shipment_key::text,input->>'carrier',input->>'trackingNumber');
   seen:=array_append(seen,shipment_key);
   results:=results||jsonb_build_array(completed||jsonb_build_object('line',input->'line','reference',input->>'reference','ok',true));
  exception when others then
   results:=results||jsonb_build_array(jsonb_build_object('line',input->'line','reference',input->>'reference','ok',false,'error',sqlerrm));
  end;
 end loop;
 return results;
end $function$;

-- admin_import_warehouse_tracking_batch(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.admin_import_warehouse_tracking_batch(target_origin_id uuid, target_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  input jsonb;
  normalized jsonb := '[]';
  outcomes jsonb := '{}';
  results jsonb := '[]';
  reference_value text;
  order_key uuid;
  shipment_key uuid;
  tracking_value text;
  row_error text;
  group_error text;
  group_row record;
  matches integer;
  origin public.fulfillment_origins;
  completed jsonb;
  outcome jsonb;
  seen uuid[] := '{}';
begin
  perform private.require_operator_capability('sales.manage',false);

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message='staff required';
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if jsonb_array_length(target_rows) not between 1 and 1000 then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if target_origin_id is null then
    raise invalid_parameter_value using message='warehouse_origin_required';
  end if;

  for input in select value from jsonb_array_elements(target_rows) loop
    reference_value := null;
    order_key := null;
    tracking_value := null;
    row_error := null;
    begin
      if jsonb_typeof(input) is distinct from 'object' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      reference_value := btrim(input->>'reference');
      if jsonb_typeof(input->'reference') is distinct from 'string'
        or reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise invalid_parameter_value using message='invalid_warehouse_order_reference';
      end if;
      order_key := reference_value::uuid;
      -- Keep the parsed order on row errors so an invalid sibling cannot let the
      -- first valid row write half of the same shipment group.
      if exists(select 1 from jsonb_object_keys(input) key where key not in ('line','reference','trackingNumber'))
        or jsonb_typeof(input->'line') is distinct from 'number'
        or (input->>'line') !~ '^[0-9]+$'
        or (input->>'line')::numeric not between 1 and 2147483647
        or jsonb_typeof(input->'trackingNumber') is distinct from 'string' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      tracking_value := upper(regexp_replace(btrim(input->>'trackingNumber'),'[[:space:]-]','','g'));
      if tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';
      end if;
    exception when others then row_error := sqlerrm;
    end;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'line',input->'line','reference',reference_value,'orderId',order_key,
      'trackingNumber',tracking_value,'error',row_error));
  end loop;

  -- Same global order->origin->shipment lock ordering as order/dispatch writers.
  -- Lock every existing order before per-shipment savepoints, including groups
  -- with invalid tracking data. Opposite file row orders cannot deadlock.
  perform o.id from public.orders o where exists(
    select 1 from jsonb_array_elements(normalized) row_value
    where row_value->>'orderId'=o.id::text
  ) order by o.id for update;
  select * into origin from public.fulfillment_origins where id=target_origin_id for share;
  if not found then raise no_data_found using message='warehouse_origin_not_found'; end if;
  if not origin.is_active then raise check_violation using message='warehouse_origin_inactive'; end if;
  if origin.export_template<>'wms_csv' then raise check_violation using message='warehouse_template_required'; end if;
  if origin.default_carrier is null then raise check_violation using message='warehouse_carrier_required'; end if;
  perform code from public.shipping_carriers where code=origin.default_carrier and is_active for share;
  if not found then raise check_violation using message='inactive_shipping_carrier'; end if;

  for group_row in
    select (value->>'orderId')::uuid order_id, jsonb_agg(value) rows
    from jsonb_array_elements(normalized)
    where value->>'orderId' is not null
    group by value->>'orderId' order by value->>'orderId'
  loop
    begin
      select value->>'error' into group_error from jsonb_array_elements(group_row.rows)
        where value->>'error' is not null limit 1;
      if group_error is not null then raise check_violation using message=group_error; end if;
      if (select count(distinct value->>'trackingNumber') from jsonb_array_elements(group_row.rows))<>1 then
        raise check_violation using message='conflicting_shipment_tracking';
      end if;
      select count(*),(array_agg(id))[1] into matches,shipment_key
        from public.order_shipments where order_id=group_row.order_id and origin_id=origin.id;
      if matches=0 then raise no_data_found using message='shipment_not_found'; end if;
      if matches<>1 then raise check_violation using message='shipment_reference_required'; end if;
      tracking_value := group_row.rows->0->>'trackingNumber';
      completed := public.admin_import_shipment_tracking(shipment_key::text,origin.default_carrier,tracking_value);
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,completed||jsonb_build_object('ok',true));
    exception when others then
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,jsonb_build_object('ok',false,'error',sqlerrm));
    end;
  end loop;

  -- Return one outcome per original row, in file order. Only the first successful
  -- row represents the mutation; duplicate rows must not count or enqueue twice.
  for input in select value from jsonb_array_elements(normalized) loop
    order_key := (input->>'orderId')::uuid;
    outcome := case when order_key is null then jsonb_build_object('ok',false,'error',input->>'error')
      else outcomes->order_key::text end;
    if outcome->>'ok'='true' then
      if order_key=any(seen) then
        outcome := outcome || jsonb_build_object('duplicate',true,'dispatched',false);
      else
        seen := array_append(seen,order_key);
        outcome := outcome || jsonb_build_object('duplicate',false);
      end if;
    end if;
    results := results || jsonb_build_array(outcome||jsonb_build_object('line',input->'line','reference',input->>'reference'));
  end loop;
  return results;
end $function$;

-- admin_inquiry_context(uuid)
CREATE OR REPLACE FUNCTION public.admin_inquiry_context(target_inquiry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_thread public.inquiries%rowtype;
  v_order jsonb := 'null'::jsonb;
  v_buyer jsonb;
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  select * into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  if v_thread.order_id is not null and public.has_operator_capability('sales.read') then
    select jsonb_build_object(
      'id', target.id,
      'status', target.status::text,
      'total', target.total,
      'createdAt', target.created_at,
      'shipments', private.order_shipment_records(target.id),
      'itemCount', (
        select coalesce(sum(item.qty), 0)
        from public.order_items as item
        where item.order_id = target.id
      ),
      'leadItemName', (
        select item.good_name_snapshot
        from public.order_items as item
        where item.order_id = target.id
        order by item.id
        limit 1
      ),
      'payment', (
        select jsonb_build_object(
          'provider', summary.provider,
          'status', summary.status,
          'amount', summary.amount
        )
        from public.payment_summaries as summary
        where summary.purpose = 'order'
          and summary.ref_id = target.id
        order by (summary.status = 'paid') desc, summary.created_at desc
        limit 1
      ),
      'claims', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', request.status,
            'requestedAt', request.requested_at,
            'decidedAt', request.decided_at,
            'reasonType', request.reason_type
          )
          order by request.requested_at desc
        )
        from public.order_cancellation_requests as request
        where request.order_id = target.id
      ), '[]'::jsonb)
    )
    into v_order
    from public.orders as target
    where target.id = v_thread.order_id;
  end if;

  select jsonb_build_object(
    'id', buyer.id,
    'nickname', buyer.nickname,
    'email', buyer.email,
    'suspendedAt', buyer.suspended_at,
    'orderCount', (
      select count(*)
      from public.orders as target
      where target.user_id = buyer.id
        and target.status <> 'pending'
    ),
    'inquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
    ),
    'openInquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
        and other.status <> 'closed'
    )
  )
  into v_buyer
  from public.profiles as buyer
  where buyer.id = v_thread.user_id;

  if not public.has_operator_capability('sales.read') then v_buyer:=jsonb_set(v_buyer,'{orderCount}','null'::jsonb); end if;
  if not public.has_operator_capability('sales.manage') and jsonb_typeof(v_order)='object' then
    v_order:=v_order||jsonb_build_object('payment',null,'claims','[]'::jsonb);
  end if;
  return jsonb_build_object('order', coalesce(v_order, 'null'::jsonb), 'buyer', v_buyer);
end;
$function$;

-- admin_inquiry_status_counts()
CREATE OR REPLACE FUNCTION public.admin_inquiry_status_counts()
 RETURNS TABLE(status text, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  return query
  select
    allowed.value::text,
    coalesce(counted.tally, 0)::bigint
  from (values ('open'), ('answered'), ('closed')) as allowed(value)
  left join (
    select thread.status as value, pg_catalog.count(*) as tally
    from public.inquiries as thread
    group by thread.status
  ) as counted on counted.value = allowed.value;
end;
$function$;

-- admin_inquiry_workspace(uuid)
CREATE OR REPLACE FUNCTION public.admin_inquiry_workspace(target_inquiry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select jsonb_build_object(
    'assigneeId', thread.assignee_id, 'waitingSince', thread.waiting_since,
    'assigneeName', case when assignee.id is null then null else
      coalesce(nullif(btrim(assignee.nickname), ''), '운영자_' || left(assignee.id::text, 6)) end,
    'staffOptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name',
        coalesce(nullif(btrim(profile.nickname), ''), '운영자_' || left(profile.id::text, 6)))
        order by profile.nickname nulls last, profile.id)
      from public.profiles as profile
      where private.has_operator_capability(profile.id,'cs.manage')
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body,
        'authorName', coalesce(nullif(btrim(author.nickname), ''),
          case when author.id is null then '탈퇴한 운영자' else '운영자_' || left(author.id::text, 6) end),
        'createdAt', note.created_at) order by note.created_at, note.id)
      from public.inquiry_internal_notes as note
      left join public.profiles as author on author.id = note.author_id
      where note.inquiry_id = thread.id
    ), '[]'::jsonb)
  ) into v_result
  from public.inquiries as thread
  left join public.profiles as assignee on assignee.id = thread.assignee_id
  where thread.id = target_inquiry_id;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  return v_result;
end;
$function$;

-- admin_last_good_notice()
CREATE OR REPLACE FUNCTION public.admin_last_good_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
 return (select jsonb_build_object('name',g.name,'notice',jsonb_build_object('maker',g.notice_maker,'origin',g.notice_origin,
   'material',g.notice_material,'size',g.notice_size,'madeOn',g.notice_made_on,'asManager',g.notice_as_manager,'asContact',g.notice_as_contact))
   from public.audit_log a join public.goods g on a.target='goods:'||g.id
   where a.action='catalog.good.upsert' and g.archived_at is null
   order by a.created_at desc,a.id desc limit 1);
end;
$function$;

-- admin_list_delivery_policies(uuid)
CREATE OR REPLACE FUNCTION public.admin_list_delivery_policies(p_origin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  return (select coalesce(jsonb_agg(policy.terms||jsonb_build_object('id',policy.id,'originId',policy.origin_id,'method',policy.method,
    'state',policy.state,'revision',policy.revision,'createdAt',policy.created_at,'activatedAt',policy.activated_at,'stoppedAt',policy.stopped_at)
    order by policy.created_at desc,policy.id),'[]') from private.fulfillment_delivery_policies policy where policy.origin_id=p_origin_id);
end $function$;

-- admin_list_draw_ticket_grants(integer)
CREATE OR REPLACE FUNCTION public.admin_list_draw_ticket_grants(target_limit integer DEFAULT 20)
 RETURNS TABLE(operation_id uuid, granted_at timestamp with time zone, actor_nickname text, recipient_id uuid, recipient_nickname text, recipient_masked_email text, pool_id uuid, pool_name text, quantity bigint, opened_count bigint, revoked_count bigint, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_limit integer := least(greatest(coalesce(target_limit, 20), 1), 100);
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    grant_group.source_id,
    grant_group.granted_at,
    coalesce(
      nullif(btrim(actor_profile.nickname, E' \t\n\r\f\v'), ''),
      'staff_' || left(coalesce(audit.actor_id::text, ''), 6)
    ),
    grant_group.user_id,
    coalesce(
      nullif(btrim(recipient_profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || left(grant_group.user_id::text, 6)
    ),
    case
      when nullif(btrim(coalesce(recipient_profile.email, '')), '') is null
        then '이메일 없음'::text
      when strpos(recipient_profile.email, '@') > 1
        then left(split_part(recipient_profile.email, '@', 1), 1)
          || '***@'
          || split_part(recipient_profile.email, '@', 2)
      else '***'::text
    end,
    grant_group.pool_id,
    pool.name,
    grant_group.quantity,
    grant_group.opened_count,
    grant_group.revoked_count,
    coalesce(audit.diff ->> 'reason', '사유 기록 없음')
  from (
    select
      ticket.source_id,
      ticket.user_id,
      ticket.pool_id,
      min(ticket.created_at) as granted_at,
      count(*)::bigint as quantity,
      count(*) filter (where ticket.consumed_at is not null)::bigint as opened_count,
      count(*) filter (where ticket.revoked_at is not null)::bigint as revoked_count
    from public.draw_tickets as ticket
    where ticket.source = 'admin_grant'
    group by ticket.source_id, ticket.user_id, ticket.pool_id
  ) as grant_group
  left join public.audit_log as audit
    on audit.id = grant_group.source_id
    and audit.action = 'admin.draw_ticket.granted'
  left join public.profiles as actor_profile on actor_profile.id = audit.actor_id
  left join public.profiles as recipient_profile on recipient_profile.id = grant_group.user_id
  left join public.card_pools as pool on pool.id = grant_group.pool_id
  order by grant_group.granted_at desc, grant_group.source_id
  limit normalized_limit;
end;
$function$;

-- admin_list_erp_categories()
CREATE OR REPLACE FUNCTION public.admin_list_erp_categories()
 RETURNS TABLE(erp_category text, item_count bigint, category_id uuid, updated_at timestamp with time zone, fallback_category_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  return query
    with counts as (
      select item.category as erp_category, pg_catalog.count(*)::bigint as item_count
      from public.erp_items as item
      where item.category is not null
      group by item.category
    )
    select
      coalesce(counts.erp_category, mapping.erp_category),
      coalesce(counts.item_count, 0::bigint),
      mapping.category_id,
      mapping.updated_at,
      private.erp_category_legacy_target(coalesce(counts.erp_category, mapping.erp_category))
    from counts
    full join public.erp_category_mappings as mapping on mapping.erp_category = counts.erp_category
    order by 1;
end;
$function$;

-- admin_list_erp_items(text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_erp_items(p_query text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_needle text := private.erp_item_text(p_query, true);
  v_pattern text;
  v_total bigint;
  v_items jsonb;
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset not between 0 and 1000000
     or pg_catalog.length(coalesce(v_needle, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_erp_item_list';
  end if;

  if v_needle is not null then
    v_pattern := '%' || pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(v_needle, E'\\', E'\\\\'), '%', E'\\%'),
      '_', E'\\_') || '%';
  end if;

  select pg_catalog.count(*) into v_total
  from public.erp_items as item
  where v_pattern is null
     or item.name ilike v_pattern escape E'\\'
     or item.code ilike v_pattern escape E'\\';

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code', page.code,
      'name', page.name,
      'category', page.category,
      'sale_price', page.sale_price,
      'barcode', page.barcode,
      'mapped_category_id', private.erp_category_target(page.category),
      'imported_at', page.imported_at,
      'updated_at', page.updated_at
    ) order by page.code), '[]'::jsonb)
  into v_items
  from (
    select item.code, item.name, item.category, item.sale_price, item.barcode, item.imported_at, item.updated_at
    from public.erp_items as item
    where v_pattern is null
       or item.name ilike v_pattern escape E'\\'
       or item.code ilike v_pattern escape E'\\'
    order by item.code
    offset p_offset
    limit p_limit
  ) as page;

  return pg_catalog.jsonb_build_object('total', v_total, 'items', v_items);
end;
$function$;

-- admin_list_games()
CREATE OR REPLACE FUNCTION public.admin_list_games()
 RETURNS TABLE(id text, type text, title text, event_id text, event_title text, config jsonb, variant_kind text, marble_count integer, reward_pool_id uuid, reward_pool_name text, reward_pool_active_from timestamp with time zone, reward_pool_active_to timestamp with time zone, reward_pool_ready boolean, ip_id text, ip_title text, per_user_daily_limit integer, active_from timestamp with time zone, active_to timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, play_count bigint, last_played_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    game.id,
    game.type,
    game.title,
    game.event_id,
    event_record.title as event_title,
    game.config,
    case
      when game.config #>> '{variant,kind}' in ('card', 'goods')
        then game.config #>> '{variant,kind}'
      else 'unknown'
    end as variant_kind,
    case
      when game.config ->> 'marbleCount' ~ '^[0-9]{1,9}$'
        then (game.config ->> 'marbleCount')::integer
      else null
    end as marble_count,
    game.reward_pool_id,
    pool.name as reward_pool_name,
    pool.active_from as reward_pool_active_from,
    pool.active_to as reward_pool_active_to,
    private.catalog_pool_has_active_lineup(pool.id) as reward_pool_ready,
    pool.ip_id,
    ip.title as ip_title,
    game.per_user_daily_limit,
    game.active_from,
    game.active_to,
    game.created_at,
    game.updated_at,
    play_summary.play_count,
    play_summary.last_played_at
  from public.games as game
  left join public.card_pools as pool
    on pool.id = game.reward_pool_id
  left join public.ips as ip
    on ip.id = pool.ip_id
  left join public.events as event_record
    on event_record.id = game.event_id
  left join lateral (
    select
      count(*)::bigint as play_count,
      max(game_play.created_at) as last_played_at
    from public.game_plays as game_play
    where game_play.game_id = game.id
  ) as play_summary on true
  order by game.created_at desc, game.id;
end;
$function$;

-- admin_list_goods_announcements(text,text,text,text,date,date,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_announcements(p_query text DEFAULT ''::text, p_field text DEFAULT 'title'::text, p_category text DEFAULT 'all'::text, p_state text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.announcements',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.announcements',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_query is null or char_length(p_query)>100 or p_field is null or p_field not in ('title','reference')
    or p_category is null or p_category not in ('all','general','event','shipping','product')
    or p_state is null or p_state not in ('all','waiting','shown','stopped')
    or p_limit is null or p_limit not in (20,50,100) or p_offset is null or p_offset < 0 or p_from>p_to then
    raise invalid_parameter_value using message='invalid_goods_announcement_filter';
  end if;
  with scope as materialized (
    select n.*,case when not n.enabled or n.ends_at<=statement_timestamp() then 'stopped'
      when n.starts_at>statement_timestamp() then 'waiting' else 'shown' end as display_state
    from public.goods_announcements n where (p_category='all' or n.category=p_category)
      and (p_query='' or case p_field when 'reference' then n.reference::text=btrim(p_query) else strpos(lower(n.title),lower(btrim(p_query)))>0 end)
      and (p_from is null or n.created_at >= (p_from::timestamp at time zone 'Asia/Seoul'))
      and (p_to is null or n.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul'))
  ), matched as materialized(select * from scope where p_state='all' or display_state=p_state),
  page as (select * from matched order by created_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'reference',reference,'title',title,'category',category,'device',device,'enabled',enabled,'important',important,'allGoods',all_goods,
    'state',display_state,'startsAt',starts_at,'endsAt',ends_at,'createdAt',created_at,'updatedAt',updated_at,'revision',revision,
    'goodCount',(select count(*) from public.goods_announcement_goods links where links.announcement_id=page.id)
  ) order by created_at desc,id) from page),'[]')) into result;
  return result;
end $function$;

-- admin_list_goods_drafts(text,boolean,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_drafts(p_query text DEFAULT ''::text, p_archived boolean DEFAULT false, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; total_count bigint;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_archived is null or p_page is null or p_page<1 or p_page>100000 then
    raise invalid_parameter_value using message='invalid_goods_draft_filter';
  end if;
  select count(*) into total_count from public.admin_goods_drafts d where d.owner_id=auth.uid()
    and d.completed_result is null and (d.archived_at is not null)=p_archived and strpos(lower(d.form_values->>'name'),lower(btrim(p_query)))>0;
  select coalesce(jsonb_agg(private.goods_draft_summary(d) order by d.updated_at desc,d.id),'[]') into result from (
    select * from public.admin_goods_drafts d where d.owner_id=auth.uid() and d.completed_result is null
      and (d.archived_at is not null)=p_archived and strpos(lower(d.form_values->>'name'),lower(btrim(p_query)))>0
    order by d.updated_at desc,d.id limit 20 offset(p_page-1)*20
  ) d;
  return jsonb_build_object('rows',result,'total',total_count,'page',p_page,'pageSize',20);
end $function$;

-- admin_list_goods_photos(text,boolean,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_photos(p_query text DEFAULT ''::text, p_archived boolean DEFAULT false, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; total_count bigint;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_query is null or char_length(p_query)>100 or p_archived is null then raise invalid_parameter_value using message='invalid_photo_search'; end if;
  select count(*) into total_count from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(p.name),lower(btrim(p_query)))>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'imagePath',p.image_path,'revision',p.revision,'archived',p.archived_at is not null,'createdAt',p.created_at,'references',private.goods_photo_references(p.image_path)) order by p.created_at desc,p.id),'[]') into result
    from (select * from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(p.name),lower(btrim(p_query)))>0 order by p.created_at desc,p.id limit 20 offset (p_page-1)*20) p;
  return jsonb_build_object('rows',result,'total',total_count,'page',p_page,'pageSize',20);
end $function$;

-- admin_list_goods_preorder_reservations(text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_preorder_reservations(p_good_id text, p_state text DEFAULT 'reserved'::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare total_count integer; result jsonb;
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('sales.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if (p_state is not null and p_state not in ('reserved','allocated','released','returned')) or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset<0 then raise invalid_parameter_value using message='invalid_preorder_reservation_query'; end if;
  select count(*) into total_count from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
    where item.good_id=p_good_id and (p_state is null or reservation.state=p_state);
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',row.order_item_id,'orderId',row.order_id,'policyId',row.policy_id,
    'variantId',row.variant_id,'variantName',row.variant_name_snapshot,'qty',row.qty,'state',row.state,'createdAt',row.created_at,
    'orderStatus',row.order_status,'expectedShipDate',row.preorder_expected_ship_date,'physicalStockQty',row.physical_stock_qty,
    'allocatedAt',row.allocated_at,'allocationReference',case when public.has_operator_capability('sales.manage') then row.allocation_reference end,'releasedAt',row.released_at,'releaseReason',case when public.has_operator_capability('sales.manage') then row.release_reason end)
    order by row.created_at,row.order_item_id),'[]'::jsonb) into result from (
      select reservation.*,item.variant_id,item.variant_name_snapshot,item.preorder_expected_ship_date,variant.stock_qty physical_stock_qty,purchase.status order_status
      from private.goods_preorder_reservations reservation join public.order_items item on item.id=reservation.order_item_id
      join public.goods_variants variant on variant.id=item.variant_id join public.orders purchase on purchase.id=reservation.order_id
      where item.good_id=p_good_id and (p_state is null or reservation.state=p_state)
      order by reservation.created_at,reservation.order_item_id limit p_limit offset p_offset) row;
  return jsonb_build_object('total',total_count,'items',result,'hasMore',p_offset+jsonb_array_length(result)<total_count);
end $function$;

-- admin_list_goods_preorders(text)
CREATE OR REPLACE FUNCTION public.admin_list_goods_preorders(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',policy.id,'variantId',policy.variant_id,'goodId',variant.good_id,
    'state',policy.state,'capacityQty',policy.capacity_qty,'startsAt',policy.starts_at,'endsAt',policy.ends_at,
    'expectedShipDate',policy.expected_ship_date,'approvalReference',policy.approval_reference,'revision',policy.revision,
    'selected',coalesce(variant.preorder_policy_id=policy.id,false),'remainingQty',private.goods_preorder_remaining(policy.id),
    'reservedQty',coalesce((select sum(qty) from private.goods_preorder_reservations where policy_id=policy.id and state='reserved'),0),
    'allocatedQty',coalesce((select sum(qty) from private.goods_preorder_reservations where policy_id=policy.id and state in ('allocated','returned')),0),
    'createdAt',policy.created_at,'activatedAt',policy.activated_at,'stoppedAt',policy.stopped_at)
    order by policy.created_at desc,policy.id),'[]'::jsonb)
    from private.goods_preorder_policies policy join public.goods_variants variant on variant.id=policy.variant_id where variant.good_id=p_good_id);
end $function$;

-- admin_list_goods_price_periods(text)
CREATE OR REPLACE FUNCTION public.admin_list_goods_price_periods(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'goodId',good_id,'variantId',variant_id,
    'state',state,'regularPrice',regular_price,'discountPrice',discount_price,'startsAt',starts_at,'endsAt',ends_at,
    'revision',revision,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id)
    from private.goods_variant_price_periods where good_id=p_good_id),'[]'::jsonb);
end $function$;

-- admin_list_goods_purchase_cost_history(text,uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_purchase_cost_history(p_good_id text, p_variant_id uuid, p_before_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('platform.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
  if p_before_revision is not null and p_before_revision<1 then raise invalid_parameter_value using message='invalid_goods_purchase_cost'; end if;
  if not exists(select 1 from public.goods_variants where id=p_variant_id and good_id=p_good_id) then
    raise no_data_found using message='goods_variant_not_found';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'variantId',entry.variant_id,'revision',entry.revision,
    'before',entry.before_value,'after',entry.after_value,'actorName',actor.nickname,'changedAt',entry.changed_at)
    order by entry.revision desc)
    from (select * from private.goods_variant_purchase_cost_changes where variant_id=p_variant_id
      and (p_before_revision is null or revision<p_before_revision) order by revision desc limit 50) entry
    left join public.profiles actor on actor.id=entry.actor_id),'[]'::jsonb);
end $function$;

-- admin_list_goods_relations(text,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_goods_relations(p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_state text DEFAULT 'all'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_kind is null or p_kind not in ('all','together','similar')
    or p_state is null or p_state not in ('all','active','scheduled','stopped','ended')
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
  then raise invalid_parameter_value using message='invalid_goods_relation_filter'; end if;
  with matched as materialized (
    select r.*,case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled'
      when r.ends_at<=statement_timestamp() then 'ended' else 'active' end state
    from public.goods_relations r where (p_kind='all' or r.kind=p_kind) and (btrim(p_query)=''
      or strpos(lower(r.title),lower(btrim(p_query)))>0 or strpos(r.id::text,btrim(p_query))>0
      or exists(select 1 from public.goods_relation_members m join public.goods g on g.id=m.good_id where m.relation_id=r.id
        and (strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)))
  ), filtered as materialized (select * from matched where p_state='all' or state=p_state),
  page_rows as (select id,updated_at from filtered order by updated_at desc,id limit p_page_size offset (p_page-1)*p_page_size)
  select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'rows',coalesce((select jsonb_agg(private.goods_relation_document(id) order by updated_at desc,id) from page_rows),'[]'::jsonb)) into result;
  return result;
end $function$;

-- admin_list_goods_variant_external_identities(text)
CREATE OR REPLACE FUNCTION public.admin_list_goods_variant_external_identities(target_good_id text DEFAULT NULL::text)
 RETURNS TABLE(variant_id uuid, good_id text, erp_code text, erp_name text, barcode text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_good_id is not null and (btrim(target_good_id) = '' or char_length(target_good_id) > 200) then
    raise invalid_parameter_value using message = 'invalid_goods_variant_external_identity';
  end if;
  return query
  select variant.id, variant.good_id, external_identity.erp_code, external_identity.erp_name, external_identity.barcode, external_identity.updated_at
  from public.goods_variants variant
  left join private.goods_variant_external_identity external_identity on external_identity.variant_id = variant.id
  where target_good_id is null or variant.good_id = target_good_id
  order by variant.good_id, variant.sort_order, variant.id;
end;
$function$;

-- admin_list_goods_variant_purchase_costs(text)
CREATE OR REPLACE FUNCTION public.admin_list_goods_variant_purchase_costs(p_good_id text)
 RETURNS TABLE(variant_id uuid, good_id text, unit_cost_krw integer, tax_basis text, revision integer, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('platform.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
  if nullif(btrim(p_good_id),'') is null or char_length(p_good_id)>200 then
    raise invalid_parameter_value using message='invalid_goods_purchase_cost';
  end if;
  return query select variant.id,variant.good_id,cost.unit_cost_krw,cost.tax_basis,cost.revision,cost.updated_at
    from public.goods_variants variant left join private.goods_variant_purchase_costs cost on cost.variant_id=variant.id
    where variant.good_id=p_good_id order by variant.is_default desc,variant.sort_order,variant.id;
end $function$;

-- admin_list_notification_history(integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_notification_history(target_limit integer DEFAULT 20, target_offset integer DEFAULT 0)
 RETURNS TABLE(operation_id uuid, actor_name text, scope text, ip_id text, ip_title text, title text, body text, recipient_count bigint, sent_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'invalid_history_limit' using errcode = '22023';
  end if;

  if target_offset is null or target_offset < 0 then
    raise exception 'invalid_history_offset' using errcode = '22023';
  end if;

  return query
    select
      audit.id,
      case
        when profile.nickname is null or profile.nickname = '' then '운영자'
        else profile.nickname
      end,
      audit.diff #>> '{request,scope}',
      audit.diff #>> '{request,ip_id}',
      audit.diff #>> '{result,ip_title}',
      audit.diff #>> '{request,title}',
      audit.diff #>> '{request,body}',
      (audit.diff #>> '{result,recipient_count}')::bigint,
      audit.created_at
    from public.audit_log as audit
    left join public.profiles as profile
      on profile.id = audit.actor_id
    where audit.action = 'admin.notification.sent'
    order by audit.created_at desc, audit.id desc
    limit target_limit
    offset target_offset;
end;
$function$;

-- admin_list_order_delay_notices(uuid)
CREATE OR REPLACE FUNCTION public.admin_list_order_delay_notices(target_order uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'createdAt',n.created_at,'requestedAt',n.requested_at) order by n.created_at desc)
 from (select n.* from private.order_delay_notices n where target_order is null or exists(select 1 from private.order_delay_notice_targets t where t.notice_id=n.id and t.order_id=target_order)
 order by n.created_at desc limit 30)n),'[]');
end $function$;

-- admin_list_reward_policies()
CREATE OR REPLACE FUNCTION public.admin_list_reward_policies()
 RETURNS TABLE(id uuid, pool_id uuid, trigger text, target_ip_id text, target_good_id text, min_amount bigint, tickets_per_grant integer, active boolean, active_from timestamp with time zone, active_to timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, issued_count bigint, available_count bigint, opened_count bigint, revoked_count bigint, order_count bigint, last_issued_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    reward_policy.id,
    reward_policy.pool_id,
    reward_policy.trigger,
    reward_policy.target_ip_id,
    reward_policy.target_good_id,
    reward_policy.min_amount,
    reward_policy.tickets_per_grant,
    reward_policy.active,
    reward_policy.active_from,
    reward_policy.active_to,
    reward_policy.created_at,
    reward_policy.updated_at,
    count(ticket.id)::bigint as issued_count,
    count(ticket.id) filter (
      where ticket.consumed_at is null and ticket.revoked_at is null
    )::bigint as available_count,
    count(ticket.id) filter (where ticket.consumed_at is not null)::bigint
      as opened_count,
    count(ticket.id) filter (where ticket.revoked_at is not null)::bigint
      as revoked_count,
    count(distinct ticket.source_id) filter (
      where ticket.source = 'order_paid'
    )::bigint as order_count,
    max(ticket.created_at) as last_issued_at
  from public.reward_policies as reward_policy
  left join public.draw_tickets as ticket
    on ticket.reward_policy_id = reward_policy.id
  group by reward_policy.id
  order by reward_policy.created_at desc, reward_policy.id;
end;
$function$;

-- admin_list_shipment_promise_changes(uuid)
CREATE OR REPLACE FUNCTION public.admin_list_shipment_promise_changes(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('sales.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',change.id,'fromDate',change.from_date,'toDate',change.to_date,
    'reason',change.reason,'actorName',profile.nickname,'changedAt',change.created_at) order by change.created_at desc,change.id),'[]'::jsonb)
    from private.order_shipment_promise_changes change left join public.profiles profile on profile.id=change.actor_id where change.shipment_id=p_shipment_id);
end $function$;

-- admin_list_shipping_region_policies()
CREATE OR REPLACE FUNCTION public.admin_list_shipping_region_policies()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('platform.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return jsonb_build_object('policies',(select coalesce(jsonb_agg(private.shipping_region_policy_record(policy)
    order by policy.origin_id,policy.carrier_code,policy.version desc),'[]') from private.shipping_region_policies policy),
    'adoptions',(select coalesce(jsonb_agg(jsonb_build_object('originId',origin_id,'managedFrom',managed_from) order by origin_id),'[]')
      from private.shipping_region_adoptions));
end $function$;

-- admin_list_shipping_settings_templates(text,text,integer)
CREATE OR REPLACE FUNCTION public.admin_list_shipping_settings_templates(p_query text DEFAULT ''::text, p_state text DEFAULT 'all'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; pattern text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_query is null or char_length(p_query)>80 or p_state is null or p_state not in ('all','enabled','disabled') or p_page is null or p_page not between 1 and 100000
 then raise invalid_parameter_value using message='invalid_shipping_settings_filter'; end if;
 pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with matched as (select * from public.shipping_settings_templates t where t.name ilike pattern escape E'\\'
  and (p_state='all' or t.enabled=(p_state='enabled'))), page as (select * from matched order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce(jsonb_agg(private.shipping_settings_template_json(page) order by page.updated_at desc,page.id),'[]')) into result from page;
 return result;
end $function$;

-- admin_mark_shipments_exported(jsonb)
CREATE OR REPLACE FUNCTION public.admin_mark_shipments_exported(target_versions jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row_value record;shipment public.order_shipments;total integer:=0;actor uuid:=(select auth.uid());
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_versions) is distinct from 'array' or jsonb_array_length(target_versions) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_export_selection';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(target_versions))<>jsonb_array_length(target_versions) then raise invalid_parameter_value using message='invalid_export_selection';end if;
 -- Global order sequence matches all other shipment mutations.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s join jsonb_to_recordset(target_versions) v(id uuid,"updatedAt" timestamptz) on v.id=s.id where s.order_id=o.id) order by o.id for update;
 for row_value in select * from jsonb_to_recordset(target_versions) as v(id uuid,"updatedAt" timestamptz) order by id loop
  select * into shipment from public.order_shipments where id=row_value.id for update;
  if not found or shipment.status<>'ready' or row_value."updatedAt" is null or shipment.updated_at<>row_value."updatedAt"
    or not exists(select 1 from public.orders where id=shipment.order_id and status in ('confirmed','shipping')) then raise sqlstate 'PT409' using message='shipment_changed';end if;
  perform private.assert_order_dispatch_allowed(shipment.order_id);
  update public.order_shipments set exported_at=clock_timestamp(),exported_by=actor,updated_at=clock_timestamp() where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.exported','order:'||shipment.order_id,jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot));
  total:=total+1;
 end loop;
 return total;
end $function$;

-- admin_mutate_inquiry_reply_template(uuid,uuid,integer,text,jsonb)
CREATE OR REPLACE FUNCTION public.admin_mutate_inquiry_reply_template(p_operation_id uuid, p_template_id uuid, p_expected_revision integer, p_action text, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.inquiry_reply_templates; saved public.inquiry_reply_templates;
  existing public.audit_log; request jsonb; receipt jsonb; title_value text; body_value text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if p_operation_id is null or p_template_id is null or p_expected_revision is null or p_expected_revision<0
    or p_action is null or p_action not in ('save','archive','restore') or jsonb_typeof(p_values) is distinct from 'object'
  then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
  if p_action='save' then
    if not(p_values ?& array['category','title','body']) or (select count(*) from jsonb_object_keys(p_values))<>3
      or jsonb_typeof(p_values->'category') is distinct from 'string'
      or p_values->>'category' not in ('product','shipping','return','exchange','refund','other')
      or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'body') is distinct from 'string'
    then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
    title_value:=btrim(p_values->>'title',E' \t\r\n'); body_value:=btrim(p_values->>'body',E' \t\r\n');
    if char_length(title_value) not between 1 and 40 or title_value ~ '[[:cntrl:]]' or title_value !~ '[^[:space:]]'
      or char_length(body_value) not between 1 and 2000 or body_value !~ '[^[:space:]]' or translate(body_value,E'\r\n\t','') ~ '[[:cntrl:]]'
    then raise invalid_parameter_value using message='invalid_inquiry_template'; end if;
    p_values:=jsonb_build_object('category',p_values->>'category','title',title_value,'body',body_value);
  elsif p_values<>'{}'::jsonb or p_expected_revision=0 then
    raise invalid_parameter_value using message='invalid_inquiry_template';
  end if;
  request:=jsonb_build_object('templateId',p_template_id,'revision',p_expected_revision,'action',p_action,'values',p_values);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_template_operation:'||p_operation_id,0));
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.inquiry_reply_template.managed'
      and existing.target='inquiry_reply_templates:'||p_template_id and existing.diff->'request'=request then
      return existing.diff->'receipt';
    end if;
    raise exception using errcode='PT409',message='inquiry_template_operation_conflict';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inquiry_reply_template:'||p_template_id,0));
  select * into previous from public.inquiry_reply_templates where id=p_template_id for update;
  if found then
    if previous.revision<>p_expected_revision then raise exception using errcode='PT409',message='inquiry_template_changed'; end if;
    if p_action='save' then
      if previous.archived_at is not null then raise check_violation using message='inquiry_template_archived'; end if;
      if (previous.category,previous.title,previous.body)=(p_values->>'category',title_value,body_value) then saved:=previous;
      else
        update public.inquiry_reply_templates set category=p_values->>'category',title=title_value,body=body_value,
          revision=revision+1,updated_by=actor where id=p_template_id returning * into saved;
      end if;
    elsif (previous.archived_at is not null)=(p_action='archive') then saved:=previous;
    else
      update public.inquiry_reply_templates set archived_at=case when p_action='archive' then clock_timestamp() else null end,
        revision=revision+1,updated_by=actor where id=p_template_id returning * into saved;
    end if;
  else
    if p_action<>'save' then raise no_data_found using message='inquiry_template_not_found'; end if;
    if p_expected_revision<>0 then raise exception using errcode='PT409',message='inquiry_template_changed'; end if;
    insert into public.inquiry_reply_templates(id,category,title,body,created_by,updated_by)
      values(p_template_id,p_values->>'category',title_value,body_value,actor,actor) returning * into saved;
  end if;
  receipt:=jsonb_build_object('operationId',p_operation_id,'templateId',p_template_id,'action',p_action,'template',to_jsonb(saved));
  insert into public.audit_log(id,actor_id,action,target,diff)
    values(p_operation_id,actor,'admin.inquiry_reply_template.managed','inquiry_reply_templates:'||p_template_id,
      jsonb_build_object('request',request,'before',to_jsonb(previous),'receipt',receipt));
  return receipt;
end $function$;

-- admin_operation_alerts(text,text,timestamp with time zone,uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_operation_alerts(p_category text DEFAULT 'all'::text, p_state text DEFAULT 'all'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if not public.has_operator_capability('home',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if actor is null or not public.has_operator_capability('home',false) then raise insufficient_privilege using message='staff_required';end if;
 if p_category is null or p_category not in('all','orders','claims','inquiries','questions','reviews')
  or p_state is null or p_state not in('all','unread','hidden') or p_limit is null or p_limit not between 1 and 50
  or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then
  raise invalid_parameter_value using message='invalid_alert_filter';end if;
 with visible as materialized (
  select a.id,a.category,a.title,a.href,a.created_at,s.read_at,s.hidden_at
  from private.admin_operation_alerts a left join private.admin_operation_alert_states s on s.alert_id=a.id and s.actor_id=actor
  where a.created_at>statement_timestamp()-interval '90 days' and public.has_operator_capability(private.operator_alert_capability(a.category))
 ), filtered as (
  select * from visible where(p_category='all' or category=p_category)
   and case p_state when 'hidden' then hidden_at is not null when 'unread' then hidden_at is null and read_at is null else hidden_at is null end
   and(p_before is null or(created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit p_limit+1
 ) select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'href',href,'createdAt',created_at,'readAt',read_at,'hiddenAt',hidden_at) order by created_at desc,id desc)
    from(select * from filtered order by created_at desc,id desc limit p_limit)page),'[]'::jsonb),
  'hasMore',(select count(*)>p_limit from filtered),
  'unreadCount',(select count(*) from visible where read_at is null and hidden_at is null),
  'badgeEnabled',coalesce((select badge_enabled from private.admin_operation_alert_preferences where actor_id=actor),true),
  'asOf',statement_timestamp()
 )into result;
 return result;
end;$function$;

-- admin_operation_tasks()
CREATE OR REPLACE FUNCTION public.admin_operation_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.has_operator_capability('home') then raise insufficient_privilege using message='operator_capability_required'; end if;
 return coalesce((select jsonb_agg(entry.payload order by entry.ordinal) from (
select 1 ordinal,jsonb_build_object('id','paid','label','신규주문','count',(select count(*) from public.orders where status='paid'),'href','/admin/sales/orders?status=paid') payload where public.has_operator_capability('sales.read')
 union all
select 2,jsonb_build_object('id','cancel','label','취소요청','count',(select count(*) from public.order_cancellation_requests where claim_type='cancel' and stage='requested'),'href','/admin/sales/claims/cancels?stage=requested') where public.has_operator_capability('sales.manage')
 union all
select 3,jsonb_build_object('id','return','label','반품요청','count',(select count(*) from public.order_cancellation_requests where claim_type='return' and stage='requested'),'href','/admin/sales/claims/returns?stage=requested') where public.has_operator_capability('sales.manage')
 union all
select 4,jsonb_build_object('id','exchange','label','교환요청','count',(select count(*) from public.order_cancellation_requests where claim_type='exchange' and stage='requested'),'href','/admin/sales/claims/exchanges?stage=requested') where public.has_operator_capability('sales.manage')
 union all
select 5,jsonb_build_object('id','inquiries','label','미답변 고객문의','count',(select count(*) from public.inquiries where status='open'),'href','/admin/cs/inquiries?status=open') where public.has_operator_capability('cs.manage')
 union all
select 6,jsonb_build_object('id','questions','label','미답변 상품문의','count',(select count(*) from public.product_questions where status='visible' and answer_body is null),'href','/admin/cs/qna?status=unanswered') where public.has_operator_capability('cs.manage')
 union all
select 7,jsonb_build_object('id','reviews','label','미답글 리뷰','count',(select count(*) from public.reviews where status='visible' and admin_reply is null),'href','/admin/cs/reviews?reply=without&status=visible') where public.has_operator_capability('cs.manage')
) entry),'[]'::jsonb);
end;
$function$;

-- admin_operations_contact_history(integer)
CREATE OR REPLACE FUNCTION public.admin_operations_contact_history(row_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, actor_name text, scope text, origin_name text, changed_fields text[], created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if row_limit is null or row_limit not between 1 and 50 then
    raise invalid_parameter_value using message = 'invalid_operations_contact_history_limit';
  end if;
  return query
  select audit.id, coalesce(nullif(actor.nickname, ''), '관리자'), audit.diff ->> 'scope', origin.name,
    array(select jsonb_array_elements_text(audit.diff -> 'changedFields')), audit.created_at
  from public.audit_log audit
  left join public.profiles actor on actor.id = audit.actor_id
  left join public.fulfillment_origins origin on origin.id = (audit.diff ->> 'originId')::uuid
  where audit.action = 'admin.operations_contact.updated'
  order by audit.created_at desc, audit.id desc limit row_limit;
end;
$function$;

-- admin_operations_contacts()
CREATE OR REPLACE FUNCTION public.admin_operations_contacts()
 RETURNS TABLE(scope text, origin_id uuid, origin_name text, origin_active boolean, owner_name text, contact text, source_reference text, handoff_reference text, updated_at timestamp with time zone, updated_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return query
  with targets as (
    select 'operations'::text as scope, null::uuid as origin_id,
      null::text as origin_name, null::boolean as origin_active
    union all
    select 'origin'::text, origin.id, origin.name, origin.is_active
      from public.fulfillment_origins origin
  )
  select target.scope, target.origin_id, target.origin_name, target.origin_active,
    coalesce(saved.owner_name, ''), coalesce(saved.contact, ''),
    coalesce(saved.source_reference, ''), coalesce(saved.handoff_reference, ''),
    saved.updated_at,
    case when saved.updated_by is null then null
      else coalesce(nullif(editor.nickname, ''), '관리자') end
  from targets target
  left join private.operations_contacts saved on saved.scope = target.scope
    and saved.origin_id is not distinct from target.origin_id
  left join public.profiles editor on editor.id = saved.updated_by
  order by (target.scope = 'operations') desc, target.origin_name, target.origin_id;
end;
$function$;

-- admin_order_claim_detail(uuid)
CREATE OR REPLACE FUNCTION public.admin_order_claim_detail(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message = 'staff required'; end if;
  result := private.admin_order_claim_detail_before_custom_inputs(p_claim_id);
  if result is null then return null; end if;
  if result->'order' is not null and result->'order' <> 'null'::jsonb then
    result := jsonb_set(result, '{order,items}', private.with_order_item_custom_inputs(result#>'{order,items}'));
  end if;
  return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id));
end $function$;

-- admin_order_claim_stage_counts(text)
CREATE OR REPLACE FUNCTION public.admin_order_claim_stage_counts(p_claim_type text DEFAULT NULL::text)
 RETURNS TABLE(stage text, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_claim_type is not null and p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type filter';
  end if;

  return query
  select
    known.value,
    count(request.id)::bigint
  from unnest(array[
    'requested', 'in_review', 'collecting', 'collected',
    'on_hold', 'processing', 'needs_review', 'completed', 'rejected'
  ]) as known(value)
  left join public.order_cancellation_requests as request
    on request.stage = known.value
   and (p_claim_type is null or request.claim_type = p_claim_type)
  group by known.value;
end;
$function$;

-- admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_order_claim_stage_counts_console(p_claim_type text DEFAULT NULL::text, p_reason_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'requested'::text)
 RETURNS TABLE(stage text, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare needle text:=nullif(btrim(p_query),'');
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if (p_claim_type is not null and p_claim_type not in ('cancel','return','exchange'))
  or p_field is null or p_field not in ('all','order','buyer','email')
  or p_date_field is null or p_date_field not in ('requested','collected','completed')
  or (p_from is not null and p_to is not null and p_from>p_to) or char_length(needle)>100 then
  raise invalid_parameter_value using message='invalid_claim_search';
 end if;
 return query select known.value,count(request.id)::bigint
 from unnest(array['requested','in_review','collecting','collected','on_hold','processing','needs_review','completed','rejected']) known(value)
 left join public.order_cancellation_requests request on request.stage=known.value
  and (p_claim_type is null or request.claim_type=p_claim_type)
  and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,needle,p_field,p_date_field)
 group by known.value;
end $function$;

-- admin_order_detail(uuid)
CREATE OR REPLACE FUNCTION public.admin_order_detail(target_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='staff required'; end if;
 result:=private.admin_order_detail_before_custom_inputs(target_order_id);
 if result is null then return null; end if;
 if not public.has_operator_capability('sales.manage') then
   result:=jsonb_set(result,'{timeline}',coalesce((select jsonb_agg(entry.value order by entry.ordinality)
     from jsonb_array_elements(result->'timeline') with ordinality entry(value,ordinality)
     where entry.value->>'source' in ('order','shipment') and entry.value->>'id' not like 'audit:%'),'[]'::jsonb));
 end if;
 return jsonb_set(result,'{items}',private.with_order_item_custom_inputs(result->'items'));
end $function$;

-- admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)
CREATE OR REPLACE FUNCTION public.admin_prepare_order_delay_notice(target_notice uuid, target_shipments uuid[], customer_title text, customer_body text, expected_ship_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());ids uuid[];n private.order_delay_notices%rowtype;g record;v_snapshot jsonb;
 email text;buyer uuid;buyer_name text;labels text[];message text;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if target_notice is null or target_shipments is null or cardinality(target_shipments) not between 1 and 100
  or array_position(target_shipments,null) is not null or length(btrim(customer_title)) not between 1 and 80
  or customer_title is null or customer_title ~ '[[:cntrl:]]' or customer_body is null or length(btrim(customer_body)) not between 1 and 350
  or expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
 then raise invalid_parameter_value using message='invalid_delay_notice';end if;
 select array_agg(distinct x order by x) into ids from unnest(target_shipments)x;
 perform pg_advisory_xact_lock(hashtextextended('order_delay_notice:'||target_notice::text,0));
 select * into n from private.order_delay_notices where id=target_notice for update;
 if found then
  if n.actor_id<>actor or n.shipment_ids<>ids or n.title<>btrim(customer_title) or n.customer_body<>btrim(customer_body)
    or n.expected_ship_date is distinct from expected_ship_date then raise unique_violation using message='delay_notice_idempotency_conflict';end if;
  return public.admin_get_order_delay_notice(target_notice);
 end if;
 if (select count(*) from public.order_shipments where id=any(ids))<>cardinality(ids) then raise check_violation using message='delay_notice_ineligible';end if;
 insert into private.order_delay_notices(id,actor_id,shipment_ids,title,customer_body,expected_ship_date)
  values(target_notice,actor,ids,btrim(customer_title),btrim(customer_body),expected_ship_date);
 for g in select order_id,array_agg(id order by id) shipment_ids from public.order_shipments where id=any(ids) group by order_id order by order_id loop
  perform private.lock_order_delay_notice_target(g.order_id,g.shipment_ids);
  v_snapshot:=private.order_delay_notice_snapshot(g.order_id,g.shipment_ids);
  if v_snapshot is null then raise check_violation using message='delay_notice_ineligible';end if;
  select o.user_id,nullif(lower(btrim(p.email)),''),coalesce(nullif(p.nickname,''),'구매자') into buyer,email,buyer_name
   from public.orders o join public.profiles p on p.id=o.user_id where o.id=g.order_id;
  select array_agg(origin_name_snapshot||' · '||upper(right(id::text,8)) order by id) into labels from public.order_shipments where id=any(g.shipment_ids);
  message:=btrim(customer_body)||E'\n\n발송 예정일: '||coalesce(to_char(expected_ship_date,'YYYY-MM-DD'),'확인 중')||
   E'\n안내 대상 배송 건: '||(select string_agg(upper(right(x::text,8)),', ' order by x) from unnest(g.shipment_ids[1:3])x)||
   case when cardinality(g.shipment_ids)>3 then ' 외 '||(cardinality(g.shipment_ids)-3)::text||'건' else '' end;
  insert into private.order_delay_notice_targets(notice_id,order_id,buyer_id,recipient_email,buyer_name,shipment_ids,shipment_labels,snapshot,message_body,email_status,error_code)
   values(target_notice,g.order_id,buyer,email,buyer_name,g.shipment_ids,labels,v_snapshot,message,
    case when email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'prepared' end,
    case when email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end);
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_prepared','delay_notice:'||target_notice,
  jsonb_build_object('orders',(select count(*) from private.order_delay_notice_targets where notice_id=target_notice),'shipments',cardinality(ids),'channels',jsonb_build_array('in_app','email')));
 return public.admin_get_order_delay_notice(target_notice);
end $function$;

-- admin_preview_purchase_restriction_batch(uuid,text,text[],text,text)
CREATE OR REPLACE FUNCTION public.admin_preview_purchase_restriction_batch(p_batch_id uuid, p_mode text, p_inputs text[], p_reason_code text, p_reason_detail text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); existing private.purchase_restriction_batches; saved private.purchase_restriction_batches;
 payload jsonb; normalized_inputs text[]; reason text:=nullif(btrim(p_reason_detail),''); token text; n integer:=0; matches integer;
 target_user uuid; target_order uuid; customer public.profiles; active_id uuid; seen uuid[]:='{}'; seen_inputs text[]:='{}';
 row_status text; duplicate_of integer; rows jsonb:='[]'::jsonb;
begin
  perform private.require_operator_capability('sales.restrictions',false);

 if p_batch_id is null or p_mode is null or p_mode not in ('customer','order') or p_inputs is null or cardinality(p_inputs) not between 1 and 100
  or array_position(p_inputs,null) is not null or exists(select 1 from unnest(p_inputs) v where length(btrim(v)) not between 1 and 254 or v ~ '[[:cntrl:]]')
  or p_reason_code is null or p_reason_code not in ('repeated_purchase','verbal_abuse','business_interference','other')
  or reason is null or length(reason)>200
 then raise invalid_parameter_value using message='invalid_purchase_restriction_batch'; end if;
 select array_agg(lower(btrim(value)) order by position) into normalized_inputs from unnest(p_inputs) with ordinality x(value,position);
 payload:=jsonb_build_object('mode',p_mode,'inputs',normalized_inputs,'reasonCode',p_reason_code,'reasonDetail',reason);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into existing from private.purchase_restriction_batches where id=p_batch_id;
 if found then
  if existing.actor_id<>actor or existing.payload<>payload then raise exception using errcode='PT409',message='purchase_restriction_batch_request_conflict'; end if;
  return private.purchase_restriction_batch_json(existing,actor);
 end if;
 foreach token in array normalized_inputs loop
  n:=n+1; target_user:=null; target_order:=null; customer:=null; active_id:=null; duplicate_of:=null; row_status:='ready';
  if token=any(seen_inputs) then
   row_status:='duplicate'; duplicate_of:=array_position(seen_inputs,token);
  elsif p_mode='order' then
   if token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then row_status:='invalid_input';
   else
    select id,user_id into target_order,target_user from public.orders where id=token::uuid;
    if not found then row_status:='not_found'; end if;
   end if;
  else
   if token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and token !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then row_status:='invalid_input';
   else
    if token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     select id into target_user from public.profiles where id=token::uuid; matches:=case when found then 1 else 0 end;
    else
     select count(*),(array_agg(id order by id))[1] into matches,target_user from public.profiles where email is not null and lower(email)=token;
    end if;
    if matches=0 then row_status:='not_found'; target_user:=null;
    elsif matches>1 then row_status:='ambiguous'; target_user:=null; end if;
   end if;
  end if;
  if target_user is not null then
   select * into customer from public.profiles where id=target_user;
   if not found then row_status:='not_found';target_user:=null;
   elsif target_user=any(seen) then
    row_status:='duplicate';
    select (x->>'rowNumber')::integer into duplicate_of from jsonb_array_elements(rows)x where x->>'userId'=target_user::text order by (x->>'rowNumber')::integer limit 1;
   elsif customer.role<>'user' then row_status:='not_eligible';
   else
    select id into active_id from public.goods_purchase_restrictions where user_id=target_user and released_at is null;
    if found then row_status:='already_active'; end if;
   end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('rowNumber',n,'input',token,'userId',target_user,'nickname',customer.nickname,
   'maskedEmail',case when customer.email is null then null else left(split_part(customer.email,'@',1),1)||'***@'||split_part(customer.email,'@',2) end,
   'evidenceOrderId',target_order,'status',row_status,'duplicateOf',duplicate_of,'restrictionId',active_id,'outcome',null,'error',null));
  seen_inputs:=array_append(seen_inputs,token); if target_user is not null then seen:=array_append(seen,target_user); end if;
 end loop;
 insert into private.purchase_restriction_batches(id,actor_id,payload,preview) values(p_batch_id,actor,payload,rows) returning * into saved;
 return private.purchase_restriction_batch_json(saved,actor);
end $function$;

-- admin_preview_shipping_settings_template(uuid,text[])
CREATE OR REPLACE FUNCTION public.admin_preview_shipping_settings_template(p_template_id uuid, p_good_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare template public.shipping_settings_templates; origin public.fulfillment_origins; rows jsonb; goods_count integer;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where char_length(id) not between 1 and 120)
  or (select count(distinct id) from unnest(p_good_ids) id)<>cardinality(p_good_ids)
 then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 select * into template from public.shipping_settings_templates where id=p_template_id and enabled;
 if not found then raise check_violation using message='shipping_settings_template_unavailable'; end if;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid and is_active;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 select count(*),jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'updatedAt',g.updated_at,
  'before',private.good_shipping_settings(g),'after',template.settings) order by g.id) into goods_count,rows
 from public.goods g where g.id=any(p_good_ids) and g.archived_at is null;
 if goods_count<>cardinality(p_good_ids) then raise check_violation using message='shipping_settings_goods_unavailable'; end if;
 return jsonb_build_object('template',private.shipping_settings_template_json(template),'goods',rows,
  'origin',jsonb_build_object('id',origin.id,'name',origin.name,'updatedAt',origin.updated_at,'baseFee',origin.base_fee,
   'freeThreshold',origin.free_threshold,'returnAddress',origin.return_address,'defaultCarrier',origin.default_carrier));
end $function$;

-- admin_preview_store_credit_batch(uuid,text[],bigint,timestamp with time zone,text,text)
CREATE OR REPLACE FUNCTION public.admin_preview_store_credit_batch(p_id uuid, p_targets text[], p_amount bigint, p_expires_at timestamp with time zone, p_reason text, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; policy private.store_credit_policy; previous private.store_credit_batches; payload jsonb; rows jsonb:='[]';
 target text; matched uuid; matches integer; balance jsonb; issue text; seen uuid[]:='{}'; invalid integer:=0; offset_total bigint:=0; result jsonb;
begin
  perform private.require_operator_capability('marketing.manage',true);

 actor:=private.assert_store_credit_admin();
 if p_id is null or coalesce(cardinality(p_targets),0) not between 1 and 1000 or p_amount is null or p_amount not between 1 and 999999999999
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_purpose is null or p_purpose not in ('promotion','general')
  or exists(select 1 from unnest(p_targets) t where t is null or length(btrim(t)) not between 1 and 200)
  then raise invalid_parameter_value using message='store_credit_batch_invalid'; end if;
 payload:=jsonb_build_object('targets',to_jsonb(p_targets),'amount',p_amount,'expiresAt',p_expires_at,'reason',btrim(p_reason),'purpose',p_purpose);
 perform pg_advisory_xact_lock(hashtextextended('store_credit_batch:'||p_id::text,0));
 select * into previous from private.store_credit_batches where id=p_id;
 if found then
  if previous.actor_id<>actor or previous.payload is distinct from payload then raise exception using errcode='PT409',message='store_credit_batch_conflict'; end if;
  return previous.result;
 end if;
 select * into policy from private.store_credit_policy where singleton for share;
 if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
 if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+make_interval(days=>policy.validity_days)
  then raise check_violation using message='store_credit_expiry_invalid'; end if;
 foreach target in array p_targets loop
  issue:=null; matched:=null; balance:='{"available":0,"reserved":0,"debt":0}';
  select count(*), (array_agg(id order by id))[1] into matches,matched from public.profiles where id::text=btrim(target) or lower(email)=lower(btrim(target));
  if matches<>1 then issue:='customer_not_found';
  elsif matched=any(seen) then issue:='duplicate_customer';
  else
   seen:=array_append(seen,matched); balance:=private.store_credit_preview_balance(matched);
   if exists(select 1 from public.profiles where id=matched and suspended_at is not null) or exists(select 1 from private.account_action_fences fence where fence.subject_user_id=matched) then issue:='customer_unavailable';
   elsif p_amount>(balance->>'debt')::bigint and (balance->>'available')::bigint+(balance->>'reserved')::bigint+p_amount-(balance->>'debt')::bigint>policy.max_balance then issue:='store_credit_balance_limit'; end if;
  end if;
  if issue is not null then invalid:=invalid+1; else offset_total:=offset_total+least(p_amount,(balance->>'debt')::bigint); end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('target',target,'userId',matched,'nickname',(select nickname from public.profiles where id=matched),
   'error',issue,'balance',balance,'offset',case when issue is null then least(p_amount,(balance->>'debt')::bigint) else 0 end));
 end loop;
 result:=jsonb_build_object('id',p_id,'status',case when invalid>0 then 'invalid' else 'prepared' end,'purpose',p_purpose,'reason',btrim(p_reason),
  'amount',p_amount,'expiresAt',p_expires_at,'count',cardinality(p_targets),'invalidCount',invalid,'gross',p_amount*cardinality(p_targets),
  'offset',offset_total,'net',p_amount*cardinality(p_targets)-offset_total,'rows',rows,'createdAt',clock_timestamp(),'error',null);
 if invalid=0 then
  insert into private.store_credit_batches(id,actor_id,purpose,amount,reason,expires_at,policy_version,payload,result)
   values(p_id,actor,p_purpose,p_amount,btrim(p_reason),p_expires_at,policy.version,payload,result);
  insert into private.store_credit_batch_recipients(batch_id,user_id,operation_id,expected_balance)
   select p_id,(r->>'userId')::uuid,extensions.gen_random_uuid(),r->'balance' from jsonb_array_elements(rows) r;
 end if;
 return result;
end $function$;

-- admin_profile_signup_counts(timestamp with time zone,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_profile_signup_counts(target_previous_start timestamp with time zone, target_current_start timestamp with time zone, target_current_end timestamp with time zone)
 RETURNS TABLE(previous_count bigint, current_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('stats.read',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_previous_start is null
    or target_current_start is null
    or target_current_end is null
    or target_previous_start >= target_current_start
    or target_current_start >= target_current_end
  then
    raise exception 'invalid_signup_window' using errcode = '22023';
  end if;

  return query
  select
    pg_catalog.count(*) filter (
      where profile.created_at >= target_previous_start
        and profile.created_at < target_current_start
    )::bigint,
    pg_catalog.count(*) filter (
      where profile.created_at >= target_current_start
        and profile.created_at < target_current_end
    )::bigint
  from public.profiles as profile;
end;
$function$;

-- admin_read_goods_additional(text)
CREATE OR REPLACE FUNCTION public.admin_read_goods_additional(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if not exists(select 1 from public.goods where id=p_good_id) then raise no_data_found using message='good_not_found'; end if;
  return jsonb_build_object('revision',(select revision from private.goods_additional_sets where good_id=p_good_id),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('goodId',good.id,'name',good.name,
      'available',private.goods_additional_available(good.id)) order by link.sort_order),'[]'::jsonb)
      from private.goods_additional_links link join public.goods good on good.id=link.target_good_id where link.base_good_id=p_good_id));
end $function$;

-- admin_read_goods_kc(text)
CREATE OR REPLACE FUNCTION public.admin_read_goods_kc(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare good public.goods; review private.goods_kc_reviews;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into review from private.goods_kc_reviews where good_id=p_good_id;
  return jsonb_build_object('revision',review.revision,'status',coalesce(review.status,'unreviewed'),'models',coalesce(review.models,'[]'),
    'publishedAt',good.published_at,'archivedAt',good.archived_at,'reviewedAt',review.reviewed_at,
    'reviewerName',(select nickname from public.profiles where id=review.reviewed_by),
    'contextFingerprint',private.goods_kc_fingerprint(p_good_id),
    'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'code',variant.code,'name',variant.name,'active',variant.archived_at is null)
      order by variant.sort_order,variant.id),'[]') from public.goods_variants variant where variant.good_id=p_good_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',event.revision,'status',event.snapshot->>'status',
      'changedAt',event.changed_at,'actorName',actor.nickname,'reason',event.reason) order by event.revision desc),'[]')
      from (select * from private.goods_kc_review_events where good_id=p_good_id order by revision desc limit 20) event
      left join public.profiles actor on actor.id=event.actor_id));
end $function$;

-- admin_read_goods_readiness(text)
CREATE OR REPLACE FUNCTION public.admin_read_goods_readiness(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  return (select private.admin_goods_readiness(good) from public.goods good where id=p_good_id);
end $function$;

-- admin_read_settled_export(uuid)
CREATE OR REPLACE FUNCTION public.admin_read_settled_export(p_export_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare receipt private.settled_export_receipts;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 select * into receipt from private.settled_export_receipts where id=p_export_id and actor_id=(select auth.uid());
 if not found then raise no_data_found using message='settled_export_not_found'; end if;
 return receipt.payload||jsonb_build_object('receiptId',receipt.id);
end $function$;

-- admin_read_shipment_delivery(uuid)
CREATE OR REPLACE FUNCTION public.admin_read_shipment_delivery(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare shipment public.order_shipments; purchase public.orders; has_claim boolean;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
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
end $function$;

-- admin_read_shipment_preorder_promise(uuid)
CREATE OR REPLACE FUNCTION public.admin_read_shipment_preorder_promise(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('sales.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'status',shipment.status,
    'originalExpectedShipDate',shipment.original_expected_ship_date,'expectedShipDate',shipment.expected_ship_date,'updatedAt',shipment.updated_at,
    'changes',public.admin_list_shipment_promise_changes(shipment.id)) from public.order_shipments shipment where shipment.id=p_shipment_id);
end $function$;

-- admin_reassign_inquiry(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.admin_reassign_inquiry(target_inquiry_id uuid, target_assignee_id uuid, target_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_before uuid;
  v_reason text := btrim(coalesce(target_reason, ''), E' \t\n\r');
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_assignee_id]);
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise invalid_parameter_value using message = 'invalid_assignment_reason';
  end if;
  select thread.assignee_id into v_before from public.inquiries as thread
    where thread.id = target_inquiry_id for update;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  if target_assignee_id is not null then
    perform 1 from public.profiles as profile
      where profile.id = target_assignee_id and private.has_operator_capability(profile.id,'cs.manage') for share;
    if not found then raise invalid_parameter_value using message = 'invalid_inquiry_assignee'; end if;
  end if;
  if v_before is not distinct from target_assignee_id then return false; end if;
  update public.inquiries set assignee_id = target_assignee_id where id = target_inquiry_id;
  insert into public.audit_log(actor_id, action, target, diff)
    values (v_actor, 'admin.inquiry.reassigned', 'inquiries:' || target_inquiry_id::text,
      jsonb_build_object('before', v_before, 'after', target_assignee_id, 'reason', v_reason));
  return true;
end;
$function$;

-- admin_recalculate_loyalty_grade(uuid)
CREATE OR REPLACE FUNCTION public.admin_recalculate_loyalty_grade(p_user_id uuid)
 RETURNS loyalty_grade
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),p_user_id]);
  perform private.require_operator_capability('marketing.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return private.recalculate_loyalty_grade(p_user_id);
end;
$function$;

-- admin_record_list_export(text,jsonb,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_record_list_export(p_screen text, p_filters jsonb, p_row_count integer, p_record_count integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  recorded_id uuid;
begin
  perform private.require_operator_capability(case when p_screen='orders' then 'sales.read' else 'sales.manage' end,false);

  if actor is null or not public.has_operator_capability(case when p_screen='orders' then 'sales.read' else 'sales.manage' end,false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_screen is null or p_screen not in (
    'orders', 'unpaid', 'dispatch', 'shipping',
    'claims-cancels', 'claims-returns', 'claims-exchanges'
  ) then
    raise invalid_parameter_value using message = 'invalid_list_export_screen';
  end if;

  -- 조건은 화면이 정규화한 작은 객체다. 임의 크기의 문서를 감사 로그에 싣지 않는다.
  if p_filters is null
    or jsonb_typeof(p_filters) <> 'object'
    or octet_length(p_filters::text) > 2000
    or exists (
      select 1
      from jsonb_each(p_filters) as field(key, value)
      where length(field.key) > 40
        or jsonb_typeof(field.value) not in ('string', 'null')
    )
  then
    raise invalid_parameter_value using message = 'invalid_list_export_filters';
  end if;

  -- 앱의 한 파일 상한(10,000행)과 같은 값이다. 기록 건수가 행 수보다 많을 수 없다.
  if p_row_count is null or p_row_count not between 0 and 10000
    or p_record_count is null or p_record_count not between 0 and p_row_count
  then
    raise invalid_parameter_value using message = 'invalid_list_export_count';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor,
    'admin.list_export.downloaded',
    'admin_screen:' || p_screen,
    jsonb_build_object(
      'screen', p_screen,
      'filters', p_filters,
      'rowCount', p_row_count,
      'recordCount', p_record_count
    )
  )
  returning id into recorded_id;

  return recorded_id;
end;
$function$;

-- admin_record_order_claim_collection(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_collection(p_claim_id uuid, p_stage text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_stage not in ('collecting', 'collected') then
    raise check_violation using message = 'invalid collection stage';
  end if;

  perform o.id from public.orders o join public.order_cancellation_requests c on c.order_id=o.id where c.id=p_claim_id for update of o;
  perform s.id from public.order_shipments s join public.order_cancellation_requests c on c.order_id=s.order_id where c.id=p_claim_id order by s.id for update of s;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  if v_claim.collection_policy='origin' and p_stage='collected' then raise check_violation using message='origin_collection_required'; end if;

  if v_claim.claim_type = 'cancel' then
    raise exception using message = 'claim_type_has_no_collection';
  end if;

  -- 수거 시작은 승인이 이미 만든다. 같은 값으로 다시 부르면 멱등하게 통과하고,
  -- 그 밖의 단계에서 부르면 거절한다 — 뒤로 감는 전이를 만들지 않는다.
  if p_stage = 'collecting' then
    if v_claim.stage = 'collecting' then
      return 'collecting';
    end if;
    raise exception using message = 'claim_not_collectable';
  end if;

  if v_claim.stage = 'collected' then
    return 'collected';
  end if;
  if v_claim.stage <> 'collecting' then
    raise exception using message = 'claim_not_collectable';
  end if;

  update public.order_cancellation_requests
  set
    stage = p_stage,
    collected_at = case when p_stage = 'collected' then now() else collected_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_collected',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', p_stage
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'collected',
    '반송한 굿즈가 입고됐어요',
    case
      when v_claim.claim_type = 'exchange'
        then '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.'
      else '입고가 확인됐습니다. 영업일 기준 3일 이내에 환급 절차를 진행합니다.'
    end
  );

  return p_stage;
end;
$function$;

-- admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_operational_fee(p_claim_id uuid, p_fee_kind text, p_amount bigint, p_note text, p_evidence text, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  previous public.order_cancellation_requests;
  saved public.order_cancellation_requests;
  normalized_note text := nullif(btrim(coalesce(p_note, '')), '');
  normalized_evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
  normalized_kind text := nullif(btrim(coalesce(p_fee_kind, '')), '');
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message = 'staff_required'; end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 1000000) then
    raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
  end if;
  if p_amount is null then
    if normalized_kind is not null or normalized_note is not null or normalized_evidence is not null then
      raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
    end if;
  elsif normalized_kind not in ('return_shipping','exchange_shipping','other')
    or normalized_note is null or char_length(normalized_note) > 500
    or normalized_evidence is null or char_length(normalized_evidence) > 1000
    or private.has_disallowed_shipping_notice_control(normalized_note)
    or private.has_disallowed_shipping_notice_control(normalized_evidence) then
    raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
  end if;
  select * into previous from public.order_cancellation_requests where id = p_claim_id for update;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  if p_expected_updated_at is null or previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'claim_operational_fee_conflict';
  end if;
  update public.order_cancellation_requests set
    operational_fee_kind = normalized_kind,
    operational_fee_amount = p_amount,
    operational_fee_note = normalized_note,
    operational_fee_evidence = normalized_evidence,
    operational_fee_confirmed_by = case when p_amount is null then null else actor end,
    operational_fee_confirmed_at = case when p_amount is null then null else clock_timestamp() end
    where id = p_claim_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'admin.order.claim_operational_fee_recorded', 'order:' || saved.order_id::text,
      jsonb_build_object('claimId', saved.id, 'before', jsonb_build_object(
        'kind', previous.operational_fee_kind, 'amount', previous.operational_fee_amount,
        'note', previous.operational_fee_note, 'evidence', previous.operational_fee_evidence
      ), 'after', jsonb_build_object(
        'kind', saved.operational_fee_kind, 'amount', saved.operational_fee_amount,
        'note', saved.operational_fee_note, 'evidence', saved.operational_fee_evidence
      )));
  return jsonb_build_object('claimId', saved.id, 'kind', saved.operational_fee_kind,
    'amount', saved.operational_fee_amount, 'note', saved.operational_fee_note,
    'evidence', saved.operational_fee_evidence, 'confirmedBy', saved.operational_fee_confirmed_by,
    'confirmedAt', saved.operational_fee_confirmed_at, 'updatedAt', saved.updated_at);
end;
$function$;

-- admin_record_order_claim_origin_collection(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_origin_collection(p_claim_id uuid, p_shipment_id uuid, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());claim public.order_cancellation_requests;collection public.order_claim_collections;order_key uuid;address_value text;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 1 and 500 or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
   raise check_violation using message='invalid_collection_evidence'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found'; end if;
 perform id from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.collection_policy<>'origin' or not claim.collection_required then raise check_violation using message='claim_type_has_no_collection'; end if;
 select * into collection from public.order_claim_collections where claim_id=p_claim_id and shipment_id=p_shipment_id for update;
 if not found then raise no_data_found using message='claim_collection_not_found'; end if;
 if collection.collected_at is not null then
   if collection.evidence=p_evidence then return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end; end if;
   raise unique_violation using message='claim_collection_conflict';
 end if;
 if claim.stage not in ('collecting','collected','processing','needs_review') then raise exception using message='claim_not_collectable'; end if;
 address_value:=collection.return_address_snapshot;
 if btrim(address_value)='' then
   select return_address into address_value from public.fulfillment_origins where id=collection.origin_id for share;
   if coalesce(btrim(address_value),'')='' then raise check_violation using message='claim_return_address_required'; end if;
 end if;
 update public.order_claim_collections set return_address_snapshot=address_value,collected_at=clock_timestamp(),collected_by=actor,evidence=p_evidence
 where claim_id=p_claim_id and shipment_id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_origin_collected','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'shipmentId',p_shipment_id,'originId',collection.origin_id,'items',collection.items_snapshot,'returnAddress',address_value,'evidence',p_evidence));
 if private.claim_collections_complete(p_claim_id) then
   update public.order_cancellation_requests set collected_at=coalesce(collected_at,clock_timestamp()),
     stage=case when stage='collecting' then 'collected' else stage end,updated_at=clock_timestamp() where id=p_claim_id returning * into claim;
   perform private.notify_order_claim(p_claim_id,'collected','반송한 굿즈가 모두 입고됐어요','모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.');
 end if;
 return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end;
end $function$;

-- admin_record_order_claim_refund(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_refund(p_claim_id uuid, p_method text, p_stage text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_order_status public.order_status;
  v_refund_count integer;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_method not in ('pg_cancel', 'bank_transfer') then
    raise check_violation using message = 'invalid refund method';
  end if;
  if p_stage not in ('filed', 'completed') then
    raise check_violation using message = 'invalid refund stage';
  end if;
  if p_note is not null
    and (btrim(p_note) <> p_note or length(p_note) not between 1 and 300)
  then
    raise check_violation using message = 'invalid settlement note';
  end if;

  select request.order_id
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  select orders.status
  into v_order_status
  from public.orders
  where orders.id = v_claim.order_id
  for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  perform private.assert_claim_collections_complete(p_claim_id);

  if v_claim.claim_type = 'exchange' then
    raise exception using message = 'exchange_has_no_refund';
  end if;

  /*
   * 계좌 송금은 받아 둔 계좌가 있을 때만 적을 수 있다.
   *
   * 없는 계좌로 'bank_transfer'를 기록하면 원장은 송금했다고 말하고 구매자에게는
   * "등록하신 환불계좌로 송금을 접수했습니다"가 나간다 — 존재하지 않는 계좌를
   * 근거로 한 안내다. 파기된 행(purged_at)은 통과시킨다: 수집 사실은 남아 있고,
   * 그때 송금은 실제로 그 계좌로 갔다.
   */
  if p_method = 'bank_transfer'
    and not exists (
      select 1
      from private.claim_refund_accounts as account
      where account.claim_id = p_claim_id
    )
  then
    raise exception using message = 'claim_refund_account_missing';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id
  order by payment.id
  for update;

  if p_stage = 'filed' then
    if v_claim.stage not in ('collected', 'processing') then
      raise exception using message = 'claim_not_refundable';
    end if;

    -- 반품은 입고가 확인된 뒤에야 durable claim이 생긴다. 그 전에 만들면
    -- 물건이 돌아오지 않은 주문의 재고가 복원 대기 상태로 열린다.
    if v_claim.stage = 'collected' then
      insert into public.order_cancellation_claims (
        order_id,
        requested_by,
        previous_status
      )
      values (v_claim.order_id, v_claim.requested_by, v_order_status)
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
        v_claim.reason,
        case when refund.status = 'done' then 'done' else 'requested' end,
        p_claim_id
      from public.payments as payment
      left join public.refunds as refund on refund.payment_id = payment.id
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
        and payment.status in ('pending', 'paid', 'canceled', 'refunded')
      on conflict (payment_id) do update
      set
        cancellation_request_id = excluded.cancellation_request_id,
        reason = coalesce(public.refunds.reason, excluded.reason),
        status = case
          when public.refunds.status = 'done' then 'done'
          else 'requested'
        end;

      update public.order_cancellation_requests
      set
        stage = 'processing',
        provider_started_at = coalesce(provider_started_at, now()),
        updated_at = now()
      where id = p_claim_id;
    end if;

    -- 수단·처리자·접수시각은 첫 기록이 이긴다. 재접수가 덮으면 이미 계좌로 송금한
    -- 건이 결제사 취소로 보이고, 실제로 접수한 사람이 마지막 클릭한 사람으로 바뀐다.
    -- 갱신 가능한 것은 상계·정산 메모뿐이다.
    update public.refunds as refund
    set
      method = coalesce(refund.method, p_method),
      handled_by = coalesce(refund.handled_by, v_actor),
      filed_at = coalesce(refund.filed_at, now()),
      settlement_note = coalesce(p_note, refund.settlement_note)
    from public.payments as payment
    where refund.payment_id = payment.id
      and payment.purpose = 'order'
      and payment.ref_id = v_claim.order_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_refund_filed',
      'order:' || v_claim.order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'method', p_method,
        'from', v_claim.stage,
        'to', 'processing'
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'refund_filed',
      '환불 접수가 완료됐어요',
      case
        when p_method = 'bank_transfer'
          then '등록하신 환불계좌로 송금을 접수했습니다.'
        else '결제사에 결제 취소를 접수했습니다. 카드사 처리 일정에 따라 반영 시점이 다를 수 있습니다.'
      end
    );

    return 'filed';
  end if;

  -- 완료 기록.
  if v_claim.stage <> 'completed' then
    raise exception using message = 'claim_refund_finalization_required';
  end if;

  update public.refunds as refund
  set
    method = coalesce(refund.method, p_method),
    handled_by = coalesce(refund.handled_by, v_actor),
    completed_at = coalesce(refund.completed_at, now()),
    settlement_note = coalesce(p_note, refund.settlement_note)
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id;

  get diagnostics v_refund_count = row_count;

  -- 환불 원장이 한 줄도 없는 완료는 "돈은 돌아갔는데 장부가 비었다"는 뜻이다.
  -- 첫 판매 리스크 목록이 지적한 그 상태를 여기서 막는다.
  if v_refund_count = 0 then
    raise exception using message = 'claim_refund_ledger_missing';
  end if;

  -- 환불계좌 파기 기한은 여기서 잡지 않는다. 클레임이 종결 stage에 닿는 순간
  -- private.seal_order_claim_refund_account가 이미 잡았다 — 거절·교환·레거시
  -- 완료까지 같은 규칙을 받으려면 판정이 한 곳에 있어야 한다.

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_refund_completed',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'method', p_method,
      'refundRows', v_refund_count,
      'settlementNote', p_note
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'refund_completed',
    '환불이 완료됐어요',
    '환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.'
  );

  return 'completed';
end;
$function$;

-- admin_record_order_claim_reshipment(uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);
return (select public.admin_record_order_claim_reshipment(p_claim_id,p_carrier,p_tracking_number,'[]'::jsonb));
end;
$function$;

-- admin_record_order_claim_reshipment(uuid,text,text,jsonb)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid()); selected_order uuid; order_status public.order_status;
  claim public.order_cancellation_requests; item record; selected_variant uuid; source_variant uuid;
  variant public.goods_variants; carrier text:=nullif(btrim(p_carrier),''); tracking text:=nullif(btrim(p_tracking_number),'');
  selections jsonb; requested jsonb; shipped_items jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
  if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items'; end if;
  for requested in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
      or (select count(*) from jsonb_object_keys(requested))<>2
      or (requested->>'orderItemId') is null or (requested->>'variantId') is null
      or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise check_violation using message='invalid reshipment items'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
    raise check_violation using message='invalid reshipment items';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
    order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
  select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Cancellation, payment finalization and claim operations all lock order first.
  select status into order_status from public.orders where id=selected_order for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment'; end if;
  if claim.stage='completed' then
    if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
      select 1 from jsonb_array_elements(selections) selected where not exists(
        select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
          and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
      then return 'completed'; end if;
    raise unique_violation using message='reshipment_conflict';
  end if;
  perform private.assert_claim_collections_complete(p_claim_id);
  if claim.stage<>'collected' or order_status not in('delivered','done')
    or exists(select 1 from public.order_cancellation_claims where order_id=selected_order)
    then raise exception using message='claim_not_reshippable'; end if;
  if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier'; end if;
  if exists(select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_items oi where oi.id=(selected->>'orderItemId')::uuid and oi.order_id=selected_order)) then
    raise check_violation using message='invalid reshipment items';
  end if;
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where order_id=selected_order) order by g.id for update;
  for item in select * from public.order_items where order_id=selected_order order by good_id,id loop
    source_variant:=private.order_item_stock_variant(item.id);
    select (selected->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) selected where (selected->>'orderItemId')::uuid=item.id;
    selected_variant:=coalesce(selected_variant,source_variant);
    select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
    if not found or (variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable'; end if;
    insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
      values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty);
  end loop;
  -- Net all returned/shipped options first. A two-line blue/red swap also works
  -- with no spare stock; every recovered unit belongs to this collected claim.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from (
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where claim_id=p_claim_id
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where claim_id=p_claim_id
  ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $function$;

-- admin_record_order_claim_reshipment_delivery(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment_delivery(p_claim_id uuid, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid());
  order_key uuid;
  claim public.order_cancellation_requests;
  observed_at timestamptz;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message='staff required';
  end if;
  if p_evidence is null or p_evidence<>btrim(p_evidence)
    or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise check_violation using message='invalid_reshipment_delivery_evidence';
  end if;
  select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Same parent-first ordering as intake and reshipment: concurrent confirmation
  -- cannot reopen intake against a different replacement transaction.
  perform id from public.orders where id=order_key for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  observed_at:=clock_timestamp();
  if claim.claim_type<>'exchange' or claim.stage<>'completed' or claim.reshipped_at is null
    or claim.reship_carrier is null or btrim(claim.reship_carrier)=''
    or claim.reship_tracking_number is null or btrim(claim.reship_tracking_number)=''
    or claim.reshipped_at>observed_at then
    raise check_violation using message='claim_reshipment_not_dispatched';
  end if;
  if claim.reship_delivered_at is not null then
    if claim.reship_delivered_by=actor and claim.reship_delivery_evidence=p_evidence then return 'delivered'; end if;
    raise unique_violation using message='reshipment_delivery_conflict';
  end if;
  update public.order_cancellation_requests
    set reship_delivered_at=observed_at,reship_delivered_by=actor,reship_delivery_evidence=p_evidence
    where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'admin.order.claim_reshipment_delivered','order:'||order_key::text,
      jsonb_build_object('claimId',p_claim_id,'reshippedAt',claim.reshipped_at,
        'reshipDeliveredAt',observed_at,'evidence',p_evidence));
  return 'delivered';
end $function$;

-- admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)
CREATE OR REPLACE FUNCTION public.admin_record_shipment_delivery(p_shipment_id uuid, p_kind text, p_evidence jsonb, p_receipt_code text, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; operation private.shipment_delivery_operations;
  confirmation private.shipment_receipt_confirmations; evidence jsonb:='{}'; field text; allowed_fields text[]; occurred timestamptz;
  value text; confirmation_value text:=upper(regexp_replace(coalesce(p_receipt_code,''),'[[:space:]-]','','g'));
  fingerprint bytea; instant timestamptz; next_status text; max_length integer;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
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
end $function$;

-- admin_register_purchase_restriction(uuid,uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.admin_register_purchase_restriction(p_request_id uuid, p_user_id uuid, p_reason_code text, p_reason_detail text, p_evidence_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());existing public.goods_purchase_restrictions;detail text:=nullif(btrim(p_reason_detail),'');
begin
  perform private.require_operator_capability('sales.restrictions',false);

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
end $function$;

-- admin_release_purchase_restriction(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_release_purchase_restriction(p_restriction_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());existing public.goods_purchase_restrictions;detail text:=nullif(btrim(p_reason),'');target_user uuid;
begin
  perform private.require_operator_capability('sales.restrictions',false);

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
end $function$;

-- admin_reply_reviews_batch(uuid,jsonb,text)
CREATE OR REPLACE FUNCTION public.admin_reply_reviews_batch(p_request_id uuid, p_items jsonb, p_reply text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); reply_value text:=btrim(coalesce(p_reply,'')); payload jsonb;
 previous private.review_reply_batches; entry jsonb; current_review public.reviews;
 target_id uuid; expected_reply_at timestamptz; expected_edited_at timestamptz;
 results jsonb:='[]'; outcome jsonb; result jsonb; failure_code text;
begin
  perform private.require_operator_capability('cs.manage',false);

 if actor is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 if jsonb_array_length(p_items) not between 1 and 50 or char_length(reply_value) not between 5 and 1000 then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 for entry in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(entry)<>'object' or not(entry ?& array['id','expectedReplyAt','expectedEditedAt','expectedStatus'])
     or exists(select 1 from jsonb_object_keys(entry) key where key not in ('id','expectedReplyAt','expectedEditedAt','expectedStatus'))
     or jsonb_typeof(entry->'id')<>'string' or entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(entry->'expectedReplyAt') not in ('string','null') or jsonb_typeof(entry->'expectedEditedAt') not in ('string','null')
     or entry->>'expectedStatus' is null or entry->>'expectedStatus' not in ('visible','hidden') then
     raise invalid_parameter_value using message='invalid_review_batch';
   end if;
   begin expected_reply_at:=(entry->>'expectedReplyAt')::timestamptz; expected_edited_at:=(entry->>'expectedEditedAt')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_review_batch'; end;
 end loop;
 if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 select jsonb_build_object('reply',reply_value,'items',jsonb_agg(value order by (value->>'id')::uuid)) into payload from jsonb_array_elements(p_items);
 perform pg_advisory_xact_lock(hashtextextended('review_reply_batch:'||actor::text||':'||p_request_id::text,0));
 select * into previous from private.review_reply_batches where actor_id=actor and request_id=p_request_id;
 if found then
   if previous.payload<>payload then raise sqlstate 'PT409' using message='review_batch_request_changed'; end if;
   return previous.result;
 end if;
 -- All batches lock rows in the same order; per-item subtransactions keep a
 -- deleted/stale target from discarding other successful replies.
 for entry in select value from jsonb_array_elements(payload->'items') loop
   target_id:=(entry->>'id')::uuid;
   begin
     select * into current_review from public.reviews where id=target_id for update;
     if not found then raise no_data_found using message='review_not_found'; end if;
     expected_reply_at:=(entry->>'expectedReplyAt')::timestamptz; expected_edited_at:=(entry->>'expectedEditedAt')::timestamptz;
     if current_review.admin_reply_at is distinct from expected_reply_at
       or current_review.edited_at is distinct from expected_edited_at or current_review.status::text<>entry->>'expectedStatus' then
       raise sqlstate 'PT409' using message='review_changed';
     end if;
     if current_review.admin_reply is not distinct from reply_value then
       outcome:=jsonb_build_object('reviewId',target_id,'status','unchanged','code',null);
     else
       perform public.admin_reply_to_review(target_id,reply_value);
       outcome:=jsonb_build_object('reviewId',target_id,'status','saved','code',null);
     end if;
   exception when others then
     failure_code:=case sqlerrm when 'review_not_found' then 'review_not_found' when 'review_changed' then 'review_changed'
       when 'staff_required' then 'staff_required' when 'invalid_review_reply' then 'invalid_review_reply' else 'save_failed' end;
     outcome:=jsonb_build_object('reviewId',target_id,'status','failed','code',failure_code,'databaseCode',sqlstate);
   end;
   results:=results||jsonb_build_array(outcome);
 end loop;
 result:=jsonb_build_object('requestId',p_request_id,'items',results);
 insert into private.review_reply_batches(actor_id,request_id,payload,result) values(actor,p_request_id,payload,result);
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.review.batch_replied','review_reply_batches:'||p_request_id::text,result);
 return result;
end $function$;

-- admin_reply_to_review(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_reply_to_review(target_review_id uuid, target_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reply text := btrim(coalesce(target_reply, ''));
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
  v_link text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reply) not between 2 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_reply';
  end if;

  select review.user_id, review.good_id, review.admin_reply
    into v_user_id, v_good_id, v_previous
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  update public.reviews
  set
    admin_reply = v_reply,
    admin_reply_at = now(),
    admin_reply_by = v_actor
  where id = target_review_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.reply',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'replyLength', char_length(v_reply)
    )
  );

  -- 굿즈 id는 카탈로그 슬러그지만 링크로 쓰기 전에 형태를 확인한다. link_path
  -- CHECK가 제어문자·역슬래시를 막긴 해도, 이상한 id 하나 때문에 답글 저장
  -- 전체가 실패하는 것보다 안전한 목적지로 접는 편이 낫다.
  v_link := case
    when v_good_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then '/shop/' || v_good_id
    else '/my/reviews'
  end;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_user_id,
    'review_replied',
    '리뷰에 답글이 달렸어요',
    /* body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답글
       저장까지 함께 되돌아간다 — 이름을 잘라서라도 답글은 남긴다. */
    left(coalesce(v_good_name, '굿즈'), 100) || ' 리뷰에 ICONS 운영자가 답글을 남겼습니다.',
    v_link,
    'review',
    target_review_id::text,
    'review_replied:' || target_review_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$function$;

-- admin_request_email_resend(text)
CREATE OR REPLACE FUNCTION public.admin_request_email_resend(p_dedupe_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_dedupe_key, ''), E' \t\n\r\f\v'), '');
  v_template text;
  v_status text;
  v_attempt_count integer;
  v_order_id text;
  v_order_status text;
  v_shipment_id text;
  v_shipment_status text;
begin
  perform private.require_operator_capability('marketing.manage',false);

  if v_actor is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_key is null then
    raise check_violation using message = 'invalid_dedupe_key';
  end if;

  select delivery.template, delivery.status, delivery.attempt_count
  into v_template, v_status, v_attempt_count
  from public.email_deliveries as delivery
  where delivery.dedupe_key = v_key
  for update;

  if not found then
    raise no_data_found using message = 'email_delivery_not_found';
  end if;

  if v_status = 'sent' then
    raise check_violation using message = 'email_already_sent';
  end if;

  -- 주문 메일이 아닌 템플릿은 이 게이트가 판정할 근거가 없다. 문의 답변 메일의
  -- 재발송 경로는 운영자가 문의 상세에서 답변을 다시 등록하는 것이다.
  if v_template not in ('order_confirmation', 'order_shipped') then
    raise check_violation using message = 'email_delivery_not_resendable';
  end if;

  -- dedupe_key는 '<template>:<order uuid>'다(lib/email/dedupe.ts).
  if split_part(v_key,':',1)<>v_template
    or (v_template='order_confirmation' and array_length(string_to_array(v_key,':'),1)<>2)
    or (v_template='order_shipped' and array_length(string_to_array(v_key,':'),1) not in (2,3)) then
    raise check_violation using message='email_delivery_target_unresolved';
  end if;
  v_order_id := split_part(v_key, ':', 2);
  if v_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise check_violation using message = 'email_delivery_target_unresolved';
  end if;

  select target.status::text
  into v_order_status
  from public.orders as target
  where target.id = lower(v_order_id)::uuid;

  if not found then
    raise no_data_found using message = 'order_missing';
  end if;

  if v_template='order_shipped' then
    v_shipment_id:=nullif(split_part(v_key,':',3),'');
    if v_shipment_id is null then
      select case when count(*)=1 then min(id::text) end into v_shipment_id from public.order_shipments where order_id=lower(v_order_id)::uuid;
    end if;
    if v_shipment_id is null or v_shipment_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or array_length(string_to_array(v_key,':'),1)>3 then
      raise check_violation using message='email_delivery_target_unresolved';
    end if;
    select status into v_shipment_status from public.order_shipments where id=v_shipment_id::uuid and order_id=lower(v_order_id)::uuid;
    if not found or v_shipment_status not in ('shipping','delivered') then
      raise check_violation using message='email_no_longer_accurate';
    end if;
  end if;

  -- 본문이 지금도 사실인 상태에서만 통과시킨다.
  -- lib/email/transactional.server.ts의 ACCURATE_ORDER_STATUSES와 같은 집합이다.
  if v_template = 'order_confirmation'
    and v_order_status not in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;
  if v_template = 'order_shipped'
    and v_order_status not in ('shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count,
      'orderStatus', v_order_status
    )
  );

  return v_template;
end;
$function$;

-- admin_request_order_delay_notice(uuid)
CREATE OR REPLACE FUNCTION public.admin_request_order_delay_notice(target_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());n private.order_delay_notices%rowtype;t private.order_delay_notice_targets%rowtype;notification uuid;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 select * into n from private.order_delay_notices where id=target_notice for update;
 if not found then raise no_data_found using message='delay_notice_not_found';end if;
 if n.requested_at is not null then return public.admin_get_order_delay_notice(target_notice);end if;
 if not (select enabled from private.order_delay_notice_delivery_control where singleton) then raise check_violation using message='delay_notice_delivery_disabled';end if;
 if n.expires_at<now() then raise check_violation using message='delay_notice_expired';end if;
 for t in select * from private.order_delay_notice_targets where notice_id=n.id order by order_id for update loop
  perform private.lock_order_delay_notice_target(t.order_id,t.shipment_ids);
  if not private.order_delay_notice_target_current(t.id) then raise check_violation using message='delay_notice_stale';end if;
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(t.buyer_id,'announcement',n.title,t.message_body,'/orders/'||t.order_id,'order_delay_notice',t.id::text,'order_delay_notice:'||t.id)
   on conflict(user_id,dedupe_key) do nothing returning id into notification;
  update private.order_delay_notice_targets set in_app_status='sent',notification_id=notification,
   email_status=case when recipient_email is null or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'queued' end,
   error_code=case when recipient_email is null or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end,
   available_at=now(),updated_at=now() where id=t.id;
 end loop;
 update private.order_delay_notices set requested_at=now() where id=n.id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_requested','delay_notice:'||n.id,
  jsonb_build_object('orders',(select count(*) from private.order_delay_notice_targets where notice_id=n.id),'channels',jsonb_build_array('in_app','email')));
 return public.admin_get_order_delay_notice(n.id);
end $function$;

-- admin_retry_order_delay_notice(uuid)
CREATE OR REPLACE FUNCTION public.admin_retry_order_delay_notice(target_notice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());t private.order_delay_notice_targets%rowtype;i private.email_intents%rowtype;retried integer:=0;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if not (select enabled from private.order_delay_notice_delivery_control where singleton) then raise check_violation using message='delay_notice_delivery_disabled';end if;
 perform 1 from private.order_delay_notices where id=target_notice and requested_at is not null for update;
 if not found then raise no_data_found using message='delay_notice_not_found';end if;
 for t in select * from private.order_delay_notice_targets where notice_id=target_notice and email_status='failed' and retryable order by order_id for update loop
  select * into i from private.email_intents where id=t.email_intent_id for update;
  if i.id is not null and i.idempotency_expires_at<=now()+interval '5 minutes' and i.accepted_at is null then
   update private.order_delay_notice_targets set email_status='unknown',error_code='delivery_needs_review',retryable=false,available_at=null,updated_at=now() where id=t.id;
   continue;
  end if;
  if i.id is not null and (i.accepted_at is not null or i.state not in ('queued','unknown')) then continue;end if;
  perform private.lock_order_delay_notice_target(t.order_id,t.shipment_ids);
  if not private.order_delay_notice_target_current(t.id) then
   update private.order_delay_notice_targets set email_status=case when coalesce(i.attempt_count,0)>0 then 'unknown' else 'suppressed' end,
    error_code='target_changed',retryable=false,available_at=null,updated_at=now() where id=t.id;
  else
   update private.order_delay_notice_targets set email_status='queued',retryable=false,available_at=now(),error_code=null,updated_at=now() where id=t.id;retried:=retried+1;
  end if;
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_retried','delay_notice:'||target_notice,jsonb_build_object('queuedEmails',retried));
 return public.admin_get_order_delay_notice(target_notice);
end $function$;

-- admin_review_console_counts()
CREATE OR REPLACE FUNCTION public.admin_review_console_counts()
 RETURNS TABLE(total_reviews bigint, low_rating_reviews bigint, awaiting_reply_reviews bigint, hidden_reviews bigint, reported_reviews bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  /* 미처리 신고는 조인으로 붙인다. FILTER 안에 상관 서브쿼리를 넣으면 읽는 사람이
     "행마다 도는 쿼리"를 못 알아보고, 신고 테이블이 커졌을 때 여기가 먼저 느려진다. */
  return query
  with reported as (
    select distinct report.target_id as review_id
    from public.reports as report
    where report.target_type = 'review'
      and report.status in ('open', 'reviewing')
  )
  select
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (where review.rating <= 2)::bigint,
    pg_catalog.count(*) filter (
      where review.admin_reply is null and review.status = 'visible'
    )::bigint,
    pg_catalog.count(*) filter (where review.status = 'hidden')::bigint,
    pg_catalog.count(*) filter (where reported.review_id is not null)::bigint
  from public.reviews as review
  left join reported on reported.review_id = review.id::text;
end;
$function$;

-- admin_review_insights(text,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_review_insights(p_focus text DEFAULT 'all'::text, p_query text DEFAULT ''::text, p_sort text DEFAULT 'analysis'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; day_start timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_focus is null or p_focus not in ('all','photo','coverage','rating','unanswered')
    or p_query is null or char_length(p_query)>100 or p_sort is null or p_sort not in ('analysis','reviews','rating')
    or p_page is null or p_page<1 or p_page>100000 or p_page_size is null or p_page_size not in (20,50,100)
  then raise invalid_parameter_value using message='invalid_review_insights_filter'; end if;
  with products as materialized (
    select g.id,g.name,g.price,g.image_path from public.goods g join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and i.archived_at is null and i.published_at is not null and g.sale_restriction='none'
  ), visible_reviews as materialized (
    select r.* from public.reviews r join products p on p.id=r.good_id
    where r.status='visible' and r.created_at<day_start
  ), reviews_by_product as (
    select good_id,count(*) review_count,count(*) filter(where cardinality(image_paths)>0) photo_count,
      count(*) filter(where nullif(btrim(admin_reply),'') is null) unanswered_count,
      avg(rating) average_rating,
      avg(rating) filter(where created_at>=((day_start at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six_month_rating
    from visible_reviews group by good_id
  ), delivered_cohort as materialized (
    -- One review can be written per order × product, even with multiple options/text entries.
    select distinct oi.order_id,oi.good_id from public.orders o join public.order_items oi on oi.order_id=o.id join products p on p.id=oi.good_id
    where o.status in ('delivered','done') and o.delivered_at>=day_start-interval '90 days' and o.delivered_at<day_start
  ), coverage_by_product as (
    select c.good_id,count(*) delivered_count,count(*) filter(where exists(
      select 1 from public.reviews r where r.order_id=c.order_id and r.good_id=c.good_id and r.created_at<day_start
    )) reviewed_count from delivered_cohort c group by c.good_id
  ), metrics as materialized (
    select p.*,coalesce(r.review_count,0) review_count,coalesce(r.photo_count,0) photo_count,
      coalesce(r.unanswered_count,0) unanswered_count,r.average_rating,r.six_month_rating,
      coalesce(c.delivered_count,0) delivered_count,coalesce(c.reviewed_count,0) reviewed_count,
      100.0*r.photo_count/nullif(r.review_count,0) photo_rate,
      100.0*c.reviewed_count/nullif(c.delivered_count,0) coverage_rate
    from products p left join reviews_by_product r on r.good_id=p.id left join coverage_by_product c on c.good_id=p.id
  ), benchmark as (
    select 100.0*sum(photo_count)/nullif(sum(review_count),0) photo_rate,
      100.0*sum(reviewed_count)/nullif(sum(delivered_count),0) coverage_rate,
      avg(average_rating) average_rating,avg(six_month_rating) six_month_rating from metrics
  ), tagged as materialized (
    select m.*,coalesce(m.photo_rate<b.photo_rate,false) low_photo,
      coalesce(m.coverage_rate<b.coverage_rate,false) low_coverage,
      coalesce(m.average_rating<4.6,false) low_rating
    from metrics m cross join benchmark b
    where p_query='' or strpos(lower(m.name),lower(btrim(p_query)))>0 or strpos(lower(m.id),lower(btrim(p_query)))>0
  ), filtered as materialized (
    select * from tagged where case p_focus when 'photo' then low_photo when 'coverage' then low_coverage
      when 'rating' then low_rating when 'unanswered' then unanswered_count>0 else true end
  ), page_rows as (
    select * from filtered order by
      case when p_sort='reviews' then review_count end desc,
      case when p_sort='rating' or p_sort='analysis' and p_focus='rating' then average_rating end asc nulls last,
      case when p_sort='analysis' and p_focus='photo' then photo_rate end asc nulls last,
      case when p_sort='analysis' and p_focus='coverage' then coverage_rate end asc nulls last,
      case when p_sort='analysis' then unanswered_count end desc,review_count desc,id
    limit p_page_size offset (p_page-1)*p_page_size
  ), recent as (
    select count(*) total,count(*) filter(where rating<=3) low_count from public.reviews r join products p on p.id=r.good_id
    where r.status='visible' and r.created_at>=day_start-interval '1 day' and r.created_at<=statement_timestamp()
  )
  select jsonb_build_object(
    'asOf',(day_start at time zone 'Asia/Seoul')::date-1,
    'cohortFrom',((day_start-interval '90 days') at time zone 'Asia/Seoul')::date,
    'summary',(select jsonb_build_object('newReviews',recent.total,'newLowReviews',recent.low_count,
      'averageRating',round(b.average_rating,2),'sixMonthRating',round(b.six_month_rating,2),
      'photoRate',round(b.photo_rate,1),'coverageRate',round(b.coverage_rate,1)) from benchmark b cross join recent),
    'counts',(select jsonb_build_object('all',count(*),'photo',count(*) filter(where low_photo),
      'coverage',count(*) filter(where low_coverage),'rating',count(*) filter(where low_rating),'unanswered',count(*) filter(where unanswered_count>0)) from tagged),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,'imagePath',image_path,
      'reviewCount',review_count,'photoCount',photo_count,'unansweredCount',unanswered_count,
      'averageRating',round(average_rating,2),'photoRate',round(photo_rate,1),'coverageRate',round(coverage_rate,1),
      'deliveredCount',delivered_count,'reviewedCount',reviewed_count)) from page_rows),'[]'::jsonb)
  ) into result;
  return result;
end $function$;

-- admin_review_reply_batch_result(uuid)
CREATE OR REPLACE FUNCTION public.admin_review_reply_batch_result(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 return (select result from private.review_reply_batches where actor_id=auth.uid() and request_id=p_request_id);
end $function$;

-- admin_sales_order_counts(date,date,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_sales_order_counts(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'ordered'::text, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='staff required';end if;
 perform private.admin_validate_sales_search(p_field,p_date_field,'newest',p_payment_method,p_from,p_to,needle);
 select jsonb_object_agg(known.value,coalesce(matched.total,0)) into result
 from unnest(enum_range(null::public.order_status)) known(value)
 left join (select o.status,count(*) total from public.orders o
  where private.admin_sales_order_matches(o,p_from,p_to,needle,p_field,p_date_field,p_payment_method)
  group by o.status) matched on matched.status=known.value;
 return result;
end $function$;

-- admin_sales_report(timestamp with time zone,timestamp with time zone,text)
CREATE OR REPLACE FUNCTION public.admin_sales_report(p_from timestamp with time zone, p_to timestamp with time zone, p_ip_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_result jsonb;
begin
  if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not public.has_operator_capability('stats.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  with scoped as (
    select
      orders.id,
      orders.total,
      orders.payment_method,
      (orders.created_at at time zone 'Asia/Seoul')::date as kst_date
    from public.orders
    where orders.status = any (private.revenue_order_statuses())
      and orders.created_at >= p_from
      and orders.created_at < p_to
  ),
  daily as (
    select
      scoped.kst_date,
      count(*) as order_count,
      sum(scoped.total) as revenue
    from scoped
    group by scoped.kst_date
  ),
  methods as (
    select
      scoped.payment_method,
      count(*) as order_count,
      sum(scoped.total) as revenue
    from scoped
    group by scoped.payment_method
  ),
  goods_rank as (
    select
      item.good_id,
      max(item.good_name_snapshot) as name,
      max(item.good_ip_id_snapshot) as ip_id,
      sum(item.qty) as qty,
      sum(item.qty::bigint * item.unit_price::bigint) as revenue
    from public.order_items as item
    join scoped on scoped.id = item.order_id
    where v_ip is null or item.good_ip_id_snapshot = v_ip
    group by item.good_id
    order by revenue desc, qty desc, item.good_id
    limit 20
  ),
  ticket_scoped as (
    select
      ticket_order.id,
      ticket_order.event_id,
      ticket_order.total,
      (ticket_order.created_at at time zone 'Asia/Seoul')::date as kst_date
    from public.ticket_orders as ticket_order
    where ticket_order.status = 'paid'
      and ticket_order.created_at >= p_from
      and ticket_order.created_at < p_to
  ),
  tickets as (
    select
      ticket_scoped.event_id,
      max(coalesce(event.title, ticket_scoped.event_id)) as event_title,
      count(*) as order_count,
      sum(ticket_scoped.total) as revenue,
      coalesce(sum(reservation.quantity), 0) as ticket_count
    from ticket_scoped
    left join public.events as event on event.id = ticket_scoped.event_id
    left join public.ticket_order_reservations as reservation
      on reservation.ticket_order_id = ticket_scoped.id
    group by ticket_scoped.event_id
    order by revenue desc, ticket_scoped.event_id
    limit 20
  ),
  -- 회차 축. 이벤트 합계만으로는 "어느 회차가 안 팔리는가"를 볼 수 없고, 그
  -- 판단이 정원 조정의 근거다. 매출은 예약 스냅샷(수량 × 단가)에서 센다 —
  -- ticket_orders.total은 회차별로 쪼갤 수 없다.
  ticket_occurrences as (
    select
      reservation.ticket_type_id,
      max(coalesce(ticket_type.name, '이름 없는 회차')) as occurrence_name,
      max(coalesce(event.title, ticket_scoped.event_id)) as event_title,
      sum(reservation.quantity) as ticket_count,
      sum(reservation.quantity::bigint * reservation.unit_price::bigint) as revenue
    from ticket_scoped
    join public.ticket_order_reservations as reservation
      on reservation.ticket_order_id = ticket_scoped.id
    left join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
    left join public.events as event on event.id = ticket_scoped.event_id
    group by reservation.ticket_type_id
    order by revenue desc, reservation.ticket_type_id
    limit 20
  )
  select jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(daily.kst_date, 'YYYY-MM-DD'),
          'orderCount', daily.order_count,
          'revenue', daily.revenue,
          -- 객단가는 정수 원 단위로 내린다. 소수점 원은 화면에서 의미가 없다.
          'averageOrderValue', (daily.revenue / greatest(daily.order_count, 1))::bigint
        )
        order by daily.kst_date
      )
      from daily
    ), '[]'::jsonb),
    'paymentMethods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'method', methods.payment_method,
          'orderCount', methods.order_count,
          'revenue', methods.revenue
        )
        order by methods.revenue desc
      )
      from methods
    ), '[]'::jsonb),
    'goods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'goodId', goods_rank.good_id,
          'name', goods_rank.name,
          'ipId', goods_rank.ip_id,
          'qty', goods_rank.qty,
          'revenue', goods_rank.revenue
        )
      )
      from goods_rank
    ), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventId', tickets.event_id,
          'eventTitle', tickets.event_title,
          'orderCount', tickets.order_count,
          'ticketCount', tickets.ticket_count,
          'revenue', tickets.revenue
        )
      )
      from tickets
    ), '[]'::jsonb),
    'ticketOccurrences', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ticketTypeId', ticket_occurrences.ticket_type_id,
          'occurrenceName', ticket_occurrences.occurrence_name,
          'eventTitle', ticket_occurrences.event_title,
          'ticketCount', ticket_occurrences.ticket_count,
          'revenue', ticket_occurrences.revenue
        )
      )
      from ticket_occurrences
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- admin_save_cs_reply_template(uuid,text,text,text,text,integer)
CREATE OR REPLACE FUNCTION public.admin_save_cs_reply_template(p_id uuid, p_surface text, p_category text, p_title text, p_body text, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.cs_reply_templates; saved public.cs_reply_templates;
 title_value text:=btrim(coalesce(p_title,'')); body_value text:=btrim(coalesce(p_body,''),E' \t\n\r\f\v');
begin
  perform private.require_operator_capability('cs.manage',false);

 if actor is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_surface is null or p_surface not in ('product_question','review')
   or p_category is null or p_category not in ('product','shipping','return','exchange','refund','other')
   or char_length(title_value) not between 1 and 35 or title_value ~ '[[:cntrl:]]'
   or char_length(body_value) not between (case when p_surface='review' then 2 else 1 end) and (case when p_surface='review' then 1000 else 2000 end)
   or p_expected_revision is null or p_expected_revision<0 then
   raise invalid_parameter_value using message='invalid_cs_reply_template';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('cs_reply_template:'||p_id::text,0));
 select * into previous from public.cs_reply_templates where id=p_id for update;
 if found then
   if previous.surface<>p_surface or previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
   if previous.archived_at is not null then raise check_violation using message='cs_reply_template_archived'; end if;
   if (previous.category,previous.title,previous.body)=(p_category,title_value,body_value) then return to_jsonb(previous); end if;
   update public.cs_reply_templates set category=p_category,title=title_value,body=body_value,revision=revision+1,
     updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
 else
   if p_expected_revision<>0 then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
   insert into public.cs_reply_templates(id,surface,category,title,body,created_by,updated_by)
     values(p_id,p_surface,p_category,title_value,body_value,actor,actor) returning * into saved;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.cs_reply_template.saved','cs_reply_templates:'||p_id::text,
   jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
 return to_jsonb(saved);
end $function$;

-- admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)
CREATE OR REPLACE FUNCTION public.admin_save_delivery_policy(p_origin_id uuid, p_method text, p_policy_id uuid, p_values jsonb, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); policy private.fulfillment_delivery_policies; values_object jsonb:='{}'; field text; state_value text;
  origin public.fulfillment_origins; instant timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then
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
end $function$;

-- admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_faq_entry(target_id uuid, target_category text, target_question text, target_answer text, target_sort_order integer, target_published boolean, expected_updated_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  previous public.faq_entries;
  saved public.faq_entries;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_category is null or target_category not in ('order','claim','good','account','etc')
    or char_length(btrim(coalesce(target_question,''))) not between 1 and 200
    or char_length(btrim(coalesce(target_answer,''))) not between 1 and 6000
    or target_sort_order is null or target_sort_order not between 0 and 9999
    or target_published is null then
    raise invalid_parameter_value using message = 'invalid_faq_entry';
  end if;
  if target_id is null then
    insert into public.faq_entries(category,question,answer,sort_order,is_published)
    values(target_category,btrim(target_question),btrim(target_answer),target_sort_order,target_published)
    returning * into saved;
  else
    select * into previous from public.faq_entries where id = target_id for update;
    if not found then raise no_data_found using message = 'faq_not_found'; end if;
    if expected_updated_at is distinct from previous.updated_at then
      raise sqlstate 'PT409' using message = 'faq_conflict';
    end if;
    update public.faq_entries set category = target_category, question = btrim(target_question),
      answer = btrim(target_answer), sort_order = target_sort_order, is_published = target_published,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,case when target_id is null then 'faq.create' else 'faq.update' end,
      'faq:' || saved.id::text,jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.id;
end;
$function$;

-- admin_save_fulfillment_origin(uuid,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_fulfillment_origin(target_id uuid, target_values jsonb, expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.fulfillment_origins; saved public.fulfillment_origins;
 code_value text; name_value text; carrier_value text; base_value bigint; threshold_value bigint; active_value boolean;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then
    raise insufficient_privilege using message='admin_required';
  end if;
  if jsonb_typeof(target_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_values) k
    where k not in ('code','name','default_carrier','base_fee','free_threshold','return_address','cutoff','export_template','is_active')) then
    raise invalid_parameter_value using message='invalid_fulfillment_origin';
  end if;
  code_value:=btrim(target_values->>'code'); name_value:=btrim(target_values->>'name');
  carrier_value:=nullif(target_values->>'default_carrier','');
  base_value:=(target_values->>'base_fee')::bigint; threshold_value:=nullif(target_values->>'free_threshold','')::bigint;
  active_value:=(target_values->>'is_active')::boolean;
  if code_value is null or code_value !~ '^[a-z][a-z0-9-]{1,39}$' or name_value is null or length(name_value) not between 1 and 80
    or base_value is null or base_value not between 0 and 1000000 or threshold_value not between 0 and 100000000 or active_value is null
    or coalesce(target_values->>'return_address','') ~ '[[:cntrl:]]'
    or length(coalesce(target_values->>'return_address',''))>500
    or coalesce(target_values->>'export_template','') not in ('standard','wms_csv','seowon_xlsx') then
    raise invalid_parameter_value using message='invalid_fulfillment_origin';
  end if;
  if carrier_value is not null and not exists(select 1 from public.shipping_carriers where code=carrier_value and is_active) then
    raise check_violation using message='shipping_carrier_inactive';
  end if;
  if active_value and carrier_value is null then raise check_violation using message='shipping_carrier_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fulfillment_origin:'||code_value,0));
  if target_id is not null then
    select * into previous from public.fulfillment_origins where id=target_id for update;
    if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
    if previous.updated_at is distinct from expected_updated_at then raise sqlstate 'PT409' using message='fulfillment_origin_conflict'; end if;
    if previous.code<>code_value then raise check_violation using message='fulfillment_origin_code_locked'; end if;
    update public.fulfillment_origins set name=name_value,default_carrier=carrier_value,base_fee=base_value,free_threshold=threshold_value,
      return_address=btrim(coalesce(target_values->>'return_address','')),cutoff=nullif(target_values->>'cutoff','')::time,
      export_template=target_values->>'export_template',is_active=active_value,
      updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
      where id=target_id returning * into saved;
  else
    if expected_updated_at is not null then raise invalid_parameter_value using message='invalid_fulfillment_origin'; end if;
    insert into public.fulfillment_origins(code,name,default_carrier,base_fee,free_threshold,return_address,cutoff,export_template,is_active)
      values(code_value,name_value,carrier_value,base_value,threshold_value,btrim(coalesce(target_values->>'return_address','')),
        nullif(target_values->>'cutoff','')::time,target_values->>'export_template',active_value) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_origin.saved','fulfillment_origins:'||saved.id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'updatedAt',saved.updated_at);
end $function$;

-- admin_save_good(jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_good(target_good jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved jsonb; previous public.goods; previous_values public.goods_attribute_values; schema_row public.catalog_category_attribute_schemas;
  submission jsonb; category uuid; code_value text; code_id uuid; next_entries jsonb; next_revision integer;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or private.is_account_write_fenced(auth.uid()) then raise insufficient_privilege using message='staff_required'; end if;
  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  perform private.lock_catalog_category_tree();
  select * into previous from public.goods where id=coalesce(nullif(target_good->>'previous_id',''),target_good->>'id') for update;
  category:=previous.category_id;
  if target_good ? 'category_id' then
    if jsonb_typeof(target_good->'category_id') not in ('string','null') then raise invalid_parameter_value using message='invalid_good_category'; end if;
    begin category:=nullif(btrim(target_good->>'category_id'),'')::uuid;
    exception when invalid_text_representation then raise invalid_parameter_value using message='invalid_good_category'; end;
  end if;
  if target_good ? 'category_code' then
    if jsonb_typeof(target_good->'category_code') not in ('string','null') then raise invalid_parameter_value using message='invalid_good_category'; end if;
    code_value:=nullif(btrim(target_good->>'category_code'),'');
    if code_value is not null then select id into code_id from public.catalog_categories where code=code_value;
      if not found then raise no_data_found using message='category_not_found'; end if; end if;
    if target_good ? 'category_id' and code_id is distinct from category then raise invalid_parameter_value using message='good_category_identity_mismatch'; end if;
    category:=code_id;
  end if;
  select * into previous_values from public.goods_attribute_values where good_id=previous.id for update;
  select * into schema_row from public.catalog_category_attribute_schemas where category_id=category for share;
  if target_good ? 'product_attributes' then
    submission:=target_good->'product_attributes';
    if jsonb_typeof(submission) is distinct from 'object' then raise check_violation using message='invalid_goods_attributes'; end if;
    if not submission ?& array['categoryId','schemaRevision','expectedRevision','values','removeIds'] or (select count(*) from jsonb_object_keys(submission))<>5
      or (submission->>'categoryId')::uuid is distinct from category
      or jsonb_typeof(submission->'schemaRevision') is distinct from 'number' or submission->>'schemaRevision' !~ '^(0|[1-9][0-9]*)$'
      or jsonb_typeof(submission->'expectedRevision') is distinct from 'number' or submission->>'expectedRevision' !~ '^(0|[1-9][0-9]*)$' then raise check_violation using message='invalid_goods_attributes'; end if;
    if (submission->>'schemaRevision')::numeric<>coalesce(schema_row.revision,0) then raise sqlstate 'PT409' using message='goods_attribute_schema_changed'; end if;
    if (submission->>'expectedRevision')::numeric<>coalesce(previous_values.revision,0) then raise sqlstate 'PT409' using message='goods_attributes_changed'; end if;
    next_entries:=private.merge_goods_attributes(coalesce(previous_values.entries,'[]'),coalesce(schema_row.fields,'[]'),submission->'values',submission->'removeIds');
  elsif previous.id is null or category is distinct from previous.category_id then
    -- Old clients may preserve an existing product unchanged. New/category-changed products still satisfy the current mandatory schema.
    next_entries:=private.merge_goods_attributes(coalesce(previous_values.entries,'[]'),coalesce(schema_row.fields,'[]'),'{}','[]');
  end if;
  saved:=private.admin_save_good_before_attributes(target_good-'product_attributes');
  if next_entries is not null and (next_entries<>coalesce(previous_values.entries,'[]') or submission is not null) then
    insert into public.goods_attribute_values(good_id,entries) values(saved->>'id',next_entries)
      on conflict(good_id) do update set entries=excluded.entries,revision=goods_attribute_values.revision+1,updated_at=clock_timestamp() returning revision into next_revision;
    insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'catalog.goods_attributes_saved','goods:'||(saved->>'id'),
      jsonb_build_object('before',coalesce(previous_values.entries,'[]'),'after',next_entries,'categoryId',category,'schemaRevision',coalesce(schema_row.revision,0),'revision',next_revision));
  end if;
  return saved||jsonb_build_object('attributesRevision',coalesce(next_revision,previous_values.revision,0));
end $function$;

-- admin_save_good_claim_policy(text,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_good_claim_policy(target_good_id text, target_policy jsonb, expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.goods; saved public.goods;
  next_return boolean; next_exchange boolean; next_reason text; next_return_fee bigint;
  next_free_return_fee bigint; next_exchange_fee bigint; field text; before_policy jsonb; after_policy jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_policy) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_policy) key
    where key not in ('returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee')) then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;
  foreach field in array array['returnAllowed','exchangeAllowed'] loop
    if target_policy ? field and jsonb_typeof(target_policy->field) not in ('boolean','null') then
      raise invalid_parameter_value using message='invalid_good_claim_policy';
    end if;
  end loop;
  foreach field in array array['returnFee','returnFreeShippingFee','exchangeFee'] loop
    if target_policy ? field and jsonb_typeof(target_policy->field)<>'null' then
      if jsonb_typeof(target_policy->field)<>'number' or target_policy->>field !~ '^[0-9]+$'
        or (target_policy->>field)::numeric>1000000 then
        raise invalid_parameter_value using message='invalid_good_claim_policy';
      end if;
    end if;
  end loop;
  if target_policy ? 'restrictionReason' and jsonb_typeof(target_policy->'restrictionReason') not in ('string','null') then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;
  select * into previous from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if previous.archived_at is not null then raise check_violation using message='good_archived'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception using errcode='PT409',message='good_claim_policy_conflict';
  end if;
  next_return:=case when target_policy?'returnAllowed' then (target_policy->>'returnAllowed')::boolean else previous.claim_return_allowed end;
  next_exchange:=case when target_policy?'exchangeAllowed' then (target_policy->>'exchangeAllowed')::boolean else previous.claim_exchange_allowed end;
  next_reason:=case when target_policy?'restrictionReason' then nullif(btrim(target_policy->>'restrictionReason',E' \t\n\r'),'') else previous.claim_restriction_reason end;
  next_return_fee:=case when target_policy?'returnFee' then (target_policy->>'returnFee')::bigint else previous.claim_return_fee end;
  next_free_return_fee:=case when target_policy?'returnFreeShippingFee' then (target_policy->>'returnFreeShippingFee')::bigint else previous.claim_return_free_shipping_fee end;
  next_exchange_fee:=case when target_policy?'exchangeFee' then (target_policy->>'exchangeFee')::bigint else previous.claim_exchange_fee end;
  if char_length(coalesce(next_reason,''))>2000 or private.has_disallowed_shipping_notice_control(next_reason)
    or ((next_return=false or next_exchange=false) and next_reason is null) then
    raise check_violation using message='invalid_good_claim_policy';
  end if;
  before_policy:=jsonb_build_object('returnAllowed',previous.claim_return_allowed,'exchangeAllowed',previous.claim_exchange_allowed,
    'restrictionReason',previous.claim_restriction_reason,'returnFee',previous.claim_return_fee,
    'returnFreeShippingFee',previous.claim_return_free_shipping_fee,'exchangeFee',previous.claim_exchange_fee);
  after_policy:=jsonb_build_object('returnAllowed',next_return,'exchangeAllowed',next_exchange,'restrictionReason',next_reason,
    'returnFee',next_return_fee,'returnFreeShippingFee',next_free_return_fee,'exchangeFee',next_exchange_fee);
  if before_policy=after_policy then return after_policy||jsonb_build_object('goodId',previous.id,'updatedAt',previous.updated_at); end if;
  update public.goods set claim_return_allowed=next_return,claim_exchange_allowed=next_exchange,
    claim_restriction_reason=next_reason,claim_return_fee=next_return_fee,claim_return_free_shipping_fee=next_free_return_fee,
    claim_exchange_fee=next_exchange_fee where id=target_good_id returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.good.claim_policy_updated','goods:'||saved.id,
    jsonb_build_object('before',before_policy,'after',after_policy));
  return after_policy||jsonb_build_object('goodId',saved.id,'updatedAt',saved.updated_at);
end $function$;

-- admin_save_good_from_draft(jsonb,uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_save_good_from_draft(target_good jsonb, p_draft_id uuid, p_draft_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.admin_goods_drafts; result jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_draft_id is null or p_draft_revision is null or p_draft_revision<1 or target_good is null or jsonb_typeof(target_good)<>'object'
    or nullif(target_good->>'previous_id','') is not null then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||auth.uid()::text,0));
  select * into d from public.admin_goods_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  if d.completed_result is not null and d.revision=p_draft_revision+1 then return d.completed_result||jsonb_build_object('draftAlreadyCompleted',true); end if;
  if d.archived_at is not null or d.revision<>p_draft_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  result:=public.admin_save_good(target_good);
  if coalesce(result->>'id','')='' then raise check_violation using message='goods_draft_completion_failed'; end if;
  update public.admin_goods_drafts set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1,
    completed_good_id=result->>'id',completed_result=result where id=p_draft_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.goods.draft.completed','goods_draft:'||p_draft_id::text,
    jsonb_build_object('goodId',result->>'id','revision',d.revision+1));
  return result;
end $function$;

-- admin_save_goods_additional(text,text[],integer)
CREATE OR REPLACE FUNCTION public.admin_save_goods_additional(p_good_id text, p_target_good_ids text[], p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_set private.goods_additional_sets; before_ids text[]; next_revision integer; target_id text;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if not coalesce(public.has_operator_capability('catalog.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_target_good_ids is null or cardinality(p_target_good_ids)>50
    or exists(select 1 from unnest(p_target_good_ids) id where id is null or btrim(id)='' or id<>btrim(id))
    or cardinality(p_target_good_ids)<>(select count(distinct id) from unnest(p_target_good_ids) id)
    or p_good_id=any(p_target_good_ids) then raise check_violation using message='invalid_additional_goods'; end if;
  -- All graph writers take this before examining reachability, so simultaneous
  -- A -> B and B -> A saves cannot independently pass the cycle check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goods-additional-graph',0));
  perform 1 from public.goods where id=p_good_id and archived_at is null for key share;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into current_set from private.goods_additional_sets where good_id=p_good_id for update;
  if current_set.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='additional_goods_changed'; end if;
  select coalesce(array_agg(target_good_id order by sort_order),'{}') into before_ids
    from private.goods_additional_links where base_good_id=p_good_id;
  if before_ids=p_target_good_ids then return jsonb_build_object('revision',current_set.revision,'changed',false); end if;
  for target_id in select id from unnest(p_target_good_ids) id order by id loop
    perform 1 from public.goods where id=target_id for key share;
    if not found or (not target_id=any(before_ids) and not private.goods_additional_available(target_id)) then
      raise check_violation using message='additional_good_unavailable';
    end if;
  end loop;
  if exists(with recursive reachable(good_id) as (
    select unnest(p_target_good_ids)
    union
    select link.target_good_id from private.goods_additional_links link
      join reachable on reachable.good_id=link.base_good_id where link.base_good_id<>p_good_id
  ) select 1 from reachable where good_id=p_good_id) then raise check_violation using message='additional_goods_cycle'; end if;
  next_revision:=coalesce(current_set.revision,0)+1;
  insert into private.goods_additional_sets(good_id,revision,updated_at,updated_by)
    values(p_good_id,next_revision,now(),auth.uid())
    on conflict(good_id) do update set revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  delete from private.goods_additional_links where base_good_id=p_good_id;
  insert into private.goods_additional_links(base_good_id,target_good_id,sort_order)
    select p_good_id,target.id,(target.ordinality-1)::integer from unnest(p_target_good_ids) with ordinality target(id,ordinality);
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.additional_saved','goods:'||p_good_id,
    jsonb_build_object('before',before_ids,'after',p_target_good_ids,'revision',next_revision));
  return jsonb_build_object('revision',next_revision,'changed',true);
end $function$;

-- admin_save_goods_announcement(uuid,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_goods_announcement(p_id uuid, p_expected_revision integer, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); previous public.goods_announcements; saved public.goods_announcements;
  ids text[]; starts_value timestamptz; ends_value timestamptz; before_goods text[];
begin
  perform private.require_operator_capability('catalog.announcements',false);

  if actor is null or not coalesce(public.has_operator_capability('catalog.announcements',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_values) is distinct from 'object' then raise invalid_parameter_value using message='invalid_goods_announcement'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) key where key not in
      ('title','body','format','category','device','enabled','important','allGoods','goodIds','startsAt','endsAt'))
    or exists(select 1 from unnest(array['title','body','format','category','device']) key where jsonb_typeof(p_values->key) is distinct from 'string')
    or exists(select 1 from unnest(array['enabled','important','allGoods']) key where jsonb_typeof(p_values->key) is distinct from 'boolean')
    or char_length(btrim(p_values->>'title')) not between 1 and 50
    or char_length(btrim(p_values->>'body')) not between 1 and 30000
    or p_values->>'format' not in ('plain','html') or p_values->>'category' not in ('general','event','shipping','product')
    or p_values->>'device' not in ('all','pc','mobile')
    or jsonb_typeof(p_values->'goodIds') is distinct from 'array'
    or jsonb_array_length(p_values->'goodIds') > 500
    or exists(select 1 from jsonb_array_elements(p_values->'goodIds') item where jsonb_typeof(item) <> 'string'
      or char_length(item#>>'{}') not between 1 and 120)
    or exists(select 1 from unnest(array['startsAt','endsAt']) key where coalesce(jsonb_typeof(p_values->key),'null') not in ('string','null')) then
    raise invalid_parameter_value using message='invalid_goods_announcement';
  end if;
  select coalesce(array_agg(value),'{}') into ids from jsonb_array_elements_text(p_values->'goodIds');
  if cardinality(ids) <> (select count(distinct value) from unnest(ids) value)
    or ((p_values->>'allGoods')::boolean and cardinality(ids) <> 0)
    or (not (p_values->>'allGoods')::boolean and cardinality(ids) = 0)
    or exists(select 1 from unnest(ids) item where not exists(select 1 from public.goods where id=item)) then
    raise invalid_parameter_value using message='invalid_goods_announcement_goods';
  end if;
  starts_value:=nullif(p_values->>'startsAt','')::timestamptz;
  ends_value:=nullif(p_values->>'endsAt','')::timestamptz;
  if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
    or (starts_value is not null and ends_value is not null and starts_value >= ends_value) then
    raise invalid_parameter_value using message='invalid_goods_announcement_period';
  end if;
  -- A client-generated id prevents an unknown create result from creating a second record.
  perform pg_advisory_xact_lock(hashtextextended('goods_announcement:'||p_id::text,0));
  select * into previous from public.goods_announcements where id=p_id for update;
  if (previous.id is null and p_expected_revision <> 0) or (previous.id is not null and previous.revision <> p_expected_revision) then
    raise sqlstate 'PT409' using message='goods_announcement_changed';
  end if;
  select coalesce(array_agg(good_id order by good_id),'{}') into before_goods from public.goods_announcement_goods where announcement_id=p_id;
  insert into public.goods_announcements(id,title,body,body_format,category,device,enabled,important,all_goods,starts_at,ends_at,created_by,updated_by)
  values(p_id,btrim(p_values->>'title'),btrim(p_values->>'body'),p_values->>'format',p_values->>'category',p_values->>'device',
    (p_values->>'enabled')::boolean,(p_values->>'important')::boolean,(p_values->>'allGoods')::boolean,starts_value,ends_value,actor,actor)
  on conflict(id) do update set title=excluded.title,body=excluded.body,body_format=excluded.body_format,category=excluded.category,
    device=excluded.device,enabled=excluded.enabled,important=excluded.important,all_goods=excluded.all_goods,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,revision=public.goods_announcements.revision+1,updated_by=actor,updated_at=clock_timestamp()
  returning * into saved;
  delete from public.goods_announcement_goods where announcement_id=p_id and not(good_id=any(ids));
  insert into public.goods_announcement_goods(announcement_id,good_id) select p_id,item from unnest(ids) item on conflict do nothing;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods_announcement.saved','goods_announcement:'||p_id::text,
    jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved),'beforeGoodIds',before_goods,'afterGoodIds',ids));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'reference',saved.reference,'updatedAt',saved.updated_at);
end $function$;

-- admin_save_goods_attribute_schema(uuid,jsonb,integer,uuid)
CREATE OR REPLACE FUNCTION public.admin_save_goods_attribute_schema(p_category_id uuid, p_fields jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.catalog_category_attribute_schemas; saved public.catalog_category_attribute_schemas; audit public.audit_log; result jsonb;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  perform 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true) and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='admin_required'; end if;
  if p_category_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or not coalesce(private.goods_attribute_fields_valid(p_fields),false) then raise invalid_parameter_value using message='invalid_attribute_schema'; end if;
  perform private.lock_catalog_category_tree();
  if not exists(select 1 from public.catalog_categories where id=p_category_id and archived_at is null)
    or exists(select 1 from public.catalog_categories where parent_id=p_category_id and archived_at is null) then raise check_violation using message='category_not_leaf'; end if;
  select * into previous from public.catalog_category_attribute_schemas where category_id=p_category_id for update;
  select * into audit from public.audit_log where id=p_operation_id;
  if found then
    if audit.actor_id=actor and audit.action='catalog.attribute_schema_saved' and audit.target=p_category_id::text
      and audit.diff->'after'=p_fields and (audit.diff->>'expectedRevision')::integer=p_expected_revision then return audit.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='goods_attribute_schema_changed'; end if;
  insert into public.catalog_category_attribute_schemas(category_id,fields) values(p_category_id,p_fields)
    on conflict(category_id) do update set fields=excluded.fields,revision=catalog_category_attribute_schemas.revision+1,updated_at=clock_timestamp() returning * into saved;
  result:=jsonb_build_object('categoryId',saved.category_id,'revision',saved.revision,'fields',saved.fields);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'catalog.attribute_schema_saved',p_category_id::text,
    jsonb_build_object('before',coalesce(previous.fields,'[]'::jsonb),'after',p_fields,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $function$;

-- admin_save_goods_draft(uuid,jsonb,integer)
CREATE OR REPLACE FUNCTION public.admin_save_goods_draft(p_id uuid, p_values jsonb, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.admin_goods_drafts; saved public.admin_goods_drafts;
  paths text[]; owned_paths text[]:='{}'; current_path text;
  allowed_fields constant text[]:=array[
    'id','ipId','name','nameEn','searchKeywords','displayOrder','categoryId','additionalCategoryIds','shippingNoticeTemplate','type','code','defaultVariantCode',
    'price','compareAtPrice','showDiscountRate','badge','stock','description','descriptionFormat','descriptionUploadPath','descriptionImageAlt','imagePath','detailImagePath',
    'originId','shippingFeeType','individualFee','variants','variantBaseline','customInputs','customInputsExpectedRevision','productAttributes','productAttributeDraft','optionUsage',
    'optionAxisName0','optionAxisValues0','optionAxisName1','optionAxisValues1','optionAxisName2','optionAxisValues2',
    'regularPrice','discountEnabled','discountValue','discountUnit','allowCardPayment','allowBankTransfer','saleRestriction','orderQuantityLimitEnabled',
    'minOrderQty','maxOrderQty','memberPurchaseLimitEnabled','memberLifetimeQtyLimit','claimReturnAllowed','claimExchangeAllowed','claimRestrictionReason',
    'claimReturnFee','claimReturnFreeShippingFee','claimExchangeFee','noticeMaker','noticeOrigin','noticeMaterial','noticeSize','noticeMadeOn','noticeAsManager','noticeAsContact',
    'galleryPath0','galleryPath1','galleryPath2','galleryPath3','galleryPath4','galleryPath5','galleryPath6','galleryPath7','galleryPath8'];
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_values is null or jsonb_typeof(p_values)<>'object'
    or octet_length(p_values::text)>524288 then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  if not p_values ? 'name' or char_length(btrim(p_values->>'name')) not between 1 and 100
    or exists(select 1 from jsonb_each(p_values) entry where not entry.key=any(allowed_fields) or jsonb_typeof(entry.value)<>'string')
    or exists(select 1 from jsonb_each_text(p_values) entry where entry.value ~* '^\s*(blob:|data:)')
    or coalesce(p_values->>'variantBaseline','[]')<>'[]' or coalesce(p_values->>'customInputsExpectedRevision','0')<>'0'
  then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  if exists(select 1 from jsonb_each_text(p_values) e where (e.key in ('imagePath','detailImagePath','descriptionUploadPath') or e.key like 'galleryPath%')
    and e.value<>'' and e.value !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
  then raise check_violation using message='unverified_artwork'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||actor::text,0));
  select * into previous from public.admin_goods_drafts where id=p_id for update;
  if found then
    if previous.owner_id<>actor then raise insufficient_privilege using message='forbidden'; end if;
    if previous.archived_at is not null then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
    if previous.form_values=p_values and previous.revision=p_expected_revision+1 then return private.goods_draft_summary(previous); end if;
    if previous.revision<>p_expected_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  else
    if p_expected_revision<>0 then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
    perform private.make_room_for_goods_draft(actor);
  end if;
  select coalesce(array_agg(distinct match[1]),'{}') into paths from regexp_matches(p_values::text,
    '(public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](?:jpg|png|webp))','g') match;
  foreach current_path in array paths loop
    if current_path=any(coalesce(previous.owned_image_paths,'{}')) or private.can_reuse_own_goods_draft_artwork(current_path) then
      owned_paths:=array_append(owned_paths,current_path);
    elsif private.can_reuse_shared_goods_artwork(current_path) then null;
    else
      update public.admin_artwork_upload_claims set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
        where actor_id=actor and path=substr(current_path,14) and kind='good' and status='verified' and expires_at>clock_timestamp();
      if not found then raise check_violation using message='unverified_artwork'; end if;
      owned_paths:=array_append(owned_paths,current_path);
    end if;
  end loop;
  insert into public.admin_goods_drafts(id,owner_id,form_values,image_paths,owned_image_paths) values(p_id,actor,p_values,paths,owned_paths)
    on conflict(id) do update set form_values=excluded.form_values,image_paths=excluded.image_paths,owned_image_paths=excluded.owned_image_paths,
      revision=admin_goods_drafts.revision+1,updated_at=clock_timestamp() returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.draft.saved','goods_draft:'||p_id::text,
    jsonb_build_object('revision',saved.revision,'fieldCount',(select count(*) from jsonb_object_keys(p_values))));
  return private.goods_draft_summary(saved);
end $function$;

-- admin_save_goods_kc(text,jsonb,text,integer,text,boolean)
CREATE OR REPLACE FUNCTION public.admin_save_goods_kc(p_good_id text, p_models jsonb, p_status text, p_expected_revision integer, p_expected_context_fingerprint text, p_attested boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare good public.goods; current_review private.goods_kc_reviews; changed private.goods_kc_reviews;
  models jsonb; errors text[]; next_revision integer;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if not coalesce(public.has_operator_capability('catalog.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_status is null or p_status not in ('unreviewed','reviewed') then raise check_violation using message='invalid_goods_kc_review_status'; end if;
  models:=private.normalize_goods_kc_models(p_models);
  select * into good from public.goods where id=p_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if good.archived_at is not null then raise check_violation using message='catalog_item_archived'; end if;
  select * into current_review from private.goods_kc_reviews where good_id=p_good_id for update;
  if current_review.revision is distinct from p_expected_revision or p_expected_context_fingerprint is null
    or p_expected_context_fingerprint is distinct from private.goods_kc_fingerprint(p_good_id) then
    raise sqlstate 'PT409' using message='goods_kc_review_changed';
  end if;
  if p_status='reviewed' then
    if p_attested is distinct from true then raise check_violation using message='goods_kc_attestation_required'; end if;
    errors:=private.goods_kc_review_problems(p_good_id,models);
    if cardinality(errors)>0 then raise check_violation using message='goods_kc_review_incomplete',detail=array_to_string(errors,' '); end if;
  end if;
  if current_review.models is not distinct from models and current_review.status is not distinct from p_status then
    return jsonb_build_object('changed',false,'configuration',public.admin_read_goods_kc(p_good_id));
  end if;
  if good.published_at is not null then raise check_violation using message='goods_kc_published_edit_requires_draft'; end if;
  next_revision:=coalesce(current_review.revision,0)+1;
  insert into private.goods_kc_reviews(good_id,revision,status,models,context_snapshot,reviewed_by,reviewed_at,updated_by,updated_at)
    values(p_good_id,next_revision,p_status,models,private.goods_kc_context(p_good_id),
      case when p_status='reviewed' then auth.uid() end,case when p_status='reviewed' then clock_timestamp() end,auth.uid(),clock_timestamp())
    on conflict(good_id) do update set revision=excluded.revision,status=excluded.status,models=excluded.models,
      context_snapshot=excluded.context_snapshot,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into changed;
  insert into private.goods_kc_review_events(good_id,revision,snapshot,reason,actor_id)
    values(p_good_id,next_revision,to_jsonb(changed),case when p_status='reviewed' then 'review_completed' else 'draft_saved' end,auth.uid());
  update public.goods set kc_disclosures='[]' where id=p_good_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.kc_saved','goods:'||p_good_id,
    jsonb_build_object('before_status',current_review.status,'status',p_status,'revision',next_revision,'model_count',jsonb_array_length(models)));
  return jsonb_build_object('changed',true,'configuration',public.admin_read_goods_kc(p_good_id));
end $function$;

-- admin_save_goods_notice_preset(uuid,text,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_goods_notice_preset(target_id uuid, target_name text, target_notice jsonb, expected_updated_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r\f\v');
  normalized_notice jsonb;
  normalized_kc jsonb;
  previous public.goods_notice_presets;
  saved public.goods_notice_presets;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(normalized_name) not between 1 and 80
    or jsonb_typeof(target_notice) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  if not target_notice ?& array['maker','origin','material','size','madeOn','asManager','asContact']
    or exists (select 1 from jsonb_each(target_notice) as field
      where field.key not in ('maker','origin','material','size','madeOn','asManager','asContact','kcTemplate')
        or (field.key<>'kcTemplate' and jsonb_typeof(field.value) <> 'string')) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  select jsonb_object_agg(field.key, btrim(field.value, E' \t\n\r\f\v'))
    into normalized_notice from jsonb_each_text(target_notice) as field where field.key<>'kcTemplate';
  if target_notice ? 'kcTemplate' then normalized_kc:=private.normalize_goods_notice_kc_template(target_notice->'kcTemplate'); end if;
  if exists (select 1 from jsonb_each_text(normalized_notice) as field
    where char_length(field.value) not between 1 and 1000) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;

  if target_id is not null then
    select * into previous from public.goods_notice_presets where id = target_id for update;
    if not found then raise no_data_found using message = 'goods_notice_preset_not_found'; end if;
    if expected_updated_at is distinct from previous.updated_at then
      raise sqlstate 'PT409' using message = 'goods_notice_preset_conflict';
    end if;
  end if;

  if target_id is null then
    insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact,kc_template)
    values (normalized_name,normalized_notice->>'maker',normalized_notice->>'origin',
      normalized_notice->>'material',normalized_notice->>'size',normalized_notice->>'madeOn',
      normalized_notice->>'asManager',normalized_notice->>'asContact',normalized_kc) returning * into saved;
  else
    update public.goods_notice_presets set name = normalized_name,
      maker = normalized_notice->>'maker', origin = normalized_notice->>'origin',
      material = normalized_notice->>'material', size = normalized_notice->>'size',
      made_on = normalized_notice->>'madeOn', as_manager = normalized_notice->>'asManager',
      as_contact = normalized_notice->>'asContact',
      kc_template = case when target_notice ? 'kcTemplate' then normalized_kc else previous.kc_template end,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  end if;

  insert into public.audit_log(actor_id,action,target,diff)
    values(actor, case when target_id is null then 'catalog.goods_notice_preset.created'
      else 'catalog.goods_notice_preset.updated' end, 'goods_notice_presets:' || saved.id::text,
      jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.id;
end;
$function$;

-- admin_save_goods_photo(uuid,text,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.admin_save_goods_photo(p_id uuid, p_image_path text, p_name text, p_expected_revision integer, p_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.goods_photo_library; saved public.goods_photo_library; object_path text; refs jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_expected_revision is null or p_expected_revision<0 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_photo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-photo:'||p_id::text,0));
  select * into previous from public.goods_photo_library where id=p_id for update;
  if found then
    if previous.image_path is distinct from p_image_path then raise check_violation using message='photo_path_immutable'; end if;
    -- Register retries are safe only for the exact creator and original payload.
    if p_expected_revision=0 and previous.created_by=actor and previous.revision=1 and previous.name=btrim(p_name) and previous.archived_at is null and not p_archived then
      return jsonb_build_object('id',previous.id,'revision',previous.revision);
    end if;
    if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    refs:=private.goods_photo_references(previous.image_path);
    if p_archived and jsonb_array_length(refs)>0 then raise check_violation using message='goods_photo_in_use'; end if;
    update public.goods_photo_library set name=btrim(p_name),archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
  else
    if p_expected_revision<>0 or p_archived then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    if p_image_path is null or p_image_path !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then raise check_violation using message='unverified_artwork'; end if;
    object_path:=substr(p_image_path,length('public-media/')+1);
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=object_path and claim.kind='good' and claim.status='verified'
        and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
    insert into public.goods_photo_library(id,image_path,name,created_by) values(p_id,p_image_path,btrim(p_name),actor) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.photo.saved','goods_photo:'||p_id::text,jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $function$;

-- admin_save_goods_preorder(text,uuid,uuid,jsonb,integer)
CREATE OR REPLACE FUNCTION public.admin_save_goods_preorder(p_good_id text, p_variant_id uuid, p_policy_id uuid, p_values jsonb, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); variant public.goods_variants; previous private.goods_preorder_policies; saved private.goods_preorder_policies;
  state_value text; capacity_value integer; starts_value timestamptz; ends_value timestamptz; date_value date; evidence_value text; is_admin boolean;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not coalesce(public.has_operator_capability('platform.manage',true),false) then raise insufficient_privilege using message='staff required'; end if;
  is_admin:=exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true));
  if jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','capacityQty','startsAt','endsAt','expectedShipDate','approvalReference')) then
    raise invalid_parameter_value using message='invalid_preorder_policy';
  end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise check_violation using message='invalid_preorder_policy'; end if;
  if state_value='active' and not is_admin then raise insufficient_privilege using message='preorder_admin_required'; end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if p_policy_id is not null then
    select * into previous from private.goods_preorder_policies where id=p_policy_id and variant_id=p_variant_id for update;
    if not found then raise no_data_found using message='preorder_policy_not_found'; end if;
  end if;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  if state_value='stopped' then
    if previous.state is null or previous.state='draft' then raise check_violation using message='preorder_not_active'; end if;
    if previous.state='stopped' then return jsonb_build_object('id',previous.id,'revision',previous.revision,'changed',false); end if;
    update private.goods_preorder_policies set state='stopped',stopped_by=actor,stopped_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  else
    if previous.state is not null and previous.state<>'draft' then raise check_violation using message='preorder_policy_immutable'; end if;
    if p_values->'capacityQty' is not null and p_values->'capacityQty'<>'null'::jsonb then
      if jsonb_typeof(p_values->'capacityQty')<>'number' or p_values->>'capacityQty' !~ '^[1-9][0-9]*$'
        or (p_values->>'capacityQty')::numeric>2147483647 then raise check_violation using message='invalid_preorder_policy'; end if;
      capacity_value:=(p_values->>'capacityQty')::integer;
    end if;
    if nullif(p_values->>'startsAt','') is not null then
      if jsonb_typeof(p_values->'startsAt')<>'string' or p_values->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      starts_value:=(p_values->>'startsAt')::timestamptz;
    end if;
    if nullif(p_values->>'endsAt','') is not null then
      if jsonb_typeof(p_values->'endsAt')<>'string' or p_values->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      ends_value:=(p_values->>'endsAt')::timestamptz;
    end if;
    if nullif(p_values->>'expectedShipDate','') is not null then
      if p_values->>'expectedShipDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise check_violation using message='invalid_preorder_policy'; end if;
      date_value:=(p_values->>'expectedShipDate')::date;
    end if;
    if p_values->'approvalReference' is not null and p_values->'approvalReference'<>'null'::jsonb and jsonb_typeof(p_values->'approvalReference')<>'string' then
      raise check_violation using message='invalid_preorder_policy';
    end if;
    evidence_value:=nullif(btrim(p_values->>'approvalReference'),'');
    if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
      or (starts_value is not null and ends_value is not null and starts_value>=ends_value)
      or length(evidence_value)>2000 then raise check_violation using message='invalid_preorder_policy'; end if;
    if state_value='active' then
      if to_regprocedure('private.preorder_checkout_ready()') is null then raise check_violation using message='preorder_runtime_not_ready'; end if;
      if capacity_value is null or starts_value is null or ends_value is null or date_value is null or evidence_value is null
        or ends_value<=clock_timestamp() or date_value<(ends_value at time zone 'Asia/Seoul')::date then
        raise check_violation using message='preorder_policy_not_configured';
      end if;
      if variant.archived_at is not null then raise check_violation using message='goods_variant_inactive'; end if;
      if exists(select 1 from private.goods_preorder_policies where variant_id=variant.id and state='active' and id is distinct from previous.id) then
        raise check_violation using message='preorder_policy_already_active';
      end if;
    end if;
    if previous.id is null then
      insert into private.goods_preorder_policies(variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
      values(variant.id,state_value,capacity_value,starts_value,ends_value,date_value,evidence_value,actor,
        case when state_value='active' then actor end,case when state_value='active' then clock_timestamp() end) returning * into saved;
    else
      update private.goods_preorder_policies set state=state_value,capacity_qty=capacity_value,starts_at=starts_value,ends_at=ends_value,
        expected_ship_date=date_value,approval_reference=evidence_value,revision=revision+1,updated_at=clock_timestamp(),
        activated_by=case when state_value='active' then actor end,activated_at=case when state_value='active' then clock_timestamp() end
        where id=previous.id returning * into saved;
    end if;
    if saved.state='active' then update public.goods_variants set preorder_policy_id=saved.id where id=variant.id; end if;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorder_saved','goods:'||p_good_id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'changed',true);
end $function$;

-- admin_save_goods_price_period(text,uuid,uuid,jsonb,integer)
CREATE OR REPLACE FUNCTION public.admin_save_goods_price_period(p_good_id text, p_variant_id uuid, p_period_id uuid, p_period jsonb, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous private.goods_variant_price_periods;
  saved private.goods_variant_price_periods;
  variant public.goods_variants;
  next_state text;
  next_price integer;
  next_start timestamptz;
  next_end timestamptz;
  next_regular integer;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(p_period) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_period) key where key not in ('state','discountPrice','startsAt','endsAt'))
    or p_period->>'state' is null or p_period->>'state' not in ('draft','active','disabled') then
    raise check_violation using message='invalid_price_period';
  end if;
  next_state:=p_period->>'state';
  if coalesce(jsonb_typeof(p_period->'discountPrice'),'null')<>'null' then
    if jsonb_typeof(p_period->'discountPrice')<>'number' or p_period->>'discountPrice' !~ '^[1-9][0-9]*$'
      or (p_period->>'discountPrice')::numeric>2147483647 then
      raise check_violation using message='invalid_price_period';
    end if;
    next_price:=(p_period->>'discountPrice')::integer;
  end if;
  if coalesce(jsonb_typeof(p_period->'startsAt'),'null')<>'null' then
    if jsonb_typeof(p_period->'startsAt')<>'string' or p_period->>'startsAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise check_violation using message='price_period_timezone_required';
    end if;
    next_start:=(p_period->>'startsAt')::timestamptz;
  end if;
  if coalesce(jsonb_typeof(p_period->'endsAt'),'null')<>'null' then
    if jsonb_typeof(p_period->'endsAt')<>'string' or p_period->>'endsAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise check_violation using message='price_period_timezone_required';
    end if;
    next_end:=(p_period->>'endsAt')::timestamptz;
  end if;
  if next_state='active' and (next_price is null or next_start is null or next_end is null) then
    raise check_violation using message='price_period_not_configured';
  end if;
  if (next_start is not null and not isfinite(next_start)) or (next_end is not null and not isfinite(next_end))
    or (next_start is not null and next_end is not null and next_start>=next_end) then
    raise check_violation using message='invalid_price_period';
  end if;
  perform 1 from public.goods where id=p_good_id for update;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise check_violation using message='goods_variant_not_found'; end if;
  next_regular:=variant.price;
  if p_period_id is not null then
    select * into previous from private.goods_variant_price_periods
      where id=p_period_id and good_id=p_good_id and variant_id=p_variant_id for update;
    if not found then raise no_data_found using message='price_period_not_found'; end if;
    if p_expected_revision is null or previous.revision<>p_expected_revision then
      raise sqlstate 'PT409' using message='price_period_changed';
    end if;
    if previous.state<>'draft' then next_regular:=previous.regular_price; end if;
    update private.goods_variant_price_periods set state=next_state,regular_price=next_regular,
      discount_price=next_price,starts_at=next_start,ends_at=next_end,revision=revision+1,
      updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=p_period_id returning * into saved;
  else
    if p_expected_revision is not null then raise check_violation using message='invalid_price_period'; end if;
    insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)
    values(p_good_id,p_variant_id,next_state,next_regular,next_price,next_start,next_end,auth.uid(),auth.uid())
    returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.price_period_saved','goods:'||p_good_id,
    jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,
    'ipId',(select ip_id from public.goods where id=p_good_id));
end $function$;

-- admin_save_goods_relation(uuid,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_goods_relation(p_id uuid, p_expected_revision integer, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); prior public.goods_relations; saved public.goods_relations; before_document jsonb;
  ids text[]; representative text; relation_kind text; title_value text; starts_value timestamptz; ends_value timestamptz;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_values) is distinct from 'object'
    or not(p_values ?& array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds'])
    or exists(select 1 from jsonb_object_keys(p_values) key where key<>all(array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds']))
    or jsonb_typeof(p_values->'kind') is distinct from 'string' or p_values->>'kind' not in ('together','similar')
    or jsonb_typeof(p_values->'title') is distinct from 'string' or char_length(btrim(p_values->>'title')) not between 1 and 15
    or jsonb_typeof(p_values->'representativeGoodId') is distinct from 'string'
    or jsonb_typeof(p_values->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_values->'goodIds') is distinct from 'array'
    or jsonb_typeof(p_values->'startsAt') not in ('null','string') or jsonb_typeof(p_values->'endsAt') not in ('null','string')
  then raise invalid_parameter_value using message='invalid_goods_relation'; end if;
  relation_kind:=p_values->>'kind'; title_value:=btrim(p_values->>'title'); representative:=p_values->>'representativeGoodId';
  if jsonb_array_length(p_values->'goodIds') not between 2 and (case when relation_kind='together' then 6 else 10 end)
    or exists(select 1 from jsonb_array_elements(p_values->'goodIds') value where jsonb_typeof(value)<>'string')
  then raise invalid_parameter_value using message='invalid_goods_relation_goods'; end if;
  select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or not(representative=any(ids))
    or exists(select 1 from unnest(ids) requested(id) where not exists(select 1 from public.goods g where g.id=requested.id))
  then raise invalid_parameter_value using message='invalid_goods_relation_goods'; end if;
  begin
    starts_value:=(p_values->>'startsAt')::timestamptz; ends_value:=(p_values->>'endsAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise invalid_parameter_value using message='invalid_goods_relation_period';
  end;
  if starts_value is not null and not isfinite(starts_value) or ends_value is not null and not isfinite(ends_value)
    or starts_value is not null and ends_value is not null and starts_value>=ends_value
  then raise invalid_parameter_value using message='invalid_goods_relation_period'; end if;
  -- A caller-generated id makes a retry of a new form collide with the first save.
  if p_expected_revision=0 then
    insert into public.goods_relations(id,kind,title,representative_good_id,enabled,starts_at,ends_at,created_by,updated_by)
      values(p_id,relation_kind,title_value,representative,(p_values->>'enabled')::boolean,starts_value,ends_value,actor,actor)
      on conflict(id) do nothing returning * into saved;
    if saved.id is null then raise sqlstate 'PT409' using message='goods_relation_changed'; end if;
  else
    select * into prior from public.goods_relations where id=p_id for update;
    if prior.id is null or prior.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_relation_changed'; end if;
    before_document:=private.goods_relation_document(p_id);
    update public.goods_relations set kind=relation_kind,title=title_value,representative_good_id=representative,
      enabled=(p_values->>'enabled')::boolean,starts_at=starts_value,ends_at=ends_value,
      revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning * into saved;
  end if;
  delete from public.goods_relation_members where relation_id=p_id;
  insert into public.goods_relation_members(relation_id,good_id,position)
    select p_id,id,position::integer from unnest(ids) with ordinality item(id,position);
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.relation.saved','goods_relation:'||p_id,
    jsonb_build_object('before',before_document,'after',private.goods_relation_document(p_id)));
  return jsonb_build_object('id',p_id,'revision',saved.revision);
end $function$;

-- admin_save_goods_variant_external_identity(text,uuid,text,text,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_goods_variant_external_identity(target_good_id text, target_variant_id uuid, target_erp_code text, target_erp_name text, target_barcode text, target_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return private.save_goods_variant_external_identity(
    target_good_id,
    target_variant_id,
    target_erp_code,
    target_erp_name,
    target_barcode,
    target_expected_updated_at,
    auth.uid()
  );
end;
$function$;

-- admin_save_goods_variant_purchase_cost(text,uuid,integer,text,integer)
CREATE OR REPLACE FUNCTION public.admin_save_goods_variant_purchase_cost(p_good_id text, p_variant_id uuid, p_unit_cost_krw integer, p_tax_basis text, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',true);
return (select private.save_goods_variant_purchase_cost(p_good_id,p_variant_id,p_unit_cost_krw,p_tax_basis,p_expected_revision));
end;
$function$;

-- admin_save_home_layout(uuid,bigint,jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_home_layout(target_operation_id uuid, expected_revision bigint, target_blocks jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid()); previous public.home_layout_settings; saved public.home_layout_settings;
  audit_entry public.audit_log; request_payload jsonb; block_ref record;
begin
  perform private.require_operator_capability('store.manage',false);

  if actor is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.has_operator_capability('store.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if target_operation_id is null or expected_revision is null or expected_revision<0
    or target_blocks is null or not private.is_valid_home_layout_blocks(target_blocks)
  then raise invalid_parameter_value using message='invalid_home_layout'; end if;
  request_payload := pg_catalog.jsonb_build_object('expected_revision',expected_revision,'blocks',target_blocks);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_home_layout_operation:'||target_operation_id::text,0));
  select * into audit_entry from public.audit_log where id=target_operation_id;
  if found then
    if audit_entry.actor_id=actor and audit_entry.action='admin.home_layout.saved'
      and audit_entry.target='home_layout_settings' and audit_entry.diff->'request'=request_payload
    then return (audit_entry.diff->'after'->>'revision')::bigint; end if;
    raise unique_violation using message='operation_conflict';
  end if;

  select * into previous from public.home_layout_settings where singleton for update;
  if not found or previous.revision<>expected_revision then
    raise sqlstate 'PT409' using message='home_layout_conflict';
  end if;
  for block_ref in
    select split_part(entry->>'key',':',2)::uuid as id,
      case split_part(entry->>'key',':',1) when 'band' then 'band_banner' when 'sales' then 'sales_best' when 'reviews' then 'review_best' else 'product_mosaic' end as kind
    from pg_catalog.jsonb_array_elements(target_blocks) entry
    where position(':' in (entry->>'key'))>0 order by entry->>'key'
  loop
    perform 1 from public.home_curations where id=block_ref.id and kind=block_ref.kind for share;
    if not found then raise no_data_found using message='home_layout_block_not_found'; end if;
  end loop;

  update public.home_layout_settings set blocks=target_blocks,revision=revision+1,updated_at=clock_timestamp()
  where singleton returning * into saved;
  insert into public.audit_log(id,actor_id,action,target,diff)
  values(target_operation_id,actor,'admin.home_layout.saved','home_layout_settings',pg_catalog.jsonb_build_object(
    'request',request_payload,
    'before',pg_catalog.jsonb_build_object('blocks',previous.blocks,'revision',previous.revision),
    'after',pg_catalog.jsonb_build_object('blocks',saved.blocks,'revision',saved.revision)
  ));
  return saved.revision;
end;
$function$;

-- admin_save_loyalty_policy(jsonb,integer,uuid)
CREATE OR REPLACE FUNCTION public.admin_save_loyalty_policy(p_tiers jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.loyalty_settings; saved public.loyalty_settings; existing public.audit_log; result jsonb;
begin
  perform private.require_operator_capability('marketing.manage',true);

  if private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  perform 1 from public.profiles where id=actor and private.has_operator_capability(id,'marketing.manage',true) and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='admin_required'; end if;
  if p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or not coalesce(private.loyalty_criteria_valid(p_tiers),false)
    then raise invalid_parameter_value using message='invalid_loyalty_policy'; end if;
  select * into strict previous from public.loyalty_settings where singleton for update;
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='commerce.loyalty.policy_updated' and existing.target='loyalty_settings'
      and existing.diff->'after'=p_tiers and (existing.diff->>'expectedRevision')::integer=p_expected_revision then return existing.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='loyalty_policy_changed'; end if;
  update public.loyalty_settings set tiers=p_tiers,revision=revision+1,updated_at=clock_timestamp() where singleton returning * into saved;
  result:=jsonb_build_object('revision',saved.revision,'updatedAt',saved.updated_at);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'commerce.loyalty.policy_updated','loyalty_settings',
    jsonb_build_object('before',previous.tiers,'after',saved.tiers,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $function$;

-- admin_save_operations_contact(text,uuid,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_operations_contact(target_scope text, target_origin_id uuid, target_values jsonb, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  previous private.operations_contacts;
  has_previous boolean;
  owner_value text;
  contact_value text;
  source_value text;
  handoff_value text;
  saved_at timestamptz;
  changed_fields text[];
  audit_target text;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor_id is null or not public.has_operator_capability('platform.manage',true)
    or not exists (select 1 from public.profiles profile where profile.id = actor_id and private.has_operator_capability(profile.id,'platform.manage',true)) then
    raise insufficient_privilege using message = 'admin_required';
  end if;
  if target_scope is null or target_scope not in ('operations', 'origin')
    or (target_scope = 'operations' and target_origin_id is not null)
    or (target_scope = 'origin' and target_origin_id is null) then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  if jsonb_typeof(target_values) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  if not (target_values ?& array['ownerName', 'contact', 'sourceReference', 'handoffReference'])
    or exists (select 1 from jsonb_object_keys(target_values) supplied_key
      where supplied_key not in ('ownerName', 'contact', 'sourceReference', 'handoffReference'))
    or exists (select 1 from jsonb_each(target_values) field
      where jsonb_typeof(field.value) is distinct from 'string' or (field.value #>> '{}') ~ '[[:cntrl:]]') then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;
  owner_value := btrim(target_values ->> 'ownerName');
  contact_value := btrim(target_values ->> 'contact');
  source_value := btrim(target_values ->> 'sourceReference');
  handoff_value := btrim(target_values ->> 'handoffReference');
  if char_length(owner_value) > 100 or char_length(contact_value) > 200
    or char_length(source_value) > 500 or char_length(handoff_value) > 500 then
    raise invalid_parameter_value using message = 'invalid_operations_contact';
  end if;

  audit_target := 'operations_contact:' || target_scope
    || case when target_origin_id is null then '' else ':' || target_origin_id::text end;
  -- Serialize even the first save, when SELECT FOR UPDATE has no row to lock.
  perform pg_advisory_xact_lock(hashtextextended(audit_target, 0));
  if target_scope = 'origin' then
    perform 1 from public.fulfillment_origins origin where origin.id = target_origin_id for key share;
    if not found then
      raise no_data_found using message = 'operations_contact_origin_not_found';
    end if;
  end if;
  select saved.* into previous from private.operations_contacts saved
    where saved.scope = target_scope and saved.origin_id is not distinct from target_origin_id for update;
  has_previous := found;
  if (case when has_previous then previous.updated_at else null::timestamptz end)
    is distinct from expected_updated_at then
    raise sqlstate 'PT409' using message = 'operations_contact_changed';
  end if;
  if has_previous and previous.owner_name = owner_value and previous.contact = contact_value
    and previous.source_reference = source_value and previous.handoff_reference = handoff_value then
    return previous.updated_at;
  end if;

  changed_fields := array_remove(array[
    case when previous.owner_name is distinct from owner_value then 'ownerName' end,
    case when previous.contact is distinct from contact_value then 'contact' end,
    case when previous.source_reference is distinct from source_value then 'sourceReference' end,
    case when previous.handoff_reference is distinct from handoff_value then 'handoffReference' end
  ], null);
  saved_at := case when has_previous
    then greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    else clock_timestamp() end;
  begin
    if has_previous then
      update private.operations_contacts saved set
        owner_name = owner_value, contact = contact_value, source_reference = source_value,
        handoff_reference = handoff_value, updated_by = actor_id, updated_at = saved_at
      where saved.scope = target_scope and saved.origin_id is not distinct from target_origin_id;
    else
      insert into private.operations_contacts(scope, origin_id, owner_name, contact, source_reference,
        handoff_reference, updated_by, updated_at)
      values(target_scope, target_origin_id, owner_value, contact_value, source_value,
        handoff_value, actor_id, saved_at);
    end if;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'operations_contact_changed';
  end;
  insert into public.audit_log(actor_id, action, target, diff, created_at)
  values(actor_id, 'admin.operations_contact.updated', audit_target,
    jsonb_build_object('scope', target_scope, 'originId', target_origin_id,
      'changedFields', changed_fields, 'previousVersion', previous.updated_at, 'updatedAt', saved_at), saved_at);
  return saved_at;
end;
$function$;

-- admin_save_origin_export_columns(uuid,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_origin_export_columns(target_id uuid, target_columns jsonb, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.fulfillment_origins;updated_stamp timestamptz:=clock_timestamp();actor uuid:=(select auth.uid());
begin
  perform private.require_operator_capability('platform.manage',true);

 if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then raise insufficient_privilege using message='admin required';end if;
 if private.valid_shipment_export_columns(target_columns) is distinct from true then raise check_violation using message='invalid_export_columns';end if;
 select * into previous from public.fulfillment_origins where id=target_id for update;
 if not found then raise no_data_found using message='origin_not_found';end if;
 if expected_updated_at is null or previous.updated_at<>expected_updated_at then raise sqlstate 'PT409' using message='origin_settings_changed';end if;
 update public.fulfillment_origins set export_columns=target_columns,updated_at=updated_stamp where id=target_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_origin.export_columns_updated','fulfillment_origins:'||target_id,
  jsonb_build_object('before',previous.export_columns,'after',target_columns));
 return updated_stamp;
end $function$;

-- admin_save_shipping_carrier(text,text,text,boolean,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_shipping_carrier(target_code text, target_label text, target_url text, target_active boolean, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.shipping_carriers; saved public.shipping_carriers;
  code_value text:=btrim(coalesce(target_code,'')); label_value text:=btrim(coalesce(target_label,'')); url_value text:=btrim(coalesce(target_url,''));
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then raise insufficient_privilege using message='admin_required'; end if;
  if code_value !~ '^[a-z0-9_]{2,32}$' or length(label_value) not between 1 and 60 or target_active is null
    or length(url_value)>500 or position('{trackingNumber}' in url_value)=0
    or url_value !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?[/#?]'
    or url_value ~ '[[:space:]\\]' then raise invalid_parameter_value using message='invalid_shipping_carrier'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_carrier:'||code_value,0));
  select * into previous from public.shipping_carriers where code=code_value for update;
  if found then
    if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
    update public.shipping_carriers set label=label_value,tracking_url_template=url_value,is_active=target_active
      where code=code_value returning * into saved;
  else
    if expected_updated_at is not null then raise no_data_found using message='shipping_carrier_not_found'; end if;
    insert into public.shipping_carriers(code,label,tracking_url_template,is_active)
      values(code_value,label_value,url_value,target_active) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_carrier.saved','shipping_carriers:'||code_value,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.updated_at;
end $function$;

-- admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_shipping_notice_template(target_id uuid, target_code text, target_version integer, target_name text, target_shipping_notice text, target_return_exchange_notice text, target_cs_name text, target_cs_phone text, target_cs_email text, expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_code text := btrim(coalesce(target_code, ''), E' \t\n\r');
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r');
  normalized_shipping text := btrim(coalesce(target_shipping_notice, ''), E' \t\n\r');
  normalized_return_exchange text := btrim(coalesce(target_return_exchange_notice, ''), E' \t\n\r');
  normalized_cs_name text := btrim(coalesce(target_cs_name, ''), E' \t\n\r');
  normalized_cs_phone text := btrim(coalesce(target_cs_phone, ''), E' \t\n\r');
  normalized_cs_email text := btrim(coalesce(target_cs_email, ''), E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if normalized_code !~ '^[a-z][a-z0-9-]{1,39}$'
    or target_version is null or target_version not between 1 and 1000000
    or char_length(normalized_name) not between 1 and 80
    or char_length(normalized_shipping) > 4000 or char_length(normalized_return_exchange) > 4000
    or char_length(normalized_cs_name) > 120 or char_length(normalized_cs_phone) > 80
    or char_length(normalized_cs_email) > 320
    or private.has_disallowed_shipping_notice_control(normalized_shipping)
    or private.has_disallowed_shipping_notice_control(normalized_return_exchange)
    or private.has_disallowed_shipping_notice_control(normalized_cs_name)
    or private.has_disallowed_shipping_notice_control(normalized_cs_phone)
    or private.has_disallowed_shipping_notice_control(normalized_cs_email)
  then
    raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
  end if;

  if target_id is not null then
    select * into previous from public.shipping_notice_templates where id = target_id for update;
    if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
    if previous.updated_at is distinct from expected_updated_at then
      raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
    end if;
    if previous.status <> 'draft' then
      raise check_violation using message = 'shipping_notice_template_active_immutable';
    end if;
    if previous.code <> normalized_code or previous.version <> target_version then
      raise check_violation using message = 'shipping_notice_template_identity_locked';
    end if;
    update public.shipping_notice_templates set
      name = normalized_name,
      shipping_notice = normalized_shipping,
      return_exchange_notice = normalized_return_exchange,
      cs_name = normalized_cs_name,
      cs_phone = normalized_cs_phone,
      cs_email = normalized_cs_email,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_id returning * into saved;
  else
    if expected_updated_at is not null then
      raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
    end if;
    insert into public.shipping_notice_templates(
      code, version, name, shipping_notice, return_exchange_notice, cs_name, cs_phone, cs_email
    ) values (
      normalized_code, target_version, normalized_name, normalized_shipping, normalized_return_exchange,
      normalized_cs_name, normalized_cs_phone, normalized_cs_email
    ) returning * into saved;
  end if;

  insert into public.audit_log(actor_id, action, target, diff)
    values (
      actor,
      case when target_id is null then 'catalog.shipping_notice_template.created'
        else 'catalog.shipping_notice_template.updated' end,
      'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved))
    );
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at);
end;
$function$;

-- admin_save_shipping_region_policy(uuid,jsonb,integer)
CREATE OR REPLACE FUNCTION public.admin_save_shipping_region_policy(p_policy_id uuid, p_values jsonb, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); v_configuration jsonb; previous private.shipping_region_policies; saved private.shipping_region_policies;
  origin public.fulfillment_origins; next_version integer;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true))
    or not coalesce(public.has_operator_capability('platform.manage',true),false) then raise insufficient_privilege using message='admin required'; end if;
  v_configuration:=private.normalize_shipping_region_policy(p_values);
  select * into origin from public.fulfillment_origins where id=(v_configuration->>'originId')::uuid for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if not exists(select 1 from public.shipping_carriers where code=v_configuration->>'carrierCode') then
    raise check_violation using message='shipping_region_carrier_invalid'; end if;
  if p_policy_id is null then
    if p_expected_revision is not null then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
    select coalesce(max(version),0)+1 into next_version from private.shipping_region_policies
      where origin_id=origin.id and carrier_code=v_configuration->>'carrierCode';
    insert into private.shipping_region_policies(origin_id,carrier_code,version,configuration,starts_at,ends_at,updated_by)
      values(origin.id,v_configuration->>'carrierCode',next_version,v_configuration,(v_configuration->>'startsAt')::timestamptz,
        (v_configuration->>'endsAt')::timestamptz,actor) returning * into saved;
  else
    select * into previous from private.shipping_region_policies where id=p_policy_id for update;
    if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
    if previous.origin_id<>origin.id or previous.carrier_code<>v_configuration->>'carrierCode' then
      raise check_violation using message='shipping_region_identity_immutable'; end if;
    if previous.status<>'draft' then raise check_violation using message='shipping_region_policy_immutable'; end if;
    if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
    update private.shipping_region_policies set configuration=v_configuration,
      starts_at=(v_configuration->>'startsAt')::timestamptz,
      ends_at=(v_configuration->>'endsAt')::timestamptz,
      revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.saved','shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'revision',saved.revision,
      'before',case when previous.id is not null then private.shipping_region_policy_record(previous) end,
      'after',private.shipping_region_policy_record(saved)));
  return private.shipping_region_policy_record(saved);
end $function$;

-- admin_save_shipping_settings_template(uuid,integer,text,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_shipping_settings_template(p_id uuid, p_expected_revision integer, p_name text, p_enabled boolean, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.shipping_settings_templates; saved public.shipping_settings_templates; normalized_settings jsonb; normalized_name text:=btrim(coalesce(p_name,''),E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage',false);

 if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_enabled is null
  or char_length(normalized_name) not between 1 and 80 or normalized_name ~ '[[:cntrl:]]'
 then raise invalid_parameter_value using message='invalid_shipping_settings_template'; end if;
 perform private.validate_shipping_settings(p_settings);
 normalized_settings:=jsonb_set(p_settings,'{originId}',to_jsonb((p_settings->>'originId')::uuid));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_settings_template:'||p_id,0));
 select * into previous from public.shipping_settings_templates where id=p_id for update;
 if (found and previous.revision<>p_expected_revision) or (not found and p_expected_revision<>0) then
  raise exception using errcode='PT409',message='shipping_settings_template_changed'; end if;
 perform id from public.fulfillment_origins where id=(p_settings->>'originId')::uuid and (not p_enabled or is_active) for share;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 insert into public.shipping_settings_templates(id,name,enabled,settings,created_by,updated_by)
  values(p_id,normalized_name,p_enabled,normalized_settings,actor,actor)
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,settings=excluded.settings,
  revision=public.shipping_settings_templates.revision+1,updated_by=actor,updated_at=clock_timestamp()
 returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.shipping_settings_template.saved','shipping_settings_templates:'||p_id,
  jsonb_build_object('before',case when previous.id is null then null else private.shipping_settings_template_json(previous) end,
   'after',private.shipping_settings_template_json(saved)));
 return private.shipping_settings_template_json(saved);
end $function$;

-- admin_save_store_branding(uuid,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_store_branding(target_operation_id uuid, target_values jsonb, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved_stamp timestamptz; existing public.audit_log; asset_path text;
begin
  perform private.require_operator_capability('store.manage',true);

  if actor is null or not public.has_operator_capability('store.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'store.manage',true)) then
    raise insufficient_privilege using message='admin_required';
  end if;
  if target_operation_id is null or not private.store_branding_valid(target_values) then
    raise invalid_parameter_value using message='invalid_store_branding';
  end if;
  -- A row lock serializes every settings section; a lost response can replay safely.
  select * into previous from public.store_settings where singleton for update;
  select * into existing from public.audit_log where id=target_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.store_settings.updated' and existing.target='store_settings:branding'
      and existing.diff->'after'=target_values then return (existing.diff->>'savedUpdatedAt')::timestamptz; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
  -- Both slots may reuse one asset; old saved slots are already trusted.
  for asset_path in select distinct value from jsonb_each_text(target_values)
    where key in ('logoPath','mobileLogoPath') and value is not null
      and value is distinct from previous.branding->>'logoPath' and value is distinct from previous.branding->>'mobileLogoPath'
  loop
    update public.admin_artwork_upload_claims as claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=substr(asset_path,length('public-media/')+1) and claim.kind='curation'
        and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null
        and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
  end loop;
  saved_stamp:=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond');
  update public.store_settings set branding=target_values,updated_at=saved_stamp where singleton;
  insert into public.audit_log(id,actor_id,action,target,diff) values(target_operation_id,actor,'admin.store_settings.updated','store_settings:branding',
    jsonb_build_object('before',previous.branding,'after',target_values,'savedUpdatedAt',saved_stamp));
  return saved_stamp;
end $function$;

-- admin_save_store_credit_policy(uuid,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_save_store_credit_policy(p_operation_id uuid, p_expected_version integer, p_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; previous private.store_credit_policy; operation private.store_credit_operations; saved jsonb;
begin
  perform private.require_operator_capability('marketing.manage',true);

  actor:=private.assert_store_credit_admin();
  if p_operation_id is null or jsonb_typeof(p_policy) is distinct from 'object' or p_expected_version is null
    or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('enabled','earnKind','earnValue','earnMaxPerOrder','maxBalance','validityDays','minUse','maxUse','restoreGraceDays','refundEarnedCreditMode','evidence'))
    or jsonb_typeof(p_policy->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_policy->'evidence') is distinct from 'string'
    or exists(select 1 from jsonb_each(p_policy) where key in ('earnValue','earnMaxPerOrder','maxBalance','validityDays','minUse','maxUse','restoreGraceDays') and (jsonb_typeof(value) not in ('number','null') or (jsonb_typeof(value)='number' and value::text !~ '^[0-9]+$')))
    then raise invalid_parameter_value using message='invalid_store_credit_policy'; end if;
  perform pg_advisory_xact_lock(hashtextextended('store_credit_operation:'||p_operation_id::text,0));
  select * into operation from private.store_credit_operations where operation_id=p_operation_id;
  if found then
    if operation.actor_id<>actor or operation.kind<>'policy' or operation.payload is distinct from jsonb_build_object('expectedVersion',p_expected_version,'policy',p_policy) then raise exception using errcode='PT409',message='store_credit_operation_conflict'; end if;
    return operation.result;
  end if;
  select * into previous from private.store_credit_policy where singleton for update;
  if previous.version<>p_expected_version then raise exception using errcode='PT409',message='store_credit_policy_conflict'; end if;
  update private.store_credit_policy set enabled=(p_policy->>'enabled')::boolean,
    earn_kind=p_policy->>'earnKind',earn_value=(p_policy->>'earnValue')::bigint,
    earn_max_per_order=(p_policy->>'earnMaxPerOrder')::bigint,max_balance=(p_policy->>'maxBalance')::bigint,
    validity_days=(p_policy->>'validityDays')::integer,min_use=(p_policy->>'minUse')::bigint,
    max_use=(p_policy->>'maxUse')::bigint,restore_grace_days=(p_policy->>'restoreGraceDays')::integer,
    refund_earned_credit_mode=p_policy->>'refundEarnedCreditMode',evidence=btrim(p_policy->>'evidence'),
    version=previous.version+1,updated_at=clock_timestamp() where singleton;
  saved:=private.store_credit_policy_json();
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.policy_saved','store_credit_policy',jsonb_build_object('before',to_jsonb(previous),'after',saved,'operationId',p_operation_id));
  insert into private.store_credit_operations(operation_id,actor_id,kind,payload,result)
    values(p_operation_id,actor,'policy',jsonb_build_object('expectedVersion',p_expected_version,'policy',p_policy),saved);
  return saved;
end $function$;

-- admin_save_store_navigation(uuid,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_store_navigation(target_operation_id uuid, target_values jsonb, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved_stamp timestamptz; existing public.audit_log;
begin
  perform private.require_operator_capability('store.manage',true);

  -- Freeze the active administrator role until the settings mutation commits.
  perform 1 from public.profiles where id=actor and private.has_operator_capability(id,'store.manage',true) and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='admin_required'; end if;
  if target_operation_id is null or not private.store_navigation_valid(target_values) then
    raise invalid_parameter_value using message='invalid_store_navigation';
  end if;
  select * into previous from public.store_settings where singleton for update;
  if not found then raise no_data_found using message='store_settings_missing'; end if;
  select * into existing from public.audit_log where id=target_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.store_settings.updated' and existing.target='store_settings:navigation'
      and existing.diff->'after'=target_values then return (existing.diff->>'savedUpdatedAt')::timestamptz; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
  saved_stamp:=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond');
  update public.store_settings set navigation=target_values,updated_at=saved_stamp where singleton;
  insert into public.audit_log(id,actor_id,action,target,diff) values(target_operation_id,actor,'admin.store_settings.updated','store_settings:navigation',
    jsonb_build_object('before',previous.navigation,'after',target_values,'savedUpdatedAt',saved_stamp));
  return saved_stamp;
end $function$;

-- admin_save_store_settings(text,jsonb,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_save_store_settings(target_section text, target_values jsonb, expected_updated_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.store_settings; saved public.store_settings; normalized jsonb; allowed text[]; filled integer; category text; notice jsonb; body_value text;
begin
  perform private.require_operator_capability(case when target_section='inquiry_auto_replies' then 'store.manage' else 'seller.manage' end,true);

  if actor is null or not public.has_operator_capability(case when target_section='inquiry_auto_replies' then 'store.manage' else 'seller.manage' end,true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,case when target_section='inquiry_auto_replies' then 'store.manage' else 'seller.manage' end,true)) then
    raise insufficient_privilege using message='admin_required';
  end if;
  if target_section='inquiry_auto_replies' then
    if jsonb_typeof(target_values) is distinct from 'object' then
      raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
    end if;
    if not target_values ?& array['order','claim','good','account','etc']
      or (select count(*) from jsonb_object_keys(target_values))<>5 then
      raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
    end if;
    normalized:='{}'::jsonb;
    for category,notice in select key,value from jsonb_each(target_values) loop
      if jsonb_typeof(notice) is distinct from 'object' then
        raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
      end if;
      if jsonb_typeof(notice->'enabled') is distinct from 'boolean'
        or jsonb_typeof(notice->'body') is distinct from 'string'
        or (select count(*) from jsonb_object_keys(notice))<>2 then
        raise invalid_parameter_value using message='invalid_inquiry_auto_replies';
      end if;
      -- Match JavaScript trim while preserving newlines inside operator-authored text.
      body_value:=btrim(notice->>'body',E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
      if length(body_value)>2000 or ((notice->>'enabled')::boolean and body_value='')
        or regexp_replace(body_value,E'[\t\n\r]','','g') ~ '[[:cntrl:]]' then
        raise invalid_parameter_value using message='invalid_inquiry_auto_reply_body';
      end if;
      normalized:=normalized||jsonb_build_object(category,jsonb_build_object('enabled',notice->'enabled','body',body_value));
    end loop;
    select * into previous from public.store_settings where singleton for update;
    if expected_updated_at is distinct from previous.updated_at then
      raise sqlstate 'PT409' using message='store_settings_conflict';
    end if;
    update public.store_settings set inquiry_auto_replies=normalized,
      updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
      where singleton returning * into saved;
    insert into public.audit_log(actor_id,action,target,diff)
      values(actor,'admin.store_settings.updated','store_settings:inquiry_auto_replies',
        jsonb_build_object('before',previous.inquiry_auto_replies,'after',normalized));
    return saved.updated_at;
  end if;
  if target_section not in ('business','bank_transfer') or target_section is null or jsonb_typeof(target_values) is distinct from 'object' then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  allowed:=case target_section when 'business' then array['companyName','representative','registrationNumber','mailOrderNumber','address','phone','email','hostingProvider'] else array['bank','accountNumber','holder'] end;
  if exists(select 1 from jsonb_each(target_values) where not(key=any(allowed)) or jsonb_typeof(value)<>'string') then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  select coalesce(jsonb_object_agg(key,btrim(value,E' \t\n\r\f\v')),'{}') into normalized from jsonb_each_text(target_values);
  if exists(select 1 from jsonb_each_text(normalized) where length(value)>500 or value ~ '[[:cntrl:]]')
    or (target_section='business' and coalesce(normalized->>'email','')<>'' and normalized->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise invalid_parameter_value using message='invalid_store_settings';
  end if;
  if target_section='bank_transfer' then
    select count(*) into filled from jsonb_each_text(normalized) where value<>'';
    if not normalized ?& allowed or filled not in (0,3) then raise invalid_parameter_value using message='incomplete_bank_account'; end if;
  end if;
  select * into previous from public.store_settings where singleton for update;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message='store_settings_conflict'; end if;
  update public.store_settings set
    business=case when target_section='business' then normalized else business end,
    bank_transfer=case when target_section='bank_transfer' then normalized else bank_transfer end,
    updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond') where singleton returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_settings.updated','store_settings:'||target_section,
    jsonb_build_object('before',case target_section when 'business' then previous.business else previous.bank_transfer end,
      'after',normalized));
  return saved.updated_at;
end $function$;

-- admin_search_coupon_console(text,text,integer,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_search_coupon_console(p_query text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(code text, name text, discount_type text, discount_value integer, max_discount_amount integer, min_subtotal integer, starts_at timestamp with time zone, ends_at timestamp with time zone, issue_limit integer, issued_count integer, status text, grade_benefit loyalty_grade, used_count bigint, total_count bigint, recipient_segment text, goods_scope text, target_good_ids text[], terms_revision integer, target_goods jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
  phase text := coalesce(p_filters->>'phase','all');
  discount text := coalesce(p_filters->>'discountType','all');
  segment text := coalesce(p_filters->>'segment','any');
  date_field text := coalesce(p_filters->>'dateField','created');
  sort_key text := coalesce(p_filters->>'sort','created_desc');
  date_from date := nullif(p_filters->>'from','')::date;
  date_to date := nullif(p_filters->>'to','')::date;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 or p_offset > 10000000
     or phase not in ('all','scheduled','live','ended','stopped')
     or discount not in ('all','fixed','percent')
     or segment not in ('any','all','first_purchase','repeat_purchase','grade')
     or date_field not in ('created','starts')
     or sort_key not in ('created_desc','name_asc','starts_desc','ends_asc')
     or (date_from is not null and date_to is not null and date_from > date_to) then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다. 나머지
  -- PostgREST 문법은 RPC 내부의 SQL 값으로만 취급되므로 필터 문자열을 만들지 않는다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count,
      coupon.recipient_segment,coupon.goods_scope,coupon.target_good_ids,coupon.terms_revision,public.admin_coupon_target_goods(coupon)
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
      and (discount='all' or coupon.discount_type=discount)
      and (segment='any' or (segment='grade' and coupon.grade_benefit is not null) or coupon.recipient_segment=segment)
      and (phase='all' or (phase='stopped' and coupon.status='archived')
        or (coupon.status='active' and ((phase='scheduled' and coupon.starts_at>now())
        or (phase='ended' and coupon.ends_at<=now())
        or (phase='live' and coupon.starts_at<=now() and (coupon.ends_at is null or coupon.ends_at>now())))))
      and (date_from is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) >= (date_from::timestamp at time zone 'Asia/Seoul'))
      and (date_to is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) < ((date_to+1)::timestamp at time zone 'Asia/Seoul'))
    order by case when sort_key='name_asc' then coupon.name end asc,
      case when sort_key='starts_desc' then coupon.starts_at end desc,
      case when sort_key='ends_asc' then coupon.ends_at end asc nulls last,
      coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$function$;

-- admin_search_coupon_console_scheduled(text,text,integer,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_search_coupon_console_scheduled(p_query text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(code text, name text, discount_type text, discount_value integer, max_discount_amount integer, min_subtotal integer, starts_at timestamp with time zone, ends_at timestamp with time zone, issue_limit integer, issued_count integer, status text, grade_benefit loyalty_grade, used_count bigint, total_count bigint, recipient_segment text, goods_scope text, target_good_ids text[], terms_revision integer, target_goods jsonb, issue_starts_at timestamp with time zone, issue_ends_at timestamp with time zone, valid_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
  phase text := coalesce(p_filters->>'phase','all');
  discount text := coalesce(p_filters->>'discountType','all');
  segment text := coalesce(p_filters->>'segment','any');
  date_field text := coalesce(p_filters->>'dateField','created');
  sort_key text := coalesce(p_filters->>'sort','created_desc');
  date_from date := nullif(p_filters->>'from','')::date;
  date_to date := nullif(p_filters->>'to','')::date;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 or p_offset > 10000000
     or phase not in ('all','scheduled','live','ended','stopped')
     or discount not in ('all','fixed','percent')
     or segment not in ('any','all','first_purchase','repeat_purchase','grade')
     or date_field not in ('created','starts')
     or sort_key not in ('created_desc','name_asc','starts_desc','ends_asc')
     or (date_from is not null and date_to is not null and date_from > date_to) then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다. 나머지
  -- PostgREST 문법은 RPC 내부의 SQL 값으로만 취급되므로 필터 문자열을 만들지 않는다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count,
      coupon.recipient_segment,coupon.goods_scope,coupon.target_good_ids,coupon.terms_revision,public.admin_coupon_target_goods(coupon),coupon.issue_starts_at,coupon.issue_ends_at,coupon.valid_days
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
      and (discount='all' or coupon.discount_type=discount)
      and (segment='any' or (segment='grade' and coupon.grade_benefit is not null) or coupon.recipient_segment=segment)
      and (phase='all' or (phase='stopped' and coupon.status='archived')
        or (coupon.status='active' and ((phase='scheduled' and coalesce(coupon.issue_starts_at,coupon.starts_at)>now())
        or (phase='ended' and least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=now())
        or (phase='live' and coalesce(coupon.issue_starts_at,coupon.starts_at)<=now() and (least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end) is null or least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)>now())))))
      and (date_from is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) >= (date_from::timestamp at time zone 'Asia/Seoul'))
      and (date_to is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) < ((date_to+1)::timestamp at time zone 'Asia/Seoul'))
    order by case when sort_key='name_asc' then coupon.name end asc,
      case when sort_key='starts_desc' then coupon.starts_at end desc,
      case when sort_key='ends_asc' then coupon.ends_at end asc nulls last,
      coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$function$;

-- admin_search_coupons(text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_coupons(p_query text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(code text, name text, discount_type text, discount_value integer, max_discount_amount integer, min_subtotal integer, starts_at timestamp with time zone, ends_at timestamp with time zone, issue_limit integer, issued_count integer, status text, grade_benefit loyalty_grade, used_count bigint, total_count bigint, recipient_segment text, goods_scope text, target_good_ids text[], terms_revision integer, target_goods jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다. 나머지
  -- PostgREST 문법은 RPC 내부의 SQL 값으로만 취급되므로 필터 문자열을 만들지 않는다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count,
      coupon.recipient_segment,coupon.goods_scope,coupon.target_good_ids,coupon.terms_revision,public.admin_coupon_target_goods(coupon)
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
    order by coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$function$;

-- admin_search_email_deliveries(text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_email_deliveries(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(dedupe_key text, template text, recipient text, subject text, status text, attempt_count integer, last_error text, claimed_at timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_status is not null and p_status not in ('pending', 'sent', 'failed') then
    raise check_violation using message = 'invalid email delivery status filter';
  end if;

  return query
  select
    delivery.dedupe_key,
    delivery.template,
    'masked'::text,
    ('legacy_' || delivery.template)::text,
    delivery.status,
    delivery.attempt_count,
    case when delivery.last_error is null then null else 'legacy_unverified' end,
    delivery.claimed_at,
    delivery.completed_at,
    delivery.created_at,
    count(*) over()::bigint
  from public.email_deliveries as delivery
  where p_status is null or delivery.status = p_status
  order by delivery.claimed_at desc, delivery.dedupe_key desc
  limit v_limit offset v_offset;
end;
$function$;

-- admin_search_erp_items(text,integer)
CREATE OR REPLACE FUNCTION public.admin_search_erp_items(p_query text, p_limit integer DEFAULT 8)
 RETURNS TABLE(code text, name text, category text, sale_price integer, barcode text, mapped_category_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_needle text := private.erp_item_text(p_query, true);
  v_escaped text;
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 1 and 50
     or pg_catalog.length(coalesce(v_needle, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_erp_item_search';
  end if;
  if v_needle is null then
    return;
  end if;

  v_escaped := pg_catalog.replace(
    pg_catalog.replace(pg_catalog.replace(v_needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_');

  return query
    select
      item.code,
      item.name,
      item.category,
      item.sale_price,
      item.barcode,
      private.erp_category_target(item.category)
    from public.erp_items as item
    where item.name ilike '%' || v_escaped || '%' escape E'\\'
       or item.code ilike '%' || v_escaped || '%' escape E'\\'
    order by
      case
        when pg_catalog.lower(item.code) = pg_catalog.lower(v_needle) then 0
        when item.name ilike v_escaped || '%' escape E'\\' then 1
        when item.code ilike v_escaped || '%' escape E'\\' then 2
        else 3
      end,
      pg_catalog.length(item.name),
      item.name,
      item.code
    limit p_limit;
end;
$function$;

-- admin_search_goods(text)
CREATE OR REPLACE FUNCTION public.admin_search_goods(search_text text DEFAULT NULL::text)
 RETURNS SETOF goods
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  needle text := btrim(coalesce(search_text, ''));
  pattern text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then
    raise insufficient_privilege using message = 'admin_only';
  end if;
  if length(needle) > 100 then
    raise invalid_parameter_value using message = 'goods_search_too_long';
  end if;
  pattern := '%' || replace(replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  return query
    select good.*
    from public.goods good
    where needle = ''
      or good.name ilike pattern escape E'\\'
      or coalesce(good.name_en, '') ilike pattern escape E'\\'
      or good.code ilike pattern escape E'\\'
      or good.id ilike pattern escape E'\\'
      or exists (
        select 1 from unnest(good.search_keywords) as item(keyword)
        where item.keyword ilike pattern escape E'\\'
      )
      or exists (
        select 1
        from public.goods_variants variant
        left join private.goods_variant_external_identity external_identity
          on external_identity.variant_id = variant.id
        where variant.good_id = good.id
          and (
            variant.code ilike pattern escape E'\\'
            or external_identity.erp_code ilike pattern escape E'\\'
            or external_identity.erp_name ilike pattern escape E'\\'
            or external_identity.barcode ilike pattern escape E'\\'
          )
      );
end;
$function$;

-- admin_search_goods_additional(text,text)
CREATE OR REPLACE FUNCTION public.admin_search_goods_additional(p_base_good_id text, p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pattern text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if length(btrim(coalesce(p_query,'')))<1 or length(p_query)>100 then return '[]'::jsonb; end if;
  pattern := '%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',candidate.id,'name',candidate.name,'available',true)
    order by candidate.name,candidate.id),'[]'::jsonb) from (
      select good.id,good.name from public.goods good where good.id<>p_base_good_id
        and private.goods_additional_available(good.id)
        and (good.name ilike pattern escape E'\\' or good.id ilike pattern escape E'\\')
      order by good.name,good.id limit 50) candidate);
end $function$;

-- admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)
CREATE OR REPLACE FUNCTION public.admin_search_goods_console(p_query text DEFAULT ''::text, p_ip_id text DEFAULT ''::text, p_status text DEFAULT 'active'::text, p_stock text DEFAULT 'all'::text, p_category_id uuid DEFAULT NULL::uuid, p_readiness text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  sort_value text := coalesce(p_filters->>'sort', 'created_desc');
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 0 and 100 or p_offset is null or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_goods_console_page';
  end if;
  if p_status is null or p_status not in ('active','all','draft','published','archived') then
    raise invalid_parameter_value using message = 'invalid_goods_console_status';
  end if;
  with scope as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all',p_stock,p_category_id,p_readiness,p_filters)
  ), matched as materialized (
    select * from scope where case p_status
      when 'all' then true when 'archived' then (good).archived_at is not null
      when 'draft' then (good).archived_at is null and (good).published_at is null
      when 'published' then (good).archived_at is null and (good).published_at is not null
      else (good).archived_at is null end
  ), ordered as (
    select *, row_number() over(order by
      case when sort_value = 'created_desc' then (good).created_at end desc nulls last,
      case when sort_value = 'updated_desc' then (good).updated_at end desc nulls last,
      case when sort_value = 'name_asc' then (good).name end asc nulls last,
      case when sort_value = 'price_asc' then (readiness->>'priceMin')::bigint end asc nulls last,
      case when sort_value = 'price_desc' then (readiness->>'priceMin')::bigint end desc nulls last,
      case when sort_value = 'stock_asc' then (readiness->>'availableQty')::bigint end asc nulls last,
      case when sort_value = 'stock_desc' then (readiness->>'availableQty')::bigint end desc nulls last,
      (good).id asc) as position
    from matched
  ), page as (select * from ordered order by position limit p_limit offset p_offset)
  select jsonb_build_object(
    'checkedAt',statement_timestamp(), 'total',(select count(*) from matched),
    'statusCounts',(select jsonb_build_object(
      'all',count(*), 'active',count(*) filter(where (good).archived_at is null),
      'draft',count(*) filter(where (good).archived_at is null and (good).published_at is null),
      'published',count(*) filter(where (good).archived_at is null and (good).published_at is not null),
      'archived',count(*) filter(where (good).archived_at is not null)) from scope),
    'reasonCounts',coalesce((select jsonb_object_agg(code,total) from (
      select code,count(*) total from matched cross join lateral jsonb_array_elements_text(readiness->'reasonCodes') code group by code
    ) counts),'{}'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',(good).id,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,
      'ipTitle',(select title from public.ips where id=(good).ip_id),
      'categoryId',(good).category_id,'categoryName',(select name from public.catalog_categories where id=(good).category_id),
      'imagePath',(good).image_path,'publishedAt',(good).published_at,'archivedAt',(good).archived_at,
      'createdAt',(good).created_at,'updatedAt',(good).updated_at,
      'stock',(good).stock,'stockQty',(good).stock_qty,'readiness',readiness
    ) order by position) from page),'[]')
  ) into result;
  return result;
end $function$;

-- admin_search_goods_for_announcement(text,integer)
CREATE OR REPLACE FUNCTION public.admin_search_goods_for_announcement(p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.announcements',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.announcements',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
    raise invalid_parameter_value using message='invalid_goods_announcement_search';
  end if;
  with matched as materialized(select id,name,code from public.goods where archived_at is null and
    (p_query='' or strpos(lower(name),lower(btrim(p_query)))>0 or strpos(lower(code),lower(btrim(p_query)))>0 or id=btrim(p_query))),
  page as (select * from matched order by name,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'archived',false) order by name,id) from page),'[]')) into result;
  return result;
end $function$;

-- admin_search_goods_for_relation(text,integer)
CREATE OR REPLACE FUNCTION public.admin_search_goods_for_relation(p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
    raise invalid_parameter_value using message='invalid_goods_relation_filter'; end if;
  with matches as materialized (
    select g.id,g.name,g.code,g.image_path,g.published_at is not null and g.sale_restriction='none'
      and i.archived_at is null and i.published_at is not null as is_public
    from public.goods g join public.ips i on i.id=g.ip_id where g.archived_at is null and (btrim(p_query)=''
      or strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)
  ), page_rows as (select * from matches order by is_public desc,name,id limit 20 offset(p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'pageSize',20,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'imagePath',image_path,'public',is_public)
      order by is_public desc,name,id) from page_rows),'[]'::jsonb)) into result;
  return result;
end $function$;

-- admin_search_goods_for_shipping_settings(text,integer)
CREATE OR REPLACE FUNCTION public.admin_search_goods_for_shipping_settings(p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; pattern text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if (select auth.uid()) is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_shipping_settings_filter'; end if;
 pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with matched as (select g.* from public.goods g where g.archived_at is null and (g.name ilike pattern escape E'\\' or g.code ilike pattern escape E'\\' or g.id ilike pattern escape E'\\')),
 page as (select * from matched order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',page.id,'name',page.name,'code',page.code,'updatedAt',page.updated_at,'settings',private.good_shipping_settings(page),
  'templateId',page.shipping_settings_template_id,'templateRevision',page.shipping_settings_template_revision)
  order by page.updated_at desc,page.id),'[]')) into result from page;
 return result;
end $function$;

-- admin_search_goods_workspace(text,text,text,text,uuid,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_goods_workspace(p_query text DEFAULT ''::text, p_ip_id text DEFAULT ''::text, p_status text DEFAULT 'active'::text, p_stock text DEFAULT 'all'::text, p_category_id uuid DEFAULT NULL::uuid, p_readiness text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_limit is null or p_limit not between 0 and 100 or p_offset is null or p_offset<0 then raise invalid_parameter_value using message='invalid_goods_workspace_page'; end if;
  with matched as materialized (
    select * from private.admin_goods_workspace_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness)
  ), page as (select * from matched order by (good).id limit p_limit offset p_offset)
  select jsonb_build_object('checkedAt',statement_timestamp(),'total',(select count(*) from matched),
    'reasonCounts',coalesce((select jsonb_object_agg(code,total) from (
      select code,count(*) total from matched cross join lateral jsonb_array_elements_text(readiness->'reasonCodes') code group by code
    ) counts),'{}'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',(good).id,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,
      'ipTitle',(select title from public.ips where id=(good).ip_id),
      'categoryId',(good).category_id,'categoryName',(select name from public.catalog_categories where id=(good).category_id),
      'imagePath',(good).image_path,'publishedAt',(good).published_at,'archivedAt',(good).archived_at,
      'stock',(good).stock,'stockQty',(good).stock_qty,'readiness',readiness) order by (good).id) from page),'[]')) into result;
  return result;
end $function$;

-- admin_search_inquiries(text,text,date,date,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_inquiries(p_status text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_field text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, reference bigint, category text, title text, status text, user_id uuid, buyer_name text, buyer_email text, order_id uuid, good_id text, good_name text, handled_by uuid, handler_name text, created_at timestamp with time zone, last_message_at timestamp with time zone, answered_at timestamp with time zone, closed_at timestamp with time zone, message_count bigint, total_count bigint, assignee_id uuid, assignee_name text, waiting_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('open', 'answered', 'closed') then
    raise check_violation using message = 'invalid_inquiry_status_filter';
  end if;
  if p_category is not null
    and p_category not in ('order', 'claim', 'good', 'account', 'etc')
  then
    raise check_violation using message = 'invalid_inquiry_category_filter';
  end if;
  if v_field not in ('all', 'title', 'buyer', 'order') then
    raise check_violation using message = 'invalid_inquiry_search_field';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_inquiry_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'inquiry_search_query_too_long';
  end if;

  return query
  select
    thread.id,
    thread.reference,
    thread.category,
    thread.title,
    thread.status,
    thread.user_id,
    buyer.nickname as buyer_name,
    buyer.email as buyer_email,
    case when public.has_operator_capability('sales.read') then thread.order_id else null::uuid end,
    thread.good_id,
    good.name as good_name,
    thread.handled_by,
    handler.nickname as handler_name,
    thread.created_at,
    thread.last_message_at,
    thread.answered_at,
    thread.closed_at,
    (
      select count(*)
      from public.inquiry_messages as message
      where message.inquiry_id = thread.id
    ) as message_count,
    count(*) over()::bigint as total_count,
    thread.assignee_id,
    case when assignee.id is null then null else
      coalesce(nullif(btrim(assignee.nickname), ''), '운영자_' || left(assignee.id::text, 6)) end,
    thread.waiting_since
  from public.inquiries as thread
  join public.profiles as buyer on buyer.id = thread.user_id
  left join public.profiles as handler on handler.id = thread.handled_by
  left join public.profiles as assignee on assignee.id = thread.assignee_id
  left join public.goods as good on good.id = thread.good_id
  where (p_status is null or thread.status = p_status)
    and (p_category is null or thread.category = p_category)
    and (
      p_from is null
      or thread.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or thread.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'title')
        and position(lower(v_query) in lower(thread.title)) > 0
      )
      or (
        v_field in ('all', 'buyer')
        and (
          position(lower(v_query) in lower(coalesce(buyer.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(buyer.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'order') and public.has_operator_capability('sales.read')
        and (
          position(lower(v_query) in lower(coalesce(thread.order_id::text, ''))) > 0
          or lower(v_query) = lower(thread.reference::text)
        )
      )
    )
  /* 미답변이 먼저, 그중에서도 오래 기다린 것이 위로. 종결은 맨 아래다. */
  order by
    case thread.status when 'open' then 0 when 'answered' then 1 else 2 end,
    case when thread.status = 'open' then thread.waiting_since else thread.last_message_at end,
    thread.id
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_members(text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_members(target_query text DEFAULT NULL::text, target_limit integer DEFAULT 20, target_offset integer DEFAULT 0)
 RETURNS TABLE(profile_id uuid, nickname text, masked_email text, role user_role, created_at timestamp with time zone, suspended_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_query text := nullif(
    pg_catalog.btrim(coalesce(target_query, ''), E' \t\n\r\f\v'),
    ''
  );
  normalized_limit integer := least(
    greatest(coalesce(target_limit, 20), 1),
    100
  );
  normalized_offset integer := greatest(
    coalesce(target_offset, 0),
    0
  );
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_query is not null and pg_catalog.length(normalized_query) > 100 then
    raise exception 'member_search_query_too_long' using errcode = '22023';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || pg_catalog.left(profile.id::text, 6)
    ),
    case
      when nullif(pg_catalog.btrim(coalesce(profile.email, '')), '') is null
        then '이메일 없음'::text
      when pg_catalog.strpos(profile.email, '@') > 1
        then pg_catalog.left(pg_catalog.split_part(profile.email, '@', 1), 1)
          || '***@'
          || pg_catalog.split_part(profile.email, '@', 2)
      else '***'::text
    end,
    profile.role,
    profile.created_at,
    profile.suspended_at,
    pg_catalog.count(*) over()::bigint
  from public.profiles as profile
  where normalized_query is null
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.nickname, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.email, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
  order by case when pg_catalog.lower(profile.email)=pg_catalog.lower(normalized_query) then 0 else 1 end,
    profile.created_at desc, profile.id desc
  limit normalized_limit
  offset normalized_offset;
end;
$function$;

-- admin_search_order_claims(text,text,text,date,date,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_order_claims(p_claim_type text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_reason_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, reference bigint, order_id uuid, claim_type text, stage text, reason_type text, buyer_id uuid, buyer_name text, buyer_email text, order_status order_status, order_total bigint, requested_at timestamp with time zone, collected_at timestamp with time zone, completed_at timestamp with time zone, refund_method text, handler_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_stages text[];
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_claim_type is not null and p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type filter';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid claim date range';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'claim search query too long';
  end if;

  -- 'open'은 단계 하나가 아니라 "아직 끝나지 않은 것 전부"다. 화면이 이 집합을
  -- 직접 나열하면 단계를 하나 더할 때 목록에서만 조용히 빠진다.
  if p_stage = 'open' then
    v_stages := array[
      'requested', 'in_review', 'collecting', 'collected',
      'on_hold', 'processing', 'needs_review'
    ];
  elsif p_stage is not null then
    v_stages := array[p_stage];
  end if;

  return query
  select
    request.id,
    request.reference,
    request.order_id,
    request.claim_type,
    request.stage,
    request.reason_type,
    orders.user_id as buyer_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status as order_status,
    orders.total as order_total,
    request.requested_at,
    request.collected_at,
    request.completed_at,
    refund.method as refund_method,
    handler.nickname as handler_name,
    count(*) over()::bigint as total_count
  from public.order_cancellation_requests as request
  join public.orders as orders on orders.id = request.order_id
  join public.profiles as profile on profile.id = orders.user_id
  left join public.profiles as handler on handler.id = request.decided_by
  left join lateral (
    select payment_refund.method
    from public.refunds as payment_refund
    join public.payments as payment on payment.id = payment_refund.payment_id
    where payment.purpose = 'order'
      and payment.ref_id = request.order_id
    order by payment_refund.created_at desc, payment_refund.id desc
    limit 1
  ) as refund on true
  where (p_claim_type is null or request.claim_type = p_claim_type)
    and (v_stages is null or request.stage = any(v_stages))
    and (p_reason_type is null or request.reason_type = p_reason_type)
    and (
      p_from is null
      or request.requested_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or request.requested_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or position(lower(v_query) in lower(request.order_id::text)) > 0
      or position(lower(v_query) in lower(request.reference::text)) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
    )
  order by request.requested_at desc, request.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_search_order_claims_console(p_claim_type text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_reason_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'requested'::text, p_sort text DEFAULT 'newest'::text)
 RETURNS TABLE(id uuid, reference bigint, order_id uuid, claim_type text, stage text, reason_type text, buyer_id uuid, buyer_name text, buyer_email text, order_status order_status, order_total bigint, requested_at timestamp with time zone, collected_at timestamp with time zone, completed_at timestamp with time zone, refund_method text, handler_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_stages text[];
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_claim_type is not null and p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type filter';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid claim date range';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'claim search query too long';
  end if;

  if p_field is null or p_field not in ('all','order','buyer','email')
    or p_date_field is null or p_date_field not in ('requested','collected','completed')
    or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') then
    raise invalid_parameter_value using message='invalid_claim_search';
  end if;

  -- 'open'은 단계 하나가 아니라 "아직 끝나지 않은 것 전부"다. 화면이 이 집합을
  -- 직접 나열하면 단계를 하나 더할 때 목록에서만 조용히 빠진다.
  if p_stage = 'open' then
    v_stages := array[
      'requested', 'in_review', 'collecting', 'collected',
      'on_hold', 'processing', 'needs_review'
    ];
  elsif p_stage is not null then
    v_stages := array[p_stage];
  end if;

  return query
  select
    request.id,
    request.reference,
    request.order_id,
    request.claim_type,
    request.stage,
    request.reason_type,
    orders.user_id as buyer_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status as order_status,
    orders.total as order_total,
    request.requested_at,
    request.collected_at,
    request.completed_at,
    refund.method as refund_method,
    handler.nickname as handler_name,
    count(*) over()::bigint as total_count
  from public.order_cancellation_requests as request
  join public.orders as orders on orders.id = request.order_id
  join public.profiles as profile on profile.id = orders.user_id
  left join public.profiles as handler on handler.id = request.decided_by
  left join lateral (
    select payment_refund.method
    from public.refunds as payment_refund
    join public.payments as payment on payment.id = payment_refund.payment_id
    where payment.purpose = 'order'
      and payment.ref_id = request.order_id
    order by payment_refund.created_at desc, payment_refund.id desc
    limit 1
  ) as refund on true
  where (p_claim_type is null or request.claim_type = p_claim_type)
    and (v_stages is null or request.stage = any(v_stages))
    and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,v_query,p_field,p_date_field)
  order by
    case when p_sort='amount_high' then orders.total end desc nulls last,
    case when p_sort='amount_low' then orders.total end asc nulls last,
    case when p_sort='oldest' then private.admin_sales_claim_date(request,p_date_field) end asc nulls last,
    case when p_sort<>'oldest' then private.admin_sales_claim_date(request,p_date_field) end desc nulls last,
    case when p_sort='oldest' then request.id end asc,
    request.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_orders(text,date,date,text,integer,integer,timestamp with time zone,text)
CREATE OR REPLACE FUNCTION public.admin_search_orders(p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_confirmed_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_field text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, user_id uuid, buyer_name text, buyer_email text, status order_status, total bigint, address jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, shipping_carrier text, tracking_number text, confirmed_at timestamp with time zone, shipped_at timestamp with time zone, delivered_at timestamp with time zone, done_at timestamp with time zone, cancellation_request_id uuid, cancellation_request_status text, cancellation_reason_type text, cancellation_requested_at timestamp with time zone, cancellation_decided_at timestamp with time zone, cancellation_decision_note text, cancellation_claim_type text, cancellation_stage text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(p_field), ''), 'all');
  -- 운송장 입력은 저장 시 하이픈·공백을 제거한다. 고객이 택배사에서
  -- 복사한 표기(1234-5678)를 그대로 붙여도 같은 배송 건을 찾게 한다.
  v_tracking_query text := nullif(
    regexp_replace(lower(coalesce(p_query, '')), '[[:space:]-]', '', 'g'),
    ''
  );
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1
      from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  if v_field not in ('all', 'order', 'nickname', 'email', 'recipient', 'tracking') then
    raise check_violation using message = 'invalid order search field';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  return query
  select
    orders.id,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    (select max(s.carrier)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    (select max(s.tracking_number)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    cancellation.claim_type as cancellation_claim_type,
    cancellation.stage as cancellation_stage,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id,
      request.status,
      request.reason_type,
      request.requested_at,
      request.decided_at,
      request.decision_note,
      request.claim_type,
      request.stage
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  where (p_status is null or orders.status::text = p_status)
    and (
      p_from is null
      or orders.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or orders.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    -- 발주확인 기록이 없는 주문은 지연 목록에 넣지 않는다.
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
    and (
      v_query is null
      or (
        v_field = 'all'
        and (
          position(lower(v_query) in lower(orders.id::text)) > 0
          or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
          or position(lower(v_query) in lower(coalesce(orders.address ->> 'recipientName', ''))) > 0
          or exists (
            select 1
            from public.order_shipments as shipment
            where shipment.order_id = orders.id
              and position(v_tracking_query in lower(coalesce(shipment.tracking_number, ''))) > 0
          )
        )
      )
      or (v_field = 'order' and position(lower(v_query) in lower(orders.id::text)) > 0)
      or (v_field = 'nickname' and position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0)
      or (v_field = 'email' and position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0)
      or (v_field = 'recipient' and position(lower(v_query) in lower(coalesce(orders.address ->> 'recipientName', ''))) > 0)
      or (
        v_field = 'tracking'
        and v_tracking_query is not null
        and exists (
          select 1
          from public.order_shipments as shipment
          where shipment.order_id = orders.id
            and position(v_tracking_query in lower(coalesce(shipment.tracking_number, ''))) > 0
        )
      )
    )
  order by orders.created_at desc, orders.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_orders_console(text,date,date,text,integer,integer,timestamp with time zone,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_search_orders_console(p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_confirmed_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'ordered'::text, p_sort text DEFAULT 'newest'::text, p_payment_method text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, user_id uuid, buyer_name text, buyer_email text, status order_status, total bigint, address jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, shipping_carrier text, tracking_number text, confirmed_at timestamp with time zone, shipped_at timestamp with time zone, delivered_at timestamp with time zone, done_at timestamp with time zone, cancellation_request_id uuid, cancellation_request_status text, cancellation_reason_type text, cancellation_requested_at timestamp with time zone, cancellation_decided_at timestamp with time zone, cancellation_decision_note text, cancellation_claim_type text, cancellation_stage text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(p_field), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1
      from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  perform private.admin_validate_sales_search(v_field,p_date_field,p_sort,p_payment_method,p_from,p_to,v_query);

  if v_field not in ('all', 'order', 'nickname', 'email', 'recipient', 'tracking','phone','product') then
    raise check_violation using message = 'invalid order search field';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  return query
  select
    orders.id,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    (select max(s.carrier)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    (select max(s.tracking_number)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    cancellation.claim_type as cancellation_claim_type,
    cancellation.stage as cancellation_stage,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id,
      request.status,
      request.reason_type,
      request.requested_at,
      request.decided_at,
      request.decision_note,
      request.claim_type,
      request.stage
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  where (p_status is null or orders.status::text = p_status)
    and private.admin_sales_order_matches(orders,p_from,p_to,v_query,v_field,p_date_field,p_payment_method)
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
  order by
    case when p_sort='amount_high' then orders.total end desc nulls last,
    case when p_sort='amount_low' then orders.total end asc nulls last,
    case when p_sort='oldest' then private.admin_sales_order_date(orders,p_date_field) end asc nulls last,
    case when p_sort<>'oldest' then private.admin_sales_order_date(orders,p_date_field) end desc nulls last,
    case when p_sort='oldest' then orders.id end asc,
    orders.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_purchase_restrictions(text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_purchase_restrictions(p_query text DEFAULT NULL::text, p_state text DEFAULT 'active'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;q text:=nullif(btrim(p_query),'');
begin
  if not public.has_operator_capability('sales.restrictions',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 perform (select auth.uid());
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
end $function$;

-- admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_reviews(p_review_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_rating integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_has_photo boolean DEFAULT NULL::boolean, p_has_reply boolean DEFAULT NULL::boolean, p_low_rating boolean DEFAULT false, p_query text DEFAULT NULL::text, p_field text DEFAULT 'all'::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, good_id text, good_name text, order_id uuid, user_id uuid, author_name text, author_email text, rating smallint, body text, image_paths text[], status text, hidden_reason text, hidden_at timestamp with time zone, admin_reply text, admin_reply_at timestamp with time zone, reply_author_name text, report_count bigint, open_report_count bigint, created_at timestamp with time zone, edited_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_sort text := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'recent');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('visible', 'hidden') then
    raise check_violation using message = 'invalid_review_status_filter';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise check_violation using message = 'invalid_review_rating_filter';
  end if;
  if v_field not in ('all', 'good', 'author', 'body') then
    raise check_violation using message = 'invalid_review_search_field';
  end if;
  if v_sort not in ('recent', 'oldest', 'rating_desc', 'rating_asc') then
    raise check_violation using message = 'invalid_review_sort';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_review_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'review_search_query_too_long';
  end if;

  return query
  select
    review.id,
    review.good_id,
    good.name as good_name,
    review.order_id,
    review.user_id,
    coalesce(
      nullif(btrim(coalesce(author.nickname, '')), ''),
      'fan_' || left(review.user_id::text, 6)
    ) as author_name,
    author.email as author_email,
    review.rating,
    review.body,
    review.image_paths,
    review.status,
    review.hidden_reason,
    review.hidden_at,
    review.admin_reply,
    review.admin_reply_at,
    replier.nickname as reply_author_name,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
    ) as report_count,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
        and report.status in ('open', 'reviewing')
    ) as open_report_count,
    review.created_at,
    review.edited_at,
    count(*) over()::bigint as total_count
  from public.reviews as review
  join public.goods as good on good.id = review.good_id
  join public.profiles as author on author.id = review.user_id
  left join public.profiles as replier on replier.id = review.admin_reply_by
  where (p_review_id is null or review.id = p_review_id)
    and (p_status is null or review.status = p_status)
    and (p_rating is null or review.rating = p_rating)
    and (not coalesce(p_low_rating, false) or review.rating <= 2)
    and (
      p_has_photo is null
      or (p_has_photo and cardinality(review.image_paths) > 0)
      or (not p_has_photo and cardinality(review.image_paths) = 0)
    )
    and (
      p_has_reply is null
      or (p_has_reply and review.admin_reply is not null)
      or (not p_has_reply and review.admin_reply is null)
    )
    and (
      p_from is null
      or review.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or review.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'good')
        and (
          position(lower(v_query) in lower(good.name)) > 0
          or position(lower(v_query) in lower(review.good_id)) > 0
        )
      )
      or (
        v_field in ('all', 'author')
        and (
          position(lower(v_query) in lower(coalesce(author.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(author.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'body')
        and position(lower(v_query) in lower(review.body)) > 0
      )
    )
  order by
    case when v_sort = 'rating_desc' then review.rating end desc nulls last,
    case when v_sort = 'rating_asc' then review.rating end asc nulls last,
    case when v_sort = 'oldest' then review.created_at end asc nulls last,
    review.created_at desc,
    review.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_search_shipments(text,uuid,text,date,date,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_shipments(p_tab text, p_origin_id uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  result:=private.admin_search_shipments_before_delivery_methods(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset);
  return jsonb_set(result,'{rows}',(select coalesce(jsonb_agg(row.value||jsonb_build_object('delivery',private.shipment_delivery_summary((row.value->>'id')::uuid))
    order by row.ordinality),'[]') from jsonb_array_elements(result->'rows') with ordinality row(value,ordinality)));
end $function$;

-- admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_search_shipments_console(p_tab text, p_origin_id uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'ordered'::text, p_method text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_sort text DEFAULT 'oldest'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

 if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 result:=private.admin_search_shipments_console_before_custom_inputs(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset,p_field,p_date_field,p_method,p_payment_method,p_sort);
 return jsonb_set(result,'{rows}',coalesce((select jsonb_agg(jsonb_set(entry.value,'{items}',private.with_order_item_custom_inputs(entry.value->'items')) order by entry.ordinality)
   from jsonb_array_elements(result->'rows') with ordinality entry(value,ordinality)),'[]'));
end $function$;

-- admin_search_store_credit_console(text,text,date,date,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_search_store_credit_console(p_mode text DEFAULT 'batches'::text, p_query text DEFAULT ''::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_kind text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; query text:=btrim(coalesce(p_query,''));
begin
  if not public.has_operator_capability('marketing.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;

 perform private.assert_store_credit_admin();
 if p_mode is null or p_mode not in ('batches','ledger') or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100,10000) or length(query)>200 or p_from>p_to
  then raise invalid_parameter_value using message='store_credit_filters_invalid'; end if;
 with all_rows as (
  select b.id::text id,b.created_at,'batch' source,b.status kind,b.reason,b.amount,(b.result->>'count')::integer recipients,
   (b.result->>'gross')::bigint gross,coalesce((b.result->>'completedCount')::integer,0) completed,b.purpose,null::uuid user_id,null::uuid order_id,
   b.actor_id,b.id batch_id,null::bigint available_delta,null::bigint reserved_delta,null::bigint debt_delta,b.expires_at
   from private.store_credit_batches b where p_mode='batches'
  union all
  select o.operation_id::text,o.created_at,'individual','completed',o.payload->>'reason',(o.payload->>'amount')::bigint,1,(o.payload->>'amount')::bigint,1,'general',
   (o.payload->>'userId')::uuid,null::uuid,o.actor_id,null::uuid,null::bigint,null::bigint,null::bigint,(o.payload->>'expiresAt')::timestamptz
   from private.store_credit_operations o where p_mode='batches' and o.kind='adjustment' and (o.payload->>'amount')::bigint>0
   and not exists(select 1 from private.store_credit_batch_recipients r where r.operation_id=o.operation_id)
  union all
  select l.id::text,l.created_at,'ledger',l.kind,l.reason,l.amount,1,l.amount,1,'',l.user_id,l.order_id,l.actor_id,r.batch_id,l.available_delta,l.reserved_delta,l.debt_delta,l.expires_at
   from public.store_credit_ledger l left join private.store_credit_batch_recipients r on r.operation_id=l.operation_id where p_mode='ledger'
 ), filtered as (
  select a.*,coalesce(p.nickname,'') nickname,case when position('@' in p.email)>0 then left(p.email,1)||'***@'||split_part(p.email,'@',2) else '' end masked_email
  from all_rows a left join public.profiles p on p.id=a.user_id
  where (p_from is null or a.created_at>=(p_from::timestamp at time zone 'Asia/Seoul'))
   and(p_to is null or a.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul')) and(coalesce(p_kind,'')='' or a.kind=p_kind)
   and(query='' or a.id=query or a.user_id::text=query or a.order_id::text=query or a.batch_id::text=query or lower(p.email)=lower(query)
    or position(lower(query) in lower(a.reason))>0 or position(lower(query) in lower(p.nickname))>0
    or (p_mode='batches' and exists(select 1 from private.store_credit_batch_recipients r join public.profiles c on c.id=r.user_id
     where r.batch_id=a.batch_id and(c.id::text=query or lower(c.email)=lower(query) or position(lower(query) in lower(c.nickname))>0))))
 ), paged as (select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'createdAt',created_at,'source',source,'kind',kind,'reason',reason,'amount',amount,'recipients',recipients,'gross',gross,'completed',completed,'purpose',purpose,
  'userId',user_id,'orderId',order_id,'actorId',actor_id,'batchId',batch_id,'availableDelta',available_delta,'reservedDelta',reserved_delta,'debtDelta',debt_delta,'expiresAt',expires_at,'nickname',nickname,'maskedEmail',masked_email)
  order by created_at desc,id desc) from paged),'[]')) into result;
 return result;
end $function$;

-- admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamp with time zone,uuid)
CREATE OR REPLACE FUNCTION public.admin_select_shipment_delivery_method(p_shipment_id uuid, p_method text, p_policy_id uuid, p_customer_request_reference text, p_fee_consent_reference text, p_fee_unchanged boolean, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; policy private.fulfillment_delivery_policies;
  operation private.shipment_delivery_operations; evidence jsonb; fingerprint bytea; snapshot jsonb; instant timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
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
end $function$;

-- admin_seller_claim_intake_context(uuid)
CREATE OR REPLACE FUNCTION public.admin_seller_claim_intake_context(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.orders; result jsonb; observed_at timestamptz := clock_timestamp();
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  perform (select auth.uid());
  select * into target from public.orders where id = p_order_id;
  if not found then return null; end if;
  select jsonb_build_object(
    'orderId', target.id, 'orderStatus', target.status, 'orderTotal', target.total,
    'buyerName', profile.nickname, 'createdAt', target.created_at, 'deliveredAt', target.delivered_at,
    'address', target.address, 'observedAt', observed_at,
    'blockedReasons', jsonb_build_object(
      'change_of_mind', private.seller_claim_intake_block(target.id, 'change_of_mind', observed_at),
      'defect', private.seller_claim_intake_block(target.id, 'defect', observed_at)),
    'activeClaim', (select jsonb_build_object('id', c.id, 'claimType', c.claim_type, 'stage', c.stage)
      from public.order_cancellation_requests c where c.order_id = target.id and c.status in ('requested', 'processing', 'needs_review') order by c.requested_at desc limit 1),
    'collections', private.seller_claim_collection_targets(target.id),
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'active', c.is_active, 'trackingUrlTemplate', c.tracking_url_template) order by c.sort_order, c.code)
      from public.shipping_carriers c where c.is_active), '[]'),
    'inquiries', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'title', i.title, 'createdAt', i.created_at) order by i.created_at desc)
      from (select * from public.inquiries where user_id = target.user_id and order_id = target.id order by created_at desc, id limit 50) i), '[]')
  ) into result from public.profiles profile where profile.id = target.user_id;
  return result;
end $function$;

-- admin_send_notification(uuid,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_send_notification(target_operation_id uuid, target_scope text, target_ip_id text, target_title text, target_body text)
 RETURNS TABLE(recipient_count bigint, sent_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_scope text := pg_catalog.btrim(target_scope, E' \t\n\r\f\v');
  normalized_ip_id text := nullif(
    pg_catalog.btrim(target_ip_id, E' \t\n\r\f\v'),
    ''
  );
  normalized_title text := pg_catalog.btrim(target_title, E' \t\n\r\f\v');
  normalized_body text := pg_catalog.btrim(target_body, E' \t\n\r\f\v');
  request_payload jsonb;
  requested_target text;
  selected_ip_title text;
  actual_recipient_count bigint;
  sent_timestamp timestamptz;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  existing_sent_at timestamptz;
begin
  perform private.require_operator_capability('marketing.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if normalized_scope is null
    or normalized_scope not in ('all', 'ip_followers')
  then
    raise exception 'invalid_notification_scope' using errcode = '22023';
  end if;

  if normalized_scope = 'all' then
    if normalized_ip_id is not null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;
    requested_target := 'notifications:all';
  else
    if normalized_ip_id is null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;
    requested_target := 'notifications:ip_followers:' || normalized_ip_id;
  end if;

  if normalized_title is null
    or pg_catalog.char_length(normalized_title) < 1
    or pg_catalog.char_length(normalized_title) > 120
  then
    raise exception 'invalid_notification_title' using errcode = '22023';
  end if;

  if normalized_body is null
    or pg_catalog.char_length(normalized_body) < 1
    or pg_catalog.char_length(normalized_body) > 500
  then
    raise exception 'invalid_notification_body' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'scope', normalized_scope,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'body', normalized_body
  );

  -- A lost-response retry must observe the first commit before deciding whether
  -- the operation is an idempotent replay or a conflicting reuse.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_notification_operation:' || target_operation_id::text,
      0
    )
  );

  select
    audit.actor_id,
    audit.action,
    audit.target,
    audit.diff,
    audit.created_at
  into
    existing_actor_id,
    existing_action,
    existing_target,
    existing_diff,
    existing_sent_at
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.notification.sent'
      and existing_target = requested_target
      and existing_diff -> 'request' = request_payload
    then
      return query
        select
          (existing_diff #>> '{result,recipient_count}')::bigint,
          existing_sent_at;
      return;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  if normalized_scope = 'ip_followers' then
    select ip.title
      into selected_ip_title
    from public.ips as ip
    where ip.id = normalized_ip_id
    for key share;

    if not found then
      raise exception 'ip_not_found' using errcode = 'P0002';
    end if;
  end if;

  if normalized_scope = 'all' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    select
      profile.id,
      'announcement',
      normalized_title,
      normalized_body,
      '/notifications',
      'admin_announcement',
      target_operation_id::text,
      'announcement:' || target_operation_id::text
    from public.profiles as profile;
  else
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    select
      follow.user_id,
      'announcement',
      normalized_title,
      normalized_body,
      '/notifications',
      'admin_announcement',
      target_operation_id::text,
      'announcement:' || target_operation_id::text
    from public.ip_follows as follow
    where follow.ip_id = normalized_ip_id;
  end if;

  get diagnostics actual_recipient_count = row_count;

  if actual_recipient_count = 0 then
    raise exception 'notification_no_recipients' using errcode = '22023';
  end if;

  sent_timestamp := pg_catalog.clock_timestamp();

  insert into public.audit_log (
    id,
    actor_id,
    action,
    target,
    diff,
    created_at
  )
  values (
    target_operation_id,
    actor_id,
    'admin.notification.sent',
    requested_target,
    pg_catalog.jsonb_build_object(
      'request', request_payload,
      'result', pg_catalog.jsonb_build_object(
        'ip_title', selected_ip_title,
        'link_path', '/notifications',
        'recipient_count', actual_recipient_count
      )
    ),
    sent_timestamp
  );

  return query
    select actual_recipient_count, sent_timestamp;
end;
$function$;

-- admin_set_category_activation(uuid,boolean,boolean,jsonb)
CREATE OR REPLACE FUNCTION public.admin_set_category_activation(target_operation_id uuid, target_customer_enabled boolean, target_erp_enabled boolean, target_evidence jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  customer jsonb := coalesce(target_evidence->'customer', '{}'::jsonb);
  erp jsonb := coalesce(target_evidence->'erp', '{}'::jsonb);
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if v_actor_id is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_evidence is null then raise invalid_parameter_value using message = 'invalid_category_activation'; end if;
  request_payload := jsonb_build_object(
    'customer_enabled', target_customer_enabled,
    'erp_enabled', target_erp_enabled,
    'evidence', target_evidence
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = v_actor_id and existing_action = 'admin.catalog.category.activation_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  if target_customer_enabled and (
    btrim(coalesce(customer->>'source', '')) = '' or btrim(coalesce(customer->>'reference', '')) = ''
    or btrim(coalesce(customer->>'verifiedAt', '')) = '' or not exists(select 1 from public.catalog_categories where archived_at is null)
  ) then raise check_violation using message = 'category_activation_unready'; end if;
  if target_erp_enabled and (
    btrim(coalesce(erp->>'source', '')) = '' or btrim(coalesce(erp->>'reference', '')) = ''
    or btrim(coalesce(erp->>'verifiedAt', '')) = '' or not exists(
      select 1 from public.catalog_categories as category
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
    ) or exists(
      select 1
      from public.catalog_categories as category
      left join public.catalog_category_erp_mappings as mapping on mapping.category_id = category.id
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
        and mapping.category_id is null
    )
  ) then raise check_violation using message = 'category_activation_unready'; end if;
  update public.category_activation_control
  set customer_enabled = target_customer_enabled, erp_enabled = target_erp_enabled, evidence = target_evidence,
      actor_id = v_actor_id, updated_at = pg_catalog.now()
  where id = 'catalog';
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, v_actor_id, 'admin.catalog.category.activation_updated', 'category_activation_control:catalog',
    jsonb_build_object('request', request_payload));
  return true;
end;
$function$;

-- admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_set_category_erp_mapping(target_operation_id uuid, target_category_id uuid, target_erp_code text, target_erp_name text, target_source text, target_verified_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or btrim(coalesce(target_erp_code, '')) = ''
     or btrim(coalesce(target_erp_name, '')) = '' or btrim(coalesce(target_source, '')) = '' or target_verified_at is null then
    raise invalid_parameter_value using message = 'invalid_category_erp_mapping';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'erp_code', btrim(target_erp_code),
    'erp_name', btrim(target_erp_name),
    'source', btrim(target_source),
    'verified_at', target_verified_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.erp_mapping_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  if not exists (select 1 from public.catalog_categories where id = target_category_id and archived_at is null) then raise no_data_found using message = 'category_not_found'; end if;
  if exists (select 1 from public.catalog_category_erp_mappings where erp_code = btrim(target_erp_code) and category_id <> target_category_id) then raise unique_violation using message = 'category_erp_code_taken'; end if;
  insert into public.catalog_category_erp_mappings(category_id, erp_code, erp_name, source, verified_at, verified_by)
  values (target_category_id, btrim(target_erp_code), btrim(target_erp_name), btrim(target_source), target_verified_at, actor_id)
  on conflict(category_id) do update set erp_code = excluded.erp_code, erp_name = excluded.erp_name, source = excluded.source,
    verified_at = excluded.verified_at, verified_by = excluded.verified_by, updated_at = pg_catalog.now();
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.erp_mapping_updated', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload));
  return true;
end;
$function$;

-- admin_set_category_type_migration(uuid,text,uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_set_category_type_migration(target_operation_id uuid, target_type text, target_category_id uuid, target_status text, target_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or btrim(coalesce(target_type, '')) = '' or target_status not in ('suggested', 'confirmed', 'rejected') then raise invalid_parameter_value using message = 'invalid_category_type_migration'; end if;
  request_payload := jsonb_build_object(
    'type', btrim(target_type),
    'category_id', target_category_id,
    'status', target_status,
    'note', target_note
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.type_migration_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  if target_category_id is not null and not exists(select 1 from public.catalog_categories where id = target_category_id) then raise no_data_found using message = 'category_not_found'; end if;
  insert into public.goods_type_category_migrations(type, category_id, status, note, actor_id)
  values (btrim(target_type), target_category_id, target_status, target_note, actor_id)
  on conflict(type) do update set category_id = excluded.category_id, status = excluded.status, note = excluded.note, actor_id = excluded.actor_id, updated_at = pg_catalog.now();
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.type_migration_updated', 'goods_type_category_migrations:' || btrim(target_type),
    jsonb_build_object('request', request_payload));
  return true;
end;
$function$;

-- admin_set_coupon_status(text,integer,text)
CREATE OR REPLACE FUNCTION public.admin_set_coupon_status(p_code text, p_expected_revision integer, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); existing public.coupons; saved public.coupons;
begin
  perform private.require_operator_capability('marketing.manage',false);

 if actor is null or not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='staff_required';end if;
 if p_status is null or p_status not in('active','archived') or p_expected_revision is null then raise invalid_parameter_value using message='invalid_coupon_status';end if;
 select * into existing from public.coupons where code=p_code for update;
 if not found then raise no_data_found using message='coupon_not_found';end if;
 if existing.terms_revision<>p_expected_revision then raise exception using errcode='PT409',message='coupon_terms_changed';end if;
 if existing.status=p_status then return jsonb_build_object('code',existing.code,'changed',false);end if;
 update public.coupons set status=p_status where code=p_code returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.status_changed','coupons:'||p_code,
 jsonb_build_object('before',existing.status,'after',saved.status,'previousRevision',existing.terms_revision,'revision',saved.terms_revision));
 return jsonb_build_object('code',saved.code,'changed',true,'revision',saved.terms_revision);
end $function$;

-- admin_set_erp_category_mapping(text,uuid)
CREATE OR REPLACE FUNCTION public.admin_set_erp_category_mapping(p_erp_category text, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_erp_category text := private.erp_item_text(p_erp_category, true);
  v_before uuid;
  v_archived_at timestamptz;
  v_changed boolean := false;
begin
  perform private.require_operator_capability('platform.manage',false);

  if v_actor is null or not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if v_erp_category is null
     or pg_catalog.length(v_erp_category) > 200
     or v_erp_category ~ '[\u0001-\u001f\u007f-\u009f]' then
    raise invalid_parameter_value using message = 'invalid_erp_category';
  end if;

  -- 카테고리 보관·이동과 같은 트리 잠금을 잡아 말단 검사와 연결 저장 사이에 트리가 바뀌지 않게 한다.
  perform private.lock_catalog_category_tree();

  select mapping.category_id into v_before
  from public.erp_category_mappings as mapping
  where mapping.erp_category = v_erp_category
  for update;

  if p_category_id is null then
    if v_before is not null then
      delete from public.erp_category_mappings as mapping
      where mapping.erp_category = v_erp_category;
      v_changed := true;
    end if;
  else
    select category.archived_at into v_archived_at
    from public.catalog_categories as category
    where category.id = p_category_id
    for share;
    if not found then
      raise no_data_found using message = 'category_not_found';
    end if;
    if v_archived_at is not null then
      raise check_violation using message = 'category_archived';
    end if;
    if exists (
      select 1
      from public.catalog_categories as child
      where child.parent_id = p_category_id
        and child.archived_at is null
    ) then
      raise check_violation using message = 'category_not_leaf';
    end if;
    if v_before is distinct from p_category_id then
      insert into public.erp_category_mappings (erp_category, category_id, updated_by, updated_at)
      values (v_erp_category, p_category_id, v_actor, pg_catalog.now())
      on conflict (erp_category) do update
        set category_id = excluded.category_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at;
      v_changed := true;
    end if;
  end if;

  if v_changed then
    insert into public.audit_log (actor_id, action, target, diff)
    values (v_actor, 'admin.erp_items.category_mapping_updated', 'erp_category_mappings:' || v_erp_category,
      pg_catalog.jsonb_build_object('erp_category', v_erp_category, 'before', v_before, 'after', p_category_id));
  end if;

  return pg_catalog.jsonb_build_object(
    'erp_category', v_erp_category,
    'category_id', p_category_id,
    'changed', v_changed);
end;
$function$;

-- admin_set_good_bank_transfer(text,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_good_bank_transfer(target_id text, target_allowed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
begin
  perform private.require_operator_capability('catalog.manage',false);

  if v_actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if target_id is null or target_allowed is null then
    raise check_violation using message = 'invalid bank transfer toggle';
  end if;

  update public.goods
  set allow_bank_transfer = target_allowed,
      updated_at = now()
  where id = target_id;

  if not found then
    raise no_data_found using message = 'catalog_record_missing';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'catalog.good.bank_transfer_toggled',
    'goods:' || target_id,
    jsonb_build_object('allowBankTransfer', target_allowed)
  );
end;
$function$;

-- admin_set_good_published(text,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_good_published(target_id text, target_published boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('catalog.manage',false);
return (select private.set_good_published(target_id,target_published));
end;
$function$;

-- admin_set_good_sale_restriction(text,goods_sale_restriction)
CREATE OR REPLACE FUNCTION public.admin_set_good_sale_restriction(target_id text, target_restriction goods_sale_restriction)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
begin
  perform private.require_operator_capability('catalog.manage',false);

  if v_actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if target_id is null or target_restriction is null then
    raise check_violation using message = 'invalid sale restriction';
  end if;

  update public.goods
  set sale_restriction = target_restriction,
      updated_at = now()
  where id = target_id;

  if not found then
    raise no_data_found using message = 'catalog_record_missing';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'catalog.good.sale_restriction_changed',
    'goods:' || target_id,
    jsonb_build_object('saleRestriction', target_restriction)
  );
end;
$function$;

-- admin_set_goods_draft_archived(uuid,integer,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_goods_draft_archived(p_id uuid, p_expected_revision integer, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.admin_goods_drafts; actor uuid:=auth.uid();
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<1 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||actor::text,0));
  select * into d from public.admin_goods_drafts where id=p_id and owner_id=actor for update;
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  if d.completed_result is not null then raise exception 'goods_draft_completed' using errcode='PT409'; end if;
  if (d.archived_at is not null)=p_archived and d.revision=p_expected_revision+1 then return private.goods_draft_summary(d); end if;
  if d.revision<>p_expected_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  if not p_archived and d.archived_at is not null then perform private.make_room_for_goods_draft(actor); end if;
  update public.admin_goods_drafts set archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into d;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.draft.archived','goods_draft:'||p_id::text,
    jsonb_build_object('revision',d.revision,'archived',p_archived));
  return private.goods_draft_summary(d);
end $function$;

-- admin_set_goods_variant_active(text,uuid,boolean,timestamp with time zone,integer)
CREATE OR REPLACE FUNCTION public.admin_set_goods_variant_active(target_good_id text, target_variant_id uuid, target_active boolean, target_expected_updated_at timestamp with time zone, target_price integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid(); good public.goods; variant public.goods_variants;
 before_row jsonb; restored_price integer;
begin
  perform private.require_operator_capability('catalog.manage',false);

 if actor is null then raise sqlstate '28000' using message='auth_required'; end if;
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
 if target_variant_id is null or target_active is null or target_expected_updated_at is null
   or (not target_active and target_price is not null) then
   raise invalid_parameter_value using message='invalid_variant_availability'; end if;
 select * into good from public.goods where id=target_good_id for update;
 if not found then raise no_data_found using message='good_not_found'; end if;
 if good.archived_at is not null then raise check_violation using message='catalog_archived'; end if;
 select * into variant from public.goods_variants where id=target_variant_id and good_id=target_good_id for update;
 if not found then raise no_data_found using message='goods_variant_not_found'; end if;
 if target_active is distinct from (variant.archived_at is null) then
   if variant.updated_at is distinct from target_expected_updated_at then
     raise sqlstate 'PT409' using message='goods_variant_changed'; end if;
   restored_price:=coalesce(target_price,variant.price);
   if target_active then
     if restored_price<good.price then raise check_violation using message='variant_price_below_base'; end if;
     if exists(select 1 from public.goods_variants other where other.good_id=good.id
       and other.id<>variant.id and other.archived_at is null and other.attributes=variant.attributes) then
       raise check_violation using message='goods_variant_combination_exists'; end if;
     if (select count(*) from public.goods_variants other where other.good_id=good.id
       and (other.archived_at is null or other.is_default or other.id=variant.id))>100 then
       raise check_violation using message='goods_options_limit'; end if;
   end if;
   before_row:=to_jsonb(variant);
   update public.goods_variants set
     archived_at=case when target_active then null else clock_timestamp() end,
     price=case when target_active then restored_price else price end
     where id=variant.id returning * into variant;
   insert into public.audit_log(actor_id,action,target,diff) values(actor,
     case when target_active then 'admin.good.option_activated' else 'admin.good.option_stopped' end,
     'goods:'||good.id,jsonb_build_object('variantId',variant.id,'before',before_row,'after',to_jsonb(variant)));
 end if;
 return jsonb_build_object('variantId',variant.id,'isActive',variant.archived_at is null,
   'price',variant.price,'updatedAt',variant.updated_at,'ipId',good.ip_id);
end;
$function$;

-- admin_set_ip_directory(text,boolean,integer,text[],boolean)
CREATE OR REPLACE FUNCTION public.admin_set_ip_directory(target_id text, target_featured boolean, target_position integer, expected_order text[], expected_featured boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  current_order text[];
  next_order text[];
  previous public.ips;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ip_directory_settings',0));
  select array_agg(id order by sort_order,id) into current_order from public.ips;
  select * into previous from public.ips where id=target_id for update;
  if not found then raise no_data_found using message='ip_not_found'; end if;
  if current_order is distinct from expected_order or previous.featured is distinct from expected_featured then
    raise sqlstate 'PT409' using message='ip_directory_conflict';
  end if;
  if target_featured is null or target_position is null or target_position not between 1 and cardinality(current_order) then
    raise invalid_parameter_value using message='invalid_ip_directory_position';
  end if;
  if target_featured and previous.archived_at is not null then
    raise check_violation using message='catalog_item_archived';
  end if;
  next_order := array_remove(current_order,target_id);
  next_order := coalesce(next_order[1:target_position-1],array[]::text[]) || array[target_id]
    || coalesce(next_order[target_position:cardinality(next_order)],array[]::text[]);
  update public.ips set featured=target_featured where id=target_id;
  update public.ips ip set sort_order=ordered.position::integer
  from unnest(next_order) with ordinality ordered(id,position)
  where ip.id=ordered.id and ip.sort_order is distinct from ordered.position::integer;
  insert into public.audit_log(actor_id,action,target,diff) values(
    actor,'catalog.ip.directory_updated','ips:'||target_id,
    jsonb_build_object('before',jsonb_build_object('featured',previous.featured,'order',current_order),
      'after',jsonb_build_object('featured',target_featured,'order',next_order))
  );
end;
$function$;

-- admin_set_ip_published(text,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_ip_published(target_id text, target_published boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_ip_published($1, $2));
end;
$function$;

-- admin_set_operation_alert_badge(boolean)
CREATE OR REPLACE FUNCTION public.admin_set_operation_alert_badge(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());
begin
  perform private.require_operator_capability('home',false);

 if actor is null or not public.has_operator_capability('home',false) then raise insufficient_privilege using message='staff_required';end if;
 if p_enabled is null then raise invalid_parameter_value using message='invalid_alert_preference';end if;
 insert into private.admin_operation_alert_preferences(actor_id,badge_enabled) values(actor,p_enabled)
 on conflict(actor_id) do update set badge_enabled=excluded.badge_enabled,updated_at=clock_timestamp();
 return p_enabled;
end;$function$;

-- admin_set_pool_odds(uuid,uuid,numeric,numeric,numeric,numeric,numeric)
CREATE OR REPLACE FUNCTION public.admin_set_pool_odds(target_operation_id uuid, target_pool_id uuid, target_n numeric, target_r numeric, target_sr numeric, target_ssr numeric, target_holo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  request_payload jsonb;
  previous_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_pool_id is null then
    raise exception 'invalid_pool_id' using errcode = '22004';
  end if;

  if target_n is null or target_r is null or target_sr is null
    or target_ssr is null or target_holo is null
    or target_n < 0 or target_n > 1
    or target_r < 0 or target_r > 1
    or target_sr < 0 or target_sr > 1
    or target_ssr < 0 or target_ssr > 1
    or target_holo < 0 or target_holo > 1
  then
    raise exception 'invalid_pool_probability' using errcode = '22023';
  end if;

  if target_n <> round(target_n, 5)
    or target_r <> round(target_r, 5)
    or target_sr <> round(target_sr, 5)
    or target_ssr <> round(target_ssr, 5)
    or target_holo <> round(target_holo, 5)
  then
    raise exception 'invalid_probability_precision' using errcode = '22023';
  end if;

  if target_n + target_r + target_sr + target_ssr + target_holo <> 1 then
    raise exception 'pool_odds_must_sum_to_one' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'N', target_n,
    'R', target_r,
    'SR', target_sr,
    'SSR', target_ssr,
    'HOLO', target_holo
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_pool_odds_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.card_pool.odds_set'
      and existing_target = 'card_pools:' || target_pool_id::text
      and existing_diff -> 'request' = request_payload
    then
      return;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card_pool:' || target_pool_id::text, 0)
  );

  perform 1
  from public.card_pools
  where id = target_pool_id
  for update;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from (values
      ('N'::public.rarity, target_n),
      ('R'::public.rarity, target_r),
      ('SR'::public.rarity, target_sr),
      ('SSR'::public.rarity, target_ssr),
      ('HOLO'::public.rarity, target_holo)
    ) as requested(rarity, probability)
    where requested.probability > 0
      and not exists (
        select 1
        from public.cards as card
        where card.pool_id = target_pool_id
          and card.rarity = requested.rarity
      )
  ) then
    raise exception 'pool_rarity_uncovered' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'N', coalesce(max(probability) filter (where rarity = 'N'), 0),
    'R', coalesce(max(probability) filter (where rarity = 'R'), 0),
    'SR', coalesce(max(probability) filter (where rarity = 'SR'), 0),
    'SSR', coalesce(max(probability) filter (where rarity = 'SSR'), 0),
    'HOLO', coalesce(max(probability) filter (where rarity = 'HOLO'), 0)
  )
    into previous_payload
  from public.pool_odds
  where pool_id = target_pool_id;

  delete from public.pool_odds
  where pool_id = target_pool_id;

  insert into public.pool_odds (pool_id, rarity, probability)
  values
    (target_pool_id, 'N', target_n),
    (target_pool_id, 'R', target_r),
    (target_pool_id, 'SR', target_sr),
    (target_pool_id, 'SSR', target_ssr),
    (target_pool_id, 'HOLO', target_holo);

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.card_pool.odds_set',
    'card_pools:' || target_pool_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', request_payload
    )
  );
end;
$function$;

-- admin_set_product_question_visibility(uuid,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_product_question_visibility(target_question_id uuid, target_hidden boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  next_status text := case when coalesce(target_hidden, false) then 'hidden' else 'visible' end;
  v_previous text;
  v_good_id text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('cs.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select question.status, question.good_id
    into v_previous, v_good_id
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set status = next_status
  where id = target_question_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.visibility',
    'product_questions:' || target_question_id::text,
    jsonb_build_object('from', v_previous, 'to', next_status, 'goodId', v_good_id)
  );
end;
$function$;

-- admin_set_review_status(uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.admin_set_review_status(target_review_id uuid, target_status text, target_reason text DEFAULT NULL::text, target_report_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_status text := btrim(coalesce(target_status, ''));
  v_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  v_previous text;
  v_good_id text;
  v_linked_target public.report_target;
  v_linked_target_id text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if v_status not in ('visible', 'hidden') then
    raise invalid_parameter_value using message = 'invalid_review_status';
  end if;
  -- 블라인드는 사유가 필수다. 사유 없는 비공개는 나중에 아무도 해제하지 못한다.
  if v_status = 'hidden' and (v_reason is null or char_length(v_reason) not between 2 and 500) then
    raise invalid_parameter_value using message = 'review_hide_reason_required';
  end if;

  select review.status, review.good_id
    into v_previous, v_good_id
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  update public.reviews
  set
    status = v_status,
    hidden_reason = case when v_status = 'hidden' then v_reason else null end,
    hidden_at = case when v_status = 'hidden' then now() else null end,
    hidden_by = case when v_status = 'hidden' then v_actor else null end
  where id = target_review_id;

  if target_report_id is not null then
    select report.target_type, report.target_id
      into v_linked_target, v_linked_target_id
    from public.reports as report
    where report.id = target_report_id
    for update;

    if not found then
      raise no_data_found using message = 'report_not_found';
    end if;
    if v_linked_target <> 'review' or v_linked_target_id <> target_review_id::text then
      raise check_violation using message = 'report_target_mismatch';
    end if;

    update public.reports
    set status = 'resolved'
    where reports.id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.status',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'from', v_previous,
      'to', v_status,
      'goodId', v_good_id,
      'reason', v_reason,
      'reportId', target_report_id
    )
  );
end;
$function$;

-- admin_set_shipping_region_policy_status(uuid,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.admin_set_shipping_region_policy_status(p_policy_id uuid, p_status text, p_expected_revision integer, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous private.shipping_region_policies; saved private.shipping_region_policies; origin public.fulfillment_origins;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true))
    or not coalesce(public.has_operator_capability('platform.manage',true),false) then raise insufficient_privilege using message='admin required'; end if;
  if p_status is null or p_status not in ('active','retired') then raise invalid_parameter_value using message='shipping_region_status_invalid'; end if;
  select * into previous from private.shipping_region_policies where id=p_policy_id;
  if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
  select * into origin from public.fulfillment_origins where id=previous.origin_id for update;
  select * into previous from private.shipping_region_policies where id=p_policy_id for update;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
  if p_attested is distinct from true then raise check_violation using message='shipping_region_attestation_required'; end if;
  if p_status='active' then
    if previous.status<>'draft' then raise check_violation using message='shipping_region_policy_immutable'; end if;
    perform private.assert_shipping_region_policy_complete(previous.configuration);
    if not origin.is_active or origin.default_carrier is distinct from previous.carrier_code
      or not exists(select 1 from public.shipping_carriers where code=previous.carrier_code and is_active) then
      raise check_violation using message='shipping_region_carrier_mismatch'; end if;
    if previous.ends_at is not null and previous.ends_at<=statement_timestamp() then
      raise check_violation using message='shipping_region_policy_expired'; end if;
    if exists(select 1 from private.shipping_region_policies policy where policy.origin_id=previous.origin_id
      and policy.carrier_code=previous.carrier_code and policy.status='active' and policy.id<>previous.id
      and tstzrange(policy.starts_at,policy.ends_at,'[)')&&tstzrange(previous.starts_at,previous.ends_at,'[)')) then
      raise check_violation using message='shipping_region_period_overlap'; end if;
    insert into private.shipping_region_adoptions(origin_id,managed_from) values(previous.origin_id,previous.starts_at)
      on conflict(origin_id) do update set managed_from=least(private.shipping_region_adoptions.managed_from,excluded.managed_from);
  elsif previous.status<>'active' then raise check_violation using message='shipping_region_status_invalid'; end if;
  update private.shipping_region_policies set status=p_status,revision=revision+1,updated_by=actor,updated_at=clock_timestamp(),
    confirmed_by=case when p_status='active' then actor else confirmed_by end,
    confirmed_at=case when p_status='active' then clock_timestamp() else confirmed_at end
    where id=p_policy_id returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.'||p_status,'shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'before',private.shipping_region_policy_record(previous),
      'after',private.shipping_region_policy_record(saved)));
  return private.shipping_region_policy_record(saved);
end $function$;

-- admin_shipment_export(uuid[])
CREATE OR REPLACE FUNCTION public.admin_shipment_export(target_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if exists(select 1 from public.order_shipments where id=any(target_ids) and delivery_method<>'parcel') then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  return private.admin_shipment_export_before_delivery_methods(target_ids);
end $function$;

-- admin_shipping_region_expiry_metadata(timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_shipping_region_expiry_metadata(p_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_warning_time'; end if;
  with candidates as (
    select policy.id,policy.version,policy.starts_at,policy.ends_at,
      origin.id origin_id,origin.name origin_name,origin.default_carrier carrier_code,carrier.label carrier_label
    from public.fulfillment_origins origin
    join public.shipping_carriers carrier on carrier.code=origin.default_carrier and carrier.is_active
    cross join lateral (
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active' and p.starts_at<=p_at
        order by p.starts_at desc,p.version desc limit 1)
      union all
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active'
          and p.starts_at>p_at and p.ends_at<=p_at+interval '7 days')
    ) policy
    where origin.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',candidate.id,'name',policy.configuration->>'name','version',candidate.version,'status','active',
    'startsAt',candidate.starts_at,'endsAt',candidate.ends_at,'originId',candidate.origin_id,
    'originName',candidate.origin_name,'carrierCode',candidate.carrier_code,'carrierLabel',candidate.carrier_label
  ) order by candidate.ends_at,candidate.id),'[]'::jsonb) into result
  from candidates candidate join private.shipping_region_policies policy on policy.id=candidate.id
  where candidate.ends_at<=p_at+interval '7 days';
  return result;
end $function$;

-- admin_store_settings_history(integer)
CREATE OR REPLACE FUNCTION public.admin_store_settings_history(row_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, actor_name text, action text, target text, created_at timestamp with time zone, diff jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (public.has_operator_capability('seller.read') or public.has_operator_capability('store.manage') or public.has_operator_capability('platform.manage')) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not (public.has_operator_capability('seller.read') or public.has_operator_capability('store.manage') or public.has_operator_capability('platform.manage')) then raise insufficient_privilege using message='staff_required'; end if;
  return query select a.id,p.nickname,a.action,a.target,a.created_at,a.diff from public.audit_log a
    left join public.profiles p on p.id=a.actor_id
    where a.action in ('admin.store_settings.updated','admin.shipping_carrier.saved','admin.fulfillment_origin.saved') and (
 (a.target in ('store_settings:branding','store_settings:navigation','store_settings:inquiry_auto_replies') and public.has_operator_capability('store.manage'))
 or (a.target in ('store_settings:business','store_settings:bank_transfer') and public.has_operator_capability('seller.manage'))
 or (a.action in ('admin.shipping_carrier.saved','admin.fulfillment_origin.saved') and public.has_operator_capability('platform.manage'))
)
    order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(row_limit,50),100));
end $function$;

-- admin_submit_seller_claim_intake(uuid,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.admin_submit_seller_claim_intake(p_request_id uuid, p_payload jsonb, p_refund_account jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid()); target public.orders;
  previous private.seller_order_claim_intakes; saved_payload jsonb; collections jsonb; targets jsonb;
  block text; submitted_at timestamptz; requested_at timestamptz; target_id uuid;
begin
  perform private.require_operator_capability('sales.manage',false);

  if p_request_id is null then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  perform private.validate_seller_claim_intake(p_payload, p_refund_account);
  target_id := (p_payload->>'orderId')::uuid;
  requested_at := (p_payload->>'customerRequestedAt')::timestamptz;
  -- Raw bank details have exactly one storage destination and its existing purge
  -- lifecycle. The idempotency receipt stores only their SHA-256 fingerprint.
  saved_payload := p_payload || jsonb_build_object('refundAccountDigest',
    case when p_refund_account is null or p_refund_account = 'null'::jsonb then null
      else encode(extensions.digest(p_refund_account::text, 'sha256'), 'hex') end);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:' || p_request_id, 0));
  select * into previous from private.seller_order_claim_intakes where claim_id = p_request_id;
  if found then
    if previous.actor_id <> actor or previous.payload <> saved_payload then
      raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
    end if;
    return private.seller_claim_intake_json(p_request_id);
  end if;
  if exists(select 1 from public.order_cancellation_requests where id = p_request_id) then
    raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
  end if;

  -- Same parent-first order as customer intake and dispatch. No financial
  -- operation is performed after these locks; they only stabilize eligibility.
  select * into target from public.orders where id = target_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform s.id from public.order_shipments s where s.order_id = target_id order by s.id for update;
  perform attempt.id from public.payment_attempts attempt where attempt.purpose = 'order' and attempt.ref_id = target_id order by attempt.id for update;
  submitted_at := clock_timestamp();
  block := private.seller_claim_intake_block(target_id, p_payload->>'reasonType', submitted_at);
  if block is not null then raise check_violation using message = block; end if;
  if requested_at < target.created_at or requested_at > submitted_at then
    raise invalid_parameter_value using message = 'invalid_seller_claim_customer_time';
  end if;
  if p_payload->>'source' = 'inquiry' then
    perform 1 from public.inquiries where id = (p_payload->>'inquiryId')::uuid and user_id = target.user_id and order_id = target_id for share;
    if not found then raise check_violation using message = 'seller_claim_inquiry_mismatch'; end if;
  end if;
  targets := private.seller_claim_collection_targets(target_id);
  if jsonb_array_length(targets) <> jsonb_array_length(p_payload->'collections')
    or (select count(distinct (x->>'shipmentId')::uuid) from jsonb_array_elements(p_payload->'collections') x) <> jsonb_array_length(targets)
    or exists(select 1 from jsonb_array_elements(p_payload->'collections') x where not exists(select 1 from jsonb_array_elements(targets) t where (t->>'shipmentId')::uuid = (x->>'shipmentId')::uuid))
  then raise check_violation using message = 'seller_claim_collections_changed'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'collections') x where x->>'carrier' is not null
    and not exists(select 1 from public.shipping_carriers carrier where carrier.code = x->>'carrier' and carrier.is_active))
  then raise check_violation using message = 'unknown_shipping_carrier'; end if;
  select jsonb_agg(x || jsonb_build_object('originId', t->>'originId', 'originName', t->>'originName', 'items', t->'items') order by t->>'originId', t->>'shipmentId')
    into collections from jsonb_array_elements(p_payload->'collections') x join jsonb_array_elements(targets) t on (x->>'shipmentId')::uuid = (t->>'shipmentId')::uuid;

  insert into public.order_cancellation_requests(id, order_id, requested_by, claim_type, reason_type, reason, stage, requested_at)
    values(p_request_id, target_id, target.user_id, p_payload->>'claimType', p_payload->>'reasonType', p_payload->>'reason', 'requested', submitted_at);
  insert into private.seller_order_claim_intakes(claim_id, actor_id, payload, collection_snapshot, created_at)
    values(p_request_id, actor, saved_payload, collections, submitted_at);
  -- Preserve the submitted payload for exact idempotency while the immutable
  -- target labels/items are stored separately inside the same private receipt.
  -- They are returned by joining the original input with its intake snapshot.
  if p_refund_account is not null and p_refund_account <> 'null'::jsonb then
    insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
      values(p_request_id, p_refund_account->>'bankName', p_refund_account->>'accountNumber', p_refund_account->>'accountHolder',
        (p_refund_account->>'bankName') || ' ' || public.mask_refund_account_number(p_refund_account->>'accountNumber'),
        public.mask_refund_account_holder(p_refund_account->>'accountHolder'));
  end if;
  insert into public.audit_log(actor_id, action, target, diff) values(actor, 'admin.order.claim_intake_created', 'order:' || target_id::text,
    jsonb_build_object('claimId', p_request_id, 'claimType', p_payload->>'claimType', 'to', 'requested', 'source', p_payload->>'source',
      'inquiryId', p_payload->>'inquiryId', 'customerRequestedAt', requested_at, 'collectionCount', jsonb_array_length(collections)));
  perform private.notify_order_claim(p_request_id, 'seller_requested', '반품·교환 요청이 접수됐어요',
    '고객님과 확인한 내용을 바탕으로 담당자가 요청을 접수했습니다. 승인과 이후 처리는 별도로 진행됩니다.');
  return private.seller_claim_intake_json(p_request_id);
end $function$;

-- admin_suggest_goods_identifiers(text,text)
CREATE OR REPLACE FUNCTION public.admin_suggest_goods_identifiers(target_ip_id text, target_name text)
 RETURNS TABLE(code text, slug text, default_variant_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prefix_value text; ordinal bigint; candidate text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if not exists(select 1 from public.ips where id=target_ip_id and archived_at is null) then
    raise no_data_found using message='ip_not_found';
  end if;
  prefix_value:=private.goods_code_prefix(target_ip_id);
  select coalesce((select last_number from private.goods_code_counters where prefix=prefix_value),0)+1 into ordinal;
  loop
    candidate:=prefix_value||'-'||lpad(ordinal::text,greatest(4,length(ordinal::text)),'0');
    exit when not exists(select 1 from public.goods good where good.code=candidate)
      and not exists(select 1 from public.goods_variants variant where variant.code=candidate||'-01');
    ordinal:=ordinal+1;
  end loop;
  code:=candidate;
  slug:=private.available_goods_slug(target_name);
  default_variant_code:=code||'-01';
  return next;
end;
$function$;

-- admin_suspend_user(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_suspend_user(target_profile_id uuid, target_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
  normalized_reason text := nullif(
    pg_catalog.btrim(target_reason, E' \t\n\r\f\v'),
    ''
  );
  changed_at timestamptz;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_profile_id]);
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_suspend_self' using errcode = '22023';
  end if;

  if normalized_reason is null or pg_catalog.length(normalized_reason) > 200 then
    raise exception 'invalid_suspension_reason' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if selected_role = 'admin'
    or (actor_role = 'staff' and selected_role <> 'user')
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if selected_suspended_at is not null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', selected_suspended_at
    );
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.profiles as profile
  set
    suspended_at = changed_at,
    suspension_reason = normalized_reason
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.suspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'active', 'to', 'suspended')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', changed_at
  );
end;
$function$;

-- admin_unarchive_card(text)
CREATE OR REPLACE FUNCTION public.admin_unarchive_card(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('card', $1, false));
end;
$function$;

-- admin_unarchive_category(uuid,uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_unarchive_category(target_operation_id uuid, target_category_id uuid, target_expected_updated_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
  changed boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or target_expected_updated_at is null then raise invalid_parameter_value using message = 'invalid_category_operation'; end if;
  request_payload := jsonb_build_object('category_id', target_category_id, 'expected_updated_at', target_expected_updated_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.unarchived' and existing_diff -> 'request' = request_payload then
      return coalesce((existing_diff ->> 'changed')::boolean, true);
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  select * into category_row from public.catalog_categories where id = target_category_id for update;
  if not found then raise no_data_found using message = 'category_not_found'; end if;
  if category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
  if category_row.archived_at is null then
    changed := false;
    next_depth := category_row.depth;
  else
    next_depth := private.category_validate_parent(target_category_id, category_row.parent_id);
    update public.catalog_categories set archived_at = null, depth = next_depth, updated_at = pg_catalog.now() where id = target_category_id;
    changed := true;
  end if;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.unarchived', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload, 'changed', changed, 'depth', next_depth));
  return changed;
end;
$function$;

-- admin_unarchive_event(text)
CREATE OR REPLACE FUNCTION public.admin_unarchive_event(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('event', $1, false));
end;
$function$;

-- admin_unarchive_good(text)
CREATE OR REPLACE FUNCTION public.admin_unarchive_good(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('catalog.manage',false);
return (select private.set_catalog_archived('good', $1, false));
end;
$function$;

-- admin_unarchive_ip(text)
CREATE OR REPLACE FUNCTION public.admin_unarchive_ip(target_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);
return (select private.set_catalog_archived('ip', $1, false));
end;
$function$;

-- admin_unpaid_bank_transfer_orders(text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_unpaid_bank_transfer_orders(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(order_id uuid, buyer_name text, buyer_id uuid, recipient_name text, total bigint, created_at timestamp with time zone, expires_at timestamp with time zone, extended_at timestamp with time zone, deposit_code text, item_summary text, attempt_state payment_attempt_state, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  return query
  with candidate as (
    select
      orders.id,
      orders.user_id,
      orders.total,
      orders.created_at,
      orders.expires_at,
      orders.bank_transfer_extended_at,
      private.bank_transfer_deposit_code(orders.id) as code,
      coalesce(nullif(btrim(profile.nickname), ''), 'fan_' || left(orders.user_id::text, 6))
        as buyer,
      -- 안내한 입금자명은 수령인 + 주문코드다. 주소 전체가 아니라 이 한 칸만
      -- 나간다 — 대조에 필요한 것이 그것뿐이다.
      coalesce(nullif(btrim(orders.address ->> 'recipientName'), ''), '') as recipient,
      (
        select attempt.state
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
      ) as attempt_state,
      (
        select string_agg(
          item.good_name_snapshot || ' × ' || item.qty::text,
          ', '
          order by item.good_name_snapshot
        )
        from public.order_items as item
        where item.order_id = orders.id
      ) as items
    from public.orders
    left join public.profiles as profile on profile.id = orders.user_id
    where orders.status = 'pending'
      and orders.payment_method = 'bank_transfer'
  ),
  filtered as (
    select *
    from candidate
    where v_query is null
      or candidate.code = upper(v_query)
      or candidate.id::text = lower(v_query)
      or candidate.buyer ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  )
  select
    filtered.id,
    filtered.buyer,
    filtered.user_id,
    filtered.recipient,
    filtered.total,
    filtered.created_at,
    filtered.expires_at,
    filtered.bank_transfer_extended_at,
    filtered.code,
    coalesce(filtered.items, ''),
    filtered.attempt_state,
    count(*) over ()
  from filtered
  order by filtered.expires_at nulls last, filtered.created_at
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_unpaid_bank_transfer_orders_console(text,integer,integer,text,text)
CREATE OR REPLACE FUNCTION public.admin_unpaid_bank_transfer_orders_console(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_state text DEFAULT NULL::text, p_sort text DEFAULT 'oldest'::text)
 RETURNS TABLE(order_id uuid, buyer_name text, buyer_id uuid, recipient_name text, total bigint, created_at timestamp with time zone, expires_at timestamp with time zone, extended_at timestamp with time zone, deposit_code text, item_summary text, attempt_state payment_attempt_state, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if (p_state is not null and p_state not in ('prepared','confirming','needs_review','unknown','missing'))
    or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') or char_length(v_query)>100 then
    raise invalid_parameter_value using message='invalid_unpaid_search';
  end if;
  return query
  with candidate as (
    select
      orders.id,
      orders.user_id,
      orders.total,
      orders.created_at,
      orders.expires_at,
      orders.bank_transfer_extended_at,
      private.bank_transfer_deposit_code(orders.id) as code,
      coalesce(nullif(btrim(profile.nickname), ''), 'fan_' || left(orders.user_id::text, 6))
        as buyer,
      -- 안내한 입금자명은 수령인 + 주문코드다. 주소 전체가 아니라 이 한 칸만
      -- 나간다 — 대조에 필요한 것이 그것뿐이다.
      coalesce(nullif(btrim(orders.address ->> 'recipientName'), ''), '') as recipient,
      (
        select attempt.state
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
      ) as attempt_state,
      (
        select string_agg(
          item.good_name_snapshot || ' × ' || item.qty::text,
          ', '
          order by item.good_name_snapshot
        )
        from public.order_items as item
        where item.order_id = orders.id
      ) as items
    from public.orders
    left join public.profiles as profile on profile.id = orders.user_id
    where orders.status = 'pending'
      and orders.payment_method = 'bank_transfer'
  ),
  filtered as (
    select *
    from candidate
    where (v_query is null
      or candidate.code = upper(v_query)
      or candidate.id::text = lower(v_query)
      or candidate.buyer ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_state is null or (p_state='missing' and candidate.attempt_state is null) or candidate.attempt_state::text=p_state)
  )
  select
    filtered.id,
    filtered.buyer,
    filtered.user_id,
    filtered.recipient,
    filtered.total,
    filtered.created_at,
    filtered.expires_at,
    filtered.bank_transfer_extended_at,
    filtered.code,
    coalesce(filtered.items, ''),
    filtered.attempt_state,
    count(*) over ()
  from filtered
  order by
    case when p_sort='amount_high' then filtered.total end desc nulls last,
    case when p_sort='amount_low' then filtered.total end asc nulls last,
    case when p_sort='newest' then filtered.expires_at end desc nulls last,
    case when p_sort<>'newest' then filtered.expires_at end asc nulls last,
    filtered.created_at,filtered.id
  limit v_limit
  offset v_offset;
end;
$function$;

-- admin_unsuspend_user(uuid)
CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(target_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_profile_id]);
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_unsuspend_self' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if selected_role = 'admin'
    or (actor_role = 'staff' and selected_role <> 'user')
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if selected_suspended_at is null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', null
    );
  end if;

  update public.profiles as profile
  set
    suspended_at = null,
    suspension_reason = null
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.unsuspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'suspended', 'to', 'active')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', null
  );
end;
$function$;

-- admin_update_ip_identity(text,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_ip_identity(target_id text, target_public_slug text, target_expected_public_slug text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  current_public_slug text;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  if target_id is null
     or target_id !~ '^[a-z0-9][a-z0-9-]*$'
     or target_public_slug is null
     or target_expected_public_slug is null
  then
    raise invalid_parameter_value using message = 'invalid_ip_identity';
  end if;
  if target_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or target_public_slug = 'aouad'
  then
    raise invalid_parameter_value using message = 'invalid_ip_public_slug';
  end if;

  -- All slug checks and the alias append happen under one global identity lock.
  -- The row lock then makes the expected slug a real stale-write guard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  select ip.public_slug
    into current_public_slug
  from public.ips as ip
  where ip.id = target_id
  for update of ip;

  if not found then
    raise no_data_found using message = 'catalog_not_found';
  end if;
  if current_public_slug is distinct from target_expected_public_slug then
    -- PostgREST retries SQLSTATE 40001 indefinitely. This is an expected
    -- business stale-write response, so use a private 409 class instead.
    raise exception using errcode = 'PT409', message = 'ip_public_slug_conflict';
  end if;
  if current_public_slug = target_public_slug then
    return false;
  end if;

  if exists (
    select 1 from public.ips as ip
    where ip.public_slug = target_public_slug
      and ip.id <> target_id
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias
    where alias.slug = target_public_slug
  ) then
    raise unique_violation using message = 'ip_public_slug_taken';
  end if;

  -- This FK deliberately prevents hard deletion of an IP whose old URL is a
  -- historical alias. The alias row is append-only and uniquely owned.
  insert into public.ip_public_slug_aliases (slug, ip_id)
  values (current_public_slug, target_id);

  perform pg_catalog.set_config('app.ip_public_slug_write', 'admin_update_ip_identity', true);
  update public.ips
  set public_slug = target_public_slug,
      updated_at = pg_catalog.now()
  where id = target_id;
  perform pg_catalog.set_config('app.ip_public_slug_write', '', true);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.ip.identity_updated',
    'ips:' || target_id,
    pg_catalog.jsonb_build_object(
      'internal_id', target_id,
      'previous_public_slug', current_public_slug,
      'public_slug', target_public_slug,
      'alias_preserved', true
    )
  );

  return true;
end;
$function$;

-- admin_update_operation_alerts(text,uuid[],timestamp with time zone,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_operation_alerts(p_action text, p_ids uuid[], p_through timestamp with time zone, p_category text DEFAULT 'all'::text, p_state text DEFAULT 'all'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); changed integer;
begin
  perform private.require_operator_capability('home',false);

 if actor is null or not public.has_operator_capability('home',false) then raise insufficient_privilege using message='staff_required';end if;
 if p_action is null or p_action not in('read','hide','restore') or p_through is null or not isfinite(p_through) or p_through>clock_timestamp()
  or (p_ids is not null and(cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null))
  or p_category is null or p_category not in('all','orders','claims','inquiries','questions','reviews')
  or p_state is null or p_state not in('all','unread','hidden') then
  raise invalid_parameter_value using message='invalid_alert_update';end if;
 insert into private.admin_operation_alert_states(alert_id,actor_id,read_at,hidden_at)
 select a.id,actor,case when p_action='read' then clock_timestamp() end,case when p_action='hide' then clock_timestamp() end
 from private.admin_operation_alerts a left join private.admin_operation_alert_states s on s.alert_id=a.id and s.actor_id=actor
 where a.created_at<=p_through and a.created_at>statement_timestamp()-interval '90 days' and public.has_operator_capability(private.operator_alert_capability(a.category))
  and(p_ids is null or a.id=any(p_ids)) and(p_category='all' or a.category=p_category)
  and case p_state when 'hidden' then s.hidden_at is not null when 'unread' then s.read_at is null and s.hidden_at is null else s.hidden_at is null end
 on conflict(alert_id,actor_id) do update set
  read_at=case when p_action='read' then coalesce(private.admin_operation_alert_states.read_at,excluded.read_at) else private.admin_operation_alert_states.read_at end,
  hidden_at=case when p_action='hide' then coalesce(private.admin_operation_alert_states.hidden_at,excluded.hidden_at) when p_action='restore' then null else private.admin_operation_alert_states.hidden_at end;
 get diagnostics changed=row_count;
 return changed;
end;$function$;

-- admin_update_order_status(uuid,order_status,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());purchase public.orders;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 if p_status is null or p_status not in ('confirmed','shipping','delivered') then raise check_violation using message='invalid_order_status';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 if purchase.status='confirmed' then return;end if;
 if purchase.status<>'paid' then raise exception using message='invalid_order_transition';end if;
 perform private.assert_order_dispatch_allowed(p_order_id);
 update public.orders set status='confirmed',confirmed_at=clock_timestamp() where id=p_order_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.status_updated','order:'||p_order_id,
  jsonb_build_object('from',purchase.status,'to','confirmed'));
end $function$;

-- admin_update_order_tracking(uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_order_tracking(p_order_id uuid, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 perform id from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform public.admin_update_shipment_tracking(private.single_order_shipment(p_order_id),p_carrier,p_tracking_number);
end $function$;

-- admin_update_report_status(uuid,report_status)
CREATE OR REPLACE FUNCTION public.admin_update_report_status(target_report_id uuid, target_status report_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  previous_status report_status;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null or not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select reports.status
    into previous_status
    from public.reports
    where reports.id = target_report_id
    for update;

  if not found then
    raise exception 'report_not_found' using errcode = '22023';
  end if;

  update public.reports
  set status = target_status
  where reports.id = target_report_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'community_report_status_update',
    'report:' || target_report_id::text,
    jsonb_build_object('from', previous_status, 'to', target_status)
  );
end;
$function$;

-- admin_update_shipment_status(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_shipment_status(p_shipment_id uuid, p_status text, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_parcel_shipment(p_shipment_id);
  perform private.admin_update_shipment_status_before_delivery_methods(p_shipment_id,p_status,p_carrier,p_tracking_number);
end $function$;

-- admin_update_shipment_tracking(uuid,text,text)
CREATE OR REPLACE FUNCTION public.admin_update_shipment_tracking(p_shipment_id uuid, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_parcel_shipment(p_shipment_id);
  perform private.admin_update_shipment_tracking_before_delivery_methods(p_shipment_id,p_carrier,p_tracking_number);
end $function$;

-- admin_upsert_campaign(text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,jsonb,text)
CREATE OR REPLACE FUNCTION public.admin_upsert_campaign(target_id text, target_kind text, target_title text, target_subtitle text, target_status text, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, target_hero_image_path text, target_card_image_path text, target_banner_image_path text, target_featured_order integer, target_sections jsonb, target_previous_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_id text := btrim(coalesce(target_id, ''), E' \t\n\r\f\v');
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  normalized_title text := btrim(coalesce(target_title, ''), E' \t\n\r\f\v');
  normalized_subtitle text := nullif(btrim(coalesce(target_subtitle, ''), E' \t\n\r\f\v'), '');
  normalized_status text := coalesce(nullif(btrim(coalesce(target_status, '')), ''), 'draft');
  normalized_sections jsonb := coalesce(target_sections, '[]'::jsonb);
  v_coupon_code text;
begin
  perform private.require_operator_capability('promotion.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('promotion.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' then
    raise exception 'invalid_campaign_id' using errcode = '22023';
  end if;

  if target_kind is null or target_kind not in ('event', 'drop') then
    raise exception 'invalid_campaign_kind' using errcode = '22023';
  end if;

  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'invalid_campaign_title' using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'published', 'ended') then
    raise exception 'invalid_campaign_status' using errcode = '22023';
  end if;

  if target_starts_at is null or target_ends_at is null or target_ends_at <= target_starts_at then
    raise exception 'invalid_campaign_period' using errcode = '22023';
  end if;

  if target_featured_order is not null and target_featured_order <= 0 then
    raise exception 'invalid_campaign_featured_order' using errcode = '22023';
  end if;

  perform private.validate_campaign_sections(normalized_sections);

  -- coupon 블록의 코드는 실재하는 쿠폰이어야 한다. jsonb 안이라 FK를 걸 수 없는
  -- 자리인데, 오타 하나가 그대로 통과하면 랜딩에는 멀쩡한 경품처럼 걸리고 사용자는
  -- 장바구니에 넣는 순간에야 없는 쿠폰이라는 걸 안다 — 저장 시점에 막는다.
  -- (구조 검증을 통과한 뒤라 sections는 배열이고 coupon_code는 문자열이다.)
  for v_coupon_code in
    select distinct section.entry ->> 'coupon_code'
    from jsonb_array_elements(normalized_sections) as section(entry)
    where section.entry ->> 'type' = 'coupon'
  loop
    if not exists (select 1 from public.coupons where code = v_coupon_code) then
      raise exception 'unknown_coupon_code'
        using errcode = '23503', detail = v_coupon_code;
    end if;
  end loop;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from normalized_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.campaigns where id = normalized_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  else
    -- 슬러그 섀도잉 차단. 레거시 /events/[id] 리다이렉트가 살아 있는 동안
    -- 같은 id의 캠페인이 생기면 그 리다이렉트가 무엇을 가리키는지 알 수 없다.
    -- (반대 방향 — 캠페인이 선점한 슬러그로 이벤트를 만드는 경로 — 은
    --  admin_upsert_event 소관이라 여기서 다루지 않는다.)
    if exists (select 1 from public.events where id = normalized_id) then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.campaigns (
    id, kind, title, subtitle, status, starts_at, ends_at,
    hero_image_path, card_image_path, banner_image_path, featured_order, sections
  )
  values (
    normalized_id,
    target_kind,
    normalized_title,
    normalized_subtitle,
    normalized_status,
    target_starts_at,
    target_ends_at,
    nullif(btrim(coalesce(target_hero_image_path, '')), ''),
    nullif(btrim(coalesce(target_card_image_path, '')), ''),
    nullif(btrim(coalesce(target_banner_image_path, '')), ''),
    target_featured_order,
    normalized_sections
  )
  on conflict (id) do update set
    kind = excluded.kind,
    title = excluded.title,
    subtitle = excluded.subtitle,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    hero_image_path = excluded.hero_image_path,
    card_image_path = excluded.card_image_path,
    banner_image_path = excluded.banner_image_path,
    featured_order = excluded.featured_order,
    sections = excluded.sections
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'campaign.upsert',
    'campaigns:' || normalized_id,
    jsonb_build_object(
      'mode', case when normalized_previous_id is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'id', normalized_id,
        'kind', target_kind,
        'title', normalized_title,
        'status', normalized_status,
        'startsAt', target_starts_at,
        'endsAt', target_ends_at,
        'featuredOrder', target_featured_order,
        'sectionCount', jsonb_array_length(normalized_sections)
      )
    )
  );
end;
$function$;

-- admin_upsert_card(text,text,text,text,rarity,text,text,uuid,boolean,text)
CREATE OR REPLACE FUNCTION public.admin_upsert_card(target_id text, target_ip_id text, target_name text, target_no text, target_rarity rarity, target_bg text, target_image_path text, target_pool_id uuid DEFAULT NULL::uuid, target_pool_binding_provided boolean DEFAULT false, target_previous_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_id text := btrim(target_id, E' \t\n\r\f\v');
  normalized_ip_id text := btrim(target_ip_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_card public.cards%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  request_payload jsonb;
  card_exists boolean := false;
  effective_pool_id uuid;
  target_pool_ip_id text;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_id is null or normalized_id = '' then
    raise exception 'invalid_card_id' using errcode = '22023';
  end if;

  if normalized_ip_id is null or normalized_ip_id = '' then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_card_name' using errcode = '22023';
  end if;

  if target_rarity is null then
    raise exception 'invalid_card_rarity' using errcode = '22004';
  end if;

  if target_pool_binding_provided is null
    or (not target_pool_binding_provided and target_pool_id is not null)
  then
    raise exception 'invalid_pool_binding_mode' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card:' || normalized_id, 0)
  );

  select card.*
    into previous_card
  from public.cards as card
  where card.id = normalized_id
  for update;

  card_exists := found;

  -- #181 신규 등록이 기존 카드를 덮어쓰지 못하게 한다.
  if normalized_previous_id is null then
    if card_exists then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  else
    if normalized_previous_id is distinct from normalized_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    if not card_exists then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  if target_pool_binding_provided then
    effective_pool_id := target_pool_id;
  elsif card_exists then
    effective_pool_id := previous_card.pool_id;
  else
    effective_pool_id := null;
  end if;

  perform pool.id
  from public.card_pools as pool
  where pool.id = previous_card.pool_id
     or pool.id = effective_pool_id
  order by pool.id
  for update;

  perform 1
  from public.ips
  where id = normalized_ip_id
  for key share;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if card_exists then
    previous_payload := jsonb_build_object(
      'id', previous_card.id,
      'ip_id', previous_card.ip_id,
      'name', previous_card.name,
      'no', previous_card.no,
      'rarity', previous_card.rarity,
      'bg', previous_card.bg,
      'image_path', previous_card.image_path,
      'pool_id', previous_card.pool_id
    );

    if previous_card.pool_id is not null
      and (
        previous_card.ip_id is distinct from normalized_ip_id
        or previous_card.rarity is distinct from target_rarity
      )
    then
      raise exception 'pooled_card_catalog_contract_locked' using errcode = '23514';
    end if;
  end if;

  if effective_pool_id is not null then
    select pool.ip_id
      into target_pool_ip_id
    from public.card_pools as pool
    where pool.id = effective_pool_id;

    if not found then
      raise exception 'pool_not_found' using errcode = 'P0002';
    end if;

    if target_pool_ip_id is distinct from normalized_ip_id then
      raise exception 'card_pool_ip_mismatch' using errcode = '23514';
    end if;
  end if;

  if card_exists
    and previous_card.pool_id is not null
    and previous_card.pool_id is distinct from effective_pool_id
    and exists (
      select 1
      from public.pool_odds
      where pool_id = previous_card.pool_id
        and rarity = previous_card.rarity
        and probability > 0
    )
    and not exists (
      select 1
      from public.cards as other_card
      where other_card.pool_id = previous_card.pool_id
        and other_card.rarity = previous_card.rarity
        and other_card.id <> previous_card.id
    )
  then
    raise exception 'pool_rarity_uncovered' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'id', normalized_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'no', target_no,
    'rarity', target_rarity,
    'bg', target_bg,
    'image_path', target_image_path,
    'pool_id', effective_pool_id,
    'pool_binding_provided', target_pool_binding_provided,
    'mode', case when normalized_previous_id is null then 'create' else 'update' end
  );

  insert into public.cards (
    id,
    ip_id,
    name,
    no,
    rarity,
    bg,
    image_path,
    pool_id
  )
  values (
    normalized_id,
    normalized_ip_id,
    normalized_name,
    target_no,
    target_rarity,
    target_bg,
    target_image_path,
    effective_pool_id
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    no = excluded.no,
    rarity = excluded.rarity,
    bg = excluded.bg,
    image_path = excluded.image_path,
    pool_id = excluded.pool_id;

  update public.ips
  set cards_count = (
      select count(*)::integer from public.cards where cards.ip_id = ips.id
    ),
    updated_at = now()
  where id in (normalized_ip_id, previous_card.ip_id);

  after_payload := jsonb_build_object(
    'id', normalized_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'no', target_no,
    'rarity', target_rarity,
    'bg', target_bg,
    'image_path', target_image_path,
    'pool_id', effective_pool_id
  );

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.card.upsert',
    'cards:' || normalized_id,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );
end;
$function$;

-- admin_upsert_card_pool(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_upsert_card_pool(target_operation_id uuid, target_pool_id uuid, target_ip_id text, target_name text, target_active_from timestamp with time zone, target_active_to timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_ip_id text := btrim(target_ip_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  request_payload jsonb;
  previous_pool public.card_pools%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  pool_exists boolean := false;
  has_dependency boolean := false;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_pool_id is null then
    raise exception 'invalid_pool_id' using errcode = '22004';
  end if;

  if normalized_ip_id is null or normalized_ip_id = '' then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_pool_name' using errcode = '22023';
  end if;

  if target_active_from is null then
    raise exception 'invalid_active_from' using errcode = '22004';
  end if;

  if target_active_to is not null and target_active_to <= target_active_from then
    raise exception 'invalid_pool_active_window' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_card_pool_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.card_pool.upserted'
      and existing_target = 'card_pools:' || target_pool_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_pool_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_card_pool:' || target_pool_id::text, 0)
  );

  perform 1
  from public.ips
  where id = normalized_ip_id
  for key share;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  select pool.*
    into previous_pool
  from public.card_pools as pool
  where pool.id = target_pool_id
  for update;

  pool_exists := found;

  if pool_exists then
    previous_payload := jsonb_build_object(
      'id', previous_pool.id,
      'ip_id', previous_pool.ip_id,
      'name', previous_pool.name,
      'active_from', previous_pool.active_from,
      'active_to', previous_pool.active_to
    );

    if previous_pool.ip_id is distinct from normalized_ip_id then
      select exists (
        select 1 from public.cards where pool_id = target_pool_id
        union all
        select 1 from public.reward_policies where pool_id = target_pool_id
        union all
        select 1 from public.games where reward_pool_id = target_pool_id
        union all
        select 1 from public.draw_tickets where pool_id = target_pool_id
        union all
        select 1 from public.card_grants where pool_id = target_pool_id
      ) into has_dependency;

      if has_dependency then
        raise exception 'pool_ip_locked' using errcode = '23514';
      end if;
    end if;

    update public.card_pools
    set ip_id = normalized_ip_id,
        name = normalized_name,
        active_from = target_active_from,
        active_to = target_active_to
    where id = target_pool_id;
  else
    insert into public.card_pools (id, ip_id, name, active_from, active_to)
    values (
      target_pool_id,
      normalized_ip_id,
      normalized_name,
      target_active_from,
      target_active_to
    );
  end if;

  after_payload := jsonb_build_object(
    'id', target_pool_id,
    'ip_id', normalized_ip_id,
    'name', normalized_name,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.card_pool.upserted',
    'card_pools:' || target_pool_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_pool_id;
end;
$function$;

-- admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_upsert_category(target_operation_id uuid, target_category_id uuid, target_code text, target_name text, target_parent_id uuid, target_sort_order integer, target_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  result_id uuid;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_code is null or target_code !~ '^[a-z0-9][a-z0-9-]*$' or length(target_code) > 80
     or target_name is null or btrim(target_name) = '' or length(target_name) > 120
     or target_sort_order is null or target_sort_order < 0 then
    raise invalid_parameter_value using message = 'invalid_category';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'code', target_code,
    'name', btrim(target_name),
    'parent_id', target_parent_id,
    'sort_order', target_sort_order,
    'expected_updated_at', target_expected_updated_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id
       and existing_action in ('admin.catalog.category.created', 'admin.catalog.category.updated')
       and existing_diff -> 'request' = request_payload
    then
      result_id := coalesce(target_category_id, nullif(existing_diff ->> 'category_id', '')::uuid);
      next_depth := nullif(existing_diff #>> '{after,depth}', '')::integer;
      if result_id is not null and next_depth is not null then
        return jsonb_build_object('id', result_id, 'depth', next_depth);
      end if;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();

  if target_category_id is null then
    if exists (select 1 from public.catalog_categories where code = target_code) then raise unique_violation using message = 'category_code_taken'; end if;
    result_id := extensions.gen_random_uuid();
    next_depth := private.category_validate_parent(result_id, target_parent_id);
    insert into public.catalog_categories (id, code, name, parent_id, depth, sort_order)
    values (result_id, target_code, btrim(target_name), target_parent_id, next_depth, target_sort_order);
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.created', 'catalog_categories:' || result_id::text,
      jsonb_build_object('category_id', result_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  else
    select * into category_row from public.catalog_categories where id = target_category_id for update;
    if not found then raise no_data_found using message = 'category_not_found'; end if;
    if target_expected_updated_at is null or category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
    if exists (select 1 from public.catalog_categories where code = target_code and id <> target_category_id) then raise unique_violation using message = 'category_code_taken'; end if;
    next_depth := private.category_validate_parent(target_category_id, target_parent_id);
    update public.catalog_categories
    set code = target_code, name = btrim(target_name), parent_id = target_parent_id, depth = next_depth,
        sort_order = target_sort_order, updated_at = pg_catalog.now()
    where id = target_category_id;
    with recursive descendants as (
      select category.id, 1 as relative_depth
      from public.catalog_categories as category
      where category.parent_id = target_category_id
      union all
      select child.id, descendants.relative_depth + 1
      from descendants
      join public.catalog_categories as child on child.parent_id = descendants.id
    )
    update public.catalog_categories as child
    set depth = next_depth + descendants.relative_depth, updated_at = pg_catalog.now()
    from descendants
    where child.id = descendants.id;
    result_id := target_category_id;
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.updated', 'catalog_categories:' || target_category_id::text,
      jsonb_build_object('category_id', target_category_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  end if;
  return jsonb_build_object('id', result_id, 'depth', next_depth);
end;
$function$;

-- admin_upsert_coin_exchange_offer(uuid,uuid,text,integer,integer,text)
CREATE OR REPLACE FUNCTION public.admin_upsert_coin_exchange_offer(target_id uuid, target_pool_id uuid, target_label text, target_coin_cost integer, target_ticket_count integer, target_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_label text := btrim(coalesce(target_label, ''), E' \t\n\r\f\v');
  normalized_status text := coalesce(nullif(btrim(coalesce(target_status, '')), ''), 'active');
  normalized_ticket_count integer := coalesce(target_ticket_count, 1);
  offer_id uuid;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_label) not between 1 and 80 then
    raise exception 'invalid_offer_label' using errcode = '22023';
  end if;

  if target_coin_cost is null or target_coin_cost not between 1 and 100000 then
    raise exception 'invalid_offer_coin_cost' using errcode = '22023';
  end if;

  if normalized_ticket_count not between 1 and 10 then
    raise exception 'invalid_offer_ticket_count' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'disabled') then
    raise exception 'invalid_offer_status' using errcode = '22023';
  end if;

  -- 없는 풀을 가리키는 상품은 캠페인 화면에 "교환 가능"으로 그려진 뒤 교환
  -- 시점에야 실패한다. 등록 시점에 막는다.
  perform 1 from public.card_pools where id = target_pool_id for share;
  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if target_id is null then
    insert into public.coin_exchange_offers (pool_id, label, coin_cost, ticket_count, status)
    values (target_pool_id, normalized_label, target_coin_cost, normalized_ticket_count, normalized_status)
    returning id into offer_id;
  else
    update public.coin_exchange_offers
    set pool_id = target_pool_id,
        label = normalized_label,
        coin_cost = target_coin_cost,
        ticket_count = normalized_ticket_count,
        status = normalized_status
    where id = target_id
    returning id into offer_id;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'coin.exchange_offer.upsert',
    'coin_exchange_offers:' || offer_id::text,
    jsonb_build_object(
      'mode', case when target_id is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'poolId', target_pool_id,
        'label', normalized_label,
        'coinCost', target_coin_cost,
        'ticketCount', normalized_ticket_count,
        'status', normalized_status
      )
    )
  );

  return offer_id;
end;
$function$;

-- admin_upsert_coupon(text,text,text,integer,integer,integer,timestamp with time zone,timestamp with time zone,integer,text,loyalty_grade,text)
CREATE OR REPLACE FUNCTION public.admin_upsert_coupon(target_code text, target_name text, target_discount_type text, target_discount_value integer, target_max_discount_amount integer, target_min_subtotal integer, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, target_issue_limit integer, target_status text, target_grade_benefit loyalty_grade, target_previous_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_code text := upper(btrim(coalesce(target_code, '')));
  normalized_previous_code text := nullif(upper(btrim(coalesce(target_previous_code, ''))), '');
begin
  perform private.require_operator_capability('marketing.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('marketing.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_code is not null
     and normalized_previous_code is distinct from normalized_code then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if normalized_previous_code is not null then
    perform coupon.code
    from public.coupons as coupon
    where coupon.code = normalized_previous_code
    for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 발급 한도를 이미 발급된 수 아래로 줄이면 issued_count 검사가 영구 소진
  -- 상태가 될 뿐 원장은 깨지지 않는다 — 운영 실수로 두고 스키마는 막지 않는다.
  insert into public.coupons (
    code, name, discount_type, discount_value, max_discount_amount,
    min_subtotal, starts_at, ends_at, issue_limit, status, grade_benefit
  )
  values (
    normalized_code,
    btrim(coalesce(target_name, '')),
    target_discount_type,
    target_discount_value,
    target_max_discount_amount,
    coalesce(target_min_subtotal, 0),
    coalesce(target_starts_at, now()),
    target_ends_at,
    target_issue_limit,
    coalesce(target_status, 'active'),
    target_grade_benefit
  )
  on conflict (code) do update set
    name = excluded.name,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    max_discount_amount = excluded.max_discount_amount,
    min_subtotal = excluded.min_subtotal,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    issue_limit = excluded.issue_limit,
    status = excluded.status,
    grade_benefit = excluded.grade_benefit
  where normalized_previous_code is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'commerce.coupon.upsert',
    'coupons:' || normalized_code,
    jsonb_build_object(
      'mode', case when normalized_previous_code is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'name', btrim(coalesce(target_name, '')),
        'discountType', target_discount_type,
        'discountValue', target_discount_value,
        'maxDiscountAmount', target_max_discount_amount,
        'minSubtotal', coalesce(target_min_subtotal, 0),
        'startsAt', coalesce(target_starts_at, now()),
        'endsAt', target_ends_at,
        'issueLimit', target_issue_limit,
        'status', coalesce(target_status, 'active'),
        'gradeBenefit', target_grade_benefit
      )
    )
  );
end;
$function$;

-- admin_upsert_coupon_scheduled(jsonb)
CREATE OR REPLACE FUNCTION public.admin_upsert_coupon_scheduled(target_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); saved public.coupons; previous public.coupons;
  issue_start timestamptz:=(target_payload->>'target_issue_starts_at')::timestamptz;
  issue_end timestamptz:=(target_payload->>'target_issue_ends_at')::timestamptz;
  usage_end timestamptz:=(target_payload->>'target_ends_at')::timestamptz;
  days integer:=(target_payload->>'target_valid_days')::integer;
  normalized_code text:=upper(btrim(target_payload->>'target_code'));
begin
  perform private.require_operator_capability('marketing.manage',false);

  perform private.assert_active_user(actor);
  if not public.has_operator_capability('marketing.manage',false) or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required';end if;
  if issue_start is null or (issue_end is not null and issue_end<=issue_start)
    or (days is not null and (days not between 1 and 365 or usage_end is not null))
    or (days is null and usage_end is not null and (issue_start>=usage_end or issue_end>usage_end))
    then raise invalid_parameter_value using message='invalid_coupon_issue_schedule';end if;
  perform pg_advisory_xact_lock(hashtextextended('coupon_admin:'||normalized_code,0));
  select * into previous from public.coupons where code=normalized_code for update;
  perform public.admin_upsert_coupon_targeted(target_payload-array['target_issue_starts_at','target_issue_ends_at','target_valid_days']);
  update public.coupons set issue_starts_at=issue_start,issue_ends_at=issue_end,valid_days=days where code=normalized_code returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.schedule_updated','coupons:'||normalized_code,
    jsonb_build_object('before',case when previous.code is null then null else jsonb_build_object('issueStartsAt',previous.issue_starts_at,'issueEndsAt',previous.issue_ends_at,'validDays',previous.valid_days) end,
      'after',jsonb_build_object('issueStartsAt',saved.issue_starts_at,'issueEndsAt',saved.issue_ends_at,'validDays',saved.valid_days),'revision',saved.terms_revision));
  return jsonb_build_object('code',saved.code,'revision',saved.terms_revision);
end $function$;

-- admin_upsert_coupon_targeted(jsonb)
CREATE OR REPLACE FUNCTION public.admin_upsert_coupon_targeted(target_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.coupons; saved public.coupons;
  normalized_code text:=upper(btrim(target_payload->>'target_code')); previous_code text:=nullif(upper(btrim(target_payload->>'target_previous_code')),'');
  segment text:=target_payload->>'target_recipient_segment'; scope text:=target_payload->>'target_goods_scope'; good_ids text[];
  next_status text:=coalesce(target_payload->>'target_status','active');
begin
  perform private.require_operator_capability('marketing.manage',false);

 perform private.assert_active_user(actor);
 if not public.has_operator_capability('marketing.manage',false) or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required'; end if;
 if jsonb_typeof(target_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_payload) k
    where k not in ('target_code','target_name','target_discount_type','target_discount_value','target_max_discount_amount','target_min_subtotal','target_starts_at','target_ends_at','target_issue_limit','target_status','target_grade_benefit','target_previous_code','target_recipient_segment','target_goods_scope','target_good_ids','target_expected_revision'))
    or segment is null or segment not in ('all','first_purchase','repeat_purchase') or scope is null or scope not in ('all','selected_goods')
    or next_status not in ('active','archived')
    or jsonb_typeof(target_payload->'target_good_ids') is distinct from 'array' or jsonb_array_length(target_payload->'target_good_ids')>1000
    or exists(select 1 from jsonb_array_elements(target_payload->'target_good_ids') e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 200)
    then raise invalid_parameter_value using message='invalid_coupon_targeting'; end if;
 select coalesce(array_agg(distinct btrim(value) order by btrim(value)),'{}') into good_ids from jsonb_array_elements_text(target_payload->'target_good_ids');
 if scope='all' and cardinality(good_ids)>0 then raise invalid_parameter_value using message='invalid_coupon_targeting'; end if;
 if scope='selected_goods' and next_status='active' and cardinality(good_ids)=0 then raise check_violation using message='coupon_goods_scope_ready'; end if;
 if previous_code is not null and previous_code is distinct from normalized_code then raise invalid_parameter_value using message='catalog_id_immutable'; end if;
 -- Per-code lock covers a new definition before its row exists and prevents a
 -- concurrent creator from being converted into an update.
 perform pg_advisory_xact_lock(hashtextextended('coupon_admin:'||normalized_code,0));
 select * into previous from public.coupons where code=normalized_code for update;
 if previous_code is null and found then raise unique_violation using message='catalog_id_taken'; end if;
 if previous_code is not null then
   if previous.code is null then raise no_data_found using message='catalog_record_missing'; end if;
   if (target_payload->>'target_expected_revision')::integer is distinct from previous.terms_revision then raise exception using errcode='PT409',message='coupon_terms_changed'; end if;
 end if;
 if exists(select 1 from unnest(good_ids) target(id) where not exists(select 1 from public.goods g where g.id=target.id and (g.archived_at is null or target.id=any(previous.target_good_ids))))
   then raise check_violation using message='coupon_target_good_unavailable'; end if;
 -- A cleared archived definition must receive its validated targets before the
 -- legacy writer switches status to active. Both writes keep the row lock and
 -- one transaction; failure never exposes a partial definition to customers.
 if previous.status='archived' and next_status='active' then
   update public.coupons set recipient_segment=segment,goods_scope=scope,target_good_ids=good_ids where code=normalized_code;
 end if;
 perform public.admin_upsert_coupon(
   normalized_code,target_payload->>'target_name',target_payload->>'target_discount_type',(target_payload->>'target_discount_value')::integer,
   (target_payload->>'target_max_discount_amount')::integer,(target_payload->>'target_min_subtotal')::integer,
   (target_payload->>'target_starts_at')::timestamptz,(target_payload->>'target_ends_at')::timestamptz,
   (target_payload->>'target_issue_limit')::integer,next_status,(target_payload->>'target_grade_benefit')::public.loyalty_grade,previous_code);
 update public.coupons set recipient_segment=segment,goods_scope=scope,target_good_ids=good_ids where code=normalized_code returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.targeting_updated','coupons:'||normalized_code,
   jsonb_build_object('before',case when previous.code is null then null else jsonb_build_object('recipientSegment',previous.recipient_segment,'goodsScope',previous.goods_scope,'targetGoodIds',previous.target_good_ids,'revision',previous.terms_revision) end,
     'after',jsonb_build_object('recipientSegment',saved.recipient_segment,'goodsScope',saved.goods_scope,'targetGoodIds',saved.target_good_ids,'revision',saved.terms_revision)));
 return jsonb_build_object('code',saved.code,'revision',saved.terms_revision);
end $function$;

-- admin_upsert_event(text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_upsert_event(target_id text, target_ip_id text, target_title text, target_mode text, target_status text, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, target_location text, target_accent text, target_bg text, target_image_path text, target_previous_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.events where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  else
    -- 슬러그 섀도잉 차단(역방향). 수정 분기에는 걸지 않는다 — 이 조건이 참인
    -- 기존 팝업이 있다면 그것은 이 가드가 생기기 전에 만들어진 행이고, 편집을
    -- 막아도 충돌은 그대로 남는다.
    if exists (select 1 from public.campaigns where id = target_id) then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.events (
    id,
    ip_id,
    title,
    mode,
    status,
    starts_at,
    ends_at,
    location,
    accent,
    bg,
    image_path
  )
  values (
    target_id,
    target_ip_id,
    target_title,
    target_mode,
    target_status,
    target_starts_at,
    target_ends_at,
    target_location,
    target_accent,
    target_bg,
    target_image_path
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    title = excluded.title,
    mode = excluded.mode,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    location = excluded.location,
    accent = excluded.accent,
    bg = excluded.bg,
    image_path = excluded.image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.event.upsert',
    'events:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'title', target_title,
      'status', target_status,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$function$;

-- admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)
CREATE OR REPLACE FUNCTION public.admin_upsert_game(target_operation_id uuid, target_previous_game_id text, target_game_id text, target_title text, target_reward_pool_id uuid, target_event_id text, target_per_user_daily_limit integer, target_active_from timestamp with time zone, target_active_to timestamp with time zone, target_end_now boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);

  -- Ending an already-running card game is a fail-safe operation and remains
  -- available. Every create/update activation request is blocked while OFF.
  if not coalesce(target_end_now, false) then
    perform private.require_card_rewards_enabled();
  end if;

  return public.admin_upsert_game_unguarded(
    target_operation_id,
    target_previous_game_id,
    target_game_id,
    target_title,
    target_reward_pool_id,
    target_event_id,
    target_per_user_daily_limit,
    target_active_from,
    target_active_to,
    target_end_now
  );
end;
$function$;

-- admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)
CREATE OR REPLACE FUNCTION public.admin_upsert_good(target_id text, target_ip_id text, target_name text, target_type text, target_price integer, target_badge text, target_stock text, target_bg text, target_image_path text, target_notice_maker text, target_notice_origin text, target_notice_material text, target_notice_size text, target_notice_made_on text, target_notice_as_manager text, target_notice_as_contact text, target_description text, target_gallery_paths text[], target_detail_image_path text, target_previous_id text DEFAULT NULL::text, target_compare_at_price integer DEFAULT NULL::integer, target_publish boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_ip_id text;
  notice_maker text := nullif(btrim(coalesce(target_notice_maker, ''), E' \t\n\r\f\v'), '');
  notice_origin text := nullif(btrim(coalesce(target_notice_origin, ''), E' \t\n\r\f\v'), '');
  notice_material text := nullif(btrim(coalesce(target_notice_material, ''), E' \t\n\r\f\v'), '');
  notice_size text := nullif(btrim(coalesce(target_notice_size, ''), E' \t\n\r\f\v'), '');
  notice_made_on text := nullif(btrim(coalesce(target_notice_made_on, ''), E' \t\n\r\f\v'), '');
  notice_as_manager text := nullif(btrim(coalesce(target_notice_as_manager, ''), E' \t\n\r\f\v'), '');
  notice_as_contact text := nullif(btrim(coalesce(target_notice_as_contact, ''), E' \t\n\r\f\v'), '');
  gallery_paths text[] := coalesce(target_gallery_paths, '{}'::text[]);
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('catalog.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null and normalized_previous_id is distinct from target_id then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if nullif(btrim(target_name),'') is null then raise check_violation using message='goods_name_required'; end if;

  -- 고시정보 누락은 앱 폼에서도 막지만, RPC 를 직접 부르는 경로에서도 막는다.
  if (target_publish is true or exists(select 1 from public.goods where id=target_id and published_at is not null)) and (notice_maker is null
    or notice_origin is null
    or notice_material is null
    or notice_size is null
    or notice_made_on is null
    or notice_as_manager is null
    or notice_as_contact is null)
  then
    raise exception 'goods_notice_required' using errcode = '23514';
  end if;

  if coalesce(array_length(gallery_paths, 1), 0) > 9 then
    raise exception 'goods_gallery_limit' using errcode = '23514';
  end if;

  -- 정가는 할인 표기 전용이다 — 판매가 이하의 정가는 CHECK 에 맡기지 않고
  -- 여기서 도메인 이름을 가진 에러로 먼저 거른다.
  if target_compare_at_price is not null and target_compare_at_price <= target_price then
    raise exception 'goods_compare_at_price_invalid' using errcode = '23514';
  end if;

  select ip_id into previous_ip_id from public.goods where id = target_id for update;

  if normalized_previous_id is not null and not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;

  insert into public.goods (
    id,
    ip_id,
    name,
    type,
    price,
    compare_at_price,
    badge,
    stock,
    bg,
    image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact,
    description,
    gallery_paths,
    detail_image_path
  )
  values (
    target_id,
    target_ip_id,
    target_name,
    coalesce(target_type,''),
    coalesce(target_price,0),
    target_compare_at_price,
    target_badge,
    coalesce(target_stock,'ok'),
    target_bg,
    target_image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact,
    nullif(btrim(coalesce(target_description, ''), E' \t\n\r\f\v'), ''),
    gallery_paths,
    nullif(btrim(coalesce(target_detail_image_path, ''), E' \t\n\r\f\v'), '')
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    type = excluded.type,
    price = excluded.price,
    compare_at_price = excluded.compare_at_price,
    badge = excluded.badge,
    stock = excluded.stock,
    bg = excluded.bg,
    image_path = excluded.image_path,
    notice_maker = excluded.notice_maker,
    notice_origin = excluded.notice_origin,
    notice_material = excluded.notice_material,
    notice_size = excluded.notice_size,
    notice_made_on = excluded.notice_made_on,
    notice_as_manager = excluded.notice_as_manager,
    notice_as_contact = excluded.notice_as_contact,
    description = excluded.description,
    gallery_paths = excluded.gallery_paths,
    detail_image_path = excluded.detail_image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  if target_publish is not null then perform private.set_good_published(target_id,target_publish); end if;

  update public.ips
  set goods_count = (
      select count(*)::integer from public.goods where goods.ip_id = ips.id
    ),
    updated_at = now()
  where id in (target_ip_id, previous_ip_id);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.good.upsert',
    'goods:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'name', target_name,
      'price', target_price,
      'compare_at_price', target_compare_at_price,
      'gallery_count', coalesce(array_length(gallery_paths, 1), 0),
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$function$;

-- admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamp with time zone,timestamp with time zone,boolean,text,jsonb)
CREATE OR REPLACE FUNCTION public.admin_upsert_home_curation(target_operation_id uuid, target_curation_id uuid, target_kind text, target_ip_id text, target_title text, target_image_path text, target_link_path text, target_display_order integer, target_active_from timestamp with time zone, target_active_to timestamp with time zone, target_enabled boolean, target_slot text DEFAULT NULL::text, target_payload jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  -- Alias with a column-safe name: inside the claim UPDATE below, a bare
  -- actor_id would be ambiguous against admin_artwork_upload_claims.actor_id.
  claim_owner_id uuid := actor_id;
  normalized_kind text := pg_catalog.btrim(target_kind);
  normalized_ip_id text := nullif(pg_catalog.btrim(target_ip_id), '');
  normalized_title text := pg_catalog.btrim(target_title);
  normalized_image_path text := nullif(pg_catalog.btrim(target_image_path), '');
  normalized_link_path text := pg_catalog.btrim(target_link_path);
  normalized_slot text := nullif(pg_catalog.btrim(target_slot), '');
  normalized_payload jsonb := case
    when target_payload is null or target_payload = '{}'::jsonb then null
    else target_payload
  end;
  allowed_payload_keys text[];
  payload_key text;
  payload_text_value text;
  payload_good_ids jsonb;
  payload_good_id_limit integer;
  payload_good_id text;
  payload_mobile_image_path text;
  previous_mobile_image_path text;
  referenced_archived_at timestamptz;
  request_payload jsonb;
  previous_payload jsonb := 'null'::jsonb;
  after_payload jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  previous_curation public.home_curations%rowtype;
  curation_exists boolean := false;
begin
  perform private.require_operator_capability('store.manage',false);

  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  perform 1 from public.profiles where id=actor_id and role in ('staff','admin') and suspended_at is null for share;
  if not found then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if target_operation_id is null then
    raise null_value_not_allowed using message = 'invalid_operation_id';
  end if;
  if target_curation_id is null then
    raise null_value_not_allowed using message = 'invalid_curation_id';
  end if;
  if normalized_kind is null
    or normalized_kind not in (
      'hero', 'featured_ip', 'announcement',
      'notice_strip', 'editor_pick', 'band_banner', 'best_tab', 'benefit', 'sales_best', 'review_best', 'product_mosaic'
    )
  then
    raise invalid_parameter_value using message = 'invalid_curation_kind';
  end if;
  if normalized_title is null
    or pg_catalog.char_length(normalized_title) not between 1 and 120
    or (normalized_kind in ('sales_best','review_best','product_mosaic') and pg_catalog.char_length(normalized_title)>15)
  then
    raise invalid_parameter_value using message = 'invalid_curation_title';
  end if;
  if normalized_kind = 'featured_ip' and normalized_ip_id is null then
    raise invalid_parameter_value using message = 'invalid_curation_ip';
  end if;
  if normalized_kind <> 'featured_ip' and normalized_ip_id is not null then
    raise invalid_parameter_value using message = 'invalid_curation_ip';
  end if;
  if normalized_kind in ('hero', 'notice_strip', 'editor_pick', 'band_banner')
    and normalized_image_path is null
  then
    raise check_violation using message = 'curation_image_required';
  end if;
  if normalized_image_path is not null
    and normalized_image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise check_violation using message = 'invalid_curation_image_path';
  end if;
  if normalized_link_path is null
    or not private.is_safe_home_curation_link(normalized_link_path)
  then
    raise invalid_parameter_value using message = 'invalid_curation_link_path';
  end if;
  if target_display_order is null or target_display_order < 0 then
    raise invalid_parameter_value using message = 'invalid_curation_display_order';
  end if;
  if target_active_from is null then
    raise null_value_not_allowed using message = 'invalid_curation_active_from';
  end if;
  if not pg_catalog.isfinite(target_active_from) then
    raise invalid_parameter_value using message = 'invalid_curation_active_from';
  end if;
  if target_active_to is not null
    and (
      not pg_catalog.isfinite(target_active_to)
      or target_active_to <= target_active_from
    )
  then
    raise check_violation using message = 'invalid_curation_active_window';
  end if;
  if target_enabled is null then
    raise null_value_not_allowed using message = 'invalid_curation_enabled';
  end if;

  if normalized_kind = 'best_tab' then
    if normalized_slot is null or normalized_slot not in ('category', 'popular') then
      raise invalid_parameter_value using message = 'invalid_curation_slot';
    end if;
  elsif normalized_slot is not null then
    raise invalid_parameter_value using message = 'invalid_curation_slot';
  end if;

  -- Per-kind payload whitelist. Unknown keys are rejected outright so typos
  -- never ship silently dead configuration.
  allowed_payload_keys := case normalized_kind
    when 'hero' then array['subtitle', 'mobile_image_path']
    when 'notice_strip' then array['mobile_image_path']
    when 'editor_pick' then array['badge', 'description']
    when 'band_banner' then array['subcopy', 'good_ids']
    when 'best_tab' then array['good_ids', 'selection_mode', 'item_count']
    when 'benefit' then array['description']
    when 'sales_best' then array['exposure_mode','period']
    when 'review_best' then array['selection_mode','good_ids']
    when 'product_mosaic' then array['mosaic_title','mosaic_subtitle','slots']
    else array[]::text[]
  end;

  if normalized_payload is not null then
    if pg_catalog.jsonb_typeof(normalized_payload) <> 'object' then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
    end if;
    if pg_catalog.cardinality(allowed_payload_keys) = 0 then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
    end if;
    for payload_key in
      select key from pg_catalog.jsonb_object_keys(normalized_payload) as keys(key)
    loop
      if not payload_key = any (allowed_payload_keys) then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
    end loop;

    for payload_key in
      select unnest from pg_catalog.unnest(array['subtitle', 'badge', 'description', 'subcopy'])
    loop
      if normalized_payload ? payload_key then
        if pg_catalog.jsonb_typeof(normalized_payload -> payload_key) <> 'string' then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
        payload_text_value := pg_catalog.btrim(normalized_payload ->> payload_key);
        if pg_catalog.char_length(payload_text_value) not between 1 and 200
          or (payload_key = 'badge' and pg_catalog.char_length(payload_text_value) > 20)
        then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
        normalized_payload := pg_catalog.jsonb_set(
          normalized_payload, array[payload_key], pg_catalog.to_jsonb(payload_text_value)
        );
      end if;
    end loop;

    if normalized_payload ? 'good_ids' then
      payload_good_ids := normalized_payload -> 'good_ids';
      payload_good_id_limit := case normalized_kind when 'best_tab' then 12 when 'review_best' then 20 else 4 end;
      if pg_catalog.jsonb_typeof(payload_good_ids) <> 'array'
        or pg_catalog.jsonb_array_length(payload_good_ids) not between (case when normalized_kind='review_best' then 0 else 1 end) and payload_good_id_limit
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      for payload_good_id in
        select value from pg_catalog.jsonb_array_elements_text(payload_good_ids) as elements(value)
      loop
        if payload_good_id !~ '^[A-Za-z0-9_-]{1,64}$' then
          raise invalid_parameter_value using message = 'invalid_curation_payload';
        end if;
      end loop;
    end if;

    -- Automatic selection is a rule, never a saved snapshot of product IDs.
    if normalized_kind='best_tab' and normalized_payload ? 'selection_mode' then
      if pg_catalog.jsonb_typeof(normalized_payload -> 'selection_mode') <> 'string'
        or normalized_payload ->> 'selection_mode' <> 'latest'
        or normalized_payload ? 'good_ids'
        or not normalized_payload ? 'item_count'
        or pg_catalog.jsonb_typeof(normalized_payload -> 'item_count') <> 'number'
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      if (normalized_payload ->> 'item_count')::numeric not between 3 and 10
        or pg_catalog.trunc((normalized_payload ->> 'item_count')::numeric)
          <> (normalized_payload ->> 'item_count')::numeric
      then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      normalized_payload := pg_catalog.jsonb_set(
        normalized_payload, array['item_count'],
        pg_catalog.to_jsonb(((normalized_payload ->> 'item_count')::numeric)::integer)
      );
    elsif normalized_kind='best_tab' and normalized_payload ? 'item_count' then
      raise invalid_parameter_value using message = 'invalid_curation_payload';
    end if;

    if normalized_payload ? 'mobile_image_path' then
      if pg_catalog.jsonb_typeof(normalized_payload -> 'mobile_image_path') <> 'string' then
        raise invalid_parameter_value using message = 'invalid_curation_payload';
      end if;
      payload_mobile_image_path := normalized_payload ->> 'mobile_image_path';
      if payload_mobile_image_path
        !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then
        raise check_violation using message = 'invalid_curation_image_path';
      end if;
    end if;
  end if;

  if not private.is_valid_home_ranked_curation(normalized_kind, normalized_payload) then
    raise invalid_parameter_value using message='invalid_curation_payload';
  end if;

  if normalized_kind='product_mosaic' and (not private.is_valid_home_mosaic(normalized_payload) or normalized_image_path is not null) then
    raise invalid_parameter_value using message='invalid_curation_mosaic';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'kind', normalized_kind,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'image_path', normalized_image_path,
    'link_path', normalized_link_path,
    'display_order', target_display_order,
    'active_from', target_active_from,
    'active_to', target_active_to,
    'enabled', target_enabled,
    'slot', normalized_slot,
    'payload', normalized_payload
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_home_curation_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.home_curation.upserted'
      and existing_target = 'home_curations:' || target_curation_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_curation_id;
    end if;

    raise unique_violation using message = 'operation_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_home_curation:' || target_curation_id::text,
      0
    )
  );

  if normalized_ip_id is not null then
    select ip.archived_at
      into referenced_archived_at
    from public.ips as ip
    where ip.id = normalized_ip_id
    for update of ip;

    if not found then
      raise no_data_found using message = 'curation_ip_not_found';
    end if;
    if referenced_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  select curation.*
    into previous_curation
  from public.home_curations as curation
  where curation.id = target_curation_id
  for update of curation;
  curation_exists := found;

  if curation_exists then
    previous_payload := pg_catalog.jsonb_build_object(
      'id', previous_curation.id,
      'kind', previous_curation.kind,
      'ip_id', previous_curation.ip_id,
      'title', previous_curation.title,
      'image_path', previous_curation.image_path,
      'link_path', previous_curation.link_path,
      'display_order', previous_curation.display_order,
      'active_from', previous_curation.active_from,
      'active_to', previous_curation.active_to,
      'enabled', previous_curation.enabled,
      'slot', previous_curation.slot,
      'payload', previous_curation.payload
    );
    previous_mobile_image_path := previous_curation.payload ->> 'mobile_image_path';
  end if;

  -- The artwork-claim trigger only guards the image_path column, so the
  -- mobile artwork carried inside payload consumes its verified upload claim
  -- here, under the same actor/kind/single-use rules (#112 contract).
  if payload_mobile_image_path is not null
    and payload_mobile_image_path is distinct from previous_mobile_image_path
  then
    update public.admin_artwork_upload_claims as claim
    set
      status = 'attached',
      attached_at = pg_catalog.clock_timestamp(),
      resolved_at = pg_catalog.clock_timestamp()
    where claim.actor_id = claim_owner_id
      and claim.path = pg_catalog.substr(
        payload_mobile_image_path,
        pg_catalog.length('public-media/') + 1
      )
      and claim.kind = 'curation'
      and claim.status = 'verified'
      and claim.verified_at is not null
      and claim.final_size is not null
      and claim.attached_at is null
      and claim.expires_at > pg_catalog.clock_timestamp();

    if not found then
      raise check_violation using message = 'unverified_artwork';
    end if;
  end if;

  if curation_exists then
    update public.home_curations
    set
      kind = normalized_kind,
      ip_id = normalized_ip_id,
      title = normalized_title,
      image_path = normalized_image_path,
      link_path = normalized_link_path,
      display_order = target_display_order,
      active_from = target_active_from,
      active_to = target_active_to,
      enabled = target_enabled,
      slot = normalized_slot,
      payload = normalized_payload
    where id = target_curation_id;
  else
    insert into public.home_curations (
      id, kind, ip_id, title, image_path, link_path,
      display_order, active_from, active_to, enabled, slot, payload
    )
    values (
      target_curation_id, normalized_kind, normalized_ip_id, normalized_title,
      normalized_image_path, normalized_link_path, target_display_order,
      target_active_from, target_active_to, target_enabled, normalized_slot,
      normalized_payload
    );
  end if;

  after_payload := pg_catalog.jsonb_build_object(
    'id', target_curation_id,
    'kind', normalized_kind,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'image_path', normalized_image_path,
    'link_path', normalized_link_path,
    'display_order', target_display_order,
    'active_from', target_active_from,
    'active_to', target_active_to,
    'enabled', target_enabled,
    'slot', normalized_slot,
    'payload', normalized_payload
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.home_curation.upserted',
    'home_curations:' || target_curation_id::text,
    pg_catalog.jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_curation_id;
end;
$function$;

-- admin_upsert_ip(text,text,text,text,text,text,text,text,text,boolean,text,boolean)
CREATE OR REPLACE FUNCTION public.admin_upsert_ip(target_id text, target_title text, target_sub text, target_vertical_key text, target_tagline text, target_synopsis text, target_glyph text, target_bg text, target_image_path text, target_featured boolean, target_previous_id text DEFAULT NULL::text, target_publish boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.ips where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 신규 등록(normalized_previous_id is null)에서는 do update 가 걸러진다.
  -- 충돌한 행이 갱신되지 않으므로 found 가 false 가 되고 아래에서 막는다.
  insert into public.ips (
    id,
    title,
    sub,
    vertical_key,
    tagline,
    synopsis,
    glyph,
    bg,
    image_path,
    featured
  )
  values (
    target_id,
    target_title,
    target_sub,
    target_vertical_key,
    target_tagline,
    target_synopsis,
    target_glyph,
    target_bg,
    target_image_path,
    coalesce(target_featured, false)
  )
  on conflict (id) do update set
    title = excluded.title,
    sub = excluded.sub,
    vertical_key = excluded.vertical_key,
    tagline = excluded.tagline,
    synopsis = excluded.synopsis,
    glyph = excluded.glyph,
    bg = excluded.bg,
    image_path = excluded.image_path,
    featured = coalesce(target_featured, ips.featured),
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.upsert',
    'ips:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'title', target_title,
      'vertical_key', target_vertical_key,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );

  -- 게시 상태는 저장과 같은 transaction 에서 한 번만 전환하고 별도로 감사한다.
  if target_publish is not null then
    perform private.set_ip_published(target_id, target_publish);
  end if;
end;
$function$;

-- admin_upsert_order_dispatch_delay(uuid,text,date)
CREATE OR REPLACE FUNCTION public.admin_upsert_order_dispatch_delay(p_order_id uuid, p_reason text, p_expected_ship_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_status public.order_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  -- 발송 전 주문에만 붙는 메모다. 이미 나간 주문의 "지연 사유"는 기록이 아니라 혼선이다.
  if v_status not in ('paid', 'confirmed') then
    raise check_violation using message = 'order_already_dispatched';
  end if;

  if v_reason is null then
    delete from public.order_dispatch_delays where order_id = p_order_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.dispatch_delay_cleared',
      'order:' || p_order_id::text,
      jsonb_build_object('status', v_status::text)
    );
    return;
  end if;

  insert into public.order_dispatch_delays (order_id, reason, expected_ship_date, noted_by)
  values (p_order_id, v_reason, p_expected_ship_date, v_actor)
  on conflict (order_id) do update set
    reason = excluded.reason,
    expected_ship_date = excluded.expected_ship_date,
    noted_by = excluded.noted_by;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.dispatch_delay_noted',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'expectedShipDate', p_expected_ship_date,
      'status', v_status::text
    )
  );
end;
$function$;

-- admin_upsert_reward_policy(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.admin_upsert_reward_policy(target_operation_id uuid, target_policy_id uuid, target_pool_id uuid, target_trigger text, target_ip_id text, target_good_id text, target_min_amount bigint, target_tickets_per_grant integer, target_active boolean, target_active_from timestamp with time zone, target_active_to timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.require_operator_capability('platform.manage',false);

  if target_active then
    perform private.require_card_rewards_enabled();
  end if;

  return public.admin_upsert_reward_policy_unguarded(
    target_operation_id,
    target_policy_id,
    target_pool_id,
    target_trigger,
    target_ip_id,
    target_good_id,
    target_min_amount,
    target_tickets_per_grant,
    target_active,
    target_active_from,
    target_active_to
  );
end;
$function$;

-- admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_upsert_ticket_type(target_operation_id uuid, target_ticket_type_id uuid, target_event_id text, target_name text, target_price integer, target_capacity integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_event_id text := btrim(target_event_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  request_payload jsonb;
  previous_ticket_type public.ticket_types%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  ticket_type_exists boolean := false;
  has_ticket_history boolean := false;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('platform.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_ticket_type_id is null then
    raise exception 'invalid_ticket_type_id' using errcode = '22004';
  end if;

  if normalized_event_id is null or normalized_event_id = '' then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_ticket_type_name' using errcode = '22023';
  end if;

  if target_price is null or target_price < 0 then
    raise exception 'invalid_ticket_type_price' using errcode = '22023';
  end if;

  if target_capacity is null or target_capacity < 0 then
    raise exception 'invalid_ticket_type_capacity' using errcode = '22023';
  end if;

  request_payload := jsonb_build_object(
    'event_id', normalized_event_id,
    'name', normalized_name,
    'price', target_price,
    'capacity', target_capacity
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_ticket_type_operation:' || target_operation_id::text, 0)
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.ticket_type.upserted'
      and existing_target = 'ticket_types:' || target_ticket_type_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_ticket_type_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_ticket_type:' || target_ticket_type_id::text, 0)
  );

  perform 1
  from public.events
  where id = normalized_event_id
  for key share;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select ticket_type.*
    into previous_ticket_type
  from public.ticket_types as ticket_type
  where ticket_type.id = target_ticket_type_id
  for update;

  ticket_type_exists := found;

  if ticket_type_exists then
    if target_capacity < previous_ticket_type.sold then
      raise exception 'capacity_below_sold' using errcode = '23514';
    end if;

    select exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_type_id = target_ticket_type_id
    ) into has_ticket_history;

    if has_ticket_history and (
      previous_ticket_type.event_id is distinct from normalized_event_id
      or previous_ticket_type.name is distinct from normalized_name
      or previous_ticket_type.price is distinct from target_price
    ) then
      raise exception 'ticket_type_catalog_locked' using errcode = '23514';
    end if;

    previous_payload := jsonb_build_object(
      'event_id', previous_ticket_type.event_id,
      'name', previous_ticket_type.name,
      'price', previous_ticket_type.price,
      'capacity', previous_ticket_type.capacity,
      'sold', previous_ticket_type.sold
    );

    update public.ticket_types
    set event_id = normalized_event_id,
        name = normalized_name,
        price = target_price,
        capacity = target_capacity
    where id = target_ticket_type_id;

    after_payload := jsonb_build_object(
      'event_id', normalized_event_id,
      'name', normalized_name,
      'price', target_price,
      'capacity', target_capacity,
      'sold', previous_ticket_type.sold
    );
  else
    insert into public.ticket_types (id, event_id, name, price, capacity)
    values (
      target_ticket_type_id,
      normalized_event_id,
      normalized_name,
      target_price,
      target_capacity
    );

    after_payload := jsonb_build_object(
      'event_id', normalized_event_id,
      'name', normalized_name,
      'price', target_price,
      'capacity', target_capacity,
      'sold', 0
    );
  end if;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.ticket_type.upserted',
    'ticket_types:' || target_ticket_type_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_ticket_type_id;
end;
$function$;

-- admin_use_stock_supply(text,uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.admin_use_stock_supply(p_good_id text, p_variant_id uuid, p_expected_policy_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); variant public.goods_variants; policy private.goods_preorder_policies;
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not coalesce(public.has_operator_capability('platform.manage',true),false) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then
    raise insufficient_privilege using message='preorder_admin_required';
  end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if variant.preorder_policy_id is null and p_expected_policy_id is null then return jsonb_build_object('changed',false); end if;
  if variant.preorder_policy_id is distinct from p_expected_policy_id then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  select * into policy from private.goods_preorder_policies where id=variant.preorder_policy_id for update;
  if policy.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  if policy.state<>'stopped' then raise check_violation using message='stop_preorder_before_stock_supply'; end if;
  if exists(select 1 from private.goods_preorder_reservations reservation join private.goods_preorder_policies source on source.id=reservation.policy_id
    where source.variant_id=variant.id and reservation.state='reserved') then raise check_violation using message='preorder_allocations_pending'; end if;
  update public.goods_variants set preorder_policy_id=null where id=variant.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.stock_supply_selected','goods:'||p_good_id,
    jsonb_build_object('variantId',variant.id,'previousPolicyId',policy.id));
  return jsonb_build_object('changed',true);
end $function$;

-- can_stage_admin_artwork(text)
CREATE OR REPLACE FUNCTION public.can_stage_admin_artwork(target_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.admin_artwork_upload_claims claim where claim.actor_id=(select auth.uid()) and claim.path=target_path and claim.status='pending' and claim.expires_at>clock_timestamp() and public.has_operator_capability(private.operator_artwork_capability(claim.kind)));
$function$;

-- community_post_reaction_counts(uuid[],uuid[])
CREATE OR REPLACE FUNCTION public.community_post_reaction_counts(target_post_ids uuid[], blocked_user_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(post_id uuid, likes_count bigint, comments_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with target_posts as (
    select posts.id
    from public.posts
    where posts.id = any(target_post_ids)
      and (
        posts.status = 'visible'
        or posts.user_id = (select auth.uid())
        or (select public.has_operator_capability('platform.manage',false))
      )
  ),
  like_counts as (
    select likes.post_id, count(*)::bigint as likes_count
    from public.likes
    join target_posts on target_posts.id = likes.post_id
    group by likes.post_id
  ),
  comment_counts as (
    select comments.post_id, count(*)::bigint as comments_count
    from public.comments
    join target_posts on target_posts.id = comments.post_id
    where comments.status = 'visible'
      and not (comments.user_id = any(blocked_user_ids))
    group by comments.post_id
  )
  select
    target_posts.id as post_id,
    coalesce(like_counts.likes_count, 0)::bigint as likes_count,
    coalesce(comment_counts.comments_count, 0)::bigint as comments_count
  from target_posts
  left join like_counts on like_counts.post_id = target_posts.id
  left join comment_counts on comment_counts.post_id = target_posts.id;
$function$;

-- goods_sale_available_qty(goods)
CREATE OR REPLACE FUNCTION public.goods_sale_available_qty(good goods)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(sum(supply.available_qty::bigint),0)::bigint
    from public.goods actual_good join public.goods_variants variant on variant.good_id=actual_good.id
      cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where actual_good.id=good.id and actual_good.archived_at is null and actual_good.stock<>'soldout' and variant.archived_at is null);
end $function$;

-- goods_variant_pricing(goods_variants)
CREATE OR REPLACE FUNCTION public.goods_variant_pricing(target_variant goods_variants)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('regularPrice',price.regular_price,'effectivePrice',price.effective_price,
    'pricePeriodId',price.price_period_id,'startsAt',price.starts_at,'endsAt',price.ends_at,
    'calculatedAt',statement_timestamp(),'nextChangeAt',(
      select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.variant_id=variant.id and schedule.state='active' and boundary.change_at>statement_timestamp()
    ))
  from public.goods_variants variant
  join public.goods good on good.id=variant.good_id
  join public.ips ip on ip.id=good.ip_id
  cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
  where variant.id=target_variant.id and (public.has_operator_capability('catalog.read',false) or (
    variant.archived_at is null and good.archived_at is null and good.published_at is not null
    and good.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
  ));
$function$;

-- inquiry_message_author_names(uuid)
CREATE OR REPLACE FUNCTION public.inquiry_message_author_names(target_inquiry_id uuid)
 RETURNS TABLE(message_id uuid, author_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select message.id, coalesce(nullif(btrim(profile.nickname), ''), '운영자_' || left(profile.id::text, 6))
  from public.inquiry_messages as message
  join public.inquiries as thread on thread.id = message.inquiry_id
  join public.profiles as profile on profile.id = message.author_id
  where thread.id = target_inquiry_id and message.author = 'staff'
    and (select auth.uid()) is not null
    and (thread.user_id = (select auth.uid()) or (select public.has_operator_capability('cs.manage',false)));
$function$;

-- order_claim_eligibility(uuid)
CREATE OR REPLACE FUNCTION public.order_claim_eligibility(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare delivery_complete boolean;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.orders o where o.id=p_order_id and (o.user_id=(select auth.uid()) or public.has_operator_capability('sales.read',false))) then return null; end if;
 delivery_complete:=private.order_all_items_delivered(p_order_id);
 return jsonb_build_object('cancel',private.order_cancel_eligible(p_order_id),'return',delivery_complete,'exchange',delivery_complete);
end $function$;

-- shipment_delivery_summary(order_shipments)
CREATE OR REPLACE FUNCTION public.shipment_delivery_summary(shipment order_shipments)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.shipment_delivery_summary(current_shipment.id) from public.order_shipments current_shipment
  join public.orders purchase on purchase.id=current_shipment.order_id where current_shipment.id=shipment.id
    and (purchase.user_id=auth.uid() or public.has_operator_capability('sales.read',false) or auth.role()='service_role');
$function$;

-- shipment_preorder_ready(order_shipments)
CREATE OR REPLACE FUNCTION public.shipment_preorder_ready(shipment order_shipments)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.shipment_preorder_allocation_ready(current_shipment.id)
    from public.order_shipments current_shipment join public.orders purchase on purchase.id=current_shipment.order_id
    where current_shipment.id=shipment.id and (auth.role()='service_role' or public.has_operator_capability('sales.read',false) or purchase.user_id=auth.uid());
$function$;


create function private.can_finish_operator_manual_recovery(p_attempt uuid,p_request uuid,p_actor uuid,p_operation text,p_case text,p_token uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.goods_payment_manual_recovery_claims c
  where c.attempt_id=p_attempt and c.request_id=p_request and c.actor_id=p_actor and c.operation=p_operation and c.case_ref=p_case and c.claim_token=p_token)
 or exists(select 1 from private.goods_payment_manual_recovery_audits a
  where a.attempt_id=p_attempt and a.request_id=p_request and a.actor_id=p_actor and a.operation=p_operation and a.case_ref=p_case);
$$;
revoke all on function private.can_finish_operator_manual_recovery(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;


-- mark_order_cancellation_needs_review(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.mark_order_cancellation_needs_review(p_request_id uuid, p_actor_id uuid, p_error_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_id uuid;
  v_request_status text;
begin
  if p_actor_id is null or not private.can_finish_operator_cancellation(p_request_id,p_actor_id) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise check_violation using message = 'invalid review code';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status
  into v_request_status
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request_status = 'needs_review' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'failed'
  where cancellation_request_id = p_request_id
    and status <> 'done';

  update public.order_cancellation_requests
  set
    status = 'needs_review',
    last_error_code = p_error_code,
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.cancellation_needs_review',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'processing',
      'to', 'needs_review',
      'errorCode', p_error_code
    )
  );
end;
$function$;

-- complete_order_cancellation_request(uuid,text[],uuid)
CREATE OR REPLACE FUNCTION public.complete_order_cancellation_request(p_request_id uuid, p_provider_payment_keys text[], p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_id uuid;
  v_reason text;
  v_request_status text;
  v_provider_payment_keys text[];
  v_refund_count integer;
begin
  if p_actor_id is null or not private.can_finish_operator_cancellation(p_request_id,p_actor_id) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status, request.reason
  into v_request_status, v_reason
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request_status = 'completed' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  select coalesce(array_agg(keys.payment_key order by keys.payment_key), array[]::text[])
  into v_provider_payment_keys
  from (
    select distinct btrim(payment_key) as payment_key
    from unnest(coalesce(p_provider_payment_keys, array[]::text[])) as input(payment_key)
    where payment_key is not null
      and btrim(payment_key) <> ''
  ) as keys;

  -- 로컬 장부가 canceled/refunded여도 provider 취소 완료의 진실원은 fresh GET이다.
  -- 실제 capture가 없었던 failed 결제만 증거 대상에서 제외한다.
  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
      and payment.status <> 'failed'
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order_id,
    v_reason,
    v_provider_payment_keys
  );

  update public.refunds as refund
  set cancellation_request_id = p_request_id
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and (
      refund.cancellation_request_id is null
      or refund.cancellation_request_id = p_request_id
    );

  if exists (
    select 1
    from public.refunds as refund
    where refund.cancellation_request_id = p_request_id
      and refund.status <> 'done'
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  select count(*)::integer
  into v_refund_count
  from public.refunds as refund
  where refund.cancellation_request_id = p_request_id
    and refund.status = 'done';

  update public.order_cancellation_requests
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_request_id
    and status = 'processing';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.cancellation_completed',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'to', 'completed',
      'refundCount', v_refund_count
    )
  );
end;
$function$;

-- check_in_ticket(uuid,text)
CREATE OR REPLACE FUNCTION public.check_in_ticket(p_staff_id uuid, p_qr_token text)
 RETURNS TABLE(result text, checked_at timestamp with time zone, event_id text, event_title text, ticket_type_id uuid, ticket_type_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_id uuid;
  v_order_status public.ticket_order_status;
  v_ticket_id uuid;
  v_ticket_status public.ticket_status;
  v_ticket_type_id uuid;
  v_event_id text;
  v_event_title text;
  v_ticket_type_name text;
  v_checked_at timestamptz;
begin
  perform private.require_actor_operator_capability(p_staff_id,'platform.manage',false);

  if p_staff_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_staff_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff access required';
  end if;

  if p_qr_token is null or p_qr_token !~ '^[0-9a-f]{32}$' then
    raise check_violation using message = 'invalid qr token';
  end if;

  -- QR lookup 자체는 잠그지 않는다. order 잠금이 검표·취소의 직렬화 기준이다.
  select ticket.id, ticket.ticket_order_id
  into v_ticket_id, v_order_id
  from public.tickets as ticket
  where ticket.qr_token = p_qr_token;

  if not found then
    return query
    select
      'not_found'::text,
      null::timestamptz,
      null::text,
      null::text,
      null::uuid,
      null::text;
    return;
  end if;

  select ticket_order.status
  into v_order_status
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  select
    ticket.status,
    ticket.ticket_type_id,
    ticket_type.event_id,
    event.title,
    ticket_type.name
  into
    v_ticket_status,
    v_ticket_type_id,
    v_event_id,
    v_event_title,
    v_ticket_type_name
  from public.tickets as ticket
  join public.ticket_types as ticket_type on ticket_type.id = ticket.ticket_type_id
  join public.events as event on event.id = ticket_type.event_id
  where ticket.id = v_ticket_id
    and ticket.ticket_order_id = v_order_id
    and ticket.qr_token = p_qr_token
  for update of ticket;

  if not found then
    raise check_violation using message = 'ticket changed during check-in';
  end if;

  if v_ticket_status = 'valid' then
    if v_order_status <> 'paid' then
      raise check_violation using message = 'ticket order not paid';
    end if;

    v_checked_at := clock_timestamp();

    update public.tickets
    set status = 'used'
    where id = v_ticket_id;

    insert into public.check_ins (ticket_id, checked_at, by_staff)
    values (v_ticket_id, v_checked_at, p_staff_id);

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_staff_id,
      'admin.ticket.checked_in',
      format('tickets:%s', v_ticket_id),
      jsonb_build_object(
        'before', jsonb_build_object('status', 'valid'),
        'after', jsonb_build_object('status', 'used')
      )
    );

    return query
    select
      'checked_in'::text,
      v_checked_at,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  if v_ticket_status = 'used' then
    select check_in.checked_at
    into v_checked_at
    from public.check_ins as check_in
    where check_in.ticket_id = v_ticket_id;

    if not found then
      raise check_violation using message = 'used ticket check-in ledger missing';
    end if;

    return query
    select
      'already_used'::text,
      v_checked_at,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  if v_ticket_status = 'refunded' then
    return query
    select
      'refunded'::text,
      null::timestamptz,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  raise check_violation using message = 'unsupported ticket status';
end;
$function$;

-- service_begin_admin_artwork_verification(uuid,text)
CREATE OR REPLACE FUNCTION public.service_begin_admin_artwork_verification(p_actor_id uuid, p_path text)
 RETURNS TABLE(kind text, mime_type text, source_size integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.lock_operator_subjects(array[p_actor_id]);
  if not private.has_operator_capability(p_actor_id,private.operator_artwork_capability((select kind from public.admin_artwork_upload_claims where actor_id=p_actor_id and path=p_path))) then return; end if;

  if p_actor_id is null
    or p_path is null
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- actor 별 동시 processing 은 1개다. 이 직렬화는 그대로 유지한다.
  if exists (
    select 1
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'processing'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) or (
    -- 남용 억제 창. 굿즈 폼 11칸(대표 1 + 추가 이미지 9 + 상세 1)을 채우고 한 번 갈아끼울 수 있어야 한다.
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.processing_started_at >= pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 22 then
    return;
  end if;

  return query
  update public.admin_artwork_upload_claims as claim
  set
    status = 'processing',
    processing_started_at = pg_catalog.clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'pending'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  returning claim.kind, claim.mime_type, claim.source_size;
end;
$function$;

-- service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.service_prepare_admin_artwork_upload(p_actor_id uuid, p_path text, p_kind text, p_mime_type text, p_source_size integer, p_expires_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.lock_operator_subjects(array[p_actor_id]);
  if not private.has_operator_capability(p_actor_id,private.operator_artwork_capability(p_kind)) then return false; end if;

  if p_actor_id is null
    or p_path is null
    or p_kind is null
    or p_kind not in ('ip', 'good', 'card', 'event', 'curation')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_size is null
    or p_source_size < 1
    or p_source_size > 5 * 1024 * 1024
    or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
    or p_path !~ '^catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    or p_path not like 'catalog/' || p_kind || '/%'
    or not (
      (p_mime_type = 'image/jpeg' and p_path like '%.jpg')
      or (p_mime_type = 'image/png' and p_path like '%.png')
      or (p_mime_type = 'image/webp' and p_path like '%.webp')
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- staging 에 동시에 쓰고 있는 업로드. 가장 큰 폼(굿즈 11칸: 대표 1 + 추가 이미지 9 + 상세 1)을
  -- 한 번 채우고 한 번 갈아끼울 수 있어야 한다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status in ('pending', 'processing')
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 22 then
    return false;
  end if;

  -- 저장을 기다리는 승격본. 폼을 몇 장 열어둬도 걸리지 않되 무한히 쌓이지는 않는다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'verified'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 60 then
    return false;
  end if;

  insert into public.admin_artwork_upload_claims (
    path, actor_id, kind, mime_type, source_size, expires_at
  )
  values (
    p_path, p_actor_id, p_kind, p_mime_type, p_source_size, p_expires_at
  )
  on conflict (path) do nothing;

  return found;
end;
$function$;

-- service_verify_admin_artwork_upload(uuid,text,integer)
CREATE OR REPLACE FUNCTION public.service_verify_admin_artwork_upload(p_actor_id uuid, p_path text, p_final_size integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.lock_operator_subjects(array[p_actor_id]);
  if not private.has_operator_capability(p_actor_id,private.operator_artwork_capability((select kind from public.admin_artwork_upload_claims where actor_id=p_actor_id and path=p_path))) then return false; end if;

  if p_final_size is null or p_final_size < 1 or p_final_size > 5 * 1024 * 1024 then
    return false;
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'verified',
    final_size = p_final_size,
    verified_at = pg_catalog.clock_timestamp(),
    -- 폼 작성 창. 이미 더 먼 만료가 잡혀 있으면 당기지 않는다.
    -- greatest 는 파서 구문이라 search_path 와 무관하게 스키마 수식이 없다.
    expires_at = greatest(
      claim.expires_at,
      pg_catalog.clock_timestamp() + interval '2 hours'
    )
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'processing'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    );

  return found;
end;
$function$;

-- claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.claim_goods_manual_payment_recovery(p_attempt_id uuid, p_actor_id uuid, p_request_id uuid, p_case_ref text, p_operation text, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_existing_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
begin
  perform private.require_actor_operator_capability(p_actor_id,'sales.manage',true);

  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and private.has_operator_capability(profile.id,'sales.manage',true)
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  -- Resolve the order without a lock, then acquire every money/stock lock in
  -- the shared order -> request -> attempt -> payments order.
  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;

    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'outcome', v_terminal.outcome
    );
  end if;

  perform private.assert_claim_collections_complete(v_request.id);

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  select claim.*
  into v_existing_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if found and v_existing_claim.expires_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state not in ('confirming', 'approved', 'unknown', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'goods_payment_attempt_not_recoverable';
  end if;

  if v_attempt.state = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;
  end if;

  insert into private.goods_payment_manual_recovery_claims (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    claim_token,
    prior_attempt_state,
    claimed_at,
    expires_at
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    p_claim_token,
    v_attempt.state,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '15 minutes'
  )
  on conflict (attempt_id) do update
  set
    order_id = excluded.order_id,
    request_id = excluded.request_id,
    actor_id = excluded.actor_id,
    operation = excluded.operation,
    case_ref = excluded.case_ref,
    claim_token = excluded.claim_token,
    prior_attempt_state = private.goods_payment_manual_recovery_claims.prior_attempt_state,
    claimed_at = excluded.claimed_at,
    expires_at = excluded.expires_at
  where private.goods_payment_manual_recovery_claims.expires_at
    <= pg_catalog.clock_timestamp();

  if not found then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state in ('confirming', 'unknown', 'needs_review') then
    update public.payment_attempts as attempt
    set
      state = 'confirming',
      claim_token = p_claim_token,
      claim_expires_at = pg_catalog.clock_timestamp() + interval '15 minutes'
    where attempt.id = v_attempt.id;
  end if;

  return pg_catalog.jsonb_build_object('claim_status', 'claimed');
end;
$function$;

-- assert_order_cancellation_reconciliation_allowed(uuid,uuid)
CREATE OR REPLACE FUNCTION public.assert_order_cancellation_reconciliation_allowed(p_request_id uuid, p_actor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claim public.order_cancellation_requests;purchase public.orders;order_key uuid;
begin
  perform private.require_actor_operator_capability(p_actor_id,'sales.manage',false);

 if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id and role in ('staff','admin') and suspended_at is null) then
   raise insufficient_privilege using message='staff required'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_request_id;
 if not found then raise no_data_found using message='cancellation_request_not_found'; end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_request_id for update;
 if claim.stage='completed' and purchase.status='canceled' then return 'completed'; end if;
 if claim.stage='on_hold' then raise check_violation using message='claim_on_hold'; end if;
 if claim.claim_type='exchange' or claim.status not in ('processing','needs_review') then
   raise check_violation using message='cancellation_request_not_processing'; end if;
 perform private.assert_claim_collections_complete(p_request_id);
 if claim.claim_type='cancel' and not claim.collection_required and not private.order_cancel_eligible(order_key) then
   raise check_violation using message='order_not_cancelable'; end if;
 insert into private.operator_cancellation_authorizations(request_id,actor_id) values(p_request_id,p_actor_id) on conflict(request_id,actor_id) do nothing;
 return 'allowed';
end $function$;

-- finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.finalize_goods_manual_payment_recovery(p_attempt_id uuid, p_actor_id uuid, p_request_id uuid, p_case_ref text, p_operation text, p_claim_token uuid, p_operator_attested boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_manual_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_provider_keys text[] := array[]::text[];
  v_final_attempt_state public.payment_attempt_state;
  v_has_payment boolean := false;
begin
  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
    or p_operator_attested is distinct from true
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_attestation_invalid';
  end if;

  if not private.can_finish_operator_manual_recovery(p_attempt_id,p_request_id,p_actor_id,p_operation,p_case_ref,p_claim_token) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  -- Keep the same global lock order as claim and cancellation writers.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;
    return v_terminal.outcome;
  end if;

  perform private.assert_claim_collections_complete(v_request.id);

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  select claim.*
  into v_manual_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if not found
    or v_manual_claim.order_id is distinct from v_order.id
    or v_manual_claim.request_id is distinct from v_request.id
    or v_manual_claim.actor_id is distinct from p_actor_id
    or v_manual_claim.operation is distinct from p_operation
    or v_manual_claim.case_ref is distinct from p_case_ref
    or v_manual_claim.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_claim_invalid';
  end if;

  if v_manual_claim.prior_attempt_state in ('confirming', 'unknown', 'needs_review') then
    if v_attempt.state is distinct from 'confirming'
      or v_attempt.claim_token is distinct from p_claim_token
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_claim_invalid';
    end if;

    v_final_attempt_state := public.finalize_goods_payment_attempt(
      v_attempt.id,
      p_claim_token,
      'canceled'::public.payment_attempt_state
    );

    if v_final_attempt_state is distinct from 'canceled' then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_not_canceled';
    end if;

    -- An ambiguous attempt does not prove that an approved provider payment
    -- ever existed. Close only the attempt and preserve the absence of payment
    -- and refund rows instead of synthesizing provider history.
    if exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status <> 'failed'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_payment_ambiguous';
    end if;
  elsif v_manual_claim.prior_attempt_state = 'approved' then
    if v_attempt.state is distinct from 'approved'
      or v_attempt.payment_id is null
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    if v_payment.status = 'paid' then
      v_provider_keys := array[v_payment.payment_key];
    end if;
    v_has_payment := true;
  else
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_prior_state_invalid';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    v_provider_keys
  );

  if v_has_payment then
    update public.refunds as refund
    set cancellation_request_id = v_request.id
    where refund.payment_id = v_payment.id
      and (
        refund.cancellation_request_id is null
        or refund.cancellation_request_id = v_request.id
      );

    if not exists (
      select 1
      from public.refunds as refund
      where refund.payment_id = v_payment.id
        and refund.cancellation_request_id = v_request.id
        and refund.amount = v_payment.amount
        and refund.status = 'done'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_refund_invalid';
    end if;
  end if;

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id;

  insert into private.goods_payment_manual_recovery_audits (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    prior_attempt_state,
    outcome
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    v_manual_claim.prior_attempt_state,
    'provider_cancel_confirmed'
  );

  delete from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.payment.goods_manual_provider_cancel_confirmed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'operation', p_operation,
      'caseRef', p_case_ref,
      'outcome', 'provider_cancel_confirmed'
    )
  );

  return 'provider_cancel_confirmed';
end;
$function$;

-- reconcile_expired_prepared_goods_cancellation(uuid,uuid)
CREATE OR REPLACE FUNCTION public.reconcile_expired_prepared_goods_cancellation(p_request_id uuid, p_actor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_transitioned boolean := false;
begin
  perform private.require_actor_operator_capability(p_actor_id,'sales.manage',false);

  if p_request_id is null or p_actor_id is null then
    raise invalid_parameter_value using
      message = 'prepared_goods_cancellation_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- Resolve only the lock key first. Every money and stock writer below uses
  -- the shared order -> request -> attempt -> payments ordering.
  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  order by attempt.id
  limit 1
  for update;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  if v_request.status = 'completed' then
    -- loadContext and this lock can be separated by another successful Toss,
    -- Korpay manual, or terminal-attempt reconciliation. A completed request
    -- plus canceled order is the provider-neutral terminal identity.
    if v_order.status = 'canceled' then
      return 'completed';
    end if;
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_terminal_mismatch';
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id,p_actor_id);

  if v_attempt.id is null then
    return 'not_applicable';
  end if;

  -- A callback or another evidence path that moved the attempt beyond
  -- prepared owns the resolution. Do not fall through to the Toss empty-ledger
  -- completion path and do not mutate the request to needs_review here.
  -- An approved, identity-matched Toss ledger is a captured payment, never a
  -- no-capture timeout. Continue to provider reconciliation without mutating it.
  if v_attempt.state='approved' and v_attempt.provider='toss'
    and v_attempt.user_id=v_order.user_id and v_attempt.amount=v_order.total and v_attempt.currency='KRW'
    and exists(select 1 from public.payments p where p.id=v_attempt.payment_id and p.provider=v_attempt.provider
      and p.purpose='order' and p.ref_id=v_order.id and p.user_id=v_order.user_id and p.amount=v_order.total
      and p.status in ('paid','canceled','refunded') and nullif(btrim(p.payment_key),'') is not null) then
    return 'not_applicable';
  end if;
  if v_attempt.state in ('confirming', 'approved', 'unknown', 'needs_review') then
    return 'in_progress';
  end if;

  if v_attempt.state in ('declined', 'canceled') then
    return 'not_applicable';
  end if;

  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_payment_attempt_invalid';
  end if;

  if v_order.status is distinct from 'pending'
    or v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status <> 'failed'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_payment_evidence_invalid';
  end if;

  if v_attempt.expires_at is null
    or v_attempt.expires_at > pg_catalog.clock_timestamp()
  then
    return 'in_progress';
  end if;

  update public.payment_attempts as attempt
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where attempt.id = v_attempt.id
    and attempt.state = 'prepared'
    and attempt.expires_at is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
  returning true into v_transitioned;

  if not coalesce(v_transitioned, false) then
    return 'in_progress';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    array[]::text[]
  );

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = coalesce(request.completed_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id
    and request.status in ('processing', 'needs_review');

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_request_changed';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.prepared_goods_cancellation_completed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'outcome', 'expired_no_capture'
    )
  );

  return 'completed';
end;
$function$;

alter policy "verticals_insert" on "public"."verticals" WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','verticals','verticals_insert','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.verticals'::regclass and p.polname='verticals_insert';

alter policy "verticals_update" on "public"."verticals" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff)) WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','verticals','verticals_update','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.verticals'::regclass and p.polname='verticals_update';

alter policy "verticals_delete" on "public"."verticals" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','verticals','verticals_delete','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.verticals'::regclass and p.polname='verticals_delete';

alter policy "ips_insert" on "public"."ips" WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ips','ips_insert','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ips'::regclass and p.polname='ips_insert';

alter policy "ips_update" on "public"."ips" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff)) WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ips','ips_update','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ips'::regclass and p.polname='ips_update';

alter policy "ips_delete" on "public"."ips" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ips','ips_delete','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ips'::regclass and p.polname='ips_delete';

alter policy "goods_insert" on "public"."goods" WITH CHECK (( SELECT public.has_operator_capability('catalog.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods','goods_insert','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods'::regclass and p.polname='goods_insert';

alter policy "goods_update" on "public"."goods" USING (( SELECT public.has_operator_capability('catalog.manage') AS is_staff)) WITH CHECK (( SELECT public.has_operator_capability('catalog.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods','goods_update','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods'::regclass and p.polname='goods_update';

alter policy "goods_delete" on "public"."goods" USING (( SELECT public.has_operator_capability('catalog.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods','goods_delete','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods'::regclass and p.polname='goods_delete';

alter policy "events_insert" on "public"."events" WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','events','events_insert','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.events'::regclass and p.polname='events_insert';

alter policy "events_update" on "public"."events" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff)) WITH CHECK (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','events','events_update','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.events'::regclass and p.polname='events_update';

alter policy "events_delete" on "public"."events" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','events','events_delete','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.events'::regclass and p.polname='events_delete';

alter policy "posts_read" on "public"."posts" USING (((status = 'visible'::post_status) OR (( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','posts','posts_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.posts'::regclass and p.polname='posts_read';

alter policy "posts_delete" on "public"."posts" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','posts','posts_delete','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.posts'::regclass and p.polname='posts_delete';

alter policy "reports_read" on "public"."reports" USING (((( SELECT auth.uid() AS uid) = reporter_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','reports','reports_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.reports'::regclass and p.polname='reports_read';

alter policy "audit_staff_read" on "public"."audit_log" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','audit_log','audit_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.audit_log'::regclass and p.polname='audit_staff_read';

alter policy "orders_self_read" on "public"."orders" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('sales.read') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','orders','orders_self_read','sales.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.orders'::regclass and p.polname='orders_self_read';

alter policy "order_items_read" on "public"."order_items" USING ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('sales.read') AS is_staff))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_items','order_items_read','sales.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_items'::regclass and p.polname='order_items_read';

alter policy "payments_self_read" on "public"."payments" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('sales.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','payments','payments_self_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.payments'::regclass and p.polname='payments_self_read';

alter policy "refunds_staff_read" on "public"."refunds" USING (( SELECT public.has_operator_capability('sales.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','refunds','refunds_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.refunds'::regclass and p.polname='refunds_staff_read';

alter policy "ticket_orders_self" on "public"."ticket_orders" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ticket_orders','ticket_orders_self','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ticket_orders'::regclass and p.polname='ticket_orders_self';

alter policy "tickets_self" on "public"."tickets" USING ((EXISTS ( SELECT 1
   FROM ticket_orders o
  WHERE ((o.id = tickets.ticket_order_id) AND ((o.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','tickets','tickets_self','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.tickets'::regclass and p.polname='tickets_self';

alter policy "check_ins_staff" on "public"."check_ins" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','check_ins','check_ins_staff','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.check_ins'::regclass and p.polname='check_ins_staff';

alter policy "follows_read" on "public"."ip_follows" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('marketing.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ip_follows','follows_read','marketing.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ip_follows'::regclass and p.polname='follows_read';

alter policy "likes_read" on "public"."likes" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff) OR (EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = likes.post_id) AND (posts.status = 'visible'::post_status))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','likes','likes_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.likes'::regclass and p.polname='likes_read';

alter policy "blocks_read_self_or_staff" on "public"."blocks" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','blocks','blocks_read_self_or_staff','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.blocks'::regclass and p.polname='blocks_read_self_or_staff';

alter policy "order_cancellation_requests_owner_staff_read" on "public"."order_cancellation_requests" USING (((requested_by = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('sales.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_cancellation_requests','order_cancellation_requests_owner_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_cancellation_requests'::regclass and p.polname='order_cancellation_requests_owner_staff_read';

alter policy "ticket_cancellation_requests_owner_staff_read" on "public"."ticket_cancellation_requests" USING (((requested_by = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ticket_cancellation_requests','ticket_cancellation_requests_owner_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ticket_cancellation_requests'::regclass and p.polname='ticket_cancellation_requests_owner_staff_read';

alter policy "comments_read" on "public"."comments" USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff) OR (EXISTS ( SELECT 1
   FROM posts
  WHERE ((posts.id = comments.post_id) AND (((comments.status = 'visible'::post_status) AND (posts.status = 'visible'::post_status)) OR (posts.user_id = ( SELECT auth.uid() AS uid))))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','comments','comments_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.comments'::regclass and p.polname='comments_read';

alter policy "home_curations_staff_read" on "public"."home_curations" USING (public.has_operator_capability('store.manage'));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','home_curations','home_curations_staff_read','store.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.home_curations'::regclass and p.polname='home_curations_staff_read';

alter policy "ticket_order_reservations_owner_staff_read" on "public"."ticket_order_reservations" USING ((EXISTS ( SELECT 1
   FROM ticket_orders ticket_order
  WHERE ((ticket_order.id = ticket_order_reservations.ticket_order_id) AND ((ticket_order.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ticket_order_reservations','ticket_order_reservations_owner_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ticket_order_reservations'::regclass and p.polname='ticket_order_reservations_owner_staff_read';

alter policy "order_dispatch_delays_staff_read" on "public"."order_dispatch_delays" USING (( SELECT public.has_operator_capability('sales.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_dispatch_delays','order_dispatch_delays_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_dispatch_delays'::regclass and p.polname='order_dispatch_delays_staff_read';

alter policy "inquiries_owner_staff_read" on "public"."inquiries" USING (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.has_operator_capability('cs.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','inquiries','inquiries_owner_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.inquiries'::regclass and p.polname='inquiries_owner_staff_read';

alter policy "inquiry_messages_owner_staff_read" on "public"."inquiry_messages" USING ((( SELECT public.has_operator_capability('cs.manage') AS is_staff) OR (EXISTS ( SELECT 1
   FROM inquiries thread
  WHERE ((thread.id = inquiry_messages.inquiry_id) AND (thread.user_id = ( SELECT auth.uid() AS uid)))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','inquiry_messages','inquiry_messages_owner_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.inquiry_messages'::regclass and p.polname='inquiry_messages_owner_staff_read';

alter policy "inquiry_reply_templates_staff_read" on "public"."inquiry_reply_templates" USING (( SELECT public.has_operator_capability('cs.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','inquiry_reply_templates','inquiry_reply_templates_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.inquiry_reply_templates'::regclass and p.polname='inquiry_reply_templates_staff_read';

alter policy "user_uploads_inquiry_staff_read" on "storage"."objects" USING (((bucket_id = 'user-uploads'::text) AND ( SELECT public.has_operator_capability('cs.manage') AS is_staff) AND (EXISTS ( SELECT 1
   FROM inquiry_messages message
  WHERE (objects.name = ANY (message.image_paths))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'storage','objects','user_uploads_inquiry_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='user_uploads_inquiry_staff_read';

alter policy "reviews_staff_read" on "public"."reviews" USING (( SELECT public.has_operator_capability('cs.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','reviews','reviews_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.reviews'::regclass and p.polname='reviews_staff_read';

alter policy "user_uploads_review_staff_read" on "storage"."objects" USING (((bucket_id = 'user-uploads'::text) AND ( SELECT public.has_operator_capability('cs.manage') AS is_staff) AND (EXISTS ( SELECT 1
   FROM reviews review
  WHERE (objects.name = ANY (review.image_paths))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'storage','objects','user_uploads_review_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='user_uploads_review_staff_read';

alter policy "bank_transfer_confirmations_staff_read" on "public"."bank_transfer_confirmations" USING (( SELECT public.has_operator_capability('sales.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','bank_transfer_confirmations','bank_transfer_confirmations_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.bank_transfer_confirmations'::regclass and p.polname='bank_transfer_confirmations_staff_read';

alter policy "bank_deposits_staff_read" on "public"."bank_deposits" USING (( SELECT public.has_operator_capability('sales.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','bank_deposits','bank_deposits_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.bank_deposits'::regclass and p.polname='bank_deposits_staff_read';

alter policy "coupons_select_held_or_staff" on "public"."coupons" USING ((public.has_operator_capability('marketing.manage') OR (EXISTS ( SELECT 1
   FROM user_coupons held
  WHERE ((held.coupon_code = coupons.code) AND (held.user_id = ( SELECT auth.uid() AS uid)))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coupons','coupons_select_held_or_staff','marketing.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coupons'::regclass and p.polname='coupons_select_held_or_staff';

alter policy "user_coupons_select_own_or_staff" on "public"."user_coupons" USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_operator_capability('marketing.manage')));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','user_coupons','user_coupons_select_own_or_staff','marketing.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.user_coupons'::regclass and p.polname='user_coupons_select_own_or_staff';

alter policy "coupon_redemptions_select_own_or_staff" on "public"."coupon_redemptions" USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_operator_capability('marketing.manage')));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coupon_redemptions','coupon_redemptions_select_own_or_staff','marketing.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coupon_redemptions'::regclass and p.polname='coupon_redemptions_select_own_or_staff';

alter policy "loyalty_grade_events_select_own_or_staff" on "public"."loyalty_grade_events" USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_operator_capability('marketing.manage')));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','loyalty_grade_events','loyalty_grade_events_select_own_or_staff','marketing.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.loyalty_grade_events'::regclass and p.polname='loyalty_grade_events_select_own_or_staff';

alter policy "campaigns_public_read" on "public"."campaigns" USING (((status <> 'draft'::text) OR ( SELECT public.has_operator_capability('promotion.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','campaigns','campaigns_public_read','promotion.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.campaigns'::regclass and p.polname='campaigns_public_read';

alter policy "coin_ledger_select_own_or_staff" on "public"."coin_ledger" USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coin_ledger','coin_ledger_select_own_or_staff','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coin_ledger'::regclass and p.polname='coin_ledger_select_own_or_staff';

alter policy "coin_balances_select_own_or_staff" on "public"."coin_balances" USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coin_balances','coin_balances_select_own_or_staff','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coin_balances'::regclass and p.polname='coin_balances_select_own_or_staff';

alter policy "coin_attendance_select_own_or_staff" on "public"."coin_attendance" USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coin_attendance','coin_attendance_select_own_or_staff','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coin_attendance'::regclass and p.polname='coin_attendance_select_own_or_staff';

alter policy "coin_exchange_offers_public_read" on "public"."coin_exchange_offers" USING (((status = 'active'::text) OR ( SELECT public.has_operator_capability('platform.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','coin_exchange_offers','coin_exchange_offers_public_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.coin_exchange_offers'::regclass and p.polname='coin_exchange_offers_public_read';

alter policy "product_questions_read" on "public"."product_questions" USING (((status = 'visible'::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.has_operator_capability('cs.manage') AS is_staff)));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','product_questions','product_questions_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.product_questions'::regclass and p.polname='product_questions_read';

alter policy "faq_staff_read" on "public"."faq_entries" USING (( SELECT public.has_operator_capability('cs.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','faq_entries','faq_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.faq_entries'::regclass and p.polname='faq_staff_read';

alter policy "inquiry_internal_notes_staff_read" on "public"."inquiry_internal_notes" USING (( SELECT public.has_operator_capability('cs.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','inquiry_internal_notes','inquiry_internal_notes_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.inquiry_internal_notes'::regclass and p.polname='inquiry_internal_notes_staff_read';

alter policy "goods_notice_presets_staff_read" on "public"."goods_notice_presets" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_notice_presets','goods_notice_presets_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_notice_presets'::regclass and p.polname='goods_notice_presets_staff_read';

alter policy "goods_variants_staff_read" on "public"."goods_variants" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_variants','goods_variants_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_variants'::regclass and p.polname='goods_variants_staff_read';

alter policy "customer_notes_staff_read" on "public"."customer_notes" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','customer_notes','customer_notes_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.customer_notes'::regclass and p.polname='customer_notes_staff_read';

alter policy "store_settings_staff_read" on "public"."store_settings" USING (( SELECT public.has_operator_capability('seller.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','store_settings','store_settings_staff_read','seller.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.store_settings'::regclass and p.polname='store_settings_staff_read';

alter policy "fulfillment_origins_staff_read" on "public"."fulfillment_origins" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','fulfillment_origins','fulfillment_origins_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.fulfillment_origins'::regclass and p.polname='fulfillment_origins_staff_read';

alter policy "shipments_owner_staff_read" on "public"."order_shipments" USING ((public.has_operator_capability('sales.read') OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_shipments.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_shipments','shipments_owner_staff_read','sales.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_shipments'::regclass and p.polname='shipments_owner_staff_read';

alter policy "shipment_items_owner_staff_read" on "public"."order_shipment_items" USING ((public.has_operator_capability('sales.read') OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_shipment_items.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_shipment_items','shipment_items_owner_staff_read','sales.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_shipment_items'::regclass and p.polname='shipment_items_owner_staff_read';

alter policy "admin_goods_import_files_read" on "storage"."objects" USING (((bucket_id = 'admin-goods-imports'::text) AND ( SELECT public.has_operator_capability('catalog.manage') AS is_staff) AND (EXISTS ( SELECT 1
   FROM admin_goods_imports batch
  WHERE ((batch.actor_id = ( SELECT auth.uid() AS uid)) AND (batch.expires_at > now()) AND ((objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/workbook.xlsx'::text)) OR (objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/images.zip'::text))))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'storage','objects','admin_goods_import_files_read','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='admin_goods_import_files_read';

alter policy "admin_goods_import_files_insert" on "storage"."objects" WITH CHECK (((bucket_id = 'admin-goods-imports'::text) AND ( SELECT public.has_operator_capability('catalog.manage') AS is_staff) AND (EXISTS ( SELECT 1
   FROM admin_goods_imports batch
  WHERE ((batch.actor_id = ( SELECT auth.uid() AS uid)) AND (batch.state = 'uploading'::text) AND (batch.expires_at > now()) AND ((objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/workbook.xlsx'::text)) OR (batch.has_images AND (objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/images.zip'::text)))))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'storage','objects','admin_goods_import_files_insert','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='admin_goods_import_files_insert';

alter policy "admin_goods_import_files_delete" on "storage"."objects" USING (((bucket_id = 'admin-goods-imports'::text) AND ( SELECT public.has_operator_capability('catalog.manage') AS is_staff) AND (EXISTS ( SELECT 1
   FROM admin_goods_imports batch
  WHERE ((batch.actor_id = ( SELECT auth.uid() AS uid)) AND ((objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/workbook.xlsx'::text)) OR (objects.name = ((((batch.actor_id)::text || '/'::text) || (batch.id)::text) || '/images.zip'::text))))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'storage','objects','admin_goods_import_files_delete','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='admin_goods_import_files_delete';

alter policy "shipment_email_jobs_staff_read" on "public"."order_shipment_email_jobs" USING (public.has_operator_capability('sales.manage'));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_shipment_email_jobs','shipment_email_jobs_staff_read','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_shipment_email_jobs'::regclass and p.polname='shipment_email_jobs_staff_read';

alter policy "order_claim_collections_owner_staff" on "public"."order_claim_collections" USING ((EXISTS ( SELECT 1
   FROM (order_cancellation_requests c
     JOIN orders o ON ((o.id = c.order_id)))
  WHERE ((c.id = order_claim_collections.claim_id) AND ((o.user_id = ( SELECT auth.uid() AS uid)) OR public.has_operator_capability('sales.manage'))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','order_claim_collections','order_claim_collections_owner_staff','sales.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.order_claim_collections'::regclass and p.polname='order_claim_collections_owner_staff';

alter policy "ip_public_slug_aliases_read" on "public"."ip_public_slug_aliases" USING ((EXISTS ( SELECT 1
   FROM ips ip
  WHERE ((ip.id = ip_public_slug_aliases.ip_id) AND (((ip.archived_at IS NULL) AND (ip.published_at IS NOT NULL)) OR ( SELECT public.has_operator_capability('catalog.read') AS is_staff))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','ip_public_slug_aliases','ip_public_slug_aliases_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.ip_public_slug_aliases'::regclass and p.polname='ip_public_slug_aliases_read';

alter policy "shipping_notice_templates_staff_read" on "public"."shipping_notice_templates" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','shipping_notice_templates','shipping_notice_templates_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.shipping_notice_templates'::regclass and p.polname='shipping_notice_templates_staff_read';

alter policy "catalog_categories_staff_read" on "public"."catalog_categories" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','catalog_categories','catalog_categories_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.catalog_categories'::regclass and p.polname='catalog_categories_staff_read';

alter policy "catalog_category_erp_mappings_staff_read" on "public"."catalog_category_erp_mappings" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','catalog_category_erp_mappings','catalog_category_erp_mappings_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.catalog_category_erp_mappings'::regclass and p.polname='catalog_category_erp_mappings_staff_read';

alter policy "goods_type_category_migrations_staff_read" on "public"."goods_type_category_migrations" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_type_category_migrations','goods_type_category_migrations_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_type_category_migrations'::regclass and p.polname='goods_type_category_migrations_staff_read';

alter policy "category_activation_staff_read" on "public"."category_activation_control" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','category_activation_control','category_activation_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.category_activation_control'::regclass and p.polname='category_activation_staff_read';

alter policy "admin_goods_imports_owner_read" on "public"."admin_goods_imports" USING (((actor_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.has_operator_capability('catalog.manage') AS is_staff) AND ((NOT requires_admin) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (public.has_operator_capability('platform.manage',true))))))));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','admin_goods_imports','admin_goods_imports_owner_read','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.admin_goods_imports'::regclass and p.polname='admin_goods_imports_owner_read';

alter policy "goods_additional_categories_staff_read" on "public"."goods_additional_categories" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_additional_categories','goods_additional_categories_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_additional_categories'::regclass and p.polname='goods_additional_categories_staff_read';

alter policy "erp_items_staff_read" on "public"."erp_items" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','erp_items','erp_items_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.erp_items'::regclass and p.polname='erp_items_staff_read';

alter policy "erp_category_mappings_staff_read" on "public"."erp_category_mappings" USING (( SELECT public.has_operator_capability('platform.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','erp_category_mappings','erp_category_mappings_staff_read','platform.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.erp_category_mappings'::regclass and p.polname='erp_category_mappings_staff_read';

alter policy "goods_purchase_restrictions_staff_read" on "public"."goods_purchase_restrictions" USING (( SELECT public.has_operator_capability('sales.restrictions') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_purchase_restrictions','goods_purchase_restrictions_staff_read','sales.restrictions',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_purchase_restrictions'::regclass and p.polname='goods_purchase_restrictions_staff_read';

alter policy "goods_announcements_staff_read" on "public"."goods_announcements" USING (public.has_operator_capability('catalog.announcements'));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_announcements','goods_announcements_staff_read','catalog.announcements',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_announcements'::regclass and p.polname='goods_announcements_staff_read';

alter policy "goods_announcement_goods_staff_read" on "public"."goods_announcement_goods" USING (public.has_operator_capability('catalog.announcements'));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_announcement_goods','goods_announcement_goods_staff_read','catalog.announcements',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_announcement_goods'::regclass and p.polname='goods_announcement_goods_staff_read';

alter policy "home_layout_staff_read" on "public"."home_layout_settings" USING (( SELECT public.has_operator_capability('store.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','home_layout_settings','home_layout_staff_read','store.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.home_layout_settings'::regclass and p.polname='home_layout_staff_read';

alter policy "shipping_settings_templates_staff_read" on "public"."shipping_settings_templates" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','shipping_settings_templates','shipping_settings_templates_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.shipping_settings_templates'::regclass and p.polname='shipping_settings_templates_staff_read';

alter policy "cs_reply_templates_staff_read" on "public"."cs_reply_templates" USING (( SELECT public.has_operator_capability('cs.manage') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','cs_reply_templates','cs_reply_templates_staff_read','cs.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.cs_reply_templates'::regclass and p.polname='cs_reply_templates_staff_read';

alter policy "goods_photo_library_staff_read" on "public"."goods_photo_library" USING (public.has_operator_capability('catalog.read'));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_photo_library','goods_photo_library_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_photo_library'::regclass and p.polname='goods_photo_library_staff_read';

alter policy "goods_relations_staff_read" on "public"."goods_relations" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_relations','goods_relations_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_relations'::regclass and p.polname='goods_relations_staff_read';

alter policy "goods_relation_members_staff_read" on "public"."goods_relation_members" USING (( SELECT public.has_operator_capability('catalog.read') AS is_staff));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','goods_relation_members','goods_relation_members_staff_read','catalog.read',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.goods_relation_members'::regclass and p.polname='goods_relation_members_staff_read';

alter policy "admin_goods_drafts_owner_read" on "public"."admin_goods_drafts" USING (((owner_id = ( SELECT auth.uid() AS uid)) AND public.has_operator_capability('catalog.manage')));

insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
 select 'public','admin_goods_drafts','admin_goods_drafts_owner_read','catalog.manage',md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(pg_get_expr(p.polqual,p.polrelid),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))) from pg_policy p where p.polrelid='public.admin_goods_drafts'::regclass and p.polname='admin_goods_drafts_owner_read';

-- Read projections prevent a menu capability from exposing another section's
-- private fields through a shared SECURITY DEFINER response.
create function public.admin_operator_store_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.store_settings; visible jsonb:='{}'; access jsonb;
begin
 if not (public.has_operator_capability('seller.read') or public.has_operator_capability('seller.manage') or public.has_operator_capability('store.manage')) then
  raise insufficient_privilege using message='operator_capability_required'; end if;
 select * into settings from public.store_settings where singleton;
 if not found then return jsonb_build_object('store',null,'capabilities',private.operator_access_for(auth.uid())->'capabilities'); end if;
 visible:=jsonb_build_object('updated_at',settings.updated_at);
 if public.has_operator_capability('seller.read') then visible:=visible||jsonb_build_object('business',settings.business); end if;
 if public.has_operator_capability('seller.manage') then visible:=visible||jsonb_build_object('bank_transfer',settings.bank_transfer); end if;
 if public.has_operator_capability('store.manage') then
  visible:=visible||jsonb_build_object('inquiry_auto_replies',settings.inquiry_auto_replies,'branding',settings.branding,'navigation',settings.navigation);
 end if;
 return jsonb_build_object('store',visible,'capabilities',private.operator_access_for(auth.uid())->'capabilities');
end $$;
revoke all on function public.admin_operator_store_settings() from public,anon,authenticated,service_role;
grant execute on function public.admin_operator_store_settings() to authenticated;

create function public.admin_goods_origin_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.read') then raise insufficient_privilege using message='operator_capability_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'defaultCarrier',default_carrier,
  'baseFee',base_fee,'freeThreshold',free_threshold,'returnAddress',return_address,'active',is_active) order by name,id)
  from public.fulfillment_origins),'[]'::jsonb);
end $$;
revoke all on function public.admin_goods_origin_options() from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_origin_options() to authenticated;

create function public.admin_goods_ip_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not (public.has_operator_capability('catalog.read') or public.has_operator_capability('store.manage')) then
  raise insufficient_privilege using message='operator_capability_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'publicSlug',public_slug,'archivedAt',archived_at,
  'publishedAt',published_at,'verticalKey',vertical_key,'glyph',glyph,'bg',bg,'imagePath',image_path,'sub',sub) order by id)
  from public.ips),'[]'::jsonb);
end $$;
revoke all on function public.admin_goods_ip_options() from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_ip_options() to authenticated;

create function public.admin_curation_target_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required'; end if;
 return jsonb_build_object(
  'ips',coalesce((select jsonb_agg(jsonb_build_object('id',id,'publicSlug',public_slug,'title',title,'archivedAt',archived_at) order by id) from public.ips),'[]'::jsonb),
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',name,'archivedAt',archived_at) order by id) from public.goods),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'archivedAt',archived_at) order by id) from public.events),'[]'::jsonb));
end $$;
revoke all on function public.admin_curation_target_options() from public,anon,authenticated,service_role;
grant execute on function public.admin_curation_target_options() to authenticated;

create function public.admin_operator_customer_history(target_user_id uuid,target_tab text,target_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb:='[]'; total bigint; page integer; page_size constant integer:=20;
begin
 if target_tab is null or target_tab not in ('orders','claims') then raise invalid_parameter_value using message='customer_tab_invalid'; end if;
 if not public.has_operator_capability(case target_tab when 'orders' then 'sales.read' else 'sales.manage' end) then
  raise insufficient_privilege using message='operator_capability_required'; end if;
 if not exists(select 1 from public.profiles where id=target_user_id) then return null; end if;
 if target_tab='orders' then
  select count(*) into total from public.orders where user_id=target_user_id;
 else
  select count(*) into total from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id;
 end if;
 page:=least(greatest(coalesce(target_page,1),1),greatest(1,(total+page_size-1)/page_size)::integer);
 if target_tab='orders' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'amount',r.total,
   'createdAt',r.created_at,'title',coalesce((select i.good_name_snapshot from public.order_items i where i.order_id=r.id order by i.id limit 1),'주문 상품'),
   'itemCount',(select count(*) from public.order_items i where i.order_id=r.id)) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select o.id,o.status,o.total,o.created_at from public.orders o where o.user_id=target_user_id
   order by o.created_at desc,o.id desc limit page_size offset (page-1)*page_size) r;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'orderId',r.order_id,'claimType',r.claim_type,
   'status',r.stage,'createdAt',r.requested_at,'title',r.reason) order by r.requested_at desc,r.id desc),'[]'::jsonb)
  into rows from (select c.id,c.order_id,c.claim_type,c.stage,c.requested_at,c.reason
   from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id
   order by c.requested_at desc,c.id desc limit page_size offset (page-1)*page_size) r;
 end if;
 return jsonb_build_object('items',rows,'tab',target_tab,'page',page,'pageSize',page_size,'total',total);
end $$;
revoke all on function public.admin_operator_customer_history(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_operator_customer_history(uuid,text,integer) to authenticated;


do $operator_contracts$ begin
perform private.register_operator_rpc_contract('public.admin_activate_shipping_notice_template(uuid,timestamp with time zone,text)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_add_customer_note(uuid,text,uuid)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_add_inquiry_internal_note(uuid,text)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_add_order_note(uuid,text,uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_adjust_loyalty_grade(uuid,loyalty_grade,text)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_adjust_stock(uuid,text,uuid,integer,integer,text)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_adjust_store_credit(uuid,uuid,bigint,timestamp with time zone,text,bigint)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_allocate_goods_preorders(text,uuid[],jsonb,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_answer_inquiry(uuid,text,text[])'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_answer_product_question(uuid,text)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_apply_shipping_notice_template(text,uuid,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamp with time zone,jsonb)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_card(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_category(uuid,uuid,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_cs_reply_template(uuid,boolean,integer)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_event(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_good(text)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_archive_ip(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_assign_good_category(uuid,text,uuid,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_bank_deposit_queue(bank_deposit_status,integer)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_begin_order_cancellation_reconcile(uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_benefit_report(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_cancel_unpaid_bank_transfer_order(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_change_shipment_preorder_date(uuid,date,text,timestamp with time zone)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_claims_report(timestamp with time zone,timestamp with time zone)'::regprocedure,'stats.read','read',false);
perform private.register_operator_rpc_contract('public.admin_clone_good(uuid,text,text,text,text)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_close_inquiry(uuid)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_commit_goods_import_group(uuid,integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_complete_shipments(uuid[])'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_confirm_bank_deposit(uuid,uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_confirm_bank_transfer_deposit(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_coupon_target_goods(coupons)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_create_settled_export(uuid,jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_customer_detail(uuid,text,integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_customer_report(timestamp with time zone,timestamp with time zone)'::regprocedure,'stats.read','read',false);
perform private.register_operator_rpc_contract('public.admin_decide_order_cancellation(uuid,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_decide_order_claim(uuid,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_delete_erp_items(text[])'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_delete_faq_entry(uuid,timestamp with time zone)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_delete_goods_notice_preset(uuid,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_enqueue_shipment_emails(jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_estimate_notification_recipients(text,text)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_execute_purchase_restriction_batch(uuid,boolean)'::regprocedure,'sales.restrictions','write',false);
perform private.register_operator_rpc_contract('public.admin_execute_store_credit_batch(uuid)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_export_store_credit_console(text,text,date,date,text)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_extend_bank_transfer_deadline(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_find_goods_for_shipping_notice_template(uuid,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_find_purchase_restriction_customer(text)'::regprocedure,'sales.restrictions','read',false);
perform private.register_operator_rpc_contract('public.admin_find_store_credit_customers(text)'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_get_goods_announcement(uuid)'::regprocedure,'catalog.announcements','read',false);
perform private.register_operator_rpc_contract('public.admin_get_goods_attributes(uuid,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_get_goods_draft(uuid)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_get_goods_relation(uuid)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_get_inquiry_reply_template_operation(uuid)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_get_loyalty_policy()'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_get_member_detail(uuid)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_get_order_delay_notice(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_get_purchase_restriction_batch(uuid)'::regprocedure,'sales.restrictions','read',false);
perform private.register_operator_rpc_contract('public.admin_get_seller_claim_intake(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_get_store_credit_batch(uuid)'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_get_store_credit_history(uuid,integer)'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_get_store_credit_policy()'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_goods_active_stock_qty(goods)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_console_export_candidates(text,text,text,text,uuid,text,jsonb)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_export_candidates(text,text,text,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_import_records(text[],text[])'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_low_stock_option_count(goods)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_manual_recovery_attempts(uuid[])'::regprocedure,'sales.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_goods_workspace_export_candidates(text,text,text,text,uuid,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_grant_draw_tickets(uuid,uuid,uuid,integer,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_hide_community_comment(uuid,uuid)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_hide_community_post(uuid,uuid)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_ignore_bank_deposit(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_import_erp_items(jsonb)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_import_shipment_tracking(text,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_import_shipment_tracking_batch(jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_import_warehouse_tracking_batch(uuid,jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_inquiry_context(uuid)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_inquiry_status_counts()'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_inquiry_workspace(uuid)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_last_good_notice()'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_delivery_policies(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_draw_ticket_grants(integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_erp_categories()'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_erp_items(text,integer,integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_games()'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_announcements(text,text,text,text,date,date,integer,integer)'::regprocedure,'catalog.announcements','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_drafts(text,boolean,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_photos(text,boolean,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_preorder_reservations(text,text,integer,integer)'::regprocedure,'sales.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_preorders(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_price_periods(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_purchase_cost_history(text,uuid,integer)'::regprocedure,'platform.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_list_goods_relations(text,text,text,integer,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_variant_external_identities(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_list_goods_variant_purchase_costs(text)'::regprocedure,'platform.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_list_notification_history(integer,integer)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_order_delay_notices(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_reward_policies()'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_shipment_promise_changes(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_shipping_region_policies()'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_list_shipping_settings_templates(text,text,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_mark_shipments_exported(jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_mutate_inquiry_reply_template(uuid,uuid,integer,text,jsonb)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_operation_alerts(text,text,timestamp with time zone,uuid,integer)'::regprocedure,'home','manual',false);
perform private.register_operator_rpc_contract('public.admin_operation_tasks()'::regprocedure,'home','manual',false);
perform private.register_operator_rpc_contract('public.admin_operations_contact_history(integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_operations_contacts()'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_order_claim_detail(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_order_claim_stage_counts(text)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_order_detail(uuid)'::regprocedure,'sales.read','read',false);
perform private.register_operator_rpc_contract('public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_preview_purchase_restriction_batch(uuid,text,text[],text,text)'::regprocedure,'sales.restrictions','write',false);
perform private.register_operator_rpc_contract('public.admin_preview_shipping_settings_template(uuid,text[])'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_preview_store_credit_batch(uuid,text[],bigint,timestamp with time zone,text,text)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_profile_signup_counts(timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,'stats.read','read',false);
perform private.register_operator_rpc_contract('public.admin_read_goods_additional(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_read_goods_kc(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_read_goods_readiness(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_read_settled_export(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_read_shipment_delivery(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_read_shipment_preorder_promise(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_reassign_inquiry(uuid,uuid,text)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_recalculate_loyalty_grade(uuid)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_list_export(text,jsonb,integer,integer)'::regprocedure,'sales.manage','manual',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_collection(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamp with time zone)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_origin_collection(uuid,uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment_delivery(uuid,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_register_purchase_restriction(uuid,uuid,text,text,uuid)'::regprocedure,'sales.restrictions','write',false);
perform private.register_operator_rpc_contract('public.admin_release_purchase_restriction(uuid,text)'::regprocedure,'sales.restrictions','write',false);
perform private.register_operator_rpc_contract('public.admin_reply_reviews_batch(uuid,jsonb,text)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_reply_to_review(uuid,text)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_request_email_resend(text)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_request_order_delay_notice(uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_retry_order_delay_notice(uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_review_console_counts()'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_review_insights(text,text,text,integer,integer)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_review_reply_batch_result(uuid)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_sales_order_counts(date,date,text,text,text,text)'::regprocedure,'sales.read','read',false);
perform private.register_operator_rpc_contract('public.admin_sales_report(timestamp with time zone,timestamp with time zone,text)'::regprocedure,'stats.read','read',false);
perform private.register_operator_rpc_contract('public.admin_save_cs_reply_template(uuid,text,text,text,text,integer)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamp with time zone)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_fulfillment_origin(uuid,jsonb,timestamp with time zone)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_good(jsonb)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_good_claim_policy(text,jsonb,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_good_from_draft(jsonb,uuid,integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_additional(text,text[],integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_announcement(uuid,integer,jsonb)'::regprocedure,'catalog.announcements','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_attribute_schema(uuid,jsonb,integer,uuid)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_photo(uuid,text,text,integer,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_goods_price_period(text,uuid,uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_relation(uuid,integer,jsonb)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_variant_external_identity(text,uuid,text,text,text,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_goods_variant_purchase_cost(text,uuid,integer,text,integer)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_home_layout(uuid,bigint,jsonb)'::regprocedure,'store.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_loyalty_policy(jsonb,integer,uuid)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_operations_contact(text,uuid,jsonb,timestamp with time zone)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_origin_export_columns(uuid,jsonb,timestamp with time zone)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_shipping_carrier(text,text,text,boolean,timestamp with time zone)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_shipping_region_policy(uuid,jsonb,integer)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_shipping_settings_template(uuid,integer,text,boolean,jsonb)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_save_store_branding(uuid,jsonb,timestamp with time zone)'::regprocedure,'store.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_store_credit_policy(uuid,integer,jsonb)'::regprocedure,'marketing.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_store_navigation(uuid,jsonb,timestamp with time zone)'::regprocedure,'store.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_save_store_settings(text,jsonb,timestamp with time zone)'::regprocedure,'seller.manage','manual',true);
perform private.register_operator_rpc_contract('public.admin_search_coupon_console(text,text,integer,integer,jsonb)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_coupon_console_scheduled(text,text,integer,integer,jsonb)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_coupons(text,text,integer,integer)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_email_deliveries(text,integer,integer)'::regprocedure,'marketing.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_erp_items(text,integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods(text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_additional(text,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_for_announcement(text,integer)'::regprocedure,'catalog.announcements','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_for_relation(text,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_for_shipping_settings(text,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_goods_workspace(text,text,text,text,uuid,text,integer,integer)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_members(text,integer,integer)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_order_claims(text,text,text,date,date,text,integer,integer)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_orders(text,date,date,text,integer,integer,timestamp with time zone,text)'::regprocedure,'sales.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_orders_console(text,date,date,text,integer,integer,timestamp with time zone,text,text,text,text)'::regprocedure,'sales.read','read',false);
perform private.register_operator_rpc_contract('public.admin_search_purchase_restrictions(text,text,integer,integer)'::regprocedure,'sales.restrictions','read',false);
perform private.register_operator_rpc_contract('public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)'::regprocedure,'cs.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_shipments(text,uuid,text,date,date,integer,integer)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_search_store_credit_console(text,text,date,date,text,integer,integer)'::regprocedure,'marketing.manage','read',true);
perform private.register_operator_rpc_contract('public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamp with time zone,uuid)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_seller_claim_intake_context(uuid)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_send_notification(uuid,text,text,text,text)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_category_activation(uuid,boolean,boolean,jsonb)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamp with time zone)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_category_type_migration(uuid,text,uuid,text,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_coupon_status(text,integer,text)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_erp_category_mapping(text,uuid)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_good_bank_transfer(text,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_good_published(text,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_good_sale_restriction(text,goods_sale_restriction)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_goods_draft_archived(uuid,integer,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_goods_variant_active(text,uuid,boolean,timestamp with time zone,integer)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_ip_directory(text,boolean,integer,text[],boolean)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_ip_published(text,boolean)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_operation_alert_badge(boolean)'::regprocedure,'home','write',false);
perform private.register_operator_rpc_contract('public.admin_set_pool_odds(uuid,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_product_question_visibility(uuid,boolean)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_review_status(uuid,text,text,uuid)'::regprocedure,'cs.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_set_shipping_region_policy_status(uuid,text,integer,boolean)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.admin_set_user_role(uuid,user_role)'::regprocedure,'operators.manage','retired',false);
perform private.register_operator_rpc_contract('public.admin_shipment_export(uuid[])'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_shipping_region_expiry_metadata(timestamp with time zone)'::regprocedure,'platform.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_store_settings_history(integer)'::regprocedure,'seller.read','manual',false);
perform private.register_operator_rpc_contract('public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_suggest_goods_identifiers(text,text)'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_suspend_user(uuid,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unarchive_card(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unarchive_category(uuid,uuid,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unarchive_event(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unarchive_good(text)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unarchive_ip(text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_unpaid_bank_transfer_orders(text,integer,integer)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_unpaid_bank_transfer_orders_console(text,integer,integer,text,text)'::regprocedure,'sales.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_unsuspend_user(uuid)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_ip_identity(text,text,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_operation_alerts(text,uuid[],timestamp with time zone,text,text)'::regprocedure,'home','manual',false);
perform private.register_operator_rpc_contract('public.admin_update_order_status(uuid,order_status,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_order_tracking(uuid,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_report_status(uuid,report_status)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_shipment_status(uuid,text,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_update_shipment_tracking(uuid,text,text)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_campaign(text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,integer,jsonb,text)'::regprocedure,'promotion.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_card(text,text,text,text,rarity,text,text,uuid,boolean,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_card_pool(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_coin_exchange_offer(uuid,uuid,text,integer,integer,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_coupon(text,text,text,integer,integer,integer,timestamp with time zone,timestamp with time zone,integer,text,loyalty_grade,text)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_coupon_scheduled(jsonb)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_coupon_targeted(jsonb)'::regprocedure,'marketing.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_event(text,text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_game(uuid,text,text,text,uuid,text,integer,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)'::regprocedure,'catalog.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamp with time zone,timestamp with time zone,boolean,text,jsonb)'::regprocedure,'store.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_ip(text,text,text,text,text,text,text,text,text,boolean,text,boolean)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_order_dispatch_delay(uuid,text,date)'::regprocedure,'sales.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_reward_policy(uuid,uuid,uuid,text,text,text,bigint,integer,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)'::regprocedure,'platform.manage','write',false);
perform private.register_operator_rpc_contract('public.admin_use_stock_supply(text,uuid,uuid,integer)'::regprocedure,'platform.manage','write',true);
perform private.register_operator_rpc_contract('public.can_stage_admin_artwork(text)'::regprocedure,'catalog.manage','mixed',false);
perform private.register_operator_rpc_contract('public.community_post_reaction_counts(uuid[],uuid[])'::regprocedure,'platform.manage','mixed',false);
perform private.register_operator_rpc_contract('public.goods_sale_available_qty(goods)'::regprocedure,'catalog.read','mixed',false);
perform private.register_operator_rpc_contract('public.goods_variant_pricing(goods_variants)'::regprocedure,'catalog.read','mixed',false);
perform private.register_operator_rpc_contract('public.inquiry_message_author_names(uuid)'::regprocedure,'cs.manage','mixed',false);
perform private.register_operator_rpc_contract('public.order_claim_eligibility(uuid)'::regprocedure,'sales.read','mixed',false);
perform private.register_operator_rpc_contract('public.shipment_delivery_summary(order_shipments)'::regprocedure,'sales.read','mixed',false);
perform private.register_operator_rpc_contract('public.shipment_preorder_ready(order_shipments)'::regprocedure,'sales.read','mixed',false);
perform private.register_operator_rpc_contract('public.mark_order_cancellation_needs_review(uuid,uuid,text)'::regprocedure,'sales.manage','service_finish',false);
perform private.register_operator_rpc_contract('public.complete_order_cancellation_request(uuid,text[],uuid)'::regprocedure,'sales.manage','service_finish',false);
perform private.register_operator_rpc_contract('public.check_in_ticket(uuid,text)'::regprocedure,'platform.manage','service_start',false);
perform private.register_operator_rpc_contract('public.service_begin_admin_artwork_verification(uuid,text)'::regprocedure,'catalog.manage','service_start',false);
perform private.register_operator_rpc_contract('public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamp with time zone)'::regprocedure,'catalog.manage','service_start',false);
perform private.register_operator_rpc_contract('public.service_verify_admin_artwork_upload(uuid,text,integer)'::regprocedure,'catalog.manage','service_start',false);
perform private.register_operator_rpc_contract('public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)'::regprocedure,'sales.manage','service_start',true);
perform private.register_operator_rpc_contract('public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)'::regprocedure,'sales.manage','service_start',false);
perform private.register_operator_rpc_contract('public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)'::regprocedure,'sales.manage','service_finish',true);
perform private.register_operator_rpc_contract('public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)'::regprocedure,'sales.manage','service_start',false);
perform private.register_operator_rpc_contract('public.admin_current_operator_access()'::regprocedure,'home','manual',false);
perform private.register_operator_rpc_contract('public.admin_operator_store_settings()'::regprocedure,'store.manage','manual',false);
perform private.register_operator_rpc_contract('public.admin_goods_origin_options()'::regprocedure,'catalog.read','read',false);
perform private.register_operator_rpc_contract('public.admin_goods_ip_options()'::regprocedure,'catalog.read','manual',false);
perform private.register_operator_rpc_contract('public.admin_curation_target_options()'::regprocedure,'store.manage','read',false);
perform private.register_operator_rpc_contract('public.admin_operator_customer_history(uuid,text,integer)'::regprocedure,'sales.read','manual',false);
end $operator_contracts$;
