\set ON_ERROR_STOP on
begin;
-- X SQUARE GNB(ADR-0043): 공개 메뉴 설정에 popups 가 더해져 9개가 된다. 저장·공개 조회 함수는 그대로이고 검증 함수와
-- 기본값·이미 저장된 설정의 이행만 바뀌었다. 이행 규칙은 private.upgrade_store_navigation_popups 를 직접 불러 확인한다.
update public.store_settings set navigation=default where singleton;

-- 1. 새 기본값: NEW·BEST·카테고리·POP-UP·EVENT 노출, 온라인 팝업·카드팩·커뮤니티·쇼핑스토리 숨김(MD-0035).
do $$ declare nav jsonb; entry jsonb;
begin
  select navigation into nav from public.store_settings where singleton;
  if jsonb_array_length(nav)<>9 or not private.store_navigation_valid(nav) then raise exception 'new default must hold nine valid menus'; end if;
  if (select jsonb_agg(value->>'id' order by ordinal) from jsonb_array_elements(nav) with ordinality item(value,ordinal))
     <>'["new","best","shop","popups","events","iphub","packs","community","stories"]'::jsonb then raise exception 'default order'; end if;
  if nav->3<>'{"id":"popups","label":"POP-UP","visible":true}'::jsonb then raise exception 'popups default entry'; end if;
  if nav->4<>'{"id":"events","label":"EVENT","visible":true}'::jsonb then raise exception 'events default entry'; end if;
  for entry in select value from jsonb_array_elements(nav) where value->>'id' in ('iphub','packs','community','stories') loop
    if (entry->>'visible')::boolean then raise exception 'hidden by default: %',entry->>'id'; end if;
  end loop;
end $$;

-- 2. 공개 조회는 보이는 메뉴만 순서대로 준다.
set local role anon;
select 1 / case when public.get_storefront_navigation()='[{"id":"new","label":"NEW"},{"id":"best","label":"BEST"},{"id":"shop","label":"카테고리"},{"id":"popups","label":"POP-UP"},{"id":"events","label":"EVENT"}]'::jsonb then 1 else 0 end as assert_public_default_projection;
reset role;

-- 3. 검증: 9개 + popups 허용, 8개·10개·미등록 id·중복 id·숨긴 카테고리는 거절한다.
do $$ declare nav jsonb;
begin
  select navigation into nav from public.store_settings where singleton;
  if not private.store_navigation_valid(nav) then raise exception 'nine menus rejected'; end if;
  if private.store_navigation_valid(nav-3) then raise exception 'eight menus accepted'; end if;
  if private.store_navigation_valid(nav||'[{"id":"new","label":"또","visible":true}]'::jsonb) then raise exception 'ten menus accepted'; end if;
  if private.store_navigation_valid(jsonb_set(nav,'{3,id}','"offline-popups"')) then raise exception 'unregistered id accepted'; end if;
  if private.store_navigation_valid(jsonb_set(nav,'{3,id}','"events"')) then raise exception 'duplicate id accepted'; end if;
  if private.store_navigation_valid(jsonb_set(nav,'{2,visible}','false')) then raise exception 'hidden shop accepted'; end if;
  if private.store_navigation_valid(jsonb_set(nav,'{3,label}','""')) then raise exception 'empty label accepted'; end if;
  if private.store_navigation_valid(jsonb_set(nav,'{3,href}','"/admin"')) then raise exception 'extra key accepted'; end if;
  -- 8개짜리 옛 저장 요청은 제약이 거절한다(앱의 관용 파싱이 9개로 올려 저장한다).
  begin
    update public.store_settings set navigation=nav-3 where singleton; raise exception 'eight-menu row accepted';
  exception when check_violation then null; end;
  begin
    update public.store_settings set navigation=jsonb_set(nav,'{3,id}','"offline-popups"') where singleton; raise exception 'unregistered id row accepted';
  exception when check_violation then null; end;
end $$;

