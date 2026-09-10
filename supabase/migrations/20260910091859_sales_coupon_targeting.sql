-- #487: recipient eligibility and discount goods are separate contracts.
alter table public.coupons
  add column recipient_segment text not null default 'all' check(recipient_segment in ('all','first_purchase','repeat_purchase')),
  add column goods_scope text not null default 'all' check(goods_scope in ('all','selected_goods')),
  add column target_good_ids text[] not null default '{}' check(cardinality(target_good_ids)<=1000 and array_position(target_good_ids,null) is null),
  add column terms_revision integer not null default 1 check(terms_revision>0),
  add constraint coupon_goods_scope_ready check((goods_scope='all' and cardinality(target_good_ids)=0)
    or (goods_scope='selected_goods' and (status='archived' or cardinality(target_good_ids)>0)));
alter table public.coupon_redemptions
  add column eligible_subtotal bigint,
  add column terms_snapshot jsonb;

create table private.coupon_first_purchase_claims (
  order_id uuid primary key,
  user_id uuid not null,
  coupon_code text not null,
  state text not null default 'reserved' check(state in ('reserved','consumed','released')),
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  released_at timestamptz
);
create unique index coupon_first_purchase_one_pending on private.coupon_first_purchase_claims(user_id) where state='reserved';
alter table private.coupon_first_purchase_claims enable row level security;
revoke all on private.coupon_first_purchase_claims from public,anon,authenticated,service_role;

create function private.touch_coupon_terms_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.name,new.discount_type,new.discount_value,new.max_discount_amount,new.min_subtotal,new.starts_at,new.ends_at,new.issue_limit,new.status,new.grade_benefit,new.recipient_segment,new.goods_scope,new.target_good_ids)
    is distinct from (old.name,old.discount_type,old.discount_value,old.max_discount_amount,old.min_subtotal,old.starts_at,old.ends_at,old.issue_limit,old.status,old.grade_benefit,old.recipient_segment,old.goods_scope,old.target_good_ids)
    then new.terms_revision:=old.terms_revision+1; else new.terms_revision:=old.terms_revision; end if;
  return new;
end $$;
revoke all on function private.touch_coupon_terms_revision() from public,anon,authenticated,service_role;
create trigger coupons_terms_revision before update on public.coupons for each row execute function private.touch_coupon_terms_revision();

create function private.customer_has_valid_goods_payment(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.user_id=p_user_id and o.status in ('paid','confirmed','shipping','delivered','done')
   and exists(select 1 from public.payments p where p.purpose='order' and p.ref_id=o.id and p.user_id=p_user_id and p.status='paid' and p.amount=o.total));
$$;
revoke all on function private.customer_has_valid_goods_payment(uuid) from public,anon,authenticated,service_role;

