-- 주문 생성도 티켓 예약과 같은 서버 신뢰 경계로 이동한다.
-- 브라우저가 authenticated RPC를 직접 호출해 재고를 선점할 수 없게 하고,
-- 서버가 인증·검토 권한을 확인한 뒤 service role로만 사용자 ID를 전달한다.

create function public.place_order(
  p_user_id uuid,
  p_address jsonb,
  p_checkout_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_subject text := pg_catalog.current_setting('request.jwt.claim.sub', true);
  placed_order_id uuid;
begin
  if p_user_id is null then
    raise not_null_violation using message = 'user required';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  placed_order_id := public.place_order(p_address, p_checkout_key);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
  return placed_order_id;
exception
  when others then
    perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
    raise;
end;
$$;

revoke all on function public.place_order(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.place_order(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.place_order(uuid, jsonb, uuid)
  to service_role;
