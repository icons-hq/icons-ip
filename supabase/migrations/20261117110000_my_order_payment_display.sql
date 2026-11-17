-- 고객 주문 상세의 결제수단 표시(MD-0037). private 근거 테이블에서 표시용 문자열만 꺼낸다.
--
-- 결제 근거(`private.payment_provider_evidence`)는 Data API에 노출되지 않고 service_role 직접 연결로만 읽힌다.
-- 고객 화면이 '신용·체크카드 (4330****…)'·'간편결제 (네이버페이)'를 보이려면 method·마스킹 표기만 안전하게
-- 꺼내는 좁은 읽기 통로가 필요하다. 결제 키·결과 코드·거래 id·승인 번호는 이 함수가 내보내지 않는다.
create function public.get_my_order_payment_display(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then raise insufficient_privilege using message = 'auth_required'; end if;
  if p_order_id is null then return null; end if;
  select jsonb_build_object(
           'provider', payment.provider::text,
           'method', evidence.payment_method,
           'detail', evidence.masked_payment_method,
           'approvedAt', evidence.approved_at)
    into result
    from public.payments payment
    left join public.payment_attempts attempt on attempt.payment_id = payment.id
    left join lateral (
      select e.payment_method, e.masked_payment_method, e.approved_at
        from private.payment_provider_evidence e
       where e.payment_attempt_id = attempt.id
         and (e.payment_method is not null or e.masked_payment_method is not null)
       order by e.recorded_at desc, e.id desc
       limit 1) evidence on true
   where payment.purpose = 'order' and payment.ref_id = p_order_id and payment.user_id = actor
   order by payment.created_at desc, payment.id desc
   limit 1;
  return result;
end $$;
revoke all on function public.get_my_order_payment_display(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_payment_display(uuid) to authenticated;
comment on function public.get_my_order_payment_display(uuid) is
  '고객 주문 상세 결제수단 표시(MD-0037). 본인 결제의 method·마스킹 표기만 돌려준다. 결제 키·결과 코드는 내보내지 않는다.';