create function private.coupon_recipient_reason(p_segment text,p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when p_segment='first_purchase' and private.customer_has_valid_goods_payment(p_user_id) then 'coupon_first_purchase_only'
   when p_segment='repeat_purchase' and not private.customer_has_valid_goods_payment(p_user_id) then 'coupon_repeat_purchase_only'
   else null end;
$$;
revoke all on function private.coupon_recipient_reason(text,uuid) from public,anon,authenticated,service_role;

create function public.get_my_coupon_purchase_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
 if actor is null then raise insufficient_privilege using message='auth_required'; end if;
 return jsonb_build_object('hasValidPayment',private.customer_has_valid_goods_payment(actor),
   'firstPurchaseReserved',exists(select 1 from private.coupon_first_purchase_claims where user_id=actor and state='reserved'));
end $$;
revoke all on function public.get_my_coupon_purchase_status() from public,anon,authenticated,service_role;
grant execute on function public.get_my_coupon_purchase_status() to authenticated;

-- Recipient eligibility applies to every issuance path, independently of what
-- happens to be in the cart. The grade issuer below skips ineligible definitions.
create function private.guard_coupon_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
declare segment text; reason text;
begin
 select recipient_segment into segment from public.coupons where code=new.coupon_code;
 reason:=private.coupon_recipient_reason(segment,new.user_id);
 if reason is not null then raise check_violation using message=reason; end if;
 return new;
end $$;
revoke all on function private.guard_coupon_recipient() from public,anon,authenticated,service_role;
create trigger user_coupons_recipient_guard before insert on public.user_coupons for each row execute function private.guard_coupon_recipient();

-- All new orders check an existing first-purchase reservation before mutating
-- inventory. Existing user advisory serialization makes this check + the later
-- first-benefit insert atomic against other new checkouts. No reverse order lock.
create function private.assert_first_purchase_checkout(p_user_id uuid,p_order_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from private.coupon_first_purchase_claims where user_id=p_user_id and state='reserved' and order_id<>p_order_id)
   then raise check_violation using message='coupon_first_purchase_reserved'; end if;
end $$;
revoke all on function private.assert_first_purchase_checkout(uuid,uuid) from public,anon,authenticated,service_role;

create function private.evaluate_coupon_target_lines(
 p_user_coupon_id uuid,p_user_id uuid,p_lines jsonb,p_order_id uuid default null,
 out o_reason text,out o_discount bigint,out o_coupon_code text,out o_eligible_subtotal bigint,out o_terms_snapshot jsonb
) returns record language plpgsql stable security definer set search_path='' as $$
declare held public.user_coupons; coupon public.coupons;
begin
 o_reason:=null; o_discount:=0; o_coupon_code:=null; o_eligible_subtotal:=0; o_terms_snapshot:=null;
 select * into held from public.user_coupons where id=p_user_coupon_id;
 if not found or held.user_id is distinct from p_user_id then o_reason:='coupon_not_owned'; return; end if;
 o_coupon_code:=held.coupon_code;
 if held.status='used' then o_reason:='coupon_already_used'; return; end if;
 select * into coupon from public.coupons where code=held.coupon_code;
 if not found or coupon.status<>'active' then o_reason:='coupon_not_found'; return; end if;
 if statement_timestamp()<coupon.starts_at then o_reason:='coupon_not_started'; return; end if;
 if (coupon.ends_at is not null and statement_timestamp()>coupon.ends_at) or (held.expires_at is not null and statement_timestamp()>held.expires_at)
   then o_reason:='coupon_expired'; return; end if;
 o_reason:=private.coupon_recipient_reason(coupon.recipient_segment,p_user_id);
 if o_reason is not null then return; end if;
 if coupon.recipient_segment='first_purchase' then
   if exists(select 1 from private.coupon_first_purchase_claims where user_id=p_user_id and state='reserved' and order_id is distinct from p_order_id)
     then o_reason:='coupon_first_purchase_reserved'; return; end if;
   if exists(select 1 from public.orders where user_id=p_user_id and status='pending' and id is distinct from p_order_id)
     then o_reason:='coupon_first_purchase_pending'; return; end if;
 end if;
 select coalesce(sum(line.subtotal),0) into o_eligible_subtotal
   from jsonb_to_recordset(p_lines) line(good_id text,subtotal bigint)
   where coupon.goods_scope='all' or line.good_id=any(coupon.target_good_ids);
 o_terms_snapshot:=jsonb_build_object('revision',coupon.terms_revision,'recipientSegment',coupon.recipient_segment,'goodsScope',coupon.goods_scope,
   'targetGoodIds',coupon.target_good_ids,'eligibleSubtotal',o_eligible_subtotal,'discountType',coupon.discount_type,'discountValue',coupon.discount_value,
   'maxDiscountAmount',coupon.max_discount_amount,'minSubtotal',coupon.min_subtotal,'startsAt',coupon.starts_at,'endsAt',coupon.ends_at);
 if o_eligible_subtotal=0 then o_reason:='coupon_no_eligible_goods'; return; end if;
 if o_eligible_subtotal<coupon.min_subtotal then o_reason:='coupon_min_subtotal'; return; end if;
 o_discount:=case when coupon.discount_type='fixed' then least(coupon.discount_value::bigint,o_eligible_subtotal)
   else least((o_eligible_subtotal*coupon.discount_value::bigint)/100,coalesce(coupon.max_discount_amount::bigint,o_eligible_subtotal),o_eligible_subtotal) end;
end $$;
revoke all on function private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function private.evaluate_user_coupon(p_user_coupon_id uuid,p_user_id uuid,p_subtotal bigint,out o_reason text,out o_discount bigint,out o_coupon_code text)
returns record language plpgsql stable security definer set search_path='' as $$
declare lines jsonb; evaluated record;
begin
 select coalesce(jsonb_agg(jsonb_build_object('good_id',cart.good_id,'subtotal',cart.qty::bigint*price.effective_price::bigint)),'[]') into lines
 from public.cart_items cart join public.goods_variants variant on variant.id=cart.variant_id and variant.good_id=cart.good_id
 cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price where cart.user_id=p_user_id;
 select * into evaluated from private.evaluate_coupon_target_lines(p_user_coupon_id,p_user_id,lines,null);
 o_reason:=evaluated.o_reason; o_discount:=evaluated.o_discount; o_coupon_code:=evaluated.o_coupon_code;
end $$;
revoke all on function private.evaluate_user_coupon(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create function private.evaluate_order_user_coupon(p_user_coupon_id uuid,p_user_id uuid,p_order_id uuid)
returns table(o_reason text,o_discount bigint,o_coupon_code text,o_eligible_subtotal bigint,o_terms_snapshot jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare lines jsonb;
begin
 -- Lock the current definition through the whole order transaction, so terms
 -- edits cannot race a quote/use snapshot. Existing held-row lock remains first.
 perform 1 from public.coupons c join public.user_coupons h on h.coupon_code=c.code where h.id=p_user_coupon_id and h.user_id=p_user_id for share of c;
 select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'subtotal',qty::bigint*unit_price::bigint)),'[]') into lines from public.order_items where order_id=p_order_id;
 return query select * from private.evaluate_coupon_target_lines(p_user_coupon_id,p_user_id,lines,p_order_id);
