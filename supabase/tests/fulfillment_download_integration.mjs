/** Explicitly owned local runtime only. Creates synthetic purchases, never PG calls. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, v, i, all) => v.startsWith('--') ? [...rows, [v.slice(2), all[i + 1]]] : rows, []));
assert(args['runtime-json'] && args['fixture-json'] && args.output);
const rt = JSON.parse(await readFile(resolve(args['runtime-json']), 'utf8'));
const fixture = JSON.parse(await readFile(resolve(args['fixture-json']), 'utf8'));
assert(rt.projectId.startsWith('icons-ip-full-admin-'));
assert.equal(new URL(rt.apiUrl).hostname, '127.0.0.1'); assert.equal(new URL(rt.siteUrl).hostname, '[::1]');
const cid = rt.databaseContainerId;
function guard() { const m = JSON.parse(execFileSync('docker', ['inspect', cid], { timeout: 15000 }))[0]; assert.equal(m.Id, cid); assert.equal(m.Name, `/supabase_db_${rt.projectId}`); }
guard();
const secrets = JSON.parse(await readFile(join(rt.workdir, 'status.private.json'), 'utf8'));
const accounts = JSON.parse(await readFile(join(rt.workdir, 'accounts.private.json'), 'utf8'));
const service = createClient(rt.apiUrl, secrets.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (value, name) => { if (value.error) throw new Error(`${name}: ${value.error.code ?? value.error.statusCode ?? 'failed'}`); return value.data; };
async function login(kind) {
 const account = accounts.find(a => a.kind === kind), cookies = new Map();
 const client = createServerClient(rt.apiUrl, secrets.ANON_KEY, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(v => cookies.set(v.name, v.value)) } });
 const auth = must(await client.auth.signInWithPassword({ email: account.email, password: account.password }), `login ${kind}`);
 const sessionId = JSON.parse(Buffer.from(auth.session.access_token.split('.')[1], 'base64url')).session_id;
 assert.match(sessionId, /^[0-9a-f-]{36}$/); return { client, cookies, sessionId, id: account.id };
}
const admin = await login('admin'), buyer = await login('buyer'), other = await login('other');
const assetId = randomUUID(), bytes = args['file-size'] === 'maximum' ? Buffer.alloc(50 * 1024 * 1024, 0x41) : Buffer.from('TEST only: purchased digital file.\n', 'utf8'), sha256 = createHash('sha256').update(bytes).digest('hex');
const prepared = must(await service.rpc('service_prepare_digital_asset', { p_actor: admin.id, p_session: admin.sessionId, p_id: assetId, p_name: 'TEST 구매 파일.txt', p_mime: 'text/plain', p_size: bytes.length }), 'prepare');
assert.equal(prepared.path, `${admin.id}/${assetId}.txt`);
must(await admin.client.storage.from('goods-digital-private').upload(prepared.path, bytes, { contentType: 'text/plain', upsert: false }), 'private upload');
const info = must(await service.storage.from('goods-digital-private').info(prepared.path), 'private size'); assert.equal(info.size, bytes.length);
const stored = must(await service.storage.from('goods-digital-private').download(prepared.path), 'private verify');
assert.equal(createHash('sha256').update(new Uint8Array(await stored.arrayBuffer())).digest('hex'), sha256);
must(await service.rpc('service_verify_digital_asset', { p_actor: admin.id, p_session: admin.sessionId, p_id: assetId, p_sha256: sha256 }), 'verified record');
const prior = must(await admin.client.rpc('admin_get_goods_fulfillment', { p_good: fixture.goodB }), 'settings read');
must(await admin.client.rpc('admin_save_goods_fulfillment', { p_good: fixture.goodB, p_revision: prior.revision, p_operation: randomUUID(), p_actor: admin.id, p_session: admin.sessionId,
 p_values: { mode: 'digital', methods: [{ method: 'digital', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }], assetIds: [assetId], publicNote: 'TEST 결제 후 구매한 파일을 다운로드합니다.', evidence: 'TEST 합성 파일 제공 정책', confirmed: true } }), 'digital settings');
const cart = must(await buyer.client.from('cart_items').select('good_id,variant_id,qty,input_revision,input_values').eq('user_id', buyer.id), 'cart');
for (const item of cart) if (item.good_id !== fixture.goodB) must(await buyer.client.rpc('set_cart_item_quantity', { p_good_id: item.good_id, p_variant_id: item.variant_id, p_qty: 0 }), 'remove other fixture cart item');
const variant = must(await buyer.client.from('goods_variants').select('id').eq('good_id', fixture.goodB).eq('is_default', true).single(), 'variant');
must(await buyer.client.rpc('set_cart_item_quantity', { p_good_id: fixture.goodB, p_variant_id: variant.id, p_qty: 1 }), 'digital cart');
const expected = must(await buyer.client.from('cart_items').select('good_id,variant_id,qty,input_revision,input_values').eq('user_id', buyer.id), 'expected cart');
const quote = must(await service.rpc('quote_cart_goods_transaction', { p_user_id: buyer.id, p_expected_cart: expected, p_address: { kind: 'none' }, p_delivery_choices: {}, p_user_coupon_id: null, p_store_credit_amount: 0 }), 'digital quote');
assert.equal(quote.state, 'quoted'); assert.equal(quote.display.totals.prepaidShippingTotal, 0);
const orderId = must(await service.rpc('place_cart_goods_transaction', { p_user_id: buyer.id, p_expected_cart: expected, p_address: { kind: 'none' }, p_quote_id: quote.quoteId, p_checkout_key: randomUUID(), p_payment_method: 'card' }), 'digital order');
const paymentId = randomUUID(), attemptId = randomUUID(); for (const v of [orderId, paymentId, attemptId]) assert.match(v, /^[0-9a-f-]{36}$/);
guard(); execFileSync('docker', ['exec', '-i', cid, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { timeout: 30000, input: `begin;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) select '${paymentId}',user_id,'order',id,'toss',total,'paid','digital-test-${paymentId}' from public.orders where id='${orderId}';
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at) select '${attemptId}','toss',user_id,'order',id,total,'approved','digital-attempt-${attemptId}','digital-provider-${attemptId}','digital-code-${attemptId}','${paymentId}',now()+interval '1 hour' from public.orders where id='${orderId}';
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values('${attemptId}','confirm',now());update public.orders set status='paid' where id='${orderId}';commit;` });
const projection = must(await buyer.client.rpc('get_my_order_downloads', { p_order: orderId }), 'purchased list'); const itemId = projection.items[0].itemId;
assert.equal(projection.items[0].available, true); const operationId = randomUUID();
async function download(actor, operation = operationId) {
 const response = await fetch(`${rt.siteUrl}/api/orders/digital-download`, { method: 'POST', headers: { origin: rt.siteUrl, 'Content-Type': 'application/json', cookie: actor ? [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; ') : '' }, body: JSON.stringify({ itemId, assetId, operationId: operation }) });
 return { status: response.status, cache: response.headers.get('cache-control'), disposition: response.headers.get('content-disposition'), bytes: new Uint8Array(await response.arrayBuffer()) };
}
const first = await download(buyer); assert.equal(first.status, 200); assert.equal(createHash('sha256').update(first.bytes).digest('hex'), sha256); assert(first.cache.includes('no-store')); assert(first.disposition.includes('attachment'));
const replay = await Promise.all(Array.from({ length: args['file-size'] === 'maximum' ? 1 : 12 }, () => download(buyer))); assert(replay.every(r => r.status === 200 && createHash('sha256').update(r.bytes).digest('hex') === sha256));
assert.equal((await download(other)).status, 403); assert.equal((await download(null)).status, 401);
const rawDenied = await buyer.client.storage.from('goods-digital-private').download(prepared.path); assert(rawDenied.error);
const publicUrl = buyer.client.storage.from('goods-digital-private').getPublicUrl(prepared.path).data.publicUrl; assert(!(await fetch(publicUrl)).ok);
const claimResult = must(await service.rpc('request_order_cancellation', { p_order_id: orderId, p_user_id: buyer.id, p_reason: 'TEST 다운로드 후 취소 검토', p_reason_type: 'change_of_mind' }), 'cancel review');assert.equal(claimResult, 'requested');assert.equal((await download(buyer, randomUUID())).status, 403);
const claims = must(await service.from('order_cancellation_requests').select('id').eq('order_id', orderId).eq('stage', 'requested').single(), 'claim identity');
must(await admin.client.rpc('admin_decide_order_claim', { p_claim_id: claims.id, p_decision: 'reject', p_note: 'TEST 접근 복구 검증을 위한 합성 요청 종료' }), 'close synthetic claim');
assert.equal((await download(buyer, randomUUID())).status, 200);
guard();const count = Number(execFileSync('docker', ['exec', cid, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-c', `select count(*) from private.order_digital_downloads where order_id='${orderId}'`], { timeout: 15000 }).toString().trim());assert.equal(count, 2);
const result = { orderId, itemId, assetId, goodId: fixture.goodB, sha256, size: bytes.length, downloadStatus: first.status, sameOperationTransfers: replay.length + 1, replayRecordedOnce: true, successfulDownloadOperations: count, unrelatedAccountDenied: true, anonymousDenied: true, directStorageDenied: true, publicUrlDenied: true, claimSuspendsAccess: true, closedClaimRestoresAccess: true };
await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`);console.log(JSON.stringify(result));
