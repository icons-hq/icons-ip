-- 2026-11-19: 운영자가 예약 조건을 기본값('초안', state='draft')으로만 저장해 판매에 적용되지 않은 상품을
-- 목록에서 바로 찾도록, 한 페이지(최대 100개)의 상품마다 '임시저장만 있고 적용 중인 예약이 없는 사용 옵션' 수를 돌려준다.
-- 예약 조건은 private 테이블이라 목록은 이 좁은 투영만 읽는다. 활성화 규칙·권한은 바꾸지 않는다(읽기 전용).
begin;
create function public.admin_goods_list_preorder_states(p_good_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_good_ids is null or cardinality(p_good_ids)>100 or array_position(p_good_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_goods_list_preorder_states';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',state.good_id,'draftOnlyOptionCount',state.option_count) order by state.good_id),'[]') into result
 from (select variant.good_id,count(*)::integer option_count
   from public.goods_variants variant
   where variant.good_id=any(p_good_ids) and variant.archived_at is null
     and exists(select 1 from private.goods_preorder_policies policy where policy.variant_id=variant.id and policy.state='draft')
     and not exists(select 1 from private.goods_preorder_policies policy where policy.variant_id=variant.id and policy.state='active')
   group by variant.good_id) state;
 return result;
end $$;
revoke all on function public.admin_goods_list_preorder_states(text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_list_preorder_states(text[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_goods_list_preorder_states(text[])'::regprocedure,'catalog.read','read',false);
notify pgrst,'reload schema';
commit;