end $$;
revoke all on function private.evaluate_order_user_coupon(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.reserve_first_purchase_coupon(p_order_id uuid,p_user_id uuid,p_coupon_code text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if (select recipient_segment from public.coupons where code=p_coupon_code)='first_purchase' then
   insert into private.coupon_first_purchase_claims(order_id,user_id,coupon_code) values(p_order_id,p_user_id,p_coupon_code);
 end if;
end $$;
revoke all on function private.reserve_first_purchase_coupon(uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.transition_first_purchase_coupon() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='paid' then update private.coupon_first_purchase_claims set state='consumed',consumed_at=clock_timestamp() where order_id=new.id and state='reserved';
 elsif new.status='canceled' then update private.coupon_first_purchase_claims set state='released',released_at=clock_timestamp() where order_id=new.id and state<>'released'; end if;
 return null;
end $$;
revoke all on function private.transition_first_purchase_coupon() from public,anon,authenticated,service_role;
create trigger orders_coupon_first_purchase_transition after update of status on public.orders for each row when(new.status is distinct from old.status) execute function private.transition_first_purchase_coupon();

grant all on private.coupon_first_purchase_claims to postgres;
grant execute on function private.touch_coupon_terms_revision(),private.customer_has_valid_goods_payment(uuid),private.coupon_recipient_reason(text,uuid),private.guard_coupon_recipient(),
 private.assert_first_purchase_checkout(uuid,uuid),private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid),private.evaluate_user_coupon(uuid,uuid,bigint),
 private.evaluate_order_user_coupon(uuid,uuid,uuid),private.reserve_first_purchase_coupon(uuid,uuid,text),private.transition_first_purchase_coupon() to postgres;

create function public.coupon_recipient_state(target_coupon public.coupons) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); coupon public.coupons; reason text;
begin
 if actor is null or not exists(select 1 from public.user_coupons where user_id=actor and coupon_code=target_coupon.code) then raise insufficient_privilege using message='coupon_not_owned'; end if;
 -- Ignore client-supplied composite policy fields; read the held definition.
 select * into coupon from public.coupons where code=target_coupon.code;
 reason:=private.coupon_recipient_reason(coupon.recipient_segment,actor);
 if reason is null and coupon.recipient_segment='first_purchase' and exists(select 1 from public.orders where user_id=actor and status='pending') then reason:='coupon_first_purchase_pending'; end if;
 return reason;
end $$;
revoke all on function public.coupon_recipient_state(public.coupons) from public,anon,authenticated,service_role;
grant execute on function public.coupon_recipient_state(public.coupons) to authenticated;

create function public.admin_coupon_target_goods(target_coupon public.coupons) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'code',g.code,'name',g.name,'archivedAt',g.archived_at) order by g.code,g.id)
   from public.goods g where g.id in(select unnest(c.target_good_ids) from public.coupons c where c.code=target_coupon.code)),'[]');
