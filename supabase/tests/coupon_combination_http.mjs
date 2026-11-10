/** Local owned synthetic accounts; no provider payment or outbound campaign. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, xs) => v.startsWith('--') ? [...a, [v.slice(2), xs[i + 1]]] : a, []));
assert(args['runtime-json'] && args['race-json'] && args.output);
const rt = JSON.parse(await readFile(resolve(args['runtime-json']), 'utf8')), race = JSON.parse(await readFile(resolve(args['race-json']), 'utf8'));
assert(rt.projectId.startsWith('icons-ip-full-admin-')); assert.equal(new URL(rt.apiUrl).hostname, '127.0.0.1'); assert.equal(new URL(rt.siteUrl).hostname, '[::1]');
const cid = rt.databaseContainerId; const guard = () => { const m = JSON.parse(execFileSync('docker', ['inspect', cid], { timeout: 15000 }))[0]; assert.equal(m.Id, cid); assert.equal(m.Name, `/supabase_db_${rt.projectId}`); }; guard();
const secret = JSON.parse(await readFile(join(rt.workdir, 'status.private.json'), 'utf8')), accounts = JSON.parse(await readFile(join(rt.workdir, 'accounts.private.json'), 'utf8'));
const service = createClient(rt.apiUrl, secret.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (r, step) => { if (r.error) throw new Error(`${step}: ${r.error.code ?? r.error.statusCode ?? 'failure'}`); return r.data; };
async function login(kind) { const account = accounts.find(a => a.kind === kind), cookies = new Map(); const client = createServerClient(rt.apiUrl, secret.ANON_KEY, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: xs => xs.forEach(x => cookies.set(x.name, x.value)) } }); const auth = must(await client.auth.signInWithPassword({ email: account.email, password: account.password }), `login ${kind}`); return { client, cookies, id: account.id, session: JSON.parse(Buffer.from(auth.session.access_token.split('.')[1], 'base64url')).session_id }; }
const admin = await login('admin'), buyer = await login('buyer'), other = await login('other'), codePrefix = `QA-${randomUUID().slice(0, 8).toUpperCase()}`;
const policy = must(await admin.client.rpc('admin_get_coupon_combination_policy'), 'read policy');
if (!policy.stackingEnabled || !policy.shippingEnabled || policy.maxGoodsCoupons < 2) must(await admin.client.rpc('admin_save_coupon_combination_policy', { p_values: { stackingEnabled: true, maxGoodsCoupons: 3, shippingEnabled: true, confirmed: true, evidence: 'TEST HTTP combination policy' }, p_revision: policy.revision, p_operation: randomUUID(), p_actor: admin.id, p_session: admin.session }), 'enable synthetic policy');
const held = [], definitions = []; const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
for (const [index, kind, type, value] of [[1, 'goods', 'fixed', 3000], [2, 'goods', 'percent', 10], [3, 'shipping', 'percent', 50]]) {
 const code = `${codePrefix}-${index}`, payload = { target_code: code, target_name: `TEST ${kind === 'shipping' ? '배송비' : '상품'} 쿠폰 ${index}`, target_discount_type: type, target_discount_value: value, target_max_discount_amount: null, target_min_subtotal: 0, target_starts_at: from, target_ends_at: to, target_issue_limit: 20, target_status: 'active', target_grade_benefit: null, target_previous_code: null, target_recipient_segment: 'all', target_goods_scope: 'all', target_good_ids: [], target_expected_revision: null, target_issue_starts_at: from, target_issue_ends_at: to, target_valid_days: null, target_benefit_kind: kind, target_stackable: true };
 must(await admin.client.rpc('admin_upsert_coupon_scheduled', { target_payload: payload }), 'create definition');
 must(await buyer.client.rpc('claim_coupon_code', { p_code: code }), 'claim coupon');
 const record = must(await buyer.client.from('user_coupons').select('id,coupons(code,benefit_kind,stackable)').eq('coupon_code', code).single(), 'held readback'); assert.equal(record.coupons.benefit_kind, kind); assert.equal(record.coupons.stackable, true); held.push(record.id); definitions.push(code);
 const current = must(await admin.client.from('coupons').select('terms_revision').eq('code', code).single(), 'definition revision');
 const edited = await admin.client.rpc('admin_upsert_coupon_scheduled', { target_payload: { ...payload, target_previous_code: code, target_expected_revision: current.terms_revision, target_benefit_kind: kind === 'goods' ? 'shipping' : 'goods' } }); assert.equal(edited.error?.message, 'coupon_issued_benefit_immutable');
}
const oldCart = must(await buyer.client.from('cart_items').select('good_id,variant_id,qty'), 'cart'); for (const row of oldCart) must(await buyer.client.rpc('set_cart_item_quantity', { p_good_id: row.good_id, p_variant_id: row.variant_id, p_qty: 0 }), 'clear synthetic cart');
const goods = [`coupon-race-${race.run}-a`, `coupon-race-${race.run}-b`];
for (const [index, good] of goods.entries()) { const v = must(await buyer.client.from('goods_variants').select('id').eq('good_id', good).eq('is_default', true).single(), 'variant'); must(await buyer.client.rpc('set_cart_item_quantity', { p_good_id: good, p_variant_id: v.id, p_qty: index ? 1 : 2 }), 'cart add'); }
const cart = must(await buyer.client.from('cart_items').select('good_id,variant_id,qty,input_revision,input_values'), 'snapshot'), address = { recipientName: 'TEST HTTP 구매자', phone: '01000000000', postalCode: '12345', address1: 'TEST 합성 주소' };
const quote = must(await service.rpc('quote_cart_goods_transaction_combined', { p_user_id: buyer.id, p_expected_cart: cart, p_address: address, p_delivery_choices: { [goods[0]]: { method: 'quick', paymentMode: 'prepaid' } }, p_user_coupon_ids: held, p_store_credit_amount: 0 }), 'quote'); assert.equal(quote.state, 'quoted'); assert.equal(quote.display.totals.onlineTotal, 25700);
async function html(actor, path, expected) { const r = await fetch(`${rt.siteUrl}${path}`, { headers: { cookie: [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }); const value = await r.text(); assert.equal(r.status, 200); assert(!value.includes('Application error')); assert(value.includes(expected), `Missing rendered contract: ${expected}`); return { path, status: r.status, expectedText: expected, present: true }; }
const rendered = [await html(admin, '/admin/sales/coupons', '쿠폰 중복 사용'), await html(buyer, '/checkout', '배송비 쿠폰'), await html(buyer, '/my/coupons', '중복 사용')];
const key = randomUUID(), params = { p_user_id: buyer.id, p_expected_cart: cart, p_address: address, p_quote_id: quote.quoteId, p_checkout_key: key, p_payment_method: 'card' };
const results = await Promise.all(Array.from({ length: 12 }, async () => must(await service.rpc('place_cart_goods_transaction', params), 'order retry'))); assert.equal(new Set(results).size, 1); const orderId = results[0];
rendered.push(await html(buyer, `/orders/${orderId}`, '배송비 쿠폰 할인'));
const foreign = await other.client.from('coupon_redemptions').select('id').eq('order_id', orderId); assert.equal(foreign.data?.length, 0);
const uses = must(await buyer.client.from('coupon_redemptions').select('id,benefit_kind,discount_amount,application_index').eq('order_id', orderId), 'uses'); assert.equal(uses.length, 3);
let previousFilePreserved = null;
if (args['old-download-json']) { const previous = JSON.parse(await readFile(resolve(args['old-download-json']), 'utf8')); const r = await fetch(`${rt.siteUrl}/api/orders/digital-download`, { method: 'POST', headers: { origin: rt.siteUrl, 'Content-Type': 'application/json', cookie: [...buyer.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify({ itemId: previous.itemId, assetId: previous.assetId, operationId: randomUUID() }) }); assert.equal(r.status, 200); assert.equal(createHash('sha256').update(new Uint8Array(await r.arrayBuffer())).digest('hex'), previous.sha256); previousFilePreserved = true; }
const proof = { orderId, quote, goods, heldCouponIds: held, definitions, sameRequestCount: results.length, redemptions: uses, issuedBenefitChangeRejected: true, unrelatedAccountReadDenied: true, rendered, previousDigitalFilePreserved: previousFilePreserved };
await writeFile(resolve(args.output), JSON.stringify(proof, null, 2)); console.log(JSON.stringify({ orderId, sameRequestCount: results.length, couponCount: uses.length, rendered: rendered.length, previousDigitalFilePreserved: previousFilePreserved }));
