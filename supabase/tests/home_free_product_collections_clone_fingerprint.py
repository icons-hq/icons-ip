"""Read canonical definitions/ACLs before rebinding OID-sensitive clone receipts."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
container, database, destination = sys.argv[1:]
if not container.startswith('supabase_db_') or (database != 'postgres' and not database.startswith('icons_home_products_concurrency_')):
    raise SystemExit('Expected explicitly selected source or disposable free-product clone')
query = r"""
set search_path='';
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
 'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
 order by a.grantee,a.grantor,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) order by p.oid::regprocedure::text)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
 'policies',(select jsonb_agg(jsonb_build_object('table',p.polrelid::regclass::text,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
 'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r) from unnest(p.polroles)r),
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polrelid::regclass::text,p.polname)
 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage')));
"""
result = subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-qAt'],input=query,text=True,capture_output=True,check=True)
snapshot=json.loads(result.stdout)
serialized=json.dumps(snapshot,ensure_ascii=False,sort_keys=True,separators=(',',':'))
Path(destination).write_text(serialized+'\n')
print(json.dumps({'database':database,'canonicalSha256':hashlib.sha256(serialized.encode()).hexdigest(),'functions':len(snapshot['functions']),'policies':len(snapshot['policies'])}),flush=True)