end $$;
revoke all on function public.admin_coupon_target_goods(public.coupons) from public,anon,authenticated,service_role;
grant execute on function public.admin_coupon_target_goods(public.coupons) to authenticated,postgres;

create function public.admin_upsert_coupon_targeted(target_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.coupons; saved public.coupons;
  normalized_code text:=upper(btrim(target_payload->>'target_code')); previous_code text:=nullif(upper(btrim(target_payload->>'target_previous_code')),'');
  segment text:=target_payload->>'target_recipient_segment'; scope text:=target_payload->>'target_goods_scope'; good_ids text[];
  next_status text:=coalesce(target_payload->>'target_status','active');
begin
 perform private.assert_active_user(actor);
 if not public.is_staff() or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required'; end if;
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
end $$;
revoke all on function public.admin_upsert_coupon_targeted(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_upsert_coupon_targeted(jsonb) to authenticated;

create function private.quote_selected_coupon(p_lines jsonb,p_subtotal bigint,p_shipping_fee bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); selected uuid; lines jsonb; evaluated record; discount bigint;
begin
 if actor is null then return null; end if;
 select user_coupon_id into selected from public.cart_coupon_selections where user_id=actor;
 if selected is null then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('good_id',line->>'goodId','subtotal',(line->>'qty')::bigint*(line->>'effectivePrice')::bigint)),'[]') into lines from jsonb_array_elements(p_lines) line;
 select * into evaluated from private.evaluate_coupon_target_lines(selected,actor,lines,null);
 discount:=case when evaluated.o_reason is null then least(evaluated.o_discount,greatest(0,p_subtotal+p_shipping_fee-1000)) else 0 end;
 return jsonb_build_object('userCouponId',selected,'couponCode',coalesce(evaluated.o_coupon_code,''),'eligibleSubtotal',evaluated.o_eligible_subtotal,
   'discount',discount,'reason',case when evaluated.o_reason is null and discount=0 then 'coupon_no_discount' else evaluated.o_reason end);
