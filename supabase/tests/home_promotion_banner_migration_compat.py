"""Before-apply compatibility in the disposable banner test DB, always rolled back."""
from pathlib import Path
import os
import subprocess
import sys

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_home_banner_concurrency_'):
    raise SystemExit('Use the disposable banner wrapper')
migration = Path(sys.argv[1]).resolve()
if migration.name != '20261020085316_home_promotion_banner_settings.sql':
    raise SystemExit('Expected the reviewed banner migration')
setup = r"""
\set ON_ERROR_STOP on
begin;
load 'safeupdate';
-- This database is a disposable clone. Retire its copied heroes to make exactly
-- eleven pre-migration synthetic records; neither source DB nor Storage changes.
delete from public.home_curations where kind='hero';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values('95400000-0000-4000-8000-000000000001','authenticated','authenticated','banner-legacy-compat@example.test',now(),'{"testFixture":"banner-compat"}','{}');
update public.profiles set role='staff' where id='95400000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('95400000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/curation/95500000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','95400000-0000-4000-8000-000000000001','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,12)n;
select set_config('request.jwt.claim.sub','95400000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$declare n integer;begin
 for n in 1..11 loop
  perform public.admin_upsert_home_curation(('95400000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,
   ('95400000-0000-4000-8200-'||lpad(n::text,12,'0'))::uuid,'hero',null,repeat('가',120),
   'public-media/catalog/curation/95500000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','/shop',n,'2026-01-01',null,true,null,jsonb_build_object('subtitle',repeat('나',200)));
 end loop;
end$$;
reset role;
"""
checks = r"""
set local role authenticated;
-- New CAS writes may retain 120/200-character legacy copy and disable a banner
-- even when eleven records already exist. Exact old receipts still replay.
select public.admin_save_home_curation('95400000-0000-4000-8300-000000000001',id,'hero',null,title,image_path,null,display_order,active_from,active_to,false,slot,payload,updated_at)
 from public.home_curations where id='95400000-0000-4000-8200-000000000001';
select public.admin_upsert_home_curation('95400000-0000-4000-8100-000000000001','95400000-0000-4000-8200-000000000001','hero',null,repeat('가',120),
 'public-media/catalog/curation/95500000-0000-4000-8000-000000000001.webp','/shop',1,'2026-01-01',null,true,null,jsonb_build_object('subtitle',repeat('나',200)));
select 1/case when count(*)=11 and max(char_length(title))=120 and max(char_length(payload->>'subtitle'))=200
 and count(*) filter(where not enabled)=1 then 1 else 0 end as legacy_rows_kept from public.home_curations where kind='hero';
do $$begin
 begin
  perform public.admin_save_home_curation(gen_random_uuid(),id,'hero',null,repeat('다',41),image_path,link_path,display_order,active_from,active_to,false,slot,payload,updated_at)
   from public.home_curations where id='95400000-0000-4000-8200-000000000001';
  raise exception 'Expected changed legacy title to fail';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_hero_title' then raise;end if;end;
 begin
  perform public.admin_save_home_curation(gen_random_uuid(),id,'hero',null,title,image_path,link_path,display_order,active_from,active_to,false,slot,jsonb_build_object('subtitle',repeat('다',151)),updated_at)
   from public.home_curations where id='95400000-0000-4000-8200-000000000001';
  raise exception 'Expected changed legacy subtitle to fail';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_hero_subtitle' then raise;end if;end;
 begin
  perform public.admin_save_home_curation(gen_random_uuid(),gen_random_uuid(),'hero',null,'추가','public-media/catalog/curation/95500000-0000-4000-8000-000000000012.webp',null,0,'2026-01-01',null,true,null,null,null);
  raise exception 'Expected twelfth banner to fail';
 exception when check_violation then if sqlerrm<>'home_hero_limit' then raise;end if;end;
end$$;
reset role;
rollback;
"""
result = subprocess.run(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-q'],
 input=setup+'\n'+migration.read_text()+'\n'+checks, text=True, capture_output=True)
if result.returncode:
    raise RuntimeError(result.stdout+'\n'+result.stderr)
print('PASS legacy migration compatibility: eleven existing rows, unchanged 120/200 copy, disable, old RPC replay; new/changed limits enforced; rolled back',flush=True)
