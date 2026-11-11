-- 10/7 회의 1007-047·048: 취소·반품·교환의 '환불 송금 대기' 목록에도 엑셀 다운로드를 둔다.
-- 2026-11-11 사용자 결정 "계좌 포함 + 비밀번호 엑셀": 송금에 쓸 환불 계좌(은행·계좌번호·예금주)를 함께 싣는다.
-- 파일은 다른 목록 엑셀과 같은 서버 경로(비밀번호 검사 → 목록 조회 → 계좌 열람 → 암호화 → 발급 감사 기록)에서만 만든다.
--
-- 1) public.service_export_bank_transfer_refund_accounts(새, service_role 전용): 서버가 비밀번호를 확인한 뒤, 검증한 운영자·세션을
--    증명해 부른다. 브라우저 세션은 이 함수를 직접 부를 수 없다 — 계좌를 여러 건 한꺼번에 받는 길은 비밀번호를 건 엑셀뿐이다.
--    목록에서 읽은 요청(요청·주문·리비전)마다 요청 상세의 계좌 열람(admin_view_bank_transfer_refund_account)과 같은 판정·잠금·기록을 한다:
--    주문 처리 권한(권한 전환 전 관리자 전용)·살아 있는 세션, 운영자·결제자·수령인 계정 울타리 → 주문·배송·요청·결제·환불 행 잠금(정렬 순서),
--    'view_account' 판정. 계좌를 내준 요청마다 열람 기록(private.bank_transfer_refund_account_views)과 주문 감사 기록
--    (admin.order.bank_refund_account_viewed, 목적 list_export·exportId)을 남기고, 한 번의 내려받기에 요약 감사 기록 하나(id=exportId)를 남긴다.
--    같은 exportId로 다시 부르면 요약 기록이 겹쳐 실패한다(평문을 다시 돌려주지 않는다).
--    요청이 목록을 읽은 뒤 바뀌었으면(리비전·송금 대기 상태) PT409로 아무것도 돌려주지 않는다. 환불 접수 전(계좌 송금 접수 기록 전·계좌 미등록)인
--    요청은 'not_filed', 그 밖의 이유로 요청 상세에서도 열람할 수 없는 요청은 'unavailable'로 돌려 그 줄만 계좌 칸을 비운다.
-- 2) public.service_record_encrypted_list_export: 'refund-transfers' 화면을 받는다. 권한은 화면과 같이 주문 처리 + 권한 전환 전 관리자 전용이다.
--    발급 기록의 조건에 accountExportId가 있으면 같은 운영자의 계좌 열람 요약 기록이어야 한다(다른 화면은 이 키를 쓰지 못한다).
--    다른 트랙이 같은 함수를 고칠 수 있어 원문 복사 대신 앵커 치환으로 필요한 줄만 바꾼다.
begin;

