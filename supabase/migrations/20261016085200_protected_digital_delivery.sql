-- No durable bearer download URLs. Every transfer is re-authorized
-- against the purchased file set and current approved-payment/claim state.
begin;
create function private.digital_download_context(p_actor uuid,p_session uuid,p_item uuid,p_asset uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase public.orders;item public.order_items;asset private.goods_digital_assets;begin
 select * into item from public.order_items where id=p_item;
 if not found or p_actor is null or p_session is null then raise no_data_found;end if;
 perform private.gift_lock_subjects(array[p_actor]);perform private.assert_active_user(p_actor);
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
 select * into purchase from public.orders where id=item.order_id for update;
 if not found or purchase.user_id<>p_actor or purchase.status not in('paid','confirmed','shipping','delivered','done')
  or item.fulfillment_terms_snapshot->>'mode' is distinct from 'digital' or not private.production_payment_valid(purchase.id)
  or exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and stage not in('completed','rejected','withdrawn'))
  or exists(select 1 from public.order_cancellation_claims where order_id=purchase.id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=purchase.id and r.status in('requested','processing','done'))
  or not(item.fulfillment_terms_snapshot->'files' @> jsonb_build_array(jsonb_build_object('id',p_asset))) then raise check_violation using message='digital_access_unavailable';end if;
 if (select count(*) from private.order_digital_downloads where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise sqlstate 'PT429' using message='digital_download_rate_limited';end if;
 perform id from public.order_shipments where order_id=purchase.id order by id for update;
 select * into asset from private.goods_digital_assets where id=p_asset and state='verified';
 if not found then raise check_violation using message='digital_asset_unavailable';end if;
 return jsonb_build_object('orderId',purchase.id,'itemId',item.id,'assetId',asset.id,'name',asset.filename,'mimeType',asset.mime_type,'size',asset.size_bytes,'sha256',asset.sha256,'path',asset.path);
end $$;
create function public.service_get_digital_download_info(p_actor uuid,p_session uuid,p_item uuid,p_asset uuid) returns jsonb language sql security definer set search_path='' as $$
 select private.digital_download_context(p_actor,p_session,p_item,p_asset);
$$;
create function public.service_record_digital_download(p_actor uuid,p_session uuid,p_item uuid,p_asset uuid,p_operation uuid,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;prior private.order_digital_downloads;shipment public.order_shipments;at_value timestamptz;begin
 if p_operation is null or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' then raise invalid_parameter_value;end if;
 context:=private.digital_download_context(p_actor,p_session,p_item,p_asset);
 if context->>'sha256'<>p_sha256 then raise check_violation using message='digital_content_changed';end if;
 select * into prior from private.order_digital_downloads where id=p_operation;
 if found then
  if prior.actor_id is distinct from p_actor or prior.session_id<>p_session or prior.order_item_id<>p_item or prior.asset_id<>p_asset or prior.sha256<>p_sha256 then raise sqlstate 'PT409';end if;
  return jsonb_build_object('operationId',p_operation,'itemId',p_item,'assetId',p_asset,'recordedAt',prior.created_at);
 end if;
 at_value:=clock_timestamp();
 insert into private.order_digital_downloads(id,order_id,order_item_id,asset_id,actor_id,session_id,sha256,created_at)
  values(p_operation,(context->>'orderId')::uuid,p_item,p_asset,p_actor,p_session,p_sha256,at_value);
 select s.* into shipment from public.order_shipments s join public.order_shipment_items i on i.shipment_id=s.id where i.order_item_id=p_item;
 if shipment.delivery_method<>'digital' then raise check_violation using message='digital_shipment_mismatch';end if;
 if shipment.status='ready' and not exists(select 1 from public.order_shipment_items i where i.shipment_id=shipment.id
  and not exists(select 1 from private.order_digital_downloads d where d.order_item_id=i.order_item_id and d.order_id=shipment.order_id)) then
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
   values(p_operation,shipment.id,'digital_access',p_actor,extensions.digest(context::text,'sha256'),jsonb_build_object('downloadId',p_operation,'occurredAt',at_value));
  update public.order_shipments set status='delivered',shipped_at=at_value,delivered_at=at_value,delivery_event_id=p_operation,updated_at=at_value where id=shipment.id;
 end if;
 return jsonb_build_object('operationId',p_operation,'itemId',p_item,'assetId',p_asset,'recordedAt',at_value);
end $$;
create function public.get_my_order_downloads(p_order uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;available boolean;begin
 select * into purchase from public.orders where id=p_order and user_id=auth.uid();
 if not found or private.is_account_write_fenced(auth.uid()) then raise no_data_found;end if;
 available:=purchase.status in('paid','confirmed','shipping','delivered','done') and private.production_payment_valid(p_order)
  and not exists(select 1 from public.order_cancellation_requests where order_id=p_order and stage not in('completed','rejected','withdrawn'))
  and not exists(select 1 from public.order_cancellation_claims where order_id=p_order)
  and not exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_order and r.status in('requested','processing','done'));
 return jsonb_build_object('orderId',p_order,'canCancel',private.order_cancel_eligible(p_order),'reviewRequired',exists(select 1 from private.order_digital_downloads where order_id=p_order),
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemId',i.id,'name',i.good_name_snapshot,'files',i.fulfillment_terms_snapshot->'files','available',available,
   'firstProvidedAt',(select min(created_at) from private.order_digital_downloads where order_item_id=i.id)) order by i.id)
   from public.order_items i where i.order_id=p_order and i.fulfillment_terms_snapshot->>'mode'='digital'),'[]'));
