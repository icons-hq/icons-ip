-- Continuation of the approved, not-yet-canceled transaction fixture.
reset role;
update private.account_deletion_control set transaction_lookup_hmac_ready=true,legacy_transaction_evidence_ready=true,
 immutable_ticket_contract_ready=true,community_legal_records_ready=true,phase_one_enabled=true;
insert into auth.sessions(id,user_id,created_at,updated_at)
 values('bb140000-0000-4000-8000-000000000090','bb140000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims','{"sub":"bb140000-0000-4000-8000-000000000002","role":"authenticated","session_id":"bb140000-0000-4000-8000-000000000090"}',true);
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다','bb140000-0000-4000-8000-000000000091') as deletion_status \gset
select 1/case when :'deletion_status'::jsonb->>'status'='blocked'
 and exists(select 1 from jsonb_array_elements(:'deletion_status'::jsonb->'blockers') b where b->>'code'='active_shipping_collect' and b->>'path'='/orders')
 then 1 else 0 end as assert_account_cod_obligation_not_inferred_settled;
reset role;
select 1/case when exists(select 1 from private.account_deletion_legal_snapshots s join private.account_deletion_requests r on r.deletion_event_id=s.deletion_event_id
 where r.subject_user_id='bb140000-0000-4000-8000-000000000002' and s.record_type='order' and s.record_ref=:'order_id'
  and s.snapshot_data->>'volumeDiscount'='3000' and s.snapshot_data->>'shippingCollectTotal'='2250'
  and s.snapshot_data->>'couponDiscount'='2100' and s.snapshot_data->>'storeCredits'='2000'
  and (select sum((item#>>'{allocation,volumeDiscount}')::bigint)=3000 from jsonb_array_elements(s.snapshot_data->'items') item)
  and s.snapshot_data::text!~'(recipient|phone|address1|envelope|TEST 수취인|010000)')
 then 1 else 0 end as assert_account_financial_retention_has_v_d_allocations_no_address;
set local role service_role;
select public.service_cleanup_fenced_goods_transactions('bb140000-0000-4000-8000-000000000002') as cleanup \gset
select 1/case when :'cleanup'::jsonb->>'state'='cleaned' and (:'cleanup'::jsonb->>'quotesRemoved')::int>0 then 1 else 0 end as assert_fenced_quote_pii_removed_after_fence_transaction;
reset role;
select 1/case when not exists(select 1 from private.goods_transaction_quotes where actor_id='bb140000-0000-4000-8000-000000000002')
 and exists(select 1 from private.order_goods_transactions where order_id=:'order_id')
 and exists(select 1 from public.payment_attempts where ref_id=:'order_id' and state='approved')
 and exists(select 1 from auth.users where id='bb140000-0000-4000-8000-000000000002')
 and not has_function_privilege('authenticated','public.service_cleanup_fenced_goods_transactions(uuid)','execute')
 and not has_function_privilege('service_role','private.goods_transaction_account_blockers(uuid)','execute')
 then 1 else 0 end as assert_phase_one_keeps_auth_financial_receipt_and_acl;
rollback;
