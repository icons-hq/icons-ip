// Actual postgres_changes transport contract. Only an explicitly selected isolated
// localhost DB/Realtime pair is accepted; never target the shared Supabase stack.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { execFileSync } from 'node:child_process';
import { RealtimeClient } from '@supabase/realtime-js';

setDefaultResultOrder('ipv4first');
const realtimeUrl = process.env.INQUIRY_REALTIME_URL;
const secret = process.env.INQUIRY_REALTIME_JWT_SECRET;
const host = process.env.PGHOST;
const port = process.env.PGPORT;
assert(realtimeUrl && secret && host === '127.0.0.1' && port && port !== '54322', 'explicit isolated local targets required');
assert(new URL(realtimeUrl).hostname.endsWith('.localhost'), 'local Realtime tenant hostname required');
const psql = process.env.PSQL ?? 'psql';
const sql = (query) => execFileSync(psql, ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], {
  env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = (role, sub) => {
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, sub, aud: role, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const users = Array.from({ length: 4 }, () => randomUUID());
const threads = [randomUUID(), randomUUID()];
const clients = [];
const events = { owner: [], other: [], staff: [], anon: [] };
function asUser(id, query) {
  return `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true); ${query}; commit;`;
}
async function subscribe(name, role, sub) {
  const jwt = token(role, sub);
  const client = new RealtimeClient(realtimeUrl, { params: { apikey: jwt }, timeout: 10000 });
  clients.push(client);
  await client.setAuth(jwt);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} subscription timeout`)), 20000);
    client.channel(`contract-${name}-${randomUUID()}`)
      // No row or column filter: authorization must survive a hostile subscriber.
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => events[name].push({ payload, at: Date.now() }))
      .on('system', {}, (event) => {
        if (event.extension === 'postgres_changes' && event.status === 'ok') { clearTimeout(timeout); resolve(); }
      })
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timeout); reject(error ?? new Error(`${name}:${status}`)); }
      });
  });
}
try {
  sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ${users.map((id) => `('${id}','authenticated','authenticated','${id}@realtime.test',now(),'{}','{}',now(),now())`).join(',')};
    update public.profiles set role=case when id in ('${users[2]}','${users[3]}') then 'staff' else 'user' end::public.user_role,
      birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now() where id in (${users.map((id) => `'${id}'`).join(',')});
    insert into public.inquiries(id,user_id,category,title,assignee_id) values
      ('${threads[0]}','${users[0]}','etc','Realtime owner A','${users[3]}'),('${threads[1]}','${users[1]}','etc','Realtime owner B',null);`);
  await Promise.all([subscribe('owner', 'authenticated', users[0]), subscribe('other', 'authenticated', users[1]),
    subscribe('staff', 'authenticated', users[2]), subscribe('anon', 'anon')]);
  const startedAt = Date.now();
  sql(asUser(users[3], `select public.admin_answer_inquiry('${threads[0]}','Realtime answer A'); select public.admin_answer_inquiry('${threads[1]}','Realtime answer B')`));
  while (Date.now() - startedAt < 3000 && (!events.owner.some((event) => event.payload.new.body === 'Realtime answer A')
    || !events.other.some((event) => event.payload.new.body === 'Realtime answer B'))) await wait(25);
  for (const [name, index] of [['owner', 0], ['other', 1]]) {
    const answer = events[name].find((event) => event.payload.new.body === `Realtime answer ${index === 0 ? 'A' : 'B'}`);
    assert(answer && answer.at - startedAt <= 3000, `${name}: reply must arrive within 3 seconds`);
    assert(events[name].every(({ payload }) => (payload.new.inquiry_id ?? payload.new.id) === threads[index]), `${name}: foreign row received`);
    console.log(`${name} reply latency ${answer.at - startedAt}ms`);
  }
  assert(events.staff.some(({ payload }) => payload.new.body === 'Realtime answer A')
    && events.staff.some(({ payload }) => payload.new.body === 'Realtime answer B'), 'staff must receive both customers');
  // Realtime can send an explicit 401 envelope for a table without SELECT;
  // that envelope must contain neither new/old row values nor a commit time.
  assert(events.anon.every(({ payload }) => Object.keys(payload.new).length === 0 && Object.keys(payload.old).length === 0
    && payload.commit_timestamp === null && payload.errors?.includes('Error 401: Unauthorized')), 'anonymous subscriber received row data');
  for (const stream of Object.values(events)) for (const { payload } of stream) {
    for (const key of ['assignee_id', 'handled_by', 'waiting_since', 'author_id']) {
      assert(!(key in payload.new) && !(key in payload.old), `${key} exposed through Realtime`);
    }
  }
  const staffCount = events.staff.length;
  sql(`update public.profiles set role='user' where id='${users[2]}';`);
  sql(asUser(users[3], `select public.admin_answer_inquiry('${threads[0]}','After staff demotion')`));
  await wait(750);
  assert.equal(events.staff.length, staffCount, 'demoted staff kept receiving private rows');
  sql(`delete from public.inquiries where id in ('${threads[0]}','${threads[1]}');`);
  await wait(750);
  assert(Object.values(events).flat().every(({ payload }) => payload.eventType !== 'DELETE'), 'unfilterable delete event exposed');
  console.log('Realtime owner/other/staff/anonymous, private columns, demotion and deletion contracts passed');
} finally {
  await Promise.allSettled(clients.map((client) => client.removeAllChannels()));
  clients.forEach((client) => client.disconnect());
  sql(`delete from public.inquiries where user_id in (${users.map((id) => `'${id}'`).join(',')});
    delete from public.audit_log where actor_id in (${users.map((id) => `'${id}'`).join(',')});
    delete from auth.users where id in (${users.map((id) => `'${id}'`).join(',')});`);
}
