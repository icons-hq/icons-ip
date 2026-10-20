do $$declare r record;h text;begin
 for r in select * from private.category_display_tree_migration_proof loop
  execute format('select md5(coalesce(jsonb_agg(v order by v::text),''[]''::jsonb)::text) from (select to_jsonb(t) v from %s t) rows',r.relation_name) into h;
  if h is distinct from r.row_hash then raise exception 'existing rows changed: %',r.relation_name;end if;
 end loop;
 if exists(select 1 from public.catalog_categories c left join private.category_display_nodes n on n.id=c.id
  where n.id is null or n.parent_id is distinct from c.parent_id or n.name is distinct from c.name or n.sort_order is distinct from c.sort_order
  or n.archived_at is distinct from c.archived_at or n.legacy_category_id is distinct from c.id or n.legacy_sort_key is distinct from c.code)
 then raise exception 'category display backfill lost existing taxonomy';end if;
 if (private.category_display_category('94930000-0000-4000-8000-000000000014')->>'depth')::integer<>4
  or (select revision from private.category_display_compositions where category_id='94930000-0000-4000-8000-000000000014')<>17
 then raise exception 'legacy hierarchy or composition revision changed';end if;
 if (select array_agg(n.id order by n.sort_order,coalesce(n.legacy_sort_key,n.id::text),n.id) from private.category_display_nodes n where n.id in('94930000-0000-4000-8000-000000000015','94930000-0000-4000-8000-000000000016'))
  is distinct from array['94930000-0000-4000-8000-000000000016'::uuid,'94930000-0000-4000-8000-000000000015'::uuid]
 then raise exception 'legacy code tie-break changed';end if;
end$$;
select jsonb_build_object('allExistingTableRowsPreserved',true,'tables',(select count(*) from private.category_display_tree_migration_proof),'legacyFourLevelsAndLongNamePreserved',true,'existingDisplayIdsPreserved',true,'legacyEqualSortOrderPreserved',true);
