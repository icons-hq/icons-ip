/*
 * 클레임 콘솔 목록 RPC에 구매자 식별 컬럼을 추가한다.
 *
 * admin_search_order_claims가 구매자를 nickname·email로만 실어서, 닉네임이 빈
 * 구매자의 익명 표기를 앱이 주문 id로 만들어 왔다 — 주문·거래확정·발송 콘솔의
 * fan_ 축약(구매자 id 앞 6자)과 같은 구매자가 클레임 콘솔에서만 다른 이름으로
 * 보인다. 표기 seed가 되는 구매자 id를 RPC가 직접 싣는다.
 *
 * 반환 테이블 변경은 create or replace로 불가능해 drop 후 재생성한다. 본문은
 * buyer_id 한 컬럼 추가 외 20260818120000_order_claims_domain.sql과 동일하다.
 */

drop function if exists public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
);

create function public.admin_search_order_claims(
  p_claim_type text default null,
  p_stage text default null,
  p_reason_type text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference bigint,
  order_id uuid,
  claim_type text,
  stage text,
  reason_type text,
  buyer_id uuid,
  buyer_name text,
  buyer_email text,
  order_status public.order_status,
  order_total bigint,
  requested_at timestamptz,
  collected_at timestamptz,
  completed_at timestamptz,
  refund_method text,
  handler_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_stages text[];
begin
  if (select auth.uid()) is null or not public.is_staff() then
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
$$;

revoke all on function public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
) to authenticated;
