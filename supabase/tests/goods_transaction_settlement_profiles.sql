-- Continuation after a real local subscription payment and PII-only cleanup.
reset role;
select provider_order_id as statement_order,ref_id as statement_ref from public.payment_attempts where id=(:'work'::jsonb#>>'{attempt,id}')::uuid \gset
select merchant_id as statement_mid from private.billing_profiles where id='b1714000-0000-4000-8000-000000000020' \gset
select jsonb_build_object('dateType','soldDate','startDate',(clock_timestamp() at time zone 'Asia/Seoul')::date,'endDate',(clock_timestamp() at time zone 'Asia/Seoul')::date) as statement_query \gset
select jsonb_build_object('mId',:'statement_mid','paymentKey','fake_payment_subscription_tx','transactionKey','fake_approval_subscription_tx','orderId',:'statement_order',
 'currency','KRW','method','카드','amount','11000','interestFee','0','fees','[]'::jsonb,'supplyAmount','0','vat','0','payOutAmount','11000',
 'approvedAt',clock_timestamp(),'soldDate',(clock_timestamp() at time zone 'Asia/Seoul')::date,'paidOutDate',(clock_timestamp() at time zone 'Asia/Seoul')::date,'cancel',null) as statement_record \gset
select jsonb_build_object('records',jsonb_build_array(:'statement_record'::jsonb),'sourceTransactionKeys',jsonb_build_array('fake_approval_subscription_tx'),
 'sourceCount',1,'page',1,'sourceHash',repeat('a',64),'recordsHash',repeat('b',64),'terminal',true) as statement_page \gset
set local role service_role;
select public.service_create_profile_pg_settlement_import('b1714000-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000080',
 :'statement_query','test',repeat('a',64),:'statement_mid','toss_billing','b1714000-0000-4000-8000-000000000020')#>>'{job,id}' as billing_import \gset
select public.service_claim_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'billing_import',repeat('a',64))->>'claimId' as statement_claim \gset
select public.service_finish_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'billing_import',:'statement_claim',repeat('a',64),:'statement_page');
select public.service_claim_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'billing_import',repeat('a',64))->>'claimId' as statement_claim \gset
select public.service_finish_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'billing_import',:'statement_claim',repeat('a',64),:'statement_page');
reset role;
select 1/case when (select state='complete' and integration='toss_billing' and billing_profile_id='b1714000-0000-4000-8000-000000000020' from private.pg_settlement_imports where id=:'billing_import')
 and (select match_state='matched' from private.pg_settlement_records where import_id=:'billing_import')
 then 1 else 0 end as assert_billing_statement_matches_retained_immutable_binding;
select pg_temp.expect_subscription_transaction_error(format('update private.pg_settlement_imports set integration=%L,billing_profile_id=null where id=%L','toss_payment',:'billing_import'),'settlement_account_immutable');
-- Identical MID and payment identifiers still cannot turn a billing statement
-- into a legacy checkout ledger match.
set local role service_role;
select public.service_create_profile_pg_settlement_import('b1714000-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000081',
 :'statement_query','test',repeat('c',64),:'statement_mid','toss_payment',null)#>>'{job,id}' as regular_import \gset
select public.service_claim_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'regular_import',repeat('c',64))->>'claimId' as statement_claim \gset
select public.service_finish_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'regular_import',:'statement_claim',repeat('c',64),:'statement_page');
select public.service_claim_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'regular_import',repeat('c',64))->>'claimId' as statement_claim \gset
select public.service_finish_pg_settlement_import('b1714000-0000-4000-8000-000000000001',:'regular_import',:'statement_claim',repeat('c',64),:'statement_page');
reset role;
select 1/case when (select match_state='mismatch' and match_reason='integration_binding_mismatch' from private.pg_settlement_records where import_id=:'regular_import')
 then 1 else 0 end as assert_same_mid_cannot_mix_checkout_and_billing_ledger;
select id as billing_account from private.pg_settlement_accounts where integration='toss_billing' and billing_profile_id='b1714000-0000-4000-8000-000000000020' \gset
select id as regular_account from private.pg_settlement_accounts where integration='toss_payment' and mid=:'statement_mid' and mode='test' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000001',true);
select public.admin_get_pg_settlement_report(:'statement_query'::jsonb||jsonb_build_object('mode','test','account',:'billing_account')) as billing_report \gset
select 1/case when :'billing_report'::jsonb#>>'{snapshot,id}'=:'billing_import' and jsonb_array_length(:'billing_report'::jsonb->'jobs')=1
 and :'billing_report'::jsonb#>>'{snapshot,integration}'='toss_billing'
 and :'billing_report'::jsonb#>>'{totals,0,amount}'='11000'
 and public.admin_get_pg_settlement_report(:'statement_query'::jsonb||jsonb_build_object('mode','test','account',:'regular_account'))#>>'{snapshot,id}'=:'regular_import'
 and public.admin_get_pg_settlement_report(:'statement_query'::jsonb||jsonb_build_object('mode','test','account',:'billing_account','importId',:'regular_import'))->>'coverage'='uncollected'
 then 1 else 0 end as assert_account_filters_separate_history_and_explicit_snapshot;
select 1/case when :'billing_report'::jsonb#>>'{snapshot,accountId}'=:'billing_account'
 and not (:'billing_report'::jsonb->'snapshot' ?| array['mid','merchantId','profileId','billingProfileId'])
 and public.admin_list_pg_settlement_accounts()::text !~ 'merchantId|profileId|billingProfileId|billingmid'
 then 1 else 0 end as assert_browser_payload_uses_only_opaque_account_identity;
reset role;
select 1/case when not has_function_privilege('authenticated','public.service_create_profile_pg_settlement_import(uuid,uuid,jsonb,text,text,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_get_pg_settlement_account(uuid)','execute')
 and not has_function_privilege('authenticated','public.service_find_regular_pg_settlement_account(text,text)','execute')
 and not has_function_privilege('service_role','private.pg_settlement_match_account(jsonb,private.pg_settlement_imports)','execute')
 and (select amount=11000 and status='paid' from public.payments where ref_id=:'statement_ref')
 then 1 else 0 end as assert_statement_read_only_payment_and_acl;
