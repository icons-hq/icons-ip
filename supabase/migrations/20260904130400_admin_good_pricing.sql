-- D-9/D-10 ⑤ — 공급가·과세 구분 setter (설계서 v2 §3 「스키마 보강」)
--
-- 저장 폼(admin_upsert_good)은 이미 인자 21개다. 값 하나를 고치려고 고시정보 7칸을 다시 제출하게 만들지 않는다 —
-- 무통장 토글·판매 스위치와 같은 등급의 행 단위 setter 로 둔다.

create or replace function public.admin_set_good_pricing(
  target_good_id text,
  target_supply_price integer default null,
  target_tax_type text default 'taxable'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  if target_tax_type not in ('taxable', 'exempt', 'zero_rated') then
    raise exception 'tax_type_invalid' using errcode = '22023';
  end if;
  if target_supply_price is not null and (target_supply_price < 0 or target_supply_price > 2147483647) then
    raise exception 'supply_price_invalid' using errcode = '22023';
  end if;

  update public.goods
  set supply_price = target_supply_price, tax_type = target_tax_type
  where id = target_good_id;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  perform private.record_admin_action(
    null, v_actor, 'catalog.good.pricing', 'goods:' || target_good_id,
    jsonb_build_object('supply_price', target_supply_price, 'tax_type', target_tax_type)
  );
end;
$$;

revoke all on function public.admin_set_good_pricing(text, integer, text) from public, anon, service_role;
grant execute on function public.admin_set_good_pricing(text, integer, text) to authenticated;
