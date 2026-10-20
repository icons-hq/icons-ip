-- Reviewed integration of the existing phase-one fence and legal-snapshot lifecycle.
-- No auth deletion, payment-attempt anonymization or automatic card revocation.
create function private.goods_transaction_account_blockers(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.gift_account_deletion_blockers(p_actor)
  ||coalesce((select jsonb_agg(jsonb_build_object('code',reason,'count',1,'path','/my/subscriptions') order by reason)
    from jsonb_array_elements_text(private.goods_subscription_account_blockers(p_actor)) reason),'[]')
  ||case when exists(select 1 from private.shipping_collect_obligations obligation join public.orders purchase on purchase.id=obligation.order_id
     where purchase.user_id=p_actor and obligation.state in('planned','refund_review','mismatch'))
    then jsonb_build_array(jsonb_build_object('code','active_shipping_collect','count',(select count(*) from private.shipping_collect_obligations obligation
     join public.orders purchase on purchase.id=obligation.order_id where purchase.user_id=p_actor and obligation.state in('planned','refund_review','mismatch')),'path','/orders')) else '[]'::jsonb end;
$$;
revoke all on function private.goods_transaction_account_blockers(uuid) from public,anon,authenticated,service_role;
grant execute on function private.goods_transaction_account_blockers(uuid) to postgres;
select private.register_operator_internal_contract('private.goods_transaction_account_blockers(uuid)'::regprocedure);

do $$declare definition text;anchor text:=$anchor$'[]'::jsonb
  )
  from blocker_counts as blocker;$anchor$;begin
 definition:=pg_get_functiondef('private.account_deletion_blockers(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'account_transaction_blocker_anchor_changed';end if;
 execute replace(definition,anchor,$replacement$'[]'::jsonb
  ) || private.goods_transaction_account_blockers(p_user_id)
  from blocker_counts as blocker;$replacement$);
end $$;

alter table private.account_deletion_legal_snapshots drop constraint account_deletion_legal_snapshots_record_type_check;
alter table private.account_deletion_legal_snapshots add constraint account_deletion_legal_snapshots_record_type_check check(record_type in
 ('order','order_cancellation','shipment','payment','refund','ticket_order','ticket_cancellation','ticket_check_in','subscription_contract'));

create function private.snapshot_goods_subscription_contracts(p_deletion_event_id uuid,p_actor uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 insert into private.account_deletion_legal_snapshots(deletion_event_id,record_type,record_ref,snapshot_data,legal_basis,retain_until)
 select p_deletion_event_id,'subscription_contract',contract->>'id',contract,'ecommerce_transaction_v1',last_event.at+interval '5 years'
 from jsonb_array_elements(private.goods_subscription_account_retention(p_actor)->'subscriptions') contract
 cross join lateral(select greatest((contract->>'createdAt')::timestamptz,(contract->>'consentedAt')::timestamptz,(contract->>'canceledAt')::timestamptz,
   (select max((cycle->>'settledAt')::timestamptz) from jsonb_array_elements(contract->'cycles') cycle)) at) last_event
 where last_event.at+interval '5 years'>clock_timestamp()
 on conflict(deletion_event_id,record_type,record_ref) do update set snapshot_data=excluded.snapshot_data,
  retain_until=greatest(private.account_deletion_legal_snapshots.retain_until,excluded.retain_until)
 where private.account_deletion_legal_snapshots.destroyed_at is null;
end $$;
revoke all on function private.snapshot_goods_subscription_contracts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.snapshot_goods_subscription_contracts(uuid,uuid) to postgres;
select private.register_operator_internal_contract('private.snapshot_goods_subscription_contracts(uuid,uuid)'::regprocedure);

do $patch$
declare definition text;pair text[];replacements text[][]:=array[
 array[$old$'shippingFee', order_record.shipping_fee,$old$,$new$'shippingFee', order_record.shipping_fee,
      'calculationVersion',order_record.calculation_version,'volumeDiscount',order_record.volume_discount_total,
      'couponDiscount',order_record.discount_total,'storeCredits',order_record.store_credit_total,'shippingCollectTotal',order_record.shipping_collect_total,
      'shippingCharges',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentRef',component.shipment_id,'mode',component.payment_mode,
       'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee) order by component.id)
       from private.shipping_charge_components component where component.order_id=order_record.id),'[]'),
      'shippingCollect',coalesce((select jsonb_agg(jsonb_build_object('shipmentRef',obligation.shipment_id,'amount',obligation.amount,'state',obligation.state,
       'events',coalesce((select jsonb_agg(jsonb_build_object('operationId',e.operation_id,'event',e.event,'amount',e.amount,'recordedAt',e.created_at,
        'occurredAt',e.evidence->'occurredAt','reversesOperationId',e.evidence->'reversesOperationId') order by coalesce(e.previous_revision,0),e.created_at,e.operation_id)
        from private.shipping_collect_events e where e.shipment_id=obligation.shipment_id),'[]')) order by obligation.shipment_id)
       from private.shipping_collect_obligations obligation where obligation.order_id=order_record.id),'[]'),$new$],
 array[$old$'unitPrice', item.unit_price$old$,$new$'unitPrice', item.unit_price,
              'allocation',(select jsonb_build_object('calculationVersion',a.calculation_version,'subtotal',a.subtotal,'volumeDiscount',a.volume_discount,
               'netSubtotal',a.net_subtotal,'couponDiscount',a.coupon_discount,'storeCreditDiscount',a.store_credit_discount,'paidGoodsTotal',a.paid_goods_total)
               from private.order_price_allocations a where a.order_item_id=item.id and a.order_id=order_record.id)$new$],
 array[$old$'ledgerRecordedAt', payment.created_at,$old$,$new$'ledgerRecordedAt', payment.created_at,
      'integrationBinding',(select jsonb_build_object('integration',binding.integration,'profileId',binding.profile_id,'merchantId',binding.merchant_id,
       'environment',binding.environment,'writeKeyVersion',binding.write_key_version,'firstDispatchedAt',binding.first_dispatched_at)
       from public.payment_attempts attempt join private.payment_provider_bindings binding on binding.attempt_id=attempt.id where attempt.payment_id=payment.id),$new$]
];
begin
 definition:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 foreach pair slice 1 in array replacements loop
  if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then raise exception 'account_transaction_snapshot_anchor_changed %',pair[1];end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 if position(E'begin\n' in definition)=0 then raise exception 'account_transaction_snapshot_begin_changed';end if;
 definition:=replace(definition,E'begin\n',E'begin\n  perform private.snapshot_goods_subscription_contracts(p_deletion_event_id,p_user_id);\n');
 execute definition;
