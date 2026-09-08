begin;
set local app.staging_seed_enabled = 'admin-ops-v1';
\ir ../seeds/admin-ops-staging.sql
do $$ begin
  if (select count(*) from public.orders where id::text like 'de100000-%') <> 120
    or (select count(*) from public.inquiries where id::text like 'de300000-%') <> 10
    or (select count(*) from public.goods where id like 'demo-goods-%') <> 20 then
    raise exception 'staging seed counts differ';
  end if;
end $$;
update public.goods set name = '운영자가 수정한 이름' where id = 'demo-goods-001';
update public.inquiries set title = '운영자가 수정한 문의' where id = 'de300000-0000-4000-8000-000000000001';
\ir ../seeds/admin-ops-staging.sql
do $$ begin
  if (select name from public.goods where id = 'demo-goods-001') <> '운영자가 수정한 이름'
    or (select title from public.inquiries where id = 'de300000-0000-4000-8000-000000000001') <> '운영자가 수정한 문의'
    or (select count(*) from public.orders where id::text like 'de100000-%') <> 120 then
    raise exception 'staging rerun replaced rehearsal state or duplicated orders';
  end if;
end $$;
rollback;
