-- 1027T-016 ERP 품목 반입을 MD에게 연다. 10/27 회의에서 MD(참석자 5)가 "ERP 품목 이렇게 복사 붙여넣기 하는 데"를
-- 직접 쓰겠다고 했고, 사용자 결정(2026-11-11, 묶음 13) "미연결 안내+MD 권한"을 골랐다.
--
-- ERP 품목 화면 읽기(목록·분류 목록·옵션 ERP 품명 제안 검색)·붙여넣기 반입·ERP 분류 연결을 platform.manage에서
-- 상품 관리 능력 catalog.manage로 옮긴다. catalog.manage는 부매니저(MD)·인플루언서·대행사도 가진 상품 편집 능력이고,
-- 반입한 값은 상품을 바꾸지 않는 제안 자료라 상품 편집보다 넓은 권한이 아니다. 품목 삭제(admin_delete_erp_items)는
-- 요청 범위 밖이라 platform.manage에 그대로 둔다.
--
-- 함수 본문은 다른 트랙이 같은 함수를 고칠 수 있어 pg_get_functiondef + 앵커 치환으로 능력 이름만 바꾼다.
-- 함수마다 'platform.manage'가 정확히 두 번(진입 검사와 옛 staff 검사)이고 둘 다 능력 검사 호출의 인자여야 한다.
-- 같은 migration 끝에서 운영자 계약 지문(RPC·내부·RLS)을 다시 적는다.
begin;

do $patch$
declare
  item record;
  body text;
  token constant text := $a$'platform.manage'$a$;
  guard constant text := $a$(require_operator_capability|has_operator_capability)\('platform\.manage'$a$;
  found_tokens integer;
  found_guards integer;
begin
  for item in select * from (values
    ('public.admin_import_erp_items(jsonb)'),
    ('public.admin_search_erp_items(text,integer)'),
    ('public.admin_list_erp_items(text,integer,integer)'),
    ('public.admin_list_erp_categories()'),
    ('public.admin_set_erp_category_mapping(text,uuid)'),
    ('public.admin_set_erp_category_mappings(jsonb)')
  ) as target(signature)
  loop
    body := pg_get_functiondef(item.signature::regprocedure);
    found_tokens := (length(body) - length(replace(body, token, ''))) / length(token);
    select count(*) into found_guards from regexp_matches(body, guard, 'g');
    if found_tokens <> 2 or found_guards <> 2 then
      raise exception 'erp_items_catalog_manage_anchor_changed: % (tokens %, guards %)', item.signature, found_tokens, found_guards;
    end if;
    execute replace(body, token, $a$'catalog.manage'$a$);
  end loop;
end $patch$;

-- 표 직접 읽기(RLS)도 같은 능력으로 연다. 반입 품목·ERP 분류 연결·카테고리별 정본 ERP 분류 매핑은
-- ERP 품목 화면의 제안·경고와 상품 등록의 카테고리 찾기(ERP 분류명 검색, SHEET-042)에 쓰인다.
alter policy erp_items_staff_read on public.erp_items
  using ((select public.has_operator_capability('catalog.manage') as is_staff));
alter policy erp_category_mappings_staff_read on public.erp_category_mappings
  using ((select public.has_operator_capability('catalog.manage') as is_staff));
alter policy catalog_category_erp_mappings_staff_read on public.catalog_category_erp_mappings
  using ((select public.has_operator_capability('catalog.manage') as is_staff));

-- 계약 지문: 분류(guard_kind)·legacy 표시는 기존 행 그대로이고 능력만 바뀐다. register_operator_rpc_contract가 내부 지문도 함께 적는다.
do $contracts$
declare
  contract record;
  changed integer;
begin
  for contract in
    select existing.signature, existing.guard_kind, existing.legacy_admin_only
    from private.operator_rpc_contracts existing
    where existing.signature in (
      'public.admin_import_erp_items(jsonb)',
      'public.admin_search_erp_items(text,integer)',
      'public.admin_list_erp_items(text,integer,integer)',
      'public.admin_list_erp_categories()',
      'public.admin_set_erp_category_mapping(text,uuid)',
      'public.admin_set_erp_category_mappings(jsonb)'
    )
    order by existing.signature
  loop
    perform private.register_operator_rpc_contract(contract.signature::regprocedure, 'catalog.manage', contract.guard_kind, contract.legacy_admin_only);
  end loop;
  select count(*) into changed from private.operator_rpc_contracts
  where capability = 'catalog.manage' and signature in (
    'public.admin_import_erp_items(jsonb)',
    'public.admin_search_erp_items(text,integer)',
    'public.admin_list_erp_items(text,integer,integer)',
    'public.admin_list_erp_categories()',
    'public.admin_set_erp_category_mapping(text,uuid)',
    'public.admin_set_erp_category_mappings(jsonb)'
  );
  if changed <> 6 then raise exception 'erp_items_catalog_manage_contract_count: %', changed; end if;
  if not exists (select 1 from private.operator_rpc_contracts
    where signature = 'public.admin_delete_erp_items(text[])' and capability = 'platform.manage') then
    raise exception 'erp_items_delete_contract_changed';
  end if;
end $contracts$;

select private.register_operator_policy_contract('public.erp_items'::regclass, 'erp_items_staff_read', 'catalog.manage');
select private.register_operator_policy_contract('public.erp_category_mappings'::regclass, 'erp_category_mappings_staff_read', 'catalog.manage');
select private.register_operator_policy_contract('public.catalog_category_erp_mappings'::regclass, 'catalog_category_erp_mappings_staff_read', 'catalog.manage');

notify pgrst, 'reload schema';
commit;
