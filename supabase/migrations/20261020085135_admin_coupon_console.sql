-- Seller benefits console: filtering is applied before pagination.
create function public.admin_search_coupon_console(
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
$$;

revoke all on function public.admin_search_coupon_console(text, text, integer, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_coupon_console(text, text, integer, integer, jsonb)
  to authenticated;

create function public.admin_set_coupon_status(p_code text, p_expected_revision integer, p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.coupons; saved public.coupons;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
 if p_status is null or p_status not in('active','archived') or p_expected_revision is null then raise invalid_parameter_value using message='invalid_coupon_status';end if;
 select * into existing from public.coupons where code=p_code for update;
 if not found then raise no_data_found using message='coupon_not_found';end if;
 if existing.terms_revision<>p_expected_revision then raise exception using errcode='PT409',message='coupon_terms_changed';end if;
 if existing.status=p_status then return jsonb_build_object('code',existing.code,'changed',false);end if;
 update public.coupons set status=p_status where code=p_code returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.status_changed','coupons:'||p_code,
 jsonb_build_object('before',existing.status,'after',saved.status,'previousRevision',existing.terms_revision,'revision',saved.terms_revision));
 return jsonb_build_object('code',saved.code,'changed',true,'revision',saved.terms_revision);
end $$;
revoke all on function public.admin_set_coupon_status(text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_coupon_status(text,integer,text) to authenticated;
