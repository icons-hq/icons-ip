-- Separate issuance from use. New definitions keep expiry on each held coupon;
-- legacy definitions retain the shared starts_at/ends_at contract until edited.
alter table public.coupons
  add column issue_starts_at timestamptz,
  add column issue_ends_at timestamptz,
  add column valid_days integer check (valid_days between 1 and 365),
  add constraint coupons_issue_period check (
    (issue_starts_at is not null or issue_ends_at is null)
    and (issue_ends_at is null or issue_ends_at > issue_starts_at)
  );

create or replace function private.touch_coupon_terms_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.name,new.discount_type,new.discount_value,new.max_discount_amount,new.min_subtotal,new.starts_at,new.ends_at,new.issue_limit,new.status,new.grade_benefit,new.recipient_segment,new.goods_scope,new.target_good_ids,new.issue_starts_at,new.issue_ends_at,new.valid_days)
    is distinct from (old.name,old.discount_type,old.discount_value,old.max_discount_amount,old.min_subtotal,old.starts_at,old.ends_at,old.issue_limit,old.status,old.grade_benefit,old.recipient_segment,old.goods_scope,old.target_good_ids,old.issue_starts_at,old.issue_ends_at,old.valid_days)
    then new.terms_revision:=old.terms_revision+1; else new.terms_revision:=old.terms_revision; end if;
  return new;
end $$;
revoke all on function private.touch_coupon_terms_revision() from public,anon,authenticated,service_role;
grant execute on function private.touch_coupon_terms_revision() to postgres;

create function private.coupon_issue_expiry(p_coupon public.coupons,p_issued_at timestamptz) returns timestamptz
language sql immutable set search_path='' as $$
  select case when p_coupon.valid_days is null then p_coupon.ends_at else
    least(p_coupon.ends_at, (((p_issued_at at time zone 'Asia/Seoul')::date + p_coupon.valid_days + 1)::timestamp at time zone 'Asia/Seoul') - interval '1 millisecond') end;