end $patch$;

-- Called only after request_my_account_deletion committed its account fence.
-- This transaction starts with the common actor lock, never account -> actor.
create function public.service_cleanup_fenced_goods_transactions(p_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare event_id uuid;blocked jsonb;removed integer;begin
 if p_actor is null then raise invalid_parameter_value using message='invalid_account_cleanup';end if;
 perform private.subscription_lock_actor(p_actor,false);
 select deletion_event_id into event_id from private.account_deletion_requests where subject_user_id=p_actor for update;
 if not found or not private.is_account_write_fenced(p_actor) then return jsonb_build_object('state','not_fenced');end if;
 perform private.snapshot_goods_subscription_contracts(event_id,p_actor);
 delete from private.goods_transaction_quotes where actor_id=p_actor;
 get diagnostics removed=row_count;
 blocked:=private.goods_subscription_account_blockers(p_actor);
 if blocked='[]'::jsonb then perform private.purge_goods_subscription_account_data(p_actor);end if;
 return jsonb_build_object('state',case when blocked='[]'::jsonb then 'cleaned' else 'deferred' end,'quotesRemoved',removed);
end $$;
revoke all on function public.service_cleanup_fenced_goods_transactions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_cleanup_fenced_goods_transactions(uuid) to service_role;
select private.register_operator_internal_contract('public.service_cleanup_fenced_goods_transactions(uuid)'::regprocedure);

create function public.service_list_fenced_goods_transaction_cleanup_candidates(p_limit integer default 100) returns uuid[]
language plpgsql stable security definer set search_path='' as $$begin
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='invalid_account_cleanup_limit';end if;
 return array(select f.subject_user_id from private.account_action_fences f where
  exists(select 1 from private.goods_transaction_quotes where actor_id=f.subject_user_id)
  or (private.goods_subscription_account_blockers(f.subject_user_id)='[]'::jsonb and (
   exists(select 1 from private.goods_subscription_plans where owner_id=f.subject_user_id)
   or exists(select 1 from private.billing_customers where user_id=f.subject_user_id))) order by f.subject_user_id limit p_limit);
end $$;
revoke all on function public.service_list_fenced_goods_transaction_cleanup_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.service_list_fenced_goods_transaction_cleanup_candidates(integer) to service_role;
select private.register_operator_internal_contract('public.service_list_fenced_goods_transaction_cleanup_candidates(integer)'::regprocedure);
notify pgrst,'reload schema';
