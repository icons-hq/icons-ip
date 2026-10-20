\set ON_ERROR_STOP on
begin;
do $$ declare nav jsonb; blocks jsonb;
begin
 select navigation into nav from public.store_settings where singleton;
 if not private.store_navigation_valid(nav) or jsonb_array_length(nav)<>8 then
  raise exception 'story navigation migration missing'; end if;
 if (select count(*) from jsonb_array_elements(nav) entry where entry->>'id'='stories')<>1 then
  raise exception 'story destination must occur once'; end if;
 if private.store_navigation_valid((select jsonb_agg(entry) from jsonb_array_elements(nav) entry where entry->>'id'<>'stories')) then
  raise exception 'stale seven-menu write must not remove stories';end if;
 blocks:='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":false},{"key":"category_best","enabled":false},{"key":"popular","enabled":true},{"key":"benefits","enabled":false}]';
 if not private.is_valid_home_layout_blocks(blocks) then raise exception 'saved original layout must remain readable';end if;
end $$;
update public.home_layout_settings set blocks='[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":false},{"key":"category_best","enabled":false},{"key":"popular","enabled":true},{"key":"benefits","enabled":false}]';
set local role anon;
do $$ begin
 if not 'stories'=any(public.get_home_layout_order()) then raise exception 'new story area must append';end if;
end $$;
reset role;
update public.home_layout_settings set blocks=blocks || '[{"key":"stories","enabled":false}]'::jsonb;
update public.store_settings set navigation=(select jsonb_agg(case when entry->>'id'='stories' then jsonb_set(entry,'{visible}','false') else entry end order by ord) from jsonb_array_elements(navigation) with ordinality entries(entry,ord));
set local role anon;
do $$ begin
 if 'stories'=any(public.get_home_layout_order()) then raise exception 'explicit hidden story area revived';end if;
 if exists(select 1 from jsonb_array_elements(public.get_storefront_navigation()) entry where entry->>'id'='stories') then
  raise exception 'hidden story navigation leaked';end if;
end $$;
reset role;
update public.home_layout_settings set blocks='[{"key":"stories","enabled":true}]'::jsonb || (select jsonb_agg(entry) from jsonb_array_elements(blocks) entry where entry->>'key'<>'stories');
set local role anon;
do $$ begin
 if (public.get_home_layout_order())[1]<>'stories' then raise exception 'story order not preserved';end if;
end $$;
rollback;
