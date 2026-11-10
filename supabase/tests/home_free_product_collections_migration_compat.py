"""Preserve over-cap legacy mosaics in a disposable clone; always roll back."""
from pathlib import Path
import os
import subprocess
import sys

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_home_products_concurrency_'):
    raise SystemExit('Use the disposable free-product wrapper')
migration = Path(sys.argv[1]).resolve()
if migration.name != '20261020085320_home_free_product_collections.sql':
    raise SystemExit('Expected the free-product draft migration')
setup = r"""
\set ON_ERROR_STOP on
begin;
load 'safeupdate';
-- Only this disposable clone is altered to represent historical over-cap data.
delete from public.home_curations where kind in ('product_mosaic','product_collection');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values('96600000-0000-4000-8000-000000000001','authenticated','authenticated','free-legacy-compat@example.test',now(),'{"testFixture":"free-products-compat"}','{}');
update public.profiles set role='staff' where id='96600000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('96600000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
alter table public.home_curations disable trigger home_curations_mosaic_artwork;
insert into public.home_curations(id,kind,title,link_path,active_from,active_to,enabled,payload)
 select ('96600000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,'product_mosaic','기존 모자이크 '||n,'/shop','2020-01-01',
 case when n=7 then '2020-02-01'::timestamptz else null end,n<5,
 jsonb_build_object('mosaic_title','제목','mosaic_subtitle','부제','slots',(select jsonb_agg(jsonb_build_object('good_id',null,'image_path',null)) from generate_series(1,8)))
 from generate_series(1,7)n;
alter table public.home_curations enable trigger home_curations_mosaic_artwork;
create temp table free_legacy_before as select * from public.home_curations where kind='product_mosaic';
"""
checks = r"""
select 1/case when not exists((select * from free_legacy_before except select * from public.home_curations)
 union all (select * from public.home_curations where kind='product_mosaic' except select * from free_legacy_before)) then 1 else 0 end as migration_preserves_every_legacy_column;
select set_config('request.jwt.claim.sub','96600000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_home_curation(gen_random_uuid(),id,kind,null,'기존 수정',image_path,link_path,display_order,active_from,active_to,false,slot,payload,updated_at)
 from public.home_curations where id='96600000-0000-4000-8100-000000000001';
select 1/case when count(*)=7 and count(*) filter(where title='기존 수정' and not enabled)=1 then 1 else 0 end as above_cap_mosaic_stays_editable from public.home_curations where kind='product_mosaic';
do $$begin
 begin
  perform public.admin_save_home_curation(gen_random_uuid(),gen_random_uuid(),'product_collection',null,'새 자유상품',null,null,0,'2020-01-01',null,false,null,
   '{"layout":"list","image_shape":"square","item_count":3,"good_ids":[]}',null);
  raise exception 'Expected new collection at legacy over-cap to fail';
 exception when check_violation then if sqlerrm<>'home_free_product_limit' then raise;end if;end;
end$$;
reset role;
rollback;
"""
result = subprocess.run(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-q'],
 input=setup+'\n'+migration.read_text()+'\n'+checks,text=True,capture_output=True)
if result.returncode:
    raise RuntimeError(result.stdout+'\n'+result.stderr)
print('PASS migration compatibility: seven legacy mosaics preserved exactly; edit/hide allowed; additions blocked; rolled back',flush=True)