end $$;
revoke all on function private.quote_selected_coupon(jsonb,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function private.quote_selected_coupon(jsonb,bigint,bigint) to postgres;

-- Extend existing issuance without coupling recipients to cart contents.
create or replace function public.apply_cart_coupon_code(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text;
  v_coupon record;
  v_user_coupon_id uuid;
  v_subtotal bigint;
  v_eval record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- 발급 한도 경합은 쿠폰 행 잠금으로 직렬화한다.
  select coupon.code, coupon.status, coupon.starts_at, coupon.ends_at,
         coupon.issue_limit, coupon.issued_count
  into v_coupon
  from public.coupons as coupon
  where coupon.code = v_code
  for update;

  -- 없는 코드와 보관된 코드는 같은 사유로 답한다 — 코드 존재를 노출하지 않는다.
  if not found or v_coupon.status <> 'active' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  if now() < v_coupon.starts_at then
    raise check_violation using message = 'coupon_not_started';
  end if;

  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise check_violation using message = 'coupon_expired';
  end if;

  select held.id into v_user_coupon_id
  from public.user_coupons as held
  where held.coupon_code = v_code and held.user_id = v_user;

  if v_user_coupon_id is null then
    if v_coupon.issue_limit is not null and v_coupon.issued_count >= v_coupon.issue_limit then
      raise check_violation using message = 'coupon_exhausted';
    end if;

    update public.coupons
    set issued_count = issued_count + 1
    where code = v_code;

    insert into public.user_coupons (coupon_code, user_id, issued_source, expires_at)
    values (v_code, v_user, 'code_entry', v_coupon.ends_at)
    returning id into v_user_coupon_id;
  end if;

  -- 최소 주문 금액 미달은 발급·선택을 막지 않는다 — 더 담으면 살아나는 선택이고,
  -- 확정 거부는 place_order 가 한다(카트가 미달 경고를 그린다). 그 밖의 사유
  -- (만료·사용됨 등)는 쓸 수 없는 선택이므로 여기서 거부한다.
  v_subtotal := private.cart_subtotal(v_user);
  select * into v_eval from private.evaluate_user_coupon(v_user_coupon_id, v_user, v_subtotal);
  if v_eval.o_reason is not null and v_eval.o_reason not in ('coupon_min_subtotal','coupon_no_eligible_goods') then
    raise check_violation using message = v_eval.o_reason;
  end if;

  insert into public.cart_coupon_selections (user_id, user_coupon_id)
  values (v_user, v_user_coupon_id)
  on conflict (user_id) do update set
    user_coupon_id = excluded.user_coupon_id,
    created_at = now();

  return v_user_coupon_id;
end;
$$;

-- 보유 쿠폰을 카트에 적용한다(쿠폰 select 경로).
create or replace function public.apply_cart_coupon(p_user_coupon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_subtotal bigint;
  v_eval record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if p_user_coupon_id is null then
    raise check_violation using message = 'coupon_not_owned';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- 코드 입력과 같은 계약: 최소 금액 미달만은 선택으로 받아들인다.
  v_subtotal := private.cart_subtotal(v_user);
  select * into v_eval from private.evaluate_user_coupon(p_user_coupon_id, v_user, v_subtotal);
  if v_eval.o_reason is not null and v_eval.o_reason not in ('coupon_min_subtotal','coupon_no_eligible_goods') then
    raise check_violation using message = v_eval.o_reason;
  end if;

  insert into public.cart_coupon_selections (user_id, user_coupon_id)
  values (v_user, p_user_coupon_id)
  on conflict (user_id) do update set
    user_coupon_id = excluded.user_coupon_id,
    created_at = now();
end;
$$;


revoke all on function public.apply_cart_coupon_code(text),public.apply_cart_coupon(uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_cart_coupon_code(text),public.apply_cart_coupon(uuid) to authenticated;

create or replace function private.grant_grade_benefit_coupons(
  p_user_id uuid,
  p_from_grade public.loyalty_grade,
  p_to_grade public.loyalty_grade
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select coupon.code, coupon.ends_at, coupon.issue_limit, coupon.issued_count
    from public.coupons as coupon
    where coupon.status = 'active'
      and private.coupon_recipient_reason(coupon.recipient_segment,p_user_id) is null
      -- 이미 끝난 정의는 발급하지 않는다 — 쓸 수 없는 쿠폰을 혜택이라 말하며
      -- 유한 발급 한도만 소모하게 된다.
      and (coupon.ends_at is null or coupon.ends_at > now())
      and coupon.grade_benefit is not null
      and coupon.grade_benefit > p_from_grade
      and coupon.grade_benefit <= p_to_grade
    order by coupon.code
    for update
  loop
    if r.issue_limit is not null and r.issued_count >= r.issue_limit then
      continue;
    end if;

    if exists (
      select 1 from public.user_coupons as held
      where held.coupon_code = r.code and held.user_id = p_user_id
    ) then
      continue;
    end if;

    update public.coupons
    set issued_count = issued_count + 1
    where code = r.code;

    insert into public.user_coupons (coupon_code, user_id, issued_source, expires_at)
    values (r.code, p_user_id, 'grade_benefit', r.ends_at);
  end loop;
end;
$$;

revoke all on function private.grant_grade_benefit_coupons(uuid,public.loyalty_grade,public.loyalty_grade) from public,anon,authenticated,service_role;
grant execute on function private.grant_grade_benefit_coupons(uuid,public.loyalty_grade,public.loyalty_grade) to postgres;

-- Authoritative selected coupon accompanies the existing quote.
create or replace function public.quote_goods_sales(items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  input record;
  line record;
  good public.goods;
  variant public.goods_variants;
  price record;
  normalized jsonb:='[]';
  quoted_lines jsonb:='[]';
  quoted_goods jsonb:='[]';
  at_time timestamptz:=statement_timestamp();
  actor uuid:=auth.uid();
  subtotal bigint:=0;
  card_allowed boolean:=true;
  bank_allowed boolean:=true;
  reserved_qty bigint;
  quantity_error text;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_sales_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(input.value) key where key not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'goodId') is distinct from 'string'
      or nullif(btrim(input.value->>'goodId'),'') is null
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or input.value->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or input.value->>'qty' !~ '^[1-9][0-9]*$' then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    if (input.value->>'qty')::numeric>2147483647 then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('good_id',input.value->>'goodId',
      'variant_id',(input.value->>'variantId')::uuid,'qty',(input.value->>'qty')::integer));
  end loop;
  for line in select good_id,variant_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id,variant_id order by good_id,variant_id
  loop
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='sales_quote_good_unavailable'; end if;
    select * into variant from public.goods_variants
      where id=line.variant_id and good_id=good.id and archived_at is null;
    if not found then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into price from private.resolve_goods_variant_price(variant.id,at_time);
    quoted_lines:=quoted_lines||jsonb_build_array(jsonb_build_object('goodId',good.id,'variantId',variant.id,'qty',line.qty,
      'regularPrice',price.regular_price,'effectivePrice',price.effective_price,'pricePeriodId',price.price_period_id,
      'startsAt',price.starts_at,'endsAt',price.ends_at,'available',good.stock<>'soldout' and line.qty<=variant.stock_qty));
    subtotal:=subtotal+line.qty*price.effective_price::bigint;
    card_allowed:=card_allowed and good.allow_card_payment;
    bank_allowed:=bank_allowed and good.allow_bank_transfer;
  end loop;
  for line in select good_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id order by good_id
  loop
    select * into good from public.goods where id=line.good_id;
    reserved_qty:=case when actor is null then null else private.member_goods_reserved_qty(actor,good.id) end;
    quantity_error:=private.check_goods_purchase_quantity(good,actor,line.qty,true);
    quoted_goods:=quoted_goods||jsonb_build_array(jsonb_build_object('goodId',good.id,'qty',line.qty,
      'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
      'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not good.member_purchase_limit_enabled or actor is null
        then null else greatest(0,good.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));
  end loop;
  return jsonb_build_object('calculatedAt',at_time,'subtotal',subtotal,'lines',quoted_lines,'goods',quoted_goods,
    'shipping',public.quote_goods_shipping(items),
    'coupon',private.quote_selected_coupon(quoted_lines,subtotal,(public.quote_goods_shipping(items)->>'totalFee')::bigint),
    'nextChangeAt',(select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.state='active' and boundary.change_at>at_time
        and schedule.variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(normalized))),
    'paymentMethods',jsonb_build_object('card',card_allowed and jsonb_array_length(normalized)>0,
      'bankTransfer',bank_allowed and jsonb_array_length(normalized)>0));
end $$;
revoke all on function public.quote_goods_sales(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales(jsonb) to anon,authenticated;

-- Preserve matching total_count/search ordering while extending result fields.
drop function public.admin_search_coupons(text,text,integer,integer);
create function public.admin_search_coupons(
  p_query text default null,
  p_status text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  code text,
  name text,
  discount_type text,
  discount_value integer,
  max_discount_amount integer,
  min_subtotal integer,
  starts_at timestamptz,
  ends_at timestamptz,
  issue_limit integer,
  issued_count integer,
  status text,
  grade_benefit public.loyalty_grade,
  used_count bigint,
  total_count bigint,
  recipient_segment text,
  goods_scope text,
  target_good_ids text[],
  terms_revision integer,
  target_goods jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
begin
  if actor_id is null or not public.is_staff() then
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
$$;

revoke all on function public.admin_search_coupons(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_coupons(text, text, integer, integer)
  to authenticated;

-- Latest core: coupon targeting, then the existing store-credit hook.
CREATE OR REPLACE FUNCTION private.place_order_before_shipments(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  v_store_credit bigint := 0;
  r record;
  v_variant public.goods_variants;
  v_price record;
  v_price_at timestamptz;
  v_limit_good public.goods;
  v_good_qty bigint;
  v_last_good_id text;
  v_quantity_error text;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  if p_payment_method is null then
    raise invalid_parameter_value using message='payment method required';
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  perform private.assert_first_purchase_checkout(v_user,v_order);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||v_user::text,0));
  -- This timestamp is fixed after the member/cart locks. Waiting for a competing
  -- checkout cannot select a stale pre-lock clock value. Each order has one price
  -- boundary, including all its coupon and shipping calculations.
  v_price_at:=clock_timestamp();
  -- Parent goods are locked before their selected options and cache updates.
  for r in
    select
      cart.good_id,
      cart.variant_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.allow_card_payment,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id, cart.variant_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    select * into v_variant from public.goods_variants where id=r.variant_id and good_id=r.good_id for update;
    if not found or v_variant.archived_at is not null then raise check_violation using message='catalog_item_unavailable'; end if;
    v_item_count := v_item_count + 1;

    -- Cart has one row per option. Check a good only before its first row is
    -- consumed, summing every selected option and any optional add-on of it.
    if v_last_good_id is distinct from r.good_id then
      select * into v_limit_good from public.goods where id=r.good_id;
      select sum(qty::bigint) into v_good_qty from public.cart_items where user_id=v_user and good_id=r.good_id;
      v_quantity_error:=private.check_goods_purchase_quantity(v_limit_good,v_user,v_good_qty,true);
      if v_quantity_error is not null then
        raise check_violation using message=v_quantity_error||': '||r.good_id;
      end if;
      v_last_good_id:=r.good_id;
    end if;
    select * into v_price from private.resolve_goods_variant_price(v_variant.id,v_price_at);


    if r.stock = 'soldout' or v_variant.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'card' and not r.allow_card_payment then
      raise check_violation using message=format('card payment blocked: %s',r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);

    insert into public.order_items (
      order_id,
      good_id,
      variant_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot,
      regular_unit_price_snapshot,
      price_period_id,
      price_evaluated_at,
      sales_policy_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.variant_id,
      r.qty,
      v_price.effective_price,
      r.name,
      r.type,
      r.ip_id,
      v_price.regular_price,
      v_price.price_period_id,
      v_price_at,
      jsonb_build_object('version',1,'allowCardPayment',r.allow_card_payment,'allowBankTransfer',r.allow_bank_transfer,
        'orderQuantityLimitEnabled',v_limit_good.order_quantity_limit_enabled,
        'minOrderQty',v_limit_good.min_order_qty,'maxOrderQty',v_limit_good.max_order_qty,
        'memberPurchaseLimitEnabled',v_limit_good.member_purchase_limit_enabled,
        'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit)
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id and variant_id = r.variant_id;

    v_subtotal := v_subtotal + (v_price.effective_price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- Shipping uses the period-adjusted item subtotal before coupon/credit deductions.
  -- Its order-item inputs already contain the immutable effective price.
  v_shipping_fee := private.goods_shipping_fee_for(v_order);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_order_user_coupon(v_selected_coupon, v_user, v_order);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    if v_discount<=0 then raise check_violation using message='coupon_no_discount'; end if;
    perform private.reserve_first_purchase_coupon(v_order,v_user,v_coupon_eval.o_coupon_code);

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount, eligible_subtotal, terms_snapshot
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount, v_coupon_eval.o_eligible_subtotal, v_coupon_eval.o_terms_snapshot
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  v_store_credit := private.reserve_order_store_credits(v_order,v_user,v_subtotal,v_discount,v_shipping_fee);

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount - v_store_credit,
      shipping_fee = v_shipping_fee,
      store_credit_total = v_store_credit,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount - v_store_credit, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
