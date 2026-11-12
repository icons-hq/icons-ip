-- 원장 재작업 웨이브 1 통합: 물류 출고 권한(T05, 1014-084)을 같은 웨이브의 새 출고 RPC에 넓힌다.
-- 트랙 migration은 각자 main 기준으로 만들어져, 서로의 새 함수에는 sales.dispatch가 닿지 않았다.
--
-- 1) T04 발송처리 화면(S36-072 행별 운송장·배송 방법, S36-X04 택배 외 일괄 인계): 능력 판정을 한곳에 모아 둔
--    private.dispatch_console_capability()를 sales.dispatch로 바꾸고 두 RPC 계약을 다시 적는다(T04 지시와 오케스트레이터 판단
--    "발송·배송완료를 택배로 좁히지 않음"). 운영 강제 배송완료(admin_force_order_*)는 운송장 근거 없이 철회 기간을 여는 도구라
--    sales.manage 그대로다.
-- 2) T03 ICONS 표준 양식 바코드 공백 경고(admin_smartstore_shipment_barcode_gaps): 출고지시를 내려받는 물류도 같은 경고를
--    보도록 기존 창고 양식 경고(T05가 이미 sales.dispatch로 옮김)와 같은 능력으로 맞춘다(리뷰 F2).
-- 3) T07 출고지시 전 재고 차이 경고(admin_stock_dispatch_warnings): 경고를 그리는 발주·발송 화면은 sales.dispatch로 열린다.
--    sales.read(주문 조회)를 요구하면 출고 전용 운영자에게는 42501로 막혀 경고가 사라지므로 화면과 같은 능력으로 맞춘다.
--    sales.manage를 가진 역할은 함의로 그대로 본다. sales.read만 있는 역할(인플루언서)은 이 화면을 열 수 없다.
--
-- sales.manage는 sales.dispatch를 포함하므로(private.has_operator_capability) 통합·주매니저·전환 전 운영자의 허용 범위는 그대로다.
-- 본문 변경은 앵커가 정확히 한 번 나올 때만 하고, 같은 migration 끝에서 운영자 계약(RPC·내부)을 다시 적는다.
begin;

create or replace function private.dispatch_console_capability() returns text
language sql stable set search_path='' as $$ select 'sales.dispatch'::text $$;
revoke all on function private.dispatch_console_capability() from public,anon,authenticated,service_role;

do $patch$
declare
  item record;
  body text;
begin
  for item in select * from (values
    ('public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid)',
      $a$private.has_operator_capability(auth.uid(),'sales.manage',false)$a$,
      $a$private.has_operator_capability(auth.uid(),'sales.dispatch',false)$a$),
    ('public.admin_stock_dispatch_warnings(uuid,integer)',
      $a$public.has_operator_capability('sales.read',false)$a$,
      $a$public.has_operator_capability('sales.dispatch',false)$a$)
  ) as target(signature, anchor, replacement)
  loop
    body := pg_get_functiondef(item.signature::regprocedure);
    if (length(body) - length(replace(body, item.anchor, ''))) / length(item.anchor) <> 1 then
      raise exception 'ledger_rework_dispatch_guard_anchor_changed: %', item.signature;
    end if;
    execute replace(body, item.anchor, item.replacement);
  end loop;
end $patch$;

-- 운영자 계약: 분류(read/write)와 legacy 관리자 전용 여부는 등록된 값을 그대로 두고 능력만 sales.dispatch로 적는다.
do $contracts$
declare
  signature text;
  fn regprocedure;
  contract record;
begin
  foreach signature in array array[
    'public.admin_dispatch_delivery_options(uuid[])',
    'public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)',
    'public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid)',
    'public.admin_stock_dispatch_warnings(uuid,integer)'
  ] loop
    fn := signature::regprocedure;
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
    if not found then raise exception 'ledger_rework_dispatch_contract_missing: %', signature; end if;
    perform private.register_operator_rpc_contract(fn, private.dispatch_console_capability(), contract.guard_kind, contract.legacy_admin_only);
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
  if (select count(*) from private.operator_rpc_contracts where capability='sales.dispatch') <> 26 then
    raise exception 'ledger_rework_dispatch_contract_count: %', (select count(*) from private.operator_rpc_contracts where capability='sales.dispatch');
  end if;
end $contracts$;

notify pgrst, 'reload schema';
commit;