create function public.service_export_bank_transfer_refund_accounts(
 p_actor_id uuid,p_session_id uuid,p_export_id uuid,p_claims jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 actor uuid:=p_actor_id; target record; purchase public.orders; claim public.order_cancellation_requests;
 lifecycle private.bank_transfer_claim_refunds; account private.claim_refund_accounts; blocker text; view_id uuid;
 happened timestamptz; results jsonb[]:='{}'; revealed integer:=0; order_ids uuid[]; claim_ids uuid[];
begin
 if actor is null or p_session_id is null or p_export_id is null or jsonb_typeof(p_claims) is distinct from 'array'
  or jsonb_array_length(p_claims)>10000
  or exists(select 1 from jsonb_array_elements(p_claims) item where jsonb_typeof(item) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(item) item_key where item_key not in('claimId','orderId','revision'))
   or jsonb_typeof(item->'claimId') is distinct from 'string' or jsonb_typeof(item->'orderId') is distinct from 'string'
   or jsonb_typeof(item->'revision') is distinct from 'number'
   or item->>'claimId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or item->>'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or item->>'revision' !~ '^[0-9]{1,9}$') then
  raise invalid_parameter_value using message='invalid_bank_refund_export';
 end if;
 select coalesce(array_agg(distinct (item->>'orderId')::uuid),'{}'),coalesce(array_agg(distinct (item->>'claimId')::uuid),'{}')
  into order_ids,claim_ids from jsonb_array_elements(p_claims) item;
 -- 한 주문에는 송금 대기 무통장 환불이 하나뿐이다(private.bank_transfer_claim_refunds.order_id 고유).
 if cardinality(order_ids)<>jsonb_array_length(p_claims) or cardinality(claim_ids)<>jsonb_array_length(p_claims) then
  raise invalid_parameter_value using message='invalid_bank_refund_export';
 end if;

 -- 서버가 확인한 운영자 세션이 지금도 살아 있어야 한다(require_claim_refund_account_identity와 같은 규칙, 서버 증명이라 JWT 대신 인자로 받는다).
 if not exists(select 1 from auth.sessions where id=p_session_id and user_id=actor and (not_after is null or not_after>statement_timestamp()))
  or not exists(select 1 from public.profiles where id=actor) then
  raise insufficient_privilege using message='refund_account_auth_changed';
 end if;
 if not private.has_operator_capability(actor,'sales.manage',true) then
  raise insufficient_privilege using message='bank_refund_permission_required';
 end if;
 -- 요청 상세 열람(lock_bank_transfer_refund_identity)과 같은 순서: 운영자·결제자·수령인 계정 울타리 → 권한 재확인 → 세션 행.
 perform private.lock_operator_subjects(array[actor]||coalesce((select array_agg(subject) from (
   select purchase_row.user_id subject from public.orders purchase_row where purchase_row.id=any(order_ids)
   union select gift.recipient_id from private.gift_intents gift where gift.order_id=any(order_ids)) subjects where subject is not null),'{}'));
 perform private.require_actor_operator_capability(actor,'sales.manage',true);
 perform id from auth.sessions where id=p_session_id and user_id=actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='refund_account_auth_changed'; end if;
 -- 행 잠금은 다른 쓰기와 같은 주문 → 배송 → 요청 → 결제 → 환불 → 계좌 순서이고, 각 단계 안에서는 id 순서다.
 perform purchase_row.id from public.orders purchase_row where purchase_row.id=any(order_ids) order by purchase_row.id for update;
 perform shipment.id from public.order_shipments shipment where shipment.order_id=any(order_ids) order by shipment.id for update;
 perform request.id from public.order_cancellation_requests request where request.id=any(claim_ids) order by request.id for update;
 perform payment.id from public.payments payment where payment.purpose='order' and payment.ref_id=any(order_ids) order by payment.id for update;
 perform refund.id from public.refunds refund join public.payments payment on payment.id=refund.payment_id
  where payment.purpose='order' and payment.ref_id=any(order_ids) order by refund.id for update of refund;
 perform stored.claim_id from private.claim_refund_accounts stored where stored.claim_id=any(claim_ids) order by stored.claim_id for share;

 happened:=clock_timestamp();
 for target in select (item.value->>'claimId')::uuid claim_id,(item.value->>'orderId')::uuid order_id,(item.value->>'revision')::integer revision
  from jsonb_array_elements(p_claims) with ordinality item(value,ord) order by item.ord loop
  select * into purchase from public.orders where id=target.order_id;
  select * into claim from public.order_cancellation_requests where id=target.claim_id and order_id=target.order_id;
  select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=target.claim_id and order_id=target.order_id;
  if purchase.id is null or claim.id is null or claim.claim_revision<>target.revision or lifecycle.state is distinct from 'awaiting_transfer' then
   raise sqlstate 'PT409' using message='bank_refund_export_changed';
  end if;
  blocker:=private.bank_transfer_refund_blocker(claim,purchase,'view_account');
  if blocker is null then
   select * into account from private.claim_refund_accounts where claim_id=claim.id;
   view_id:=gen_random_uuid();
   -- 계좌 원문은 감사 기록에 남기지 않는다. 요청 상세 열람과 같은 열람 기록·주문 감사 기록을 요청마다 남긴다.
   insert into private.bank_transfer_refund_account_views(id,actor_id,session_id,order_id,claim_id,created_at)
   values(view_id,actor,p_session_id,purchase.id,claim.id,happened);
   insert into public.audit_log(id,actor_id,action,target,diff) values(view_id,actor,'admin.order.bank_refund_account_viewed','order:'||purchase.id,
    jsonb_build_object('claimId',claim.id,'purpose','list_export','revision',claim.claim_revision,'exportId',p_export_id));
   revealed:=revealed+1;
   results:=array_append(results,jsonb_build_object('claimId',claim.id,'status','revealed',
    'bankName',account.bank_name,'accountNumber',account.account_number,'accountHolder',account.account_holder));
  else
   results:=array_append(results,jsonb_build_object('claimId',claim.id,
    'status',case when blocker in('bank_refund_filing_required','claim_refund_account_missing') then 'not_filed' else 'unavailable' end,
    'bankName',null,'accountNumber',null,'accountHolder',null));
  end if;
 end loop;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_export_id,actor,'admin.list_export.bank_refund_accounts_revealed',
  'admin_screen:refund-transfers',jsonb_build_object('claimCount',jsonb_array_length(p_claims),'revealedCount',revealed));
 return jsonb_build_object('exportId',p_export_id,'rows',to_jsonb(results));
end $$;
revoke all on function public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb) to service_role;
select private.register_operator_rpc_contract('public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)'::regprocedure,'sales.manage','service_start',true);

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text)'::regprocedure);
 -- 환불 송금 대기 화면은 주문 처리 권한 + 권한 전환 전 관리자 전용이다(화면 게이트와 같다).
 anchor:=$old$ perform private.require_actor_operator_capability(actor,case when p_screen='orders' then 'sales.read' else 'sales.manage' end,false);$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'list_export_audit_capability_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$ perform private.require_actor_operator_capability(actor,case when p_screen='orders' then 'sales.read' else 'sales.manage' end,coalesce(p_screen='refund-transfers',false));$new$);
 anchor:=$old$'claims-cancels','claims-returns','claims-exchanges') then$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'list_export_audit_screen_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$'claims-cancels','claims-returns','claims-exchanges','refund-transfers') then$new$);
 anchor:=$old$'tab','originId','method','delayNotice','stage','reasonType')$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'list_export_audit_filter_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$'tab','originId','method','delayNotice','stage','reasonType','accountExportId')$new$);
 anchor:=$old$ if p_row_count is null or p_row_count not between 0 and 10000$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'list_export_audit_count_anchor_changed'; end if;
 execute replace(definition,anchor,$new$ -- 계좌를 실은 환불 송금 대기 파일은 같은 운영자의 계좌 열람 요약 기록(service_export_bank_transfer_refund_accounts)을 가리킨다.
 if p_filters ? 'accountExportId' and (p_screen<>'refund-transfers' or not exists(select 1 from public.audit_log revealed
   where revealed.id=case when p_filters->>'accountExportId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then (p_filters->>'accountExportId')::uuid end
    and revealed.actor_id=actor and revealed.action='admin.list_export.bank_refund_accounts_revealed')) then
  raise invalid_parameter_value using message='invalid_list_export_filters';end if;
 if p_row_count is null or p_row_count not between 0 and 10000$new$);
end $patch$;

do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY['public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text)'] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true; end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if not registered then raise exception 'operational_rpc_contract_missing: %',signature; end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
