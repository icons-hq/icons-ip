-- QA 라운드 2: 웨이브 2의 반품/교환지(claimReturnAddressId)가 화면 입력 기록(GOOD_LOCAL_DRAFT_FIELDS)과 서버 임시저장 값에 실리는데
-- admin_save_goods_draft 허용 키에 없어 상품 등록 [임시저장]이 매번 invalid_goods_draft로 실패했다.
-- 화면 허용 키와 DB 허용 키를 전수 대조한 결과(11/13) 어긋난 키는 이 하나뿐이다. 값은 반품지 id 규칙(빈 문자열 또는 UUID)과 같게 검사한다.
-- 앵커 치환은 정확히 1회 일치해야 하고, 아니면 migration이 멈춘다.
do $patch$
declare
  def text := pg_get_functiondef('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure);
  patched text;
  pairs text[][] := array[
    array[$a$'claimReturnFee','claimReturnFreeShippingFee','claimExchangeFee',$a$,
          $r$'claimReturnFee','claimReturnFreeShippingFee','claimExchangeFee','claimReturnAddressId',$r$],
    array[$a$    or coalesce(p_values->>'variantBaseline','[]')<>'[]' or coalesce(p_values->>'customInputsExpectedRevision','0')<>'0'$a$,
          $r$    or coalesce(p_values->>'variantBaseline','[]')<>'[]' or coalesce(p_values->>'customInputsExpectedRevision','0')<>'0'
    or coalesce(p_values->>'claimReturnAddressId','')<>'' and p_values->>'claimReturnAddressId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$r$]
  ];
  i int;
begin
  patched := def;
  for i in 1..array_length(pairs, 1) loop
    if (length(patched) - length(replace(patched, pairs[i][1], ''))) / length(pairs[i][1]) <> 1 then
      raise exception 'goods_draft_return_address_key anchor % must match exactly once', i;
    end if;
    patched := replace(patched, pairs[i][1], pairs[i][2]);
  end loop;
  execute patched;
end
$patch$;

revoke all on function public.admin_save_goods_draft(uuid,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_goods_draft(uuid,jsonb,integer) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure, 'catalog.manage', 'write', false);
