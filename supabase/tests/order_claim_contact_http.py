"""Real local HTTP and AES integration on an explicitly owned disposable clone only."""
if not __debug__:
 raise SystemExit('Optimized Python is not allowed for database fixture tools')
import base64,hashlib,hmac,json,os,re,secrets,signal,subprocess,sys,time,urllib.parse,urllib.request,uuid
from pathlib import Path
def interrupted(number,frame):
 raise SystemExit(128+number)
signal.signal(signal.SIGTERM,interrupted)
signal.signal(signal.SIGINT,interrupted)
ROOT=Path.cwd()
if len(sys.argv)!=4:raise SystemExit('Expected immutable container ID, disposable database and output directory')
cid,db,destination=sys.argv[1:]
if not re.fullmatch(r'[0-9a-f]{64}',cid) or not re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}',db):raise SystemExit('Expected immutable container and leased local clone')
out=Path(destination)

command=['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1']
def sql(body):
 r=subprocess.run(command,input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]
assert identity['Id']==cid and identity['State']['Running']
assert re.fullmatch(r'/supabase_db_icons-ip(?:-[a-z0-9]+)*',identity['Name'])
assert identity['Config']['Labels']['com.supabase.cli.project']==identity['Name'].removeprefix('/supabase_db_')
lease=json.loads(sql('begin read only;select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;commit;').splitlines()[-1])
assert lease['container_id']==cid and lease['source_database']=='postgres' and lease['lease'].replace('-','')==db[-32:]
out.mkdir(parents=True,exist_ok=True)

salt='claim-contact-http-'+uuid.uuid4().hex[:10];prefix='cc-http-'+uuid.uuid4().hex[:8]
uid=lambda kind,n:str(uuid.UUID(hashlib.md5(f'{salt}:{kind}:{n}'.encode()).hexdigest()))
fixture=(ROOT/'supabase/tests/order_claim_contact.sql').read_text();fixture=fixture[:fixture.index("select pg_temp.cc_error('select pg_temp.cc_context(1)'")]
fixture=fixture.replace('claim-contact-',salt+'-').replace('claim-contact:',salt+':').replace('cc-good',prefix+'-good').replace('cc-ip',prefix+'-ip').replace('cc-origin',prefix+'-origin')
sql(fixture+'update private.order_claim_contact_runtime set enabled=true where singleton;commit;')
network,network_config=next(iter(identity['NetworkSettings']['Networks'].items()));db_env=dict(v.split('=',1) for v in identity['Config']['Env'] if '=' in v)
secret=secrets.token_hex(32)
minimal_env={key:os.environ[key] for key in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS') if key in os.environ}
env={**minimal_env,'PGRST_DB_URI':'postgresql://authenticator:'+urllib.parse.quote(db_env['POSTGRES_PASSWORD'],safe='')+'@'+network_config['IPAddress']+':5432/'+db,
 'PGRST_JWT_SECRET':secret,'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_SERVER_PORT':'3000'}
image='public.ecr.aws/supabase/postgrest:v14.14';subprocess.run(['docker','image','inspect',image],capture_output=True,check=True)
run=['docker','run','-d','--name',prefix,'--network',network,'-p','127.0.0.1::3000']
for key in ['PGRST_DB_URI','PGRST_JWT_SECRET','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_SERVER_PORT']:run+=['-e',key]
rest=None
test_process=None
try:
 rest=subprocess.check_output(run+[image],env=env,text=True).strip();assert len(rest)==64
 info=json.loads(subprocess.check_output(['docker','inspect',rest],text=True))[0];origin='http://127.0.0.1:'+info['NetworkSettings']['Ports']['3000/tcp'][0]['HostPort']
 for _ in range(100):
  try:
   with urllib.request.urlopen(origin+'/',timeout=.5) as response:
    if response.status==200:break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Ephemeral PostgREST not ready')
 def token(role,actor=None):
  enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')
  claims={'role':role,'exp':int(time.time())+900}
  if actor:claims.update(sub=uid('user',actor),session_id=uid('session',actor))
  body=enc({'alg':'HS256','typ':'JWT'})+b'.'+enc(claims);return(body+b'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),body,hashlib.sha256).digest()).rstrip(b'=')).decode()
 keyring={'v':1,'environment':'local','backendOrigin':origin,'activeKeyVersion':'k1','keys':{'k1':{purpose:base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode() for purpose in ['encryptionKey','addressHmacKey','requestHmacKey','contextSigningKey']}}}
 test_env={**minimal_env,'CC_POSTGREST_ORIGIN':origin,'CC_SERVICE_TOKEN':token('service_role'),'CC_CUSTOMER_TOKEN':token('authenticated',2),
 'ICONS_CLAIM_CONTACT_ENABLED':'1','ICONS_CLAIM_CONTACT_ENVIRONMENT':'local','ICONS_CLAIM_CONTACT_KEYRING_JSON':json.dumps(keyring),'NEXT_PUBLIC_SUPABASE_URL':origin,
 'CC_INTEGRATION_FIXTURE_JSON':json.dumps({'containerId':cid,'database':db,'orders':[uid('order',n) for n in range(1,19)],'claims':[uid('claim',n) for n in range(1,19)],'users':[uid('user',n) for n in range(1,6)],'sessions':[uid('session',n) for n in range(1,6)]})}
 test_process=subprocess.Popen(['node',str(ROOT/'node_modules/vitest/vitest.mjs'),'run','--config','supabase/tests/order-claim-contact-vitest.config.ts','--reporter=verbose'],env=test_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 stdout,stderr=test_process.communicate()
 (out/'integration.log').write_text(stdout+stderr);print(stdout[-7000:]);print(stderr[-7000:])
 if test_process.returncode:raise RuntimeError('Live integration failed')
 (out/'result.json').write_text(json.dumps({'status':'PASS','database':db,'lease':lease['lease'],'fixtureNamespace':salt,'realRouteHandlers':True,'realServiceAndCrypto':True,'realPostgRESTAndSQL':True,'onlyMockedBoundary':'verified HTTP identity acquisition and service-client transport adapter','productionKeysCreated':False,'sourceDatabaseWrites':0,'ephemeralOrigin':origin},indent=2))
finally:
 if test_process is not None and test_process.poll() is None:
  os.killpg(test_process.pid,signal.SIGTERM)
  try:test_process.wait(timeout=10)
  except subprocess.TimeoutExpired:
   os.killpg(test_process.pid,signal.SIGKILL);test_process.wait(timeout=5)
 if rest:subprocess.run(['docker','rm','-f',rest],capture_output=True,check=True)
 print('Ephemeral PostgREST removed; synthetic secrets existed only in process environments',flush=True)
