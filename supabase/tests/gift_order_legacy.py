"""Legacy ordinary-order suites inside the wrapper's leased disposable clone."""
from pathlib import Path
import json,os,re,subprocess,sys
from gift_order_test_support import validate_owned_clone
container=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['SUPABASE_DB_DATABASE'];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
validate_owned_clone(container,database)
root=Path(__file__).parent;results=[]
cases=['order_claims'] if len(sys.argv)<3 or sys.argv[2]=='legacy' else ['order_claim_withdrawal','order_claim_reason_changes','order_claim_type_conversion','admin_order_address_changes']
for name in cases:
 source=(root/'helpers/goods_kc_fixture.sql').read_text()+'\n'+(root/(name+'.sql')).read_text()
 if name=='admin_order_address_changes':
  source=source.replace('order-address:', 'gift-regression-order-address:').replace('order-address-', 'gift-regression-order-address-').replace('address-origin-', 'gift-regression-address-origin-')
  results.append({'fixtureNamespace':'gift-regression','reason':'source clone contains pre-existing address-origin codes'})
 if name=='order_claims':
  # pg_cron is single-database and intentionally absent from the dump clone.
  # Verify only this unchanged installation assertion read-only on its source.
  start=source.index('-- 파기 잡은');end=source.index('-- 알림 타입',start);cron=source[start:end]
  r=subprocess.run(['docker','exec','-i',container,'psql','-X','-b','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='begin read only;\n'+cron+'\nrollback;',text=True,capture_output=True,timeout=30)
  (out/'source-existing-cron-readonly.log').write_text(r.stdout+r.stderr)
  if r.returncode:raise RuntimeError('Source unchanged cron assertion: '+r.stderr)
  source=source[:start]+'-- Existing cron assertion verified read-only on source; pg_cron is not copied.\n'+source[end:]
  results.append({'assertion':'unchanged existing refund account cron','scope':'source-read-only','status':'PASS'})
 r=subprocess.run(['docker','exec','-i',container,'psql','-X','-b','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],input=source,text=True,capture_output=True,timeout=60)
 (out/(name+'.log')).write_text(r.stdout+r.stderr)
 if r.returncode:raise RuntimeError(name+': '+r.stderr[-2500:])
 results.append({'suite':name,'status':'PASS'});print('PASS legacy '+name,flush=True)
(out/'result.json').write_text(json.dumps(results,indent=2)+'\n')
