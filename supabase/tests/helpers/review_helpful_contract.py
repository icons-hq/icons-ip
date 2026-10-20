"""Read-only schema/ACL/registry/full-ledger and row-hash snapshots for helpful tests."""
import json
import re
import subprocess

SCHEMA_QUERY = "select jsonb_build_object(\n 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),\n 'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)\n order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) order by p.oid::regprocedure::text)\n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth','storage') and p.prokind='f'),\n 'policies',(select jsonb_agg(jsonb_build_object('table',p.polrelid::regclass::text,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,\n 'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by r) from unnest(p.polroles)r),\n 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polrelid::regclass::text,p.polname)\n from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage')),\n 'tables',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,\n 'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)\n order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a),\n 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)\n from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),\n 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid,true)) order by con.conname),'[]') from pg_constraint con where con.conrelid=c.oid),\n 'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text),'[]') from pg_index i where i.indrelid=c.oid),\n 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(t.oid,true) order by t.tgname),'[]') from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.oid::regclass::text)\n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage') and c.relkind in('r','p')));"

REGISTRY_QUERY = "select jsonb_build_object('internals',(select jsonb_agg(to_jsonb(r) order by signature) from private.operator_internal_contracts r),'rpc',(select jsonb_agg(to_jsonb(r) order by signature) from private.operator_rpc_contracts r),'policies',(select jsonb_agg(to_jsonb(r) order by schema_name,table_name,policy_name) from private.operator_policy_contracts r));"

LEDGER_QUERY = 'select jsonb_agg(to_jsonb(r) order by version) from supabase_migrations.schema_migrations r;'

REGISTRY_TABLES = {'private.operator_internal_contracts', 'private.operator_rpc_contracts', 'private.operator_policy_contracts'}


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql(container, database, statement):
    body = "begin read only;set local search_path='';set local statement_timeout='60s';\n" + statement.rstrip().rstrip(';') + ';\nrollback;'
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=body, text=True, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError('Read-only contract query failed; data is not printed')
    return result.stdout.strip()


def rows_query(tables):
    names = sorted(t['table'] for t in tables if t['table'] not in REGISTRY_TABLES)
    parts = []
    for name in names:
        if not re.fullmatch(r'(public|private|auth|storage)\.[a-z_][a-z0-9_]*', name):
            raise RuntimeError('Unexpected identifier in contract snapshot')
        parts.append("select " + quote(name) + " name,jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''))) value from " + name + ' t')
    return 'select jsonb_object_agg(name,value) from (' + ' union all '.join(parts) + ') rows;'


def snapshot(container, database):
    schema = json.loads(sql(container, database, SCHEMA_QUERY))
    queries = dict(schema=SCHEMA_QUERY, ledger=LEDGER_QUERY, registry=REGISTRY_QUERY, rows=rows_query(schema['tables']))
    query = 'select jsonb_build_object(' + ','.join(quote(k) + ',(' + v.rstrip(';') + ')' for k, v in queries.items()) + ');'
    value = json.loads(sql(container, database, query))
    if value['schema'] != schema:
        raise RuntimeError('Schema changed while taking a contract snapshot')
    return value
