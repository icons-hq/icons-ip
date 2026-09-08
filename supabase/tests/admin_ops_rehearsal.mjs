import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildRehearsalOrdersSql } from '../../scripts/admin-rehearsal-orders.mjs';

if (
  !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
  !process.env.PGPORT
)
  throw new Error('Explicit local PGHOST and PGPORT are required');
const fixture = buildRehearsalOrdersSql({ run: 'sql-rehearsal-preservation' });
const seed = await readFile(
  new URL('../seeds/admin-ops-staging.sql', import.meta.url),
  'utf8',
);
const run = fixture.sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const statement = `begin;
select set_config('app.staging_seed_enabled','admin-ops-v1',true);
${seed}
create temporary table expected_stock as select id,stock_qty from public.goods where id like 'demo-goods-%';
${run}
do $$ begin
 if exists(select 1 from expected_stock e join public.goods g using(id) where e.stock_qty<>g.stock_qty) then raise exception 'fixture changed inventory'; end if;
 if (select count(*) from public.orders where user_id='${fixture.customerId}' and status='paid')<>100 then raise exception '100 initial paid orders missing'; end if;
 if (select count(*) from public.order_shipments where order_id in(select id from public.orders where user_id='${fixture.customerId}'))<>100 then raise exception '100 initial shipments missing'; end if;
end $$;
update public.orders set status='confirmed',confirmed_at=now() where id=(select id from public.orders where user_id='${fixture.customerId}' order by id limit 1);
update public.order_shipments set exported_at=now() where order_id in(select id from public.orders where user_id='${fixture.customerId}');
update public.profiles set nickname='기존 리허설 담당 수정값' where id='${fixture.customerId}';
create temporary table expected_orders as select id,to_jsonb(o) payload from public.orders o where user_id='${fixture.customerId}';
create temporary table expected_items as select i.id,to_jsonb(i) payload from public.order_items i join public.orders o on o.id=i.order_id where o.user_id='${fixture.customerId}';
create temporary table expected_shipments as select s.id,to_jsonb(s) payload from public.order_shipments s join public.orders o on o.id=s.order_id where o.user_id='${fixture.customerId}';
update public.fulfillment_origins set base_fee=base_fee+1 where code='gimpo';
drop table rehearsal_inputs;
${run}
do $$ begin
 if exists(select 1 from expected_orders e join public.orders o using(id) where e.payload<>to_jsonb(o)) then raise exception 'order status or money changed on replay'; end if;
 if exists(select 1 from expected_items e join public.order_items i using(id) where e.payload<>to_jsonb(i)) then raise exception 'item price or option snapshot changed'; end if;
 if exists(select 1 from expected_shipments e join public.order_shipments s using(id) where e.payload<>to_jsonb(s)) then raise exception 'shipment status or fee changed'; end if;
 if (select nickname from public.profiles where id='${fixture.customerId}')<>'기존 리허설 담당 수정값' then raise exception 'rehearsal profile overwritten'; end if;
 if exists(select 1 from public.orders o where user_id='${fixture.customerId}' and (o.total<>o.shipping_fee+(select sum(qty*unit_price) from public.order_items where order_id=o.id) or o.shipping_fee<>(select sum(shipping_fee) from public.order_shipments where order_id=o.id))) then raise exception 'money mismatch'; end if;
end $$;
rollback;`;
const result = spawnSync(
  process.env.PSQL_BIN ?? 'psql',
  [
    '-X',
    '-U',
    process.env.PGUSER ?? 'postgres',
    '-d',
    process.env.PGDATABASE ?? 'postgres',
    '-vON_ERROR_STOP=1',
  ],
  { input: statement, encoding: 'utf8' },
);
if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  process.exitCode = 1;
} else
  console.log(
    'PASS: 100 paid orders, 100 linked shipments, unchanged stock, and replay preserves order/item/fee/status/profile snapshots after policy edits',
  );
