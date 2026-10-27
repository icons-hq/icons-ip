-- 10/14 회의 A3b·D7: 무통장 입금코드를 16자리 주문번호에서 만든다.
--
-- 코드 = 주문일의 10일 주기 자리 1자리 + 그날 주문 일련번호 끝 5자리 (숫자 6자리).
--   주기 자리 = (주문번호 앞 8자리 날짜 - 2000-01-01) mod 10. 연속한 10일은 서로 다르다.
-- 입금 대기는 최대 48시간(24시간 + 1회 24시간 연장)이라 동시에 열린 주문의 주문일은 연속한 3일 안이다.
-- 그 안에서 하루 주문이 10만 건을 넘지 않는 한 입금 대기 주문 사이 코드가 겹치지 않는다.
-- 숫자 6자리라 한글 4자 이름과 붙여도 은행 입금자명 14바이트(EUC-KR) 안에 들어간다.
-- TS `lib/payments/bank-transfer.ts`의 bankTransferDepositCode와 같은 규칙이다.
--
-- 함수 이름과 호출 형태(private.bank_transfer_deposit_code(uuid))는 유지한다. 옛 UUID 앞 8자리 코드를
-- 안내받은 입금 대기 주문이 있을 수 있으므로 입금 제안과 미입금 검색은 옛 코드도 받는다.
begin;

create function private.bank_transfer_legacy_deposit_code(p_order_id uuid)
returns text language sql immutable strict security invoker set search_path='' as $$
  select pg_catalog.upper(pg_catalog.left(pg_catalog.replace(p_order_id::text,'-',''),8));
$$;

create function private.bank_transfer_deposit_code_for_number(p_order_number text)
returns text language sql immutable strict security invoker set search_path='' as $$
  select case when p_order_number ~ '^[0-9]{8}1[0-9]{7}$' then
    ((pg_catalog.make_date(pg_catalog.left(p_order_number,4)::integer,pg_catalog.substr(p_order_number,5,2)::integer,
      pg_catalog.substr(p_order_number,7,2)::integer) - date '2000-01-01') % 10)::text||pg_catalog.right(p_order_number,5)
  end;
$$;

-- 번호는 주문 INSERT 트리거가 발급하므로 같은 트랜잭션의 입금 안내 알림도 새 코드를 쓴다.
-- 번호가 없는 옛 행만 옛 코드로 남긴다.
create or replace function private.bank_transfer_deposit_code(p_order_id uuid)
returns text language sql stable strict security definer set search_path='' as $$
  select coalesce(
    (select private.bank_transfer_deposit_code_for_number(o.order_number) from public.orders o where o.id=p_order_id),
    private.bank_transfer_legacy_deposit_code(p_order_id));
$$;

revoke all on function private.bank_transfer_legacy_deposit_code(uuid),private.bank_transfer_deposit_code_for_number(text),
  private.bank_transfer_deposit_code(uuid) from public,anon,authenticated,service_role;

do $patch$
declare definition text; anchor text;
begin
 -- 입금 제안: 새 코드나 옛 코드가 입금자명에 있으면 코드 일치로 본다.
 definition:=pg_get_functiondef('private.suggest_bank_deposit_order(text,bigint)'::regprocedure);
 anchor:=$old$private.bank_transfer_deposit_code(orders.id) as code,$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'deposit_suggest_code_anchor_changed'; end if;
 definition:=replace(definition,anchor,anchor||$new$
      private.bank_transfer_legacy_deposit_code(orders.id) as legacy_code,$new$);
 anchor:=$old$where position(candidate.code in normalized.name) > 0$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'deposit_suggest_match_anchor_changed'; end if;
 execute replace(definition,anchor,$new$where position(candidate.code in normalized.name) > 0
      or position(candidate.legacy_code in normalized.name) > 0$new$);

 -- 미입금 검색: 새 코드·옛 코드 모두 정확히 일치하면 찾는다.
 definition:=pg_get_functiondef('private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)'::regprocedure);
 anchor:=$old$or candidate.code = upper(v_query)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'unpaid_console_code_anchor_changed'; end if;
 execute replace(definition,anchor,$new$or candidate.code = upper(v_query)
      or private.bank_transfer_legacy_deposit_code(candidate.id) = upper(v_query)$new$);

 definition:=pg_get_functiondef('public.admin_unpaid_bank_transfer_orders(text,integer,integer)'::regprocedure);
 anchor:=$old$or candidate.code = upper(v_query)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'unpaid_code_anchor_changed'; end if;
 execute replace(definition,anchor,$new$or candidate.code = upper(v_query)
      or private.bank_transfer_legacy_deposit_code(candidate.id) = upper(v_query)$new$);
end $patch$;

do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array ARRAY[
  'private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)',
  'public.admin_unpaid_bank_transfer_orders(text,integer,integer)'
 ] loop
  fn:=signature::regprocedure;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only); end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  else raise exception 'operational_internal_contract_missing: %',signature;
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
