-- 10/14 회의 1014-116·117: 주문번호를 "앞에는 날짜, 시간 다음에 일련번호"로, 누구라도 읽을 수 있게 만든다.
-- 사용자 11/11 확정: 날짜 + 시각 + 일련번호, 새 주문부터, 기존 번호는 그대로.
--
-- 새 형식(20자리) = 주문일(KST) 8자리 + 주문 시각(KST 시·분) 4자리 + 종류 1자리 + 그날 일련번호 7자리.
--   주문번호      20261112 1435 1 0000042 → 20261112143510000042 (2026-11-12 14:35, 그날 42번째 주문)
--   상품주문번호  주문번호의 날짜·시각 12자리 + 2 + 그날 상품주문 일련번호 7자리. 주문번호와 앞자리가 같은 짝이다.
--   배송건번호    현행 16자리 그대로(주문일 8 + 3 + 일련 7). 시각을 넣지 않는다.
-- 옛 형식(16자리 = 주문일 8 + 종류 1 + 일련 7)으로 이미 발급한 번호는 바꾸지 않는다(UNIQUE·불변 트리거 그대로).
-- 옛 형식 주문에 나중에 붙는 상품주문번호도 그 주문의 형식(날짜 8자리 앞자리)을 따른다.
--
-- 근거(docs/runbooks/order-reference-numbers.md '주문 시각 형식'):
--   · 기존 번호의 날짜 뒤에 시각 4자리를 끼운 모양이다. 종류 자리는 늘 끝에서 8번째, 일련번호는 늘 끝 7자리라
--     두 형식을 길이(16·20)로 가르고, 무통장 입금코드(10일 주기 자리 + 일련번호 끝 5자리) 규칙이 그대로다.
--   · 고유성은 종전처럼 (KST 날짜, 종류)별 원자적 카운터가 준다. 시각은 정보용이라 같은 분의 주문도 일련번호로 갈린다.
--     전환하는 날도 같은 카운터를 이어 쓰므로 그날 옛 번호와 새 번호의 일련번호(=입금코드)가 겹치지 않는다.
--   · 하루 최대 건수도 종전과 같다: (날짜, 종류)별 9,999,999건. 넘으면 잘린 번호를 만들지 않고 실패한다.
--     입금코드는 하루 주문 10만 건 미만이면 입금 대기 주문 사이에서 겹치지 않는다(종전과 같은 보장).
--
-- 배포 순서 보호: 파이프라인은 DB를 먼저, 앱을 몇 분 뒤 배포하고 앱 배포는 실패할 수도 있다. 배포 전 앱은 20자리
-- 번호를 주문번호로 읽지 못하므로(어드민 조회·선물 화면의 정확 형식 검사) 이 migration은 전환을 꺼 둔 채
-- (private.commerce_number_time_switch.switched_at = infinity) 배포한다. 꺼져 있는 동안 발급은 종전과 한 글자도 같은
-- 16자리다. 이 변경의 앱이 운영에 배포된 것을 확인한 뒤 후속 migration이 switched_at을 그 적용 시각으로 바꾸면
-- 그 뒤에 만든 주문부터 20자리다(런북 '주문 시각 형식'의 켜는 순서). 그때 운영 앱은 이미 두 형식을 읽는다.
begin;

-- 1) 형식 판정. 주문(1)·상품주문(2)은 옛 16자리와 새 20자리를 받고, 배송(3)은 16자리만 받는다.
--    시각 자리는 00~23시·00~59분만 받는다. 앱 lib/commerce-number.ts isCommerceNumber와 같은 규칙이다.
create function private.is_commerce_number(p_value text,p_kind smallint)
returns boolean language sql immutable strict parallel safe security invoker set search_path='' as $$
  select case p_kind
    when 1 then p_value ~ '^[0-9]{8}(([01][0-9]|2[0-3])[0-5][0-9])?1[0-9]{7}$'
    when 2 then p_value ~ '^[0-9]{8}(([01][0-9]|2[0-3])[0-5][0-9])?2[0-9]{7}$'
    when 3 then p_value ~ '^[0-9]{8}3[0-9]{7}$'
    else false end;
$$;
revoke all on function private.is_commerce_number(text,smallint) from public,anon,authenticated,service_role;

-- 2) 일련번호 카운터. 종전 next_commerce_number 본문의 검증·원자적 증가를 그대로 옮겼다.
create function private.next_commerce_sequence(p_business_day date,p_kind smallint)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_business_day is null or not isfinite(p_business_day) or p_business_day not between date '2000-01-01' and date '9999-12-31'
    or p_kind is null or p_kind not in (1,2,3) then
    raise invalid_parameter_value using message='invalid_commerce_number_input';
  end if;
  insert into private.commerce_number_counters as counter(business_date,kind,last_value)
    values(p_business_day,p_kind,1)
    on conflict(business_date,kind) do update set last_value=counter.last_value+1
    returning last_value into n;
  return n;
