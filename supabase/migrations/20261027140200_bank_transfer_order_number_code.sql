-- 10/14 회의 A3b·D7: 무통장 입금코드를 16자리 주문번호에서 만든다.
--
-- 코드 = 주문일의 10일 주기 자리 1자리 + 그날 주문 일련번호 끝 5자리 (숫자 6자리).
--   주기 자리 = (주문번호 앞 8자리 날짜 - 2000-01-01) mod 10. 연속한 10일은 서로 다르다.
-- 입금 대기는 최대 48시간(24시간 + 1회 24시간 연장)이라 동시에 열린 주문의 주문일은 연속한 3일 안이다.
-- 그 안에서 하루 주문이 10만 건을 넘지 않는 한 입금 대기 주문 사이 코드가 겹치지 않는다.
-- 숫자 6자리라 한글 4자 이름과 붙여도 은행 입금자명 14바이트(EUC-KR) 안에 들어간다.
-- TS `lib/payments/bank-transfer.ts`의 bankTransferDepositCode와 같은 규칙이다.
--
-- 안내된 코드는 바꾸지 않는다: 이 migration을 적용한 시각(전환 시각) 전에 만든 주문은 그때 안내받은
-- 옛 코드(UUID 앞 8자리)가 그 주문의 입금코드다. 함수 이름과 호출 형태(private.bank_transfer_deposit_code(uuid))는
-- 유지한다. 고객이 자기 주문의 안내 코드를 그대로 읽도록 get_my_bank_transfer_deposit_code(uuid)를 연다.
--
-- 대조: 입금 제안은 입금자명에 든 코드가 입금 대기 주문 한 건에만 맞을 때만 코드로 제안한다(오래 남은 입금 대기
-- 주문과 코드가 겹치면 사람이 고른다). 미입금 검색의 주문번호 부분 일치는 8자리 이상 숫자만 받는다 — 6자리 코드
-- 검색이 다른 주문의 주문번호 일부로 잡히지 않게 한다.
begin;

create table private.bank_transfer_deposit_code_switch (
  singleton boolean primary key default true check (singleton),
  switched_at timestamptz not null
);
alter table private.bank_transfer_deposit_code_switch enable row level security;
revoke all on private.bank_transfer_deposit_code_switch from public,anon,authenticated,service_role;
insert into private.bank_transfer_deposit_code_switch(singleton,switched_at) values(true,clock_timestamp());

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
create or replace function private.bank_transfer_deposit_code(p_order_id uuid)
returns text language sql stable strict security definer set search_path='' as $$
  select coalesce(
    (select case when o.created_at < (select s.switched_at from private.bank_transfer_deposit_code_switch s where s.singleton)
       then null else private.bank_transfer_deposit_code_for_number(o.order_number) end
     from public.orders o where o.id=p_order_id),
    private.bank_transfer_legacy_deposit_code(p_order_id));
$$;

revoke all on function private.bank_transfer_legacy_deposit_code(uuid),private.bank_transfer_deposit_code_for_number(text),
  private.bank_transfer_deposit_code(uuid) from public,anon,authenticated,service_role;

-- 주문서가 자기 무통장 주문에 안내된 코드를 그대로 보여주도록 연다. 다른 사람의 주문·카드 주문은 null이다.
create function public.get_my_bank_transfer_deposit_code(p_order_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select private.bank_transfer_deposit_code(o.id) from public.orders o
  where o.id=p_order_id and o.user_id=(select auth.uid()) and o.payment_method='bank_transfer';
$$;
revoke all on function public.get_my_bank_transfer_deposit_code(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_bank_transfer_deposit_code(uuid) to authenticated;

do $patch$
declare definition text; anchor text;
begin
 -- 입금 제안: 코드가 입금 대기 주문 한 건에만 맞을 때만 코드로 제안한다. 둘 이상이면 금액·이름 제안도 하지 않는다.
 definition:=pg_get_functiondef('private.suggest_bank_deposit_order(text,bigint)'::regprocedure);
 anchor:=$old$  by_code as ($old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'deposit_suggest_code_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$  by_code_all as ($new$);
 anchor:=$old$  by_amount as ($old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'deposit_suggest_amount_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$  by_code as (
    select * from by_code_all where (select count(distinct by_code_all.id) from by_code_all) = 1
  ),
  by_amount as ($new$);
 anchor:=$old$where not exists (select 1 from by_code)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'deposit_suggest_fallback_anchor_changed'; end if;
 execute replace(definition,anchor,$new$where not exists (select 1 from by_code_all)$new$);

 -- 미입금 검색: 주문번호 부분 일치는 8자리 이상 숫자만. 6자리 입금코드는 코드 정확 일치로만 찾는다.
 definition:=pg_get_functiondef('private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)'::regprocedure);
 anchor:=$old$position(v_query in numbered.order_number)>0$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'unpaid_console_number_anchor_changed'; end if;
 execute replace(definition,anchor,$new$v_query ~ '^[0-9]{8,16}$' and position(v_query in numbered.order_number)>0$new$);
end $patch$;

do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array ARRAY[
  'private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)'
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
