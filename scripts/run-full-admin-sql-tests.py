"""Run the admin extension SQL contracts in an explicit fresh local/CI database."""
import argparse, json, os, re, subprocess, time
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--runtime-json');parser.add_argument('--container');parser.add_argument('--scope',choices=['isolated-local','ci'],default='isolated-local');parser.add_argument('--output-dir',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=Path(args.output_dir).resolve();out.mkdir(parents=True,exist_ok=True)
if args.scope=='ci':
 assert not args.runtime_json and args.container=='supabase_db_icons-ip' and os.environ.get('CI')=='true' and os.environ.get('GITHUB_ACTIONS')=='true','CI identity required'
 project='icons-ip';target=args.container
else:
 assert args.runtime_json and not args.container,'Explicit fresh runtime manifest required'
 runtime=json.loads(Path(args.runtime_json).read_text());project=runtime['projectId'];target=runtime['databaseContainerId'];assert re.fullmatch(r'icons-ip-full-replay-[a-f0-9]{8}',project)
meta=json.loads(subprocess.check_output(['docker','inspect',target],timeout=15))[0];cid=meta['Id'];assert meta['Name']=='/supabase_db_'+project and meta['State']['Running'] and meta['Config']['Labels']['com.supabase.cli.project']==project
if args.scope!='ci':assert cid==target
sql=lambda text:subprocess.check_output(['docker','exec',cid,'psql','-X','-U','postgres','-d','postgres','-At','-c',text],timeout=15).decode().strip()
assert sql('select configured from private.operator_access_state where id')=='f','Use an unconfigured fresh database, never browser QA or production'
helper=(root/'supabase/tests/helpers/goods_kc_fixture.sql').read_bytes()
tests=['operator_capability_coverage','operator_capability_guards','goods_group_console','goods_list_bulk_operations','shipping_template_fulfillment','member_activity','customer_demographics','customer_rewards','customer_grade_rewards_checkout','marketing_coupon_test_receipts','coupon_target_issuance','coupon_category_targeting','purchase_confirmation','in_transit_claim_intake','claim_full_address_collection','claim_fees','combined_packing','review_types','order_production','fulfillment_checkout','coupon_combinations','coupon_ip_targeting','goods_bulk_ip_discount']
results=[]
for name in tests:
 source=root/'supabase/tests'/f'{name}.sql';started=time.monotonic()
 result=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input=(b'' if name.startswith('operator_') else helper)+source.read_bytes(),capture_output=True,timeout=90)
 (out/f'{name}.log').write_bytes(result.stdout+result.stderr);results.append({'name':name,'exitCode':result.returncode,'seconds':round(time.monotonic()-started,3)})
 print(json.dumps(results[-1]),flush=True)
 if result.returncode:print(result.stderr.decode()[-1800:],flush=True)
(out/'result.json').write_text(json.dumps({'projectId':project,'containerId':cid,'results':results},indent=2))
raise SystemExit(1 if any(r['exitCode'] for r in results) else 0)