$$;
revoke all on function private.coupon_issue_expiry(public.coupons,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.coupon_issue_expiry(public.coupons,timestamptz) to postgres;

create function public.admin_upsert_coupon_scheduled(target_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); saved public.coupons; previous public.coupons;
  issue_start timestamptz:=(target_payload->>'target_issue_starts_at')::timestamptz;
  issue_end timestamptz:=(target_payload->>'target_issue_ends_at')::timestamptz;
  usage_end timestamptz:=(target_payload->>'target_ends_at')::timestamptz;
  days integer:=(target_payload->>'target_valid_days')::integer;
  normalized_code text:=upper(btrim(target_payload->>'target_code'));
begin
  perform private.assert_active_user(actor);
  if not public.is_staff() or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required';end if;
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
end $$;
revoke all on function public.admin_upsert_coupon_scheduled(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_upsert_coupon_scheduled(jsonb) to authenticated;

create function private.claim_coupon_code(p_code text,p_user_id uuid) returns uuid
language plpgsql volatile set search_path='' as $$
declare coupon public.coupons; held_id uuid; issued timestamptz:=statement_timestamp(); reason text;
begin
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then raise insufficient_privilege using message='account_write_fenced';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into coupon from public.coupons where code=upper(btrim(coalesce(p_code,''))) for update;
  if not found or coupon.status<>'active' then raise check_violation using message='coupon_not_found';end if;
  select id into held_id from public.user_coupons where user_id=p_user_id and coupon_code=coupon.code;
  -- An existing held coupon survives the end of the issuance period. Applying it
  -- still rechecks its own expiry, status, recipient and eligible goods.
  if held_id is not null then return held_id;end if;
  if issued<coalesce(coupon.issue_starts_at,coupon.starts_at) then raise check_violation using message='coupon_issue_not_started';end if;
  if (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=issued then raise check_violation using message='coupon_issue_ended';end if;
  if coupon.ends_at is not null and coupon.ends_at<=issued then raise check_violation using message='coupon_expired';end if;
  reason:=private.coupon_recipient_reason(coupon.recipient_segment,p_user_id);
  if reason is not null then raise check_violation using message=reason;end if;
  if coupon.issue_limit is not null and coupon.issued_count>=coupon.issue_limit then raise check_violation using message='coupon_exhausted';end if;
  insert into public.user_coupons(coupon_code,user_id,issued_source,issued_at,expires_at)
    values(coupon.code,p_user_id,'code_entry',issued,private.coupon_issue_expiry(coupon,issued)) returning id into held_id;
  update public.coupons set issued_count=issued_count+1 where code=coupon.code;
  return held_id;
end $$;
revoke all on function private.claim_coupon_code(text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.claim_coupon_code(text,uuid) to postgres;

create function public.claim_coupon_code(p_code text) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise insufficient_privilege using message='auth required';end if;
  return private.claim_coupon_code(p_code,actor);
end $$;
revoke all on function public.claim_coupon_code(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_coupon_code(text) to authenticated;

create or replace function public.apply_cart_coupon_code(p_code text) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); held_id uuid; evaluated record;
begin
  if actor is null then raise insufficient_privilege using message='auth required';end if;
  held_id:=private.claim_coupon_code(p_code,actor);
  select * into evaluated from private.evaluate_user_coupon(held_id,actor,private.cart_subtotal(actor));
  if evaluated.o_reason is not null and evaluated.o_reason not in ('coupon_min_subtotal','coupon_no_eligible_goods') then raise check_violation using message=evaluated.o_reason;end if;
  insert into public.cart_coupon_selections(user_id,user_coupon_id) values(actor,held_id)
    on conflict(user_id) do update set user_coupon_id=excluded.user_coupon_id,created_at=now();
  return held_id;
end $$;
revoke all on function public.apply_cart_coupon_code(text) from public,anon,authenticated,service_role;
grant execute on function public.apply_cart_coupon_code(text) to authenticated;

create or replace function private.evaluate_coupon_target_lines(
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
 if (coupon.issue_starts_at is null and coupon.ends_at is not null and statement_timestamp()>coupon.ends_at) or (held.expires_at is not null and statement_timestamp()>held.expires_at)
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
   'maxDiscountAmount',coupon.max_discount_amount,'minSubtotal',coupon.min_subtotal,'startsAt',coupon.starts_at,'endsAt',coupon.ends_at,'expiresAt',held.expires_at,'issueStartsAt',coupon.issue_starts_at,'issueEndsAt',coupon.issue_ends_at,'validDays',coupon.valid_days);
 if o_eligible_subtotal=0 then o_reason:='coupon_no_eligible_goods'; return; end if;
 if o_eligible_subtotal<coupon.min_subtotal then o_reason:='coupon_min_subtotal'; return; end if;
 o_discount:=case when coupon.discount_type='fixed' then least(coupon.discount_value::bigint,o_eligible_subtotal)
   else least((o_eligible_subtotal*coupon.discount_value::bigint)/100,coalesce(coupon.max_discount_amount::bigint,o_eligible_subtotal),o_eligible_subtotal) end;
end $$;
revoke all on function private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

grant execute on function private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid) to postgres;

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
    select coupon.*, private.coupon_issue_expiry(coupon,statement_timestamp()) as held_expiry
    from public.coupons as coupon
    where coupon.status = 'active'
      and private.coupon_recipient_reason(coupon.recipient_segment,p_user_id) is null
      -- 이미 끝난 정의는 발급하지 않는다 — 쓸 수 없는 쿠폰을 혜택이라 말하며
      -- 유한 발급 한도만 소모하게 된다.
      and (coupon.ends_at is null or coupon.ends_at > now())
      and (coupon.issue_starts_at is null or coupon.issue_starts_at<=statement_timestamp())
      and (coupon.issue_starts_at is null or coupon.issue_ends_at is null or coupon.issue_ends_at>statement_timestamp())
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
    values (r.code, p_user_id, 'grade_benefit', r.held_expiry);
  end loop;
end;
$$;

revoke all on function private.grant_grade_benefit_coupons(uuid,public.loyalty_grade,public.loyalty_grade) from public,anon,authenticated,service_role;
grant execute on function private.grant_grade_benefit_coupons(uuid,public.loyalty_grade,public.loyalty_grade) to postgres;
-- Seller benefits console: filtering is applied before pagination.
create function public.admin_search_coupon_console_scheduled(
  p_query text default null,
  p_status text default 'all',
  p_limit integer default 20,
  p_offset integer default 0,
  p_filters jsonb default '{}'::jsonb
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
  target_goods jsonb,
  issue_starts_at timestamptz,
  issue_ends_at timestamptz,
  valid_days integer
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
  phase text := coalesce(p_filters->>'phase','all');
  discount text := coalesce(p_filters->>'discountType','all');
  segment text := coalesce(p_filters->>'segment','any');
  date_field text := coalesce(p_filters->>'dateField','created');
  sort_key text := coalesce(p_filters->>'sort','created_desc');
  date_from date := nullif(p_filters->>'from','')::date;
  date_to date := nullif(p_filters->>'to','')::date;
begin
  if actor_id is null or not public.is_staff() then
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
        or (phase='ended' and (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=now())
        or (phase='live' and coalesce(coupon.issue_starts_at,coupon.starts_at)<=now() and ((case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end) is null or (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)>now())))))
      and (date_from is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) >= (date_from::timestamp at time zone 'Asia/Seoul'))
      and (date_to is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) < ((date_to+1)::timestamp at time zone 'Asia/Seoul'))
    order by case when sort_key='name_asc' then coupon.name end asc,
      case when sort_key='starts_desc' then coupon.starts_at end desc,
      case when sort_key='ends_asc' then coupon.ends_at end asc nulls last,
      coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$$;

revoke all on function public.admin_search_coupon_console_scheduled(text, text, integer, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_coupon_console_scheduled(text, text, integer, integer, jsonb)
  to authenticated;


notify pgrst,'reload schema';
