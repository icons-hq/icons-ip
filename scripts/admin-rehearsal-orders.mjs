import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function uuid(key) {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/** Emits reviewable insert-only SQL; never connects to a database. */
export function buildRehearsalOrdersSql({
  run,
  count = 100,
  originCode = 'gimpo',
}) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(run ?? ''))
    throw new Error('run requires 3–40 lowercase letters, digits or hyphens');
  if (count !== 100 || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(originCode))
    throw new Error('S3 requires 100 orders and a valid origin code');
  const customerId = uuid(`admin-ops-rehearsal:${run}:customer`);
  const email = `rehearsal.${run}@staging.icons.test`;
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `(${i + 1},'${uuid(`admin-ops-rehearsal:${run}:order:${i + 1}`)}'::uuid,'${uuid(`admin-ops-rehearsal:${run}:item:${i + 1}`)}'::uuid)`,
  ).join(',\n');
  return {
    customerId,
    query: email,
    sql: `-- Synthetic S3 run ${run}. No password, payment receipt, external message or stock write.
-- Reusing this run name preserves practised states. Use a new run for 100 new paid orders.
begin;
do $$ begin
 if current_setting('app.staging_seed_enabled',true) is distinct from 'admin-ops-v1' then raise exception 'verified isolated staging session required'; end if;
 if not exists(select 1 from public.fulfillment_origins where code='${originCode}' and is_active) then raise exception 'active rehearsal origin required'; end if;
 if (select count(*) from public.goods where id like 'demo-goods-%' and archived_at is null)<20 then raise exception 'apply admin-ops-staging seed first'; end if;
end $$;
do $$ begin
 if not exists(select 1 from auth.users where id='${customerId}') then
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('${customerId}','authenticated','authenticated','${email}',now(),jsonb_build_object('staging_fixture','admin-ops-rehearsal','run','${run}'),'{}',now(),now());
  update public.profiles set nickname='리허설 ${run}' where id='${customerId}';
 elsif not exists(select 1 from auth.users where id='${customerId}' and raw_app_meta_data->>'staging_fixture'='admin-ops-rehearsal') then
  raise exception 'rehearsal customer identity conflict';
 end if;
end $$;
create temporary table rehearsal_inputs on commit drop as
select batch.n,batch.order_id,batch.item_id,g.id good_id,g.name,g.type,g.ip_id,v.id variant_id,v.price,
 origin.id origin_id,quote.value fee
from (values ${rows}) batch(n,order_id,item_id)
join public.goods g on g.id='demo-goods-'||lpad((1+((batch.n-1)%20))::text,3,'0')
join public.goods_variants v on v.good_id=g.id and v.is_default and v.archived_at is null
join public.fulfillment_origins origin on origin.code='${originCode}'
cross join lateral (select private.calculate_goods_shipping(jsonb_build_array(jsonb_build_object(
 'origin_id',origin.id,'good_id',g.id,'qty',1,'unit_price',v.price,'fee_type','policy','individual_fee',0))) value) quote;
do $$ begin if (select count(*) from rehearsal_inputs)<>100 then raise exception '100 current default options required'; end if; end $$;
insert into public.orders(id,user_id,status,total,address,shipping_fee,shipping_fee_breakdown,payment_method)
select order_id,'${customerId}','paid',price+(fee->>'totalFee')::bigint,
 jsonb_build_object('recipientName','데모 ${run}','phone','01000000000','postalCode','00000','address1','가상 주소 - 배송 금지','address2','${run}','deliveryRequest','운영 연습 데이터 / 실제 출고 금지'),
 (fee->>'totalFee')::bigint,fee->'groups','card'
from rehearsal_inputs on conflict(id) do nothing;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
 origin_id_snapshot,shipping_fee_type_snapshot,individual_fee_snapshot)
select item_id,order_id,good_id,variant_id,1,price,name,type,ip_id,origin_id,'policy',0 from rehearsal_inputs on conflict(id) do nothing;
select private.create_order_shipments(order_id) from rehearsal_inputs;
commit;
`,
  };
}
async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1])
      throw new Error('Use --name value pairs');
    values[args[i].slice(2)] = args[i + 1];
  }
  if (!values.out) throw new Error('--out directory is required');
  const directory = resolve(values.out);
  await mkdir(directory, { recursive: true });
  const result = buildRehearsalOrdersSql({
    run: values.run,
    originCode: values.origin ?? 'gimpo',
  });
  await writeFile(`${directory}/orders-100.sql`, result.sql, { flag: 'wx' });
  await writeFile(
    `${directory}/orders-manifest.json`,
    JSON.stringify(
      {
        run: values.run,
        customerId: result.customerId,
        query: result.query,
        count: 100,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(
    `Created ${directory}/orders-100.sql; search orders by ${result.query}. No database connection was made.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
