-- Clone-only pre-migration evidence. Never run against a named development DB.
do $$begin if current_database() !~ '^icons_category_display_canonical_[0-9a-f]{10}$' then raise exception 'owned clone required';end if;end$$;
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 ('94930000-0000-4000-8000-000000000011','display-migration-root','기존 전시 최상위',null,7),
 ('94930000-0000-4000-8000-000000000012','display-migration-child','기존 전시 중분류','94930000-0000-4000-8000-000000000011',3),
 ('94930000-0000-4000-8000-000000000013','display-migration-third','기존 전시 소분류','94930000-0000-4000-8000-000000000012',9),
 ('94930000-0000-4000-8000-000000000014','display-migration-fourth','스무 글자를 넘는 기존 전시 이름도 자르지 않고 모두 보존합니다','94930000-0000-4000-8000-000000000013',2);
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 ('94930000-0000-4000-8000-000000000016','display-migration-a-tie','동률 첫째','94930000-0000-4000-8000-000000000011',5),
 ('94930000-0000-4000-8000-000000000015','display-migration-z-tie','동률 둘째','94930000-0000-4000-8000-000000000011',5);
insert into public.ips(id,title,vertical_key) values('display-migration-ip','이관 증빙 IP','character');
insert into public.goods(id,ip_id,name,type,price,category_id) values('display-migration-good','display-migration-ip','이관 증빙 상품','문구',3210,'94930000-0000-4000-8000-000000000014');
insert into private.category_display_compositions(category_id,enabled,mode,banner,video_enabled,video_good_id,recommendations,revision,updated_at)
select '94930000-0000-4000-8000-000000000014',false,'manual',private.category_display_defaults('94930000-0000-4000-8000-000000000014')->'banner'||'{"title":"그대로 남아야 하는 배너","content":"첫 줄\n둘째 줄","imagePath":"public-media/catalog/curation/94930000-0000-4000-8000-000000000001.png"}',true,'display-migration-good',
 ((private.category_display_defaults('94930000-0000-4000-8000-000000000014')->'recommendations')-'goodIds')||'{"enabled":true,"title":"보존 추천상품"}',17,'2026-10-12T12:34:56.123456Z';
insert into private.category_display_sources values('94930000-0000-4000-8000-000000000014','94930000-0000-4000-8000-000000000013',0);
insert into private.category_display_goods values('94930000-0000-4000-8000-000000000014','main','display-migration-good',0),('94930000-0000-4000-8000-000000000014','recommend','display-migration-good',0);
create table private.category_display_tree_migration_proof(relation_name text primary key,row_hash text not null);
alter table private.category_display_tree_migration_proof enable row level security;
revoke all on private.category_display_tree_migration_proof from public,anon,authenticated,service_role;
do $$declare r record;h text;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','private') and c.relkind='r'
 and c.relname not in('operator_internal_contracts','operator_rpc_contracts','category_display_tree_migration_proof') order by 1,2 loop
  execute format('select md5(coalesce(jsonb_agg(v order by v::text),''[]''::jsonb)::text) from (select to_jsonb(t) v from %I.%I t) rows',r.nspname,r.relname) into h;
  insert into private.category_display_tree_migration_proof values(r.nspname||'.'||r.relname,h);
 end loop;
end$$;
