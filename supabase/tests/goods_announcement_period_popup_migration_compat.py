"""Apply one reviewed DRAFT only inside a named disposable clone, preserving old APIs."""
from pathlib import Path
import hashlib,json,os,subprocess,sys
container=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['PGDATABASE']
if not database.startswith('icons_notice_popup_race_'):raise SystemExit('Use the disposable notice popup wrapper')
source=Path(sys.argv[1]).read_text();expected=sys.argv[2]
assert hashlib.sha256(source.encode()).hexdigest()==expected
cmd=['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-qAt']
def sql(q):
 r=subprocess.run(cmd,input=q,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
query="""select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(n)-array['important_starts_at','important_ends_at'] order by id) from public.goods_announcements n),'[]'),
'links',coalesce((select jsonb_agg(to_jsonb(l) order by announcement_id,good_id) from public.goods_announcement_goods l),'[]'),
'oldFunctions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_save_goods_announcement','admin_get_goods_announcement','admin_list_goods_announcements','admin_search_goods_for_announcement')));"""
before=sql(query);sql('begin;'+source+'commit;');after=sql(query);assert before==after
assert sql("select announcement_id is null and revision=0 and starts_at is null and ends_at is null and dismiss_key is null from private.home_announcement_popup where singleton;")=='t'
print(json.dumps({'status':'PASS','legacyRowsLinksAndFourFunctionDefinitionsOwnersAclsUnchanged':True,'actualDefaultSelectionRevisionZero':True,'sha256':expected}),flush=True)
