-- ERP 품목 화면의 'ERP 분류 ↔ 고객 카테고리 연결'을 여러 건 한 번에 저장한다.
-- 2026-11-10 사람 눈 시험: 운영 ERP 분류 257개를 행마다 고르고 저장해야 했다.
--
-- 행마다 단건 RPC(admin_set_erp_category_mapping)를 그대로 부른다. 권한·마지막 단계 검사·트리 잠금·감사 기록
-- (바뀐 행마다 admin.erp_items.category_mapping_updated 한 줄)이 단건 저장과 같고, 규칙이 두 벌로 갈라지지 않는다.
-- 한 행이 거절돼도 나머지는 저장하고, 거절된 행은 입력 순번·사유와 함께 돌려준다.
-- 같은 내용을 다시 보내면 변경 없음으로 끝나므로 결과를 못 받았을 때 그대로 다시 보내도 안전하다.
begin;

create function public.admin_set_erp_category_mappings(p_entries jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_entry jsonb;
  v_index integer;
  v_raw text;
  v_erp_category text;
  v_seen text[] := array[]::text[];
  v_result jsonb;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_rejected jsonb := '[]'::jsonb;
begin
  perform private.require_operator_capability('platform.manage', false);

  if v_actor is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_entries is null
     or pg_catalog.jsonb_typeof(p_entries) <> 'array'
     or pg_catalog.jsonb_array_length(p_entries) not between 1 and 500 then
    raise invalid_parameter_value using message = 'invalid_erp_category_mappings';
  end if;

  -- 카테고리 보관·이동과 같은 트리 잠금을 처음에 잡아 묶음 전체를 같은 트리로 검사한다.
  -- 단건 RPC가 다시 잡아도 같은 트랜잭션이라 기다리지 않는다.
  perform private.lock_catalog_category_tree();

  for v_entry, v_index in
    select item.value, item.ordinality::integer - 1
    from pg_catalog.jsonb_array_elements(p_entries) with ordinality as item(value, ordinality)
  loop
    v_raw := case
      when pg_catalog.jsonb_typeof(v_entry) = 'object' and pg_catalog.jsonb_typeof(v_entry -> 'erp_category') = 'string'
        then v_entry ->> 'erp_category'
    end;
    v_erp_category := private.erp_item_text(v_raw, true);

    if v_erp_category is null then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('index', v_index, 'erp_category', v_raw, 'reason', 'invalid_erp_category');
      continue;
    end if;
    if v_erp_category = any(v_seen) then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('index', v_index, 'erp_category', v_raw, 'reason', 'duplicate_erp_category');
      continue;
    end if;
    v_seen := v_seen || v_erp_category;

    -- category_id는 있어야 하고 uuid 문자열 또는 null이다(null은 연결 해제).
    if coalesce(pg_catalog.jsonb_typeof(v_entry -> 'category_id'), '') not in ('string', 'null') then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('index', v_index, 'erp_category', v_raw, 'reason', 'invalid_category_id');
      continue;
    end if;

    begin
      v_result := public.admin_set_erp_category_mapping(v_erp_category, (v_entry ->> 'category_id')::uuid);
      if (v_result ->> 'changed')::boolean then
        v_changed := v_changed + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    exception
      when invalid_text_representation then
        v_rejected := v_rejected || pg_catalog.jsonb_build_object('index', v_index, 'erp_category', v_raw, 'reason', 'invalid_category_id');
      when invalid_parameter_value or check_violation or no_data_found then
        v_rejected := v_rejected || pg_catalog.jsonb_build_object('index', v_index, 'erp_category', v_raw, 'reason', sqlerrm);
    end;
  end loop;

  return pg_catalog.jsonb_build_object('changed', v_changed, 'unchanged', v_unchanged, 'rejected', v_rejected);
end;
$$;

revoke all on function public.admin_set_erp_category_mappings(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_erp_category_mappings(jsonb) to authenticated;

select private.register_operator_rpc_contract('public.admin_set_erp_category_mappings(jsonb)'::regprocedure, 'platform.manage', 'write', false);

commit;
