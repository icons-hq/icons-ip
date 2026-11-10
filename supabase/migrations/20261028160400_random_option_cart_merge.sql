-- 10/27 회의 D5②(R24) 보강 — 장바구니 병합에서 같은 랜덤 장바구니 키로 모이는 줄의 수량을 더한다(T7 리뷰 RV-3).
--
-- 랜덤 판매 굿즈는 옵션 줄이 장바구니 키(기본 옵션) 하나로 모인다(20261028160100 private.cart_variant_key). merge_cart_items는
-- 줄마다 greatest(요청 수량, 키 줄 현재 수량)로 반영하므로, 한 번의 병합에 같은 키로 모이는 줄이 둘 이상이면(랜덤 전환 전에
-- 이 기기 장바구니에 옵션 A 2개·B 3개를 담아 둔 채 로그인) 앞 줄 수량이 사라져 키 줄이 3이 됐다. 한 번의 병합 안에서는
-- 같은 (굿즈, 장바구니 키, 직접입력 키)로 모이는 서로 다른 옵션 줄의 수량을 먼저 더한 뒤 한 번만 반영한다. 같은 옵션 줄이
-- 한 요청에 겹쳐 오면 지금처럼 큰 값 하나이고(cart_items.sql 재시도 멱등), 호출과 호출 사이도 지금처럼 greatest라 같은
-- 장바구니를 다시 병합해도 수량이 불어나지 않는다. 선택 판매 굿즈는 장바구니 키가 옵션 그대로라 동작이 같다.
-- 잘못된 수량 거절은 더하기 전 줄마다 그대로다.
begin;

do $patch$
declare definition text; anchor text;
  target constant regprocedure:='public.merge_cart_items(jsonb)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$  for item in select good_id,variant_id,qty,coalesce(input_revision,0) input_revision,coalesce(input_values,'{}') input_values
    from jsonb_to_recordset(p_items) as candidate(good_id text,variant_id uuid,qty integer,input_revision integer,input_values jsonb)
    order by good_id,variant_id loop
$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'merge_cart_random_sum_anchor_changed'; end if;
  execute replace(definition,anchor,$new$  if exists(select 1 from jsonb_to_recordset(p_items) as candidate(qty integer) where candidate.qty is null or candidate.qty<=0) then
    raise check_violation using message='invalid cart item'; end if;
  -- 같은 장바구니 키로 모이는 서로 다른 옵션 줄(랜덤 판매 굿즈의 옵션 줄)은 수량을 더해 한 번만 반영한다(D5②).
  -- 같은 옵션 줄이 한 요청에 겹쳐 오면 지금처럼 큰 값 하나다(재시도 멱등 — cart_items.sql).
  for item in select grouped.good_id,grouped.variant_id,least(sum(grouped.qty::bigint),2147483647)::integer qty,grouped.input_revision,grouped.input_values
    from (select requested.good_id,private.cart_variant_key(requested.good_id,requested.variant_id) variant_id,requested.qty,
        requested.input_revision,requested.input_values
      from (select candidate.good_id,candidate.variant_id,max(candidate.qty) qty,
          coalesce(candidate.input_revision,0) input_revision,coalesce(candidate.input_values,'{}') input_values
        from jsonb_to_recordset(p_items) as candidate(good_id text,variant_id uuid,qty integer,input_revision integer,input_values jsonb)
        group by candidate.good_id,candidate.variant_id,coalesce(candidate.input_revision,0),coalesce(candidate.input_values,'{}')) requested) grouped
    group by grouped.good_id,grouped.variant_id,grouped.input_revision,grouped.input_values
    order by grouped.good_id,grouped.variant_id loop
$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

commit;
