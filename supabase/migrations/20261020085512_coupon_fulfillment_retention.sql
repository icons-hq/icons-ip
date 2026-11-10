-- Preserve the financial decomposition after account erasure without copying
-- customer identities, coupon names, target lists or free-form evidence.
begin;
do $patch$
declare definition text;pair text[];replacements text[][]:=array[
 array[$old$'shippingFee', order_record.shipping_fee,$old$,$new$'shippingFee', order_record.shipping_fee,
      'shippingCouponDiscount',order_record.shipping_coupon_discount_total,
      'couponApplications',coalesce((select jsonb_agg(jsonb_build_object('redemptionRef',r.id,'benefitKind',r.benefit_kind,
       'applicationIndex',r.application_index,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,
       'status',r.status,'appliedAt',r.applied_at,'releasedAt',r.released_at) order by r.application_index,r.id)
       from public.coupon_redemptions r where r.order_id=order_record.id),'[]'),$new$],
 array[$old$'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee$old$,
 $new$'baseFee',component.base_fee,'regionalFee',component.regional_fee,'installationFee',component.installation_fee,
       'shippingCouponDiscount',component.shipping_coupon_discount,'totalFee',component.total_fee$new$]
];
begin
 if (select md5(prosrc) from pg_proc where oid='private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure)
  is distinct from '7df3b2daa49bb0ff9e984fd52d8c005d' then raise exception 'coupon_fulfillment_retention_source_changed';end if;
 definition:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 foreach pair slice 1 in array replacements loop
  if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then raise exception 'coupon_fulfillment_retention_anchor_changed';end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 execute definition;
end $patch$;
revoke all on function private.snapshot_account_deletion_legal_records(uuid,uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
commit;
