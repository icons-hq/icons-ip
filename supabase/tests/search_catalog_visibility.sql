\set ON_ERROR_STOP on
begin;

insert into public.verticals(key,label,color) values ('search-visibility','검색 통합','#000000');
insert into public.ips(id,title,vertical_key,published_at)
values ('search-visibility-live','검색통합 공개 IP','search-visibility',now()),
 ('search-visibility-draft','검색통합 초안 IP','search-visibility',null);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,sale_restriction)
values ('search-visibility-live-good','search-visibility-live','검색통합 공개 굿즈','문구',12000,'ok',1,'none'),
 ('search-visibility-adult-good','search-visibility-live','검색통합 제한 굿즈','문구',12000,'ok',1,'adult'),
 ('search-visibility-draft-good','search-visibility-draft','검색통합 초안 굿즈','문구',12000,'ok',1,'none');

set local role anon;
select 1 / case when exists (
 select 1 from public.search_public_content('검색통합',20)
 where kind='good' and id='search-visibility-live-good'
) then 1 else 0 end as assert_public_unrestricted_good_is_searchable;
select 1 / case when not exists (
 select 1 from public.search_public_content('검색통합',20)
 where kind='good' and id='search-visibility-adult-good'
) then 1 else 0 end as assert_published_ip_does_not_expose_restricted_good;
select 1 / case when not exists (
 select 1 from public.search_public_content('검색통합',20)
 where id in ('search-visibility-draft','search-visibility-draft-good')
) then 1 else 0 end as assert_unrestricted_good_does_not_expose_draft_ip;
reset role;

-- Taking the public family down also removes the previously visible positive control.
update public.ips set published_at=null where id='search-visibility-live';
set local role anon;
select 1 / case when not exists (
 select 1 from public.search_public_content('검색통합',20)
 where kind in ('ip','good')
) then 1 else 0 end as assert_unpublish_excludes_all_catalog_results;
reset role;
rollback;
