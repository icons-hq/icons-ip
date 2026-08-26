-- The Last Bell trigger must guard only story-entitlement goods. Public goods
-- keep the existing cart/RLS and service checkout behavior unchanged.
create or replace function private.last_bell_guard_cart_item_purchase_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_access text;
  v_user_id uuid;
begin
  select good.purchase_access
    into v_purchase_access
  from public.goods as good
  where good.id = new.good_id;

  if v_purchase_access is distinct from 'story_entitlement' then
    return new;
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null or v_user_id is distinct from new.user_id then
    raise insufficient_privilege using message = 'cart owner required';
  end if;

  if not coalesce(private.last_bell_user_can_purchase_good(v_user_id, new.good_id, pg_catalog.now()), false) then
    raise check_violation using message = 'story_entitlement_required';
  end if;

  return new;
end;
$$;

revoke all on function private.last_bell_guard_cart_item_purchase_access()
from public, anon, authenticated, service_role;
