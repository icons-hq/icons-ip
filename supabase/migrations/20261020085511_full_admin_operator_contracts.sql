-- Reconciled: retain the registered capability/ACL boundaries after the reviewed
-- fulfillment, contact, production, marketing and coupon implementations.
-- Every refreshed body is bound to the exact forward-migration source hash.
begin;
create or replace function public.get_my_marketing_test_receipt(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('id',r.id,'registeredAt',r.registered_at,'content',r.content,'coupon',private.marketing_coupon_document(r.content->>'couponCode'),
  'goodIds',coalesce((select jsonb_agg(g.id order by choice.position) from jsonb_array_elements_text(r.content->'goodIds') with ordinality choice(id,position)
   join public.goods g on g.id=choice.id join public.ips i on i.id=g.ip_id where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null),'[]'))
  from private.marketing_test_receipts r where r.id=p_receipt_id and r.actor_id=auth.uid());
end $$;
revoke all on function public.get_my_marketing_test_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_marketing_test_receipt(uuid) to authenticated;
select private.register_operator_rpc_contract('public.get_my_marketing_test_receipt(uuid)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.can_upload_digital_asset(text)'::regprocedure,'catalog.manage','mixed',false);
select private.register_operator_policy_contract('storage.objects'::regclass,'goods_digital_private_insert','catalog.manage');
do $$declare entry record;current_body text;begin
 for entry in select * from (values
  ('public.admin_complete_shipments(uuid[])','sales.manage','write',false,'e12dfacc65c15b0aaa9af8848ca8fc26'),
  ('public.admin_import_shipment_tracking(text,text,text)','sales.manage','write',false,'7654097a080ff0aaee86e5564be8415c'),
  ('public.admin_import_shipment_tracking_batch(jsonb)','sales.manage','write',false,'7c3be9732988ed8ff75ac274be43f1b2'),
  ('public.admin_import_warehouse_tracking_batch(uuid,jsonb)','sales.manage','write',false,'8b6ded6fb92f20e237dc890c91c6aefc'),
  ('public.admin_mark_shipments_exported(jsonb)','sales.manage','write',false,'02071e4d50c088681bb361406941754f'),
  ('public.admin_read_shipment_delivery(uuid)','sales.manage','read',false,'817a7c2dbc643c50227d69fa6ab6d618'),
  ('public.admin_record_order_claim_reshipment_delivery(uuid,text)','sales.manage','write',false,'6fd5cf711743b5214becbe0d38879710'),
  ('public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)','sales.manage','write',false,'0be3d60fab0e5fa346f4cb2722c75bec'),
  ('public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','platform.manage','write',true,'535beab002d35b1bcc457ff233e66241'),
  ('public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamp with time zone,uuid)','sales.manage','write',false,'a7b2e40184386633294dbab5cb0defc7'),
  ('public.admin_update_order_status(uuid,public.order_status,text,text)','sales.manage','write',false,'52a944d074f6299931e844565cca96ff'),
  ('public.admin_update_order_tracking(uuid,text,text)','sales.manage','write',false,'62528a49d97cb4567689f0c15252cc28'),
  ('public.admin_update_shipment_status(uuid,text,text,text)','sales.manage','write',false,'bf141211ab8c34ddc80a02dc34cf4fdd'),
  ('public.admin_update_shipment_tracking(uuid,text,text)','sales.manage','write',false,'5f5005e43ba51acc571109b8a1ba3939'),
  ('public.admin_upsert_coupon_scheduled(jsonb)','marketing.manage','write',false,'4e60cc9bbabcfa8388a192a2e149f6da'),
  ('public.order_claim_eligibility(uuid)','sales.read','mixed',false,'6095ee44e1ca8b8e8a02d4fa5103bef7'),
  ('public.service_change_order_claim_contact(uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,jsonb,text,text,boolean)','sales.manage','service_start',false,'9d60874590941c7dea618b3a4ec406b7'),
  ('public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)','sales.manage','manual',false,'583e67e95cee8e88b156ae6e4d403045'),
  ('public.admin_get_coupon_combination_policy()','marketing.manage','read',false,'f347166f467eb0eec4efc42dc4814d3e')) contracts(signature,capability,guard_kind,legacy_admin_only,body_md5) loop
  select md5(prosrc) into current_body from pg_proc where oid=to_regprocedure(entry.signature);
  if current_body is distinct from entry.body_md5 then raise exception 'Operator contract source changed: %',entry.signature;end if;
  perform private.register_operator_rpc_contract(entry.signature::regprocedure,entry.capability,entry.guard_kind,entry.legacy_admin_only);
 end loop;
 for entry in select * from (values
  ('private.goods_photo_references(text)','d049f8fcada25cef8c5288efcc154ce4'),
  ('public.admin_complete_shipments(uuid[])','e12dfacc65c15b0aaa9af8848ca8fc26'),
  ('public.admin_import_shipment_tracking(text,text,text)','7654097a080ff0aaee86e5564be8415c'),
  ('public.admin_import_shipment_tracking_batch(jsonb)','7c3be9732988ed8ff75ac274be43f1b2'),
  ('public.admin_import_warehouse_tracking_batch(uuid,jsonb)','8b6ded6fb92f20e237dc890c91c6aefc'),
  ('public.admin_mark_shipments_exported(jsonb)','02071e4d50c088681bb361406941754f'),
  ('public.admin_read_shipment_delivery(uuid)','817a7c2dbc643c50227d69fa6ab6d618'),
  ('public.admin_record_order_claim_reshipment_delivery(uuid,text)','6fd5cf711743b5214becbe0d38879710'),
  ('public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)','0be3d60fab0e5fa346f4cb2722c75bec'),
  ('public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','535beab002d35b1bcc457ff233e66241'),
  ('public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamp with time zone,uuid)','a7b2e40184386633294dbab5cb0defc7'),
  ('public.admin_update_order_status(uuid,public.order_status,text,text)','52a944d074f6299931e844565cca96ff'),
  ('public.admin_update_order_tracking(uuid,text,text)','62528a49d97cb4567689f0c15252cc28'),
  ('public.admin_update_shipment_status(uuid,text,text,text)','bf141211ab8c34ddc80a02dc34cf4fdd'),
  ('public.admin_update_shipment_tracking(uuid,text,text)','5f5005e43ba51acc571109b8a1ba3939'),
  ('public.admin_upsert_coupon_scheduled(jsonb)','4e60cc9bbabcfa8388a192a2e149f6da'),
  ('public.order_claim_eligibility(uuid)','6095ee44e1ca8b8e8a02d4fa5103bef7'),
  ('private.normalize_customer_segment_rule(jsonb)','4b72127dc182b5de3784ad30315a1c68'),
  ('private.customer_segment_group(text)','c4be6b5d9077e48881e1f0d7db420f19'),
  ('private.customer_segment_references_available(jsonb)','8b9fa234315ea29ec22a29c7ef06b73c'),
  ('private.customer_segment_members(jsonb,timestamp with time zone)','4ce93eb0b668d4e61be61ddbd0258f21'),
  ('private.normalize_marketing_content(jsonb)','f65f9796c732ad9905e05b98c694f8a3'),
  ('private.marketing_content_available(jsonb)','199ee3c840ca1176f3fcefe77681cb74'),
  ('private.marketing_campaign_document(uuid)','d397a0957f97a2fd453053c13c964379'),
  ('public.get_my_marketing_message(uuid)','d9cdd37ce350562844458d330f0ef8ea'),
  ('private.capture_review_event_entry()','b11c9524472c3db2e726d509dd98b237'),
  ('public.get_review_event_disclosures(uuid[])','774126bece54092b17d3e30cd638da50'),
  ('private.order_claim_withdrawal_blocker(public.order_cancellation_requests)','f5da7666cfd8b4cb323511bcf0a8f50f'),
  ('private.decide_order_claim(uuid,text,text)','547f95c766ba7294e639938377a8e747'),
  ('private.collect_settled_export_for_search(date,date,text,text,text)','c97f17f15d316b63410bc5d472de933d'),
  ('private.normalize_goods_transaction_address(jsonb)','e666e5e9f72267697840dc3a10674fca'),
  ('private.normalize_goods_transaction_choices(jsonb,jsonb)','3bbca5f7260a917ad99f5da01a5ce331'),
  ('private.reserve_order_store_credits_explicit(uuid,uuid,bigint,bigint,bigint,bigint,timestamp with time zone)','f152a0c8704301daf95e9c4057f07293'),
  ('private.place_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,uuid,public.order_payment_method)','e15fca1b1e2547ea3b393bf8f8b58be3'),
  ('private.goods_transaction_snapshot_matches(uuid,bigint,bigint)','c5bede403cb45f4e59a1ced545d2688f'),
  ('public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method)','4c18250e51a2da292b26bdb25b7a2334'),
  ('private.goods_transaction_public_shipping(text,jsonb)','d1de7bd51abe0aa4124e525e17168c7d'),
  ('private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)','2cdc2044c06234320750ea0c412c3d95'),
  ('private.gift_claim_context(uuid,uuid)','901ca40a78837e9592ceb00cd35f8dc7'),
  ('private.collect_settled_export(date,date,text)','1d7a7197c98637f31fd32230bb1636e1'),
  ('private.collect_settled_export_for_date(date,date,text,text)','658fd93851ea96dab3086306abbd4167'),
  ('private.snapshot_account_deletion_legal_records(uuid,uuid)','7df3b2daa49bb0ff9e984fd52d8c005d'),
  ('private.account_deletion_blockers(uuid)','b43e3638d331f761babadbb7fe167edc'),
  ('private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)','0e64b1bf94428c808957a5f04b0ddc50'),
  ('private.record_group_claim_reshipment(uuid,text,text,jsonb)','ab6b5d7729f60e6ab8fb2ff86839bd0e'),
  ('private.contact_blocker(public.order_cancellation_requests,text,text)','c8f51048fe7b01c6b49e02f16a3ed3c5'),
  ('public.service_change_order_claim_contact(uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,jsonb,text,text,boolean)','9d60874590941c7dea618b3a4ec406b7'),
  ('private.record_order_claim_reshipment_physical(uuid,text,text,jsonb)','0c5e25f2f0587ec840a2ebccff4f6601'),
  ('private.shipping_charge_group_display(jsonb)','735d22d44779bcdda2ca802aeaae8599'),
  ('private.claim_fee_document(uuid,uuid,boolean)','12132bd6ef900b0dea19d1b2ded5a4d2'),
  ('private.shipment_pack_ready(uuid)','cea2ae7f25c12e5e70ff7d6c9d4f5073'),
  ('private.change_packed_shipments(uuid,text,text,text,boolean)','d9c28dd863481789d588f7e76f9f48b4'),
  ('public.admin_get_shipment_packs(uuid[])','c3adc6d99fc9321d3d55cdcf8221a298'),
  ('public.admin_shipment_pack_summaries(uuid[])','a769a75ff4bcd03a23e6766c4b4bb733'),
  ('public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)','583e67e95cee8e88b156ae6e4d403045'),
  ('public.admin_get_coupon_combination_policy()','f347166f467eb0eec4efc42dc4814d3e'),
  ('private.marketing_coupon_document(text)','60e97f3d79b94aa64a0612dbc0e08f67')) contracts(signature,body_md5) loop
  select md5(prosrc) into current_body from pg_proc where oid=to_regprocedure(entry.signature);
  if current_body is distinct from entry.body_md5 then raise exception 'Operator internal source changed: %',entry.signature;end if;
  perform private.register_operator_internal_contract(entry.signature::regprocedure);
 end loop;
end $$;
commit;
