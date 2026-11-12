-- ============================================================================
-- 장바구니 선택 삭제·전체 비우기 (10/14 실사용 QA 회의 1014-035·036, ADR-0030)
--
-- 지금까지 장바구니는 줄마다 X(수량 0 저장)로만 지울 수 있었다. 화면이 체크한 줄(선택 삭제)이나 보이는 줄
-- 전체(전체 비우기)를 한 번에 지우도록 일괄 삭제 RPC를 둔다. 전체 비우기도 화면이 본 줄만 넘긴다 — 다른 탭에서
-- 막 담은 줄을 고객이 보지 못한 채 지우지 않는다.
--
-- 잠금 순서는 다른 장바구니 변경 RPC와 같다: 사용자 advisory → account-action → profiles(lock_goods_transaction_actor)
-- → 'cart:'. 결제 대기 주문의 보류 줄이 지워져도 결제 확정 정산이 '없음(absent)'으로 넘기므로 안전하다(ADR-0026).
-- ============================================================================

create function public.remove_cart_lines(p_lines jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  removed integer := 0;
begin
  if actor is null then
    raise insufficient_privilege using message = 'auth required';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 19239
    or exists (
      select 1 from jsonb_array_elements(p_lines) as line
      where jsonb_typeof(line) <> 'object'
        or not line ?& array['good_id', 'variant_id', 'input_revision', 'input_values']
        or exists (select 1 from jsonb_object_keys(line) as key
          where key not in ('good_id', 'variant_id', 'input_revision', 'input_values'))
        or jsonb_typeof(line -> 'good_id') <> 'string' or nullif(btrim(line ->> 'good_id'), '') is null
        or jsonb_typeof(line -> 'variant_id') <> 'string'
        or line ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(line -> 'input_revision') <> 'number' or line ->> 'input_revision' !~ '^(0|[1-9][0-9]*)$'
        or jsonb_typeof(line -> 'input_values') <> 'object'
    )
  then
    raise invalid_parameter_value using message = 'invalid cart lines';
  end if;
  -- 담기·수량 변경·병합과 같은 순서로 잠근다(20261020085341). 정지 계정은 장바구니를 바꾸지 못한다.
  perform private.lock_goods_transaction_actor(actor);
  perform private.assert_active_user(actor);
  perform pg_advisory_xact_lock(hashtextextended('cart:' || actor::text, 0));
  delete from public.cart_items as cart
  using (
    select distinct line.good_id, line.variant_id, line.input_revision, line.input_values
    from jsonb_to_recordset(p_lines) as line(good_id text, variant_id uuid, input_revision integer, input_values jsonb)
  ) as requested
  where cart.user_id = actor
    and cart.good_id = requested.good_id
    and cart.variant_id = requested.variant_id
    and cart.input_revision = requested.input_revision
    and cart.input_values = requested.input_values;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.remove_cart_lines(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.remove_cart_lines(jsonb) to authenticated;
comment on function public.remove_cart_lines(jsonb) is
  '장바구니 선택 삭제·전체 비우기(ADR-0030). 화면이 넘긴 줄(굿즈·옵션·직접입력값)만 지우고 지운 줄 수를 돌려준다.';

-- 다른 장바구니 변경 RPC(add_cart_selection·merge_cart_items·set_cart_quantity_with_inputs)와 같이 정의 지문을 남긴다.
select private.register_operator_internal_contract('public.remove_cart_lines(jsonb)'::regprocedure);

notify pgrst, 'reload schema';
