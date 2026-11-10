-- A changed issuance campaign must not postpone coupons that customers already hold.
alter table public.user_coupons add column usable_from timestamptz;
update public.user_coupons held set usable_from=coupon.starts_at
  from public.coupons coupon where coupon.code=held.coupon_code;
alter table public.user_coupons alter column usable_from set not null;

create function private.snapshot_held_coupon_validity() returns trigger
language plpgsql security definer set search_path='' as $$
declare coupon public.coupons;
begin
 select * into coupon from public.coupons where code=new.coupon_code;
 if not found then raise check_violation using message='coupon_not_found';end if;
 new.usable_from:=case when coupon.valid_days is not null then new.issued_at else coupon.starts_at end;
 if coupon.issue_starts_at is not null then new.expires_at:=private.coupon_issue_expiry(coupon,new.issued_at);end if;
 return new;
end $$;
revoke all on function private.snapshot_held_coupon_validity() from public,anon,authenticated,service_role;
grant execute on function private.snapshot_held_coupon_validity() to postgres;
create trigger user_coupons_validity_snapshot before insert on public.user_coupons
 for each row execute function private.snapshot_held_coupon_validity();

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
 if statement_timestamp()<(case when coupon.issue_starts_at is null then coupon.starts_at else held.usable_from end) then o_reason:='coupon_not_started'; return; end if;
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
   'maxDiscountAmount',coupon.max_discount_amount,'minSubtotal',coupon.min_subtotal,'startsAt',coupon.starts_at,'endsAt',coupon.ends_at,'expiresAt',held.expires_at,'usableFrom',held.usable_from,'issueStartsAt',coupon.issue_starts_at,'issueEndsAt',coupon.issue_ends_at,'validDays',coupon.valid_days);
 if o_eligible_subtotal=0 then o_reason:='coupon_no_eligible_goods'; return; end if;
 if o_eligible_subtotal<coupon.min_subtotal then o_reason:='coupon_min_subtotal'; return; end if;
 o_discount:=case when coupon.discount_type='fixed' then least(coupon.discount_value::bigint,o_eligible_subtotal)
   else least((o_eligible_subtotal*coupon.discount_value::bigint)/100,coalesce(coupon.max_discount_amount::bigint,o_eligible_subtotal),o_eligible_subtotal) end;
end $$;
revoke all on function private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

grant execute on function private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid) to postgres;


create or replace function public.admin_search_coupon_console_scheduled(
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
$$;

revoke all on function public.admin_search_coupon_console_scheduled(text, text, integer, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_coupon_console_scheduled(text, text, integer, integer, jsonb)
  to authenticated;



notify pgrst,'reload schema';