end $$;
alter function private.order_cancel_eligible(uuid) rename to order_cancel_eligible_before_digital;
revoke all on function private.order_cancel_eligible_before_digital(uuid) from public,anon,authenticated,service_role;
create function private.order_cancel_eligible(target_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.order_cancel_eligible_before_digital(target_order) or exists(select 1 from public.orders o where o.id=target_order and o.status in('paid','confirmed','shipping','delivered','done')
  and exists(select 1 from public.order_items i where i.order_id=o.id and i.fulfillment_terms_snapshot->>'mode' in('digital','no_delivery'))
  and not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.delivery_method<>'digital' and(s.status<>'ready' or s.shipped_at is not null or s.delivered_at is not null)));
$$;
do $$declare source text;anchor text:='and not exists(select 1 from private.order_production_jobs where order_id=p_order_id and claim_id is null and started_at is not null)';begin
 source:=pg_get_functiondef('private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'digital_cancel_intake_source_changed';end if;
 execute replace(source,anchor,anchor||E'\n    and not exists(select 1 from private.order_digital_downloads where order_id=p_order_id)');
end $$;
-- A digital file has no parcel to physically collect. Preserve the real
-- collections of any physical items in the same order; never invent receipts.
create or replace function private.set_claim_collection_requirement() returns trigger language plpgsql set search_path='' as $$begin
 new.collection_required:=new.claim_type in('return','exchange') and exists(select 1 from public.order_items where order_id=new.order_id and coalesce(fulfillment_terms_snapshot->>'mode','shipping')<>'digital');return new;
end $$;
do $$declare source text;begin
 source:=pg_get_functiondef('private.prepare_claim_collections(uuid,boolean)'::regprocedure);
 if strpos(source,'where s.order_id=claim.order_id')=0 then raise exception 'digital_collection_source_changed';end if;
 execute replace(source,'where s.order_id=claim.order_id','where s.order_id=claim.order_id and s.delivery_method<>''digital''');
 source:=pg_get_functiondef('private.claim_collections_complete(uuid)'::regprocedure);
 if strpos(source,'where i.order_id=c.order_id and')=0 then raise exception 'digital_collection_complete_source_changed';end if;
 execute replace(source,'where i.order_id=c.order_id and','where i.order_id=c.order_id and coalesce(i.fulfillment_terms_snapshot->>''mode'',''shipping'')<>''digital'' and');
end $$;
revoke all on function private.digital_download_context(uuid,uuid,uuid,uuid),private.order_cancel_eligible(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_my_order_downloads(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_downloads(uuid) to authenticated;
revoke all on function public.service_get_digital_download_info(uuid,uuid,uuid,uuid),public.service_record_digital_download(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_get_digital_download_info(uuid,uuid,uuid,uuid),public.service_record_digital_download(uuid,uuid,uuid,uuid,uuid,text) to service_role;
select private.register_operator_internal_contract('private.digital_download_context(uuid,uuid,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.order_cancel_eligible(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.order_cancel_eligible_before_digital(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_get_digital_download_info(uuid,uuid,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_record_digital_download(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
-- Structured supply evidence follows the existing transaction retention basis.
-- Free-text filenames, notes, private paths, uploader and session IDs are excluded.
do $$declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='private.account_deletion_legal_snapshots'::regclass and conname='account_deletion_legal_snapshots_record_type_check';
 if definition is null or position('ARRAY[' in definition)=0 then raise exception 'fulfillment_snapshot_type_changed';end if;
 alter table private.account_deletion_legal_snapshots drop constraint account_deletion_legal_snapshots_record_type_check;
 execute 'alter table private.account_deletion_legal_snapshots add constraint account_deletion_legal_snapshots_record_type_check '||replace(definition,'ARRAY[','ARRAY[''order_fulfillment''::text,');
end $$;
create function private.snapshot_order_fulfillment_contracts(p_event uuid,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$begin
 insert into private.account_deletion_legal_snapshots(deletion_event_id,record_type,record_ref,snapshot_data,legal_basis,retain_until)
 select p_event,'order_fulfillment',i.id::text,jsonb_build_object('orderRef',i.order_id,'itemRef',i.id,
  'terms',i.fulfillment_terms_snapshot-'publicNote'-'files',
  'files',coalesce((select jsonb_agg(jsonb_build_object('assetId',a.id,'mimeType',a.mime_type,'size',a.size_bytes,'sha256',a.sha256) order by a.id)
    from private.goods_digital_assets a where i.fulfillment_terms_snapshot->'files' @> jsonb_build_array(jsonb_build_object('id',a.id))),'[]'),
  'provided',coalesce((select jsonb_agg(jsonb_build_object('operationId',d.id,'assetId',d.asset_id,'at',d.created_at,'sha256',d.sha256) order by d.created_at,d.id)
    from private.order_digital_downloads d where d.order_item_id=i.id),'[]')),
  'ecommerce_transaction_v1',greatest(o.created_at,(select max(created_at) from private.order_digital_downloads where order_item_id=i.id))+interval '5 years'
 from public.order_items i join public.orders o on o.id=i.order_id where p_actor=any(private.contact_parties(i.order_id)) and i.fulfillment_terms_snapshot is not null
  and greatest(o.created_at,(select max(created_at) from private.order_digital_downloads where order_item_id=i.id))+interval '5 years'>clock_timestamp()
 on conflict(deletion_event_id,record_type,record_ref) do update set snapshot_data=excluded.snapshot_data,retain_until=greatest(private.account_deletion_legal_snapshots.retain_until,excluded.retain_until) where private.account_deletion_legal_snapshots.destroyed_at is null;
end $$;
do $$declare source text;anchor text:='perform private.snapshot_order_production_contracts(p_deletion_event_id,p_user_id);';begin
 source:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'fulfillment_retention_source_changed';end if;
 execute replace(source,anchor,anchor||E'\n perform private.snapshot_order_fulfillment_contracts(p_deletion_event_id,p_user_id);');
end $$;
revoke all on function private.snapshot_order_fulfillment_contracts(uuid,uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.snapshot_order_fulfillment_contracts(uuid,uuid)'::regprocedure);

notify pgrst,'reload schema';
commit;
