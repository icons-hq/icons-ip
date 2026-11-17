-- X SQUARE 스토어프런트(Figma 2026-11-12, ADR-0043): GNB가 NEW·BEST·카테고리·POP-UP·EVENT로 바뀐다.
-- 새 고정 목적지 popups(진행 중인 온·오프라인 팝업 화면)를 공개 메뉴 설정에 더한다. 이 migration 은
--  1. 메뉴 설정 검증 함수가 허용하는 id·개수를 8 → 9로 넓히고,
--  2. 기본값을 새 GNB(NEW·BEST·카테고리·POP-UP·EVENT 노출, 온라인 팝업·카드팩·커뮤니티·쇼핑스토리 숨김)로 바꾸며,
--  3. 이미 저장된 설정을 옮긴다: 운영자가 손대지 않은 옛 기본값이면 새 기본값으로 통째 교체하고,
--     손댔다면 popups(노출)를 카테고리 바로 뒤에 끼우고 쇼핑스토리만 숨긴다(MD-0035). 나머지 이름·순서·노출 선택은 보존한다.
-- 메뉴 저장·공개 조회 함수(admin_save_store_navigation·get_storefront_navigation)는 이 검증 함수를 부를 뿐이라 정의를 바꾸지 않는다.

alter table public.store_settings drop constraint store_settings_navigation_valid;

create or replace function private.store_navigation_valid(settings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare entry jsonb; ids text[]:='{}'; label text;
begin
  if jsonb_typeof(settings) is distinct from 'array' then return false; end if;
  if jsonb_array_length(settings)<>9 then return false; end if;
  for entry in select value from jsonb_array_elements(settings) loop
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    if not entry ?& array['id','label','visible'] or (select count(*) from jsonb_object_keys(entry))<>3
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or entry->>'id' not in ('new','best','shop','popups','events','iphub','packs','community','stories')
      or jsonb_typeof(entry->'label') is distinct from 'string'
      or jsonb_typeof(entry->'visible') is distinct from 'boolean'
      or entry->>'id'=any(ids) then return false; end if;
    label:=entry->>'label';
    if length(label) not between 1 and 20 or label ~ '[[:cntrl:]]'
      or label<>btrim(label,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or (entry->>'id'='shop' and not (entry->>'visible')::boolean) then return false; end if;
    ids:=array_append(ids,entry->>'id');
  end loop;
  return true;
end $$;
revoke all on function private.store_navigation_valid(jsonb) from public,anon,authenticated,service_role;

-- 저장된 8개 설정을 9개로 옮기는 순수 변환. 이 migration 이 쓰고, 옮기는 규칙을 SQL 시험이 직접 부를 수 있게 남겨 둔다.
create function private.upgrade_store_navigation_popups(settings jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  old_default constant jsonb:='[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"iphub","label":"온라인 팝업","visible":true},{"id":"packs","label":"카드팩","visible":true},{"id":"events","label":"이벤트","visible":true},{"id":"community","label":"커뮤니티","visible":true},{"id":"stories","label":"쇼핑스토리","visible":true}]';
  new_default constant jsonb:='[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"popups","label":"POP-UP","visible":true},{"id":"events","label":"EVENT","visible":true},{"id":"iphub","label":"온라인 팝업","visible":false},{"id":"packs","label":"카드팩","visible":false},{"id":"community","label":"커뮤니티","visible":false},{"id":"stories","label":"쇼핑스토리","visible":false}]';
begin
  if settings=old_default then return new_default; end if;
  if jsonb_typeof(settings) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(settings) entry where entry->>'id'='popups') then return settings; end if;
  return (
    select jsonb_agg(item order by position) from (
      select case when entry->>'id'='stories' then jsonb_set(entry,'{visible}','false'::jsonb) else entry end as item, ordinal::numeric as position
      from jsonb_array_elements(settings) with ordinality entries(entry,ordinal)
      union all
      select '{"id":"popups","label":"POP-UP","visible":true}'::jsonb, ordinal::numeric+0.5
      from jsonb_array_elements(settings) with ordinality entries(entry,ordinal) where entry->>'id'='shop'
    ) rebuilt
  );
end $$;
revoke all on function private.upgrade_store_navigation_popups(jsonb) from public,anon,authenticated,service_role;

update public.store_settings set
 navigation=private.upgrade_store_navigation_popups(navigation),
 updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
where private.upgrade_store_navigation_popups(navigation) is distinct from navigation;

alter table public.store_settings alter column navigation set default '[{"id":"new","label":"NEW","visible":true},{"id":"best","label":"BEST","visible":true},{"id":"shop","label":"카테고리","visible":true},{"id":"popups","label":"POP-UP","visible":true},{"id":"events","label":"EVENT","visible":true},{"id":"iphub","label":"온라인 팝업","visible":false},{"id":"packs","label":"카드팩","visible":false},{"id":"community","label":"커뮤니티","visible":false},{"id":"stories","label":"쇼핑스토리","visible":false}]'::jsonb;
alter table public.store_settings add constraint store_settings_navigation_valid check(private.store_navigation_valid(navigation));

select private.register_operator_internal_contract('private.store_navigation_valid(jsonb)'::regprocedure);
notify pgrst,'reload schema';