-- 4. 9개 설정은 순서·이름·노출을 그대로 저장하고 공개 조회가 그 선택을 따른다(popups 도 숨길 수 있다).
do $$ declare saved jsonb;
begin
  update public.store_settings set navigation='[{"id":"events","label":"행사","visible":true},{"id":"popups","label":"팝업","visible":false},{"id":"shop","label":"분류","visible":true},{"id":"new","label":"신상","visible":true},{"id":"best","label":"BEST","visible":false},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":false},{"id":"community","label":"커뮤니티","visible":false},{"id":"stories","label":"쇼핑스토리","visible":false}]'::jsonb where singleton;
  select navigation into saved from public.store_settings where singleton;
  if public.get_storefront_navigation()<>'[{"id":"events","label":"행사"},{"id":"shop","label":"분류"},{"id":"new","label":"신상"},{"id":"iphub","label":"온라인 팝업"}]'::jsonb then
    raise exception 'public projection must follow saved order and visibility'; end if;
  if jsonb_array_length(saved)<>9 then raise exception 'saved nine menus lost'; end if;
end $$;

-- 5. 이행 규칙. 옛 기본값 그대로면 새 기본값으로 통째 교체한다.
update public.store_settings set navigation=default where singleton;
do $$ declare current_default jsonb; old_default jsonb; custom jsonb; upgraded jsonb;
begin
  select navigation into current_default from public.store_settings where singleton;
  old_default:='[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":true},{"id":"events","label":"이벤트","visible":true},{"id":"community","label":"커뮤니티","visible":true},{"id":"stories","label":"쇼핑스토리","visible":true}]';
  if private.upgrade_store_navigation_popups(old_default)<>current_default then raise exception 'untouched old default must become the new default'; end if;

  -- 사용자 정의: 이름·순서·노출은 보존하고 popups(노출)를 카테고리 바로 뒤에 끼우며 쇼핑스토리만 숨긴다(MD-0035).
  custom:='[{"id":"best","label":"인기","visible":true},{"id":"shop","label":"분류","visible":true},{"id":"new","label":"신상","visible":false},{"id":"events","label":"행사","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":false},{"id":"community","label":"커뮤니티","visible":true},{"id":"stories","label":"쇼핑스토리","visible":true}]';
  upgraded:=private.upgrade_store_navigation_popups(custom);
  if upgraded<>'[{"id":"best","label":"인기","visible":true},{"id":"shop","label":"분류","visible":true},{"id":"popups","label":"POP-UP","visible":true},{"id":"new","label":"신상","visible":false},{"id":"events","label":"행사","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":false},{"id":"community","label":"커뮤니티","visible":true},{"id":"stories","label":"쇼핑스토리","visible":false}]'::jsonb then
    raise exception 'customized settings must keep operator choices and gain popups after shop: %',upgraded; end if;
  if not private.store_navigation_valid(upgraded) then raise exception 'upgraded customized settings invalid'; end if;

  -- 옛 기본값에서 이름 하나만 바꿔도 사용자 정의다 — 통째 교체하지 않고 선택을 보존한다.
  upgraded:=private.upgrade_store_navigation_popups(jsonb_set(old_default,'{5,label}','"행사"'));
  if not exists(select 1 from jsonb_array_elements(upgraded) entry where entry->>'id'='events' and entry->>'label'='행사')
     or upgraded->3->>'id' is distinct from 'popups' or jsonb_array_length(upgraded)<>9
     or (upgraded->8->>'visible')::boolean or upgraded->8->>'id' is distinct from 'stories' then raise exception 'one renamed label makes the default customized'; end if;

  -- 이미 9개(popups 있음)·배열이 아닌 값은 그대로 둔다 — 두 번 돌려도 같다.
  if private.upgrade_store_navigation_popups(current_default)<>current_default then raise exception 'nine menus must pass through'; end if;
  if private.upgrade_store_navigation_popups(private.upgrade_store_navigation_popups(custom))<>private.upgrade_store_navigation_popups(custom) then raise exception 'upgrade must be idempotent'; end if;
  if private.upgrade_store_navigation_popups('null'::jsonb)<>'null'::jsonb then raise exception 'non-array passes through'; end if;
end $$;

-- 6. 검증·이행 함수는 클라이언트 롤에 열지 않는다(Supabase 기본 grant 봉인).
select 1 / case when not has_function_privilege('anon','private.upgrade_store_navigation_popups(jsonb)','execute')
  and not has_function_privilege('authenticated','private.upgrade_store_navigation_popups(jsonb)','execute')
  and not has_function_privilege('service_role','private.upgrade_store_navigation_popups(jsonb)','execute')
  and not has_function_privilege('anon','private.store_navigation_valid(jsonb)','execute')
  and not has_function_privilege('authenticated','private.store_navigation_valid(jsonb)','execute')
  and not has_function_privilege('service_role','private.store_navigation_valid(jsonb)','execute') then 1 else 0 end as assert_sealed_functions;
rollback;
