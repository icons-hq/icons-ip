\set ON_ERROR_STOP on
begin;
update public.ips set featured=false;
insert into public.verticals(key,label,color) values ('ip-seed-curation','노출 시드 검증','#000000');
insert into public.ips(id,title,vertical_key,featured)
select 'ip-seed-curation-'||n,'운영자 선정 '||n,'ip-seed-curation',true from generate_series(1,5)n;
create temp table before_seed_directory as select id,featured,sort_order from public.ips;
\ir ../seed.sql
\ir ../seed.sql
select 1 / case when (select count(*) from public.ips where featured)=5
 and not exists(select 1 from before_seed_directory original join public.ips current using(id)
 where original.featured is distinct from current.featured or original.sort_order is distinct from current.sort_order)
 then 1 else 0 end as assert_repeated_seed_preserves_operator_directory_selection_and_order;
rollback;
