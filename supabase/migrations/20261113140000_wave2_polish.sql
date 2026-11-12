-- ============================================================================
-- 원장 재작업 웨이브 2 T22i '기능 다듬기 묶음'의 DB 조각
--
--  1. 장바구니 주문의 다시 결제(QA1c S-D2-15): 장바구니 다시 결제 초안(service_create_checkout_retry_draft)이 원 주문을
--     retry_order_id로 기억하고, 그 초안이 이미 결제·무통장 접수·결제 확인 중 주문을 만들었으면 목록 RPC가 그 주문(retryOrderId)을
--     출처 종류와 상관없이 알린다. 화면은 [다시 결제하기] 대신 [다시 주문한 주문 보기]를 보인다. 같은 주문의 다시 결제 초안은 하나다.
--  2. 무통장 잔액 0원 뒤 전체 취소(T12b 후속·개인정보): 송금할 돈이 없으므로 클레임 환불계좌를 요구하지 않는다.
--     bank_transfer_refund_blocker의 계좌 요구에 `bank_transfer_zero_refund_payment(주문) is null`을 더하고,
--     order_claim_refund_account_blocker는 이 경우 refund_account_not_needed로 알려 고객 화면이 계좌 칸을 열지 않게 한다.
--
-- 기존 함수는 pg_get_functiondef 앵커 치환으로만 고친다(통째 재정의 금지). 앵커가 1회가 아니면 migration을 멈춘다.
-- 등록 함수(운영자 계약)를 재정의했으므로 끝에서 계약을 다시 등록한다.
-- ============================================================================
begin;

create function private.t22i_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't22i patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 장바구니 다시 결제 초안이 원 주문을 기억한다.
select private.t22i_patch_function('public.service_create_checkout_retry_draft(uuid,uuid)'::regprocedure, array[
$a$  v_draft uuid;
begin$a$,
$a$  v_draft uuid;
  v_existing private.checkout_drafts%rowtype;
begin$a$,
$a$  perform private.trim_checkout_drafts(p_user_id);
  insert into private.checkout_drafts (user_id, source, lines, expires_at)
  values (p_user_id, 'selection', v_lines, pg_catalog.clock_timestamp() + private.checkout_draft_ttl())
  returning id into v_draft;$a$,
$a$  perform private.trim_checkout_drafts(p_user_id);
  -- 같은 주문의 다시 결제 초안은 하나다(T22i). 이미 그 초안으로 결제·접수·결제 확인 중 주문을 만들었으면 다시 만들지 않는다.
  select draft.* into v_existing from private.checkout_drafts as draft
  where draft.retry_order_id = p_order_id and draft.user_id = p_user_id
  for update;
  if found then
    if v_existing.order_id is not null
      and (private.checkout_draft_order_settled(v_existing.order_id) or private.checkout_draft_order_payment_unresolved(v_existing.order_id)) then
      return null;
    end if;
    update private.checkout_drafts set retry_order_id = null where id = v_existing.id;
  end if;
  insert into private.checkout_drafts (user_id, source, lines, expires_at, retry_order_id)
  values (p_user_id, 'selection', v_lines, pg_catalog.clock_timestamp() + private.checkout_draft_ttl(), p_order_id)
  returning id into v_draft;$a$
]);

-- 목록 RPC: 이미 다시 결제한 주문(retryOrderId)을 바로구매뿐 아니라 장바구니 출처도 알린다.
select private.t22i_patch_function('public.service_list_order_retry_sources(uuid,uuid[])'::regprocedure, array[
$a$'retryOrderId', case when hold.source in ('direct_checkout', 'direct_transaction') then ($a$,
$a$'retryOrderId', ($a$,
$a$private.checkout_draft_order_payment_unresolved(draft.order_id))) end)$a$,
$a$private.checkout_draft_order_payment_unresolved(draft.order_id))))$a$
]);

-- 2. 무통장 잔액 0원 뒤 전체 취소는 환불계좌를 요구하지 않는다.
select private.t22i_patch_function('private.bank_transfer_refund_blocker(public.order_cancellation_requests,public.orders,text)'::regprocedure, array[
$a$ if not exists(select 1 from private.claim_refund_accounts where claim_id=p_claim.id and purged_at is null
  and bank_name is not null and account_number is not null and account_holder is not null) then return 'claim_refund_account_missing';end if;$a$,
$a$ if not exists(select 1 from private.claim_refund_accounts where claim_id=p_claim.id and purged_at is null
  and bank_name is not null and account_number is not null and account_holder is not null)
  and private.bank_transfer_zero_refund_payment(p_order.id) is null then return 'claim_refund_account_missing';end if;$a$
]);

select private.t22i_patch_function('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure, array[
$a$      where account.claim_id = p_claim_id
    )
  then
    raise exception using message = 'claim_refund_account_missing';$a$,
$a$      where account.claim_id = p_claim_id
    )
    and private.bank_transfer_zero_refund_payment(v_claim.order_id) is null
  then
    raise exception using message = 'claim_refund_account_missing';$a$
]);

select private.t22i_patch_function('private.order_claim_refund_account_blocker(public.order_cancellation_requests,public.orders)'::regprocedure, array[
$a$  when exists(select 1 from private.gift_intents where order_id=p_order.id) then 'refund_account_gift_order'
$a$,
$a$  when exists(select 1 from private.gift_intents where order_id=p_order.id) then 'refund_account_gift_order'
  when private.bank_transfer_zero_refund_payment(p_order.id) is not null then 'refund_account_not_needed'
$a$
]);

drop function private.t22i_patch_function(regprocedure, text[]);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.order_claim_refund_account_blocker(public.order_cancellation_requests,public.orders)'::regprocedure,
    'private.bank_transfer_refund_blocker(public.order_cancellation_requests,public.orders,text)'::regprocedure,
    'public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,
    'public.service_create_checkout_retry_draft(uuid,uuid)'::regprocedure,
    'public.service_list_order_retry_sources(uuid,uuid[])'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