end $$;
revoke all on function private.next_commerce_sequence(date,smallint) from public,anon,authenticated,service_role;

-- 옛 형식(16자리) 발급. 결과는 종전과 같다 — 배송건번호, 전환 전 주문번호, 옛 주문의 상품주문번호가 쓴다.
create or replace function private.next_commerce_number(p_created_at timestamptz,p_kind smallint)
returns text language plpgsql security definer set search_path='' as $$
declare business_day date := (p_created_at at time zone 'Asia/Seoul')::date; n integer;
begin
  n:=private.next_commerce_sequence(business_day,p_kind);
  return to_char(business_day,'YYYYMMDD')||p_kind::text||lpad(n::text,7,'0');
end $$;
revoke all on function private.next_commerce_number(timestamptz,smallint) from public,anon,authenticated,service_role;

-- 새 주문번호(20자리): 주문 생성 시각(KST)의 날짜·시·분 + 1 + 그날 주문 일련번호.
create function private.next_timed_order_number(p_created_at timestamptz)
returns text language plpgsql security definer set search_path='' as $$
declare local_time timestamp := p_created_at at time zone 'Asia/Seoul'; n integer;
begin
  n:=private.next_commerce_sequence(local_time::date,1::smallint);
  return to_char(local_time,'YYYYMMDDHH24MI')||'1'||lpad(n::text,7,'0');
end $$;
revoke all on function private.next_timed_order_number(timestamptz) from public,anon,authenticated,service_role;

-- 상품주문번호: 주문번호의 앞자리(옛 형식은 날짜 8자리, 새 형식은 날짜·시각 12자리) + 2 + 그날 상품주문 일련번호.
-- 주문번호에서 바로 만들므로 주문번호와 상품주문번호의 날짜·시각이 늘 같다.
create function private.next_product_order_number(p_order_number text)
returns text language plpgsql security definer set search_path='' as $$
declare prefix text; n integer;
begin
  if not coalesce(private.is_commerce_number(p_order_number,1::smallint),false) then
    raise invalid_parameter_value using message='invalid_commerce_number_input';
  end if;
  prefix:=left(p_order_number,length(p_order_number)-8);
  n:=private.next_commerce_sequence(to_date(left(prefix,8),'YYYYMMDD'),2::smallint);
  return prefix||'2'||lpad(n::text,7,'0');
end $$;
revoke all on function private.next_product_order_number(text) from public,anon,authenticated,service_role;

-- 3) 전환 시각. 이 시각 이후(이상)에 만든 주문부터 새 형식이다. 행이 없거나 infinity(꺼짐)면 옛 형식을 쓴다.
--    켜기는 앱 배포 확인 뒤의 후속 migration이 한다(앱 배포가 늦거나 실패해도 정해 둔 시각에 저절로 켜지지 않게).
create table private.commerce_number_time_switch (
  singleton boolean primary key default true check (singleton),
  switched_at timestamptz not null
);
alter table private.commerce_number_time_switch enable row level security;
revoke all on private.commerce_number_time_switch from public,anon,authenticated,service_role;
insert into private.commerce_number_time_switch(singleton,switched_at) values(true,'infinity');
comment on table private.commerce_number_time_switch is
  'Orders created at/after switched_at get 20-digit numbers (KST date + KST HHMI + kind + daily sequence). Ships as infinity (off); a follow-up migration sets it to its own apply time only after the app that reads both formats is confirmed live in production.';

-- 4) 발급 트리거. 갱신 금지·임의 번호 금지는 종전 그대로다.
create or replace function private.assign_commerce_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare column_name text := tg_argv[0]; kind smallint := tg_argv[1]::smallint; created timestamptz; parent_number text; number text;
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)->>column_name) is distinct from (to_jsonb(old)->>column_name) then
      raise check_violation using message='commerce_number_immutable';
    end if;
    return new;
  end if;
  if to_jsonb(new)->>column_name is not null then
    raise check_violation using message='commerce_number_is_generated';
  end if;
  if kind=1 then
    if new.created_at>=(select s.switched_at from private.commerce_number_time_switch s where s.singleton) then
      number:=private.next_timed_order_number(new.created_at);
    else
      number:=private.next_commerce_number(new.created_at,kind);
    end if;
  else
    select o.created_at,o.order_number into strict created,parent_number from public.orders o where o.id=new.order_id;
    if kind=2 then number:=private.next_product_order_number(parent_number);
    else number:=private.next_commerce_number(created,kind);
    end if;
  end if;
  new:=jsonb_populate_record(new,jsonb_build_object(column_name,number));
  return new;
