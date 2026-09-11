-- The checkout displays a selected user-coupon identity. A later tab must not
-- replace that selection between the displayed quote and order creation.
-- Keep the five-argument seam for existing trusted callers and add an explicit
-- expectation to the application checkout. NULL means no coupon was selected.
create function public.place_order_with_store_credits(
 p_user_id uuid,p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method,
 p_store_credit_amount bigint,p_expected_user_coupon_id uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare existing_order public.orders; recorded_coupon_ids uuid[]; selected_coupon_id uuid;
begin
 if p_user_id is null or p_checkout_key is null or p_store_credit_amount is null
  or p_store_credit_amount not between 0 and 999999999999 then
  raise invalid_parameter_value using message='store_credit_amount_invalid';
 end if;
 -- apply_cart_coupon, clear_cart_coupon, and the existing five-argument
 -- checkout all use this same user lock. The comparison and consumption are
 -- therefore one operation even if another browser tab changes its selection.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into existing_order from public.orders
  where user_id=p_user_id and checkout_key=p_checkout_key for update;
 if found then
  -- The cart was consumed on the first request and may now contain a different
  -- selection. Compare the original order's record, including a released
  -- redemption after cancellation; never reinterpret an old checkout key.
  select array_agg(distinct r.user_coupon_id) into recorded_coupon_ids
   from public.coupon_redemptions r where r.order_id=existing_order.id;
  if coalesce(cardinality(recorded_coupon_ids),0)>1
   or (existing_order.discount_total>0 and coalesce(cardinality(recorded_coupon_ids),0)=0) then
   raise exception using errcode='PT409',message='coupon_selection_changed';
  end if;
  selected_coupon_id:=recorded_coupon_ids[1];
 else
  select user_coupon_id into selected_coupon_id from public.cart_coupon_selections where user_id=p_user_id;
 end if;
 if selected_coupon_id is distinct from p_expected_user_coupon_id then
  raise exception using errcode='PT409',message='coupon_selection_changed';
 end if;
 -- Preserve the original address/payment-method/credit-amount replay checks,
 -- stock/coupon/credit reservation, pricing, and shipment creation exactly.
 return public.place_order_with_store_credits(p_user_id,p_address,p_checkout_key,p_payment_method,p_store_credit_amount);
end $$;
revoke all on function public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)
 to service_role;