end $$;
revoke all on function private.assign_commerce_number() from public,anon,authenticated,service_role;

-- 5) 형식 제약: 옛 16자리와 새 20자리를 모두 받는다. 배송건번호 제약은 그대로다.
alter table public.orders drop constraint orders_number_format,
  add constraint orders_number_format check(order_number ~ '^[0-9]{8}(([01][0-9]|2[0-3])[0-5][0-9])?1[0-9]{7}$');
alter table public.order_items drop constraint order_items_number_format,
  add constraint order_items_number_format check(product_order_number ~ '^[0-9]{8}(([01][0-9]|2[0-3])[0-5][0-9])?2[0-9]{7}$');

-- 6) 무통장 입금코드: 두 형식 모두 주문일(앞 8자리)의 10일 주기 자리 + 일련번호 끝 5자리(뒤 5자리). 규칙은 그대로다.
create or replace function private.bank_transfer_deposit_code_for_number(p_order_number text)
returns text language sql immutable strict security invoker set search_path='' as $$
  select case when private.is_commerce_number(p_order_number,1::smallint) then
    ((pg_catalog.make_date(pg_catalog.left(p_order_number,4)::integer,pg_catalog.substr(p_order_number,5,2)::integer,
      pg_catalog.substr(p_order_number,7,2)::integer) - date '2000-01-01') % 10)::text||pg_catalog.right(p_order_number,5)
  end;
$$;
revoke all on function private.bank_transfer_deposit_code_for_number(text) from public,anon,authenticated,service_role;

-- 7) 번호 형식을 직접 보던 읽기 함수: 운송장 입력(주문번호 → 단일 배송 건), ICONS 표준 양식 회신(상품주문번호),
--    테스트 배송완료(주문번호), 미입금 검색(주문번호 부분 일치 8~20자리). 다른 조건·권한은 바꾸지 않는다.
create function pg_temp.patch_number_reader(signature text,anchor text,replacement text) returns void language plpgsql as $$
declare definition text:=pg_get_functiondef(signature::regprocedure);
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'order_number_time_anchor_changed: % / %',signature,anchor;
  end if;
  execute replace(definition,anchor,replacement);
end $$;
select pg_temp.patch_number_reader('private.resolve_shipment_reference(text)',
  $a$elsif reference_value ~ '^[0-9]{8}1[0-9]{7}$' then$a$,
  $a$elsif private.is_commerce_number(reference_value,1::smallint) then$a$);
select pg_temp.patch_number_reader('public.admin_import_item_tracking_batch(jsonb)',
  $a$if number ~ '^[0-9]{8}2[0-9]{7}$' then$a$,
  $a$if private.is_commerce_number(number,2::smallint) then$a$);
select pg_temp.patch_number_reader('public.admin_mark_staging_test_delivered(text,uuid)',
  $a$p_order_number!~'^[0-9]{8}1[0-9]{7}$'$a$,
  $a$not private.is_commerce_number(p_order_number,1::smallint)$a$);
select pg_temp.patch_number_reader('private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)',
  $a$v_query ~ '^[0-9]{8,16}$'$a$,
  $a$v_query ~ '^[0-9]{8,20}$'$a$);

-- 고친 함수의 운영자 계약 지문을 다시 등록한다. 권한·가드 종류는 등록된 값을 그대로 쓴다.
do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array array[
  'private.resolve_shipment_reference(text)',
  'public.admin_import_item_tracking_batch(jsonb)',
  'public.admin_mark_staging_test_delivered(text,uuid)',
  'private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)'
 ] loop
  fn:=signature::regprocedure;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only); end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  else raise exception 'order_number_time_internal_contract_missing: %',signature;
  end if;
 end loop;
end $$;

comment on column public.orders.order_number is
  'Immutable display/search number. Orders created at/after private.commerce_number_time_switch: KST date + KST HHMI + 1 + seven digit daily sequence (20 digits). Earlier orders keep KST date + 1 + seven digit daily sequence (16 digits). UUID/PG IDs remain unchanged.';
comment on column public.order_items.product_order_number is
  'Immutable product-order number: the parent order number prefix (KST date, plus KST HHMI for 20-digit orders) + 2 + seven digit daily sequence.';

notify pgrst,'reload schema';
commit;
