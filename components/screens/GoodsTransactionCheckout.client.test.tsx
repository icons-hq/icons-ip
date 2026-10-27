import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { transactionActor, transactionDisplay, transactionInput, transactionOrder, transactionQuote, transactionRecovery, transactionSession } from '@/test/fixtures/cart-transaction';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[], effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], si: 0, ri: 0, mi: 0, ei: 0 }));
const mocks = vi.hoisted(() => ({ place: vi.fn(), resume: vi.fn(), refresh: vi.fn(), reprice: vi.fn(), push: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void), cart: null as unknown, quote: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? initial() : initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.ri++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (fn: () => unknown, deps: unknown[]) => { const i = hooks.mi++; if (!hooks.memos[i] || deps.some((d, j) => d !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: fn(), deps }; return hooks.memos[i].value; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = hooks.ei++, previous = hooks.effects[i]; if (!previous || deps.some((d, j) => d !== previous.deps[j])) { hooks.effects[i] = { effect, deps, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock('@/app/checkout/transaction-actions', () => ({ placeCartTransactionAction: mocks.place, resumeCartTransactionAction: mocks.resume }));
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => mocks.cart }));
vi.mock('@/components/checkout/useCartTransactionQuote', () => ({ useCartTransactionQuote: () => ({ result: mocks.quote, offers: [], loading: false, refresh: mocks.reprice }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
import { GoodsTransactionCheckout } from './GoodsTransactionCheckout';
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { CheckoutAddressBook } from '@/components/checkout/CheckoutAddressBook';
import { PostcodeField } from '@/components/checkout/PostcodeField';
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child)).join('');
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
let props: Parameters<typeof GoodsTransactionCheckout>[0], storage: Map<string, string>;
function render() { hooks.si = hooks.ri = hooks.mi = hooks.ei = 0; return GoodsTransactionCheckout(props); }
function effects() { for (const i of hooks.changed.splice(0)) { const effect = hooks.effects[i]; effect.cleanup?.(); effect.cleanup = effect.effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = transactionActor, session = transactionSession) { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
function button(label: string) { return all(render()).find(node => node.type === 'button' && text(node) === label)!; }
function submit() { const form = all(render()).find(node => node.type === 'form')!; return (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} }); }
function resetHooks() { hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; }
beforeEach(async () => {
  resetHooks(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T03:05:00Z')); storage = new Map();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  mocks.cart = { items: transactionInput.items, ready: true, mode: 'server', pending: false, refresh: mocks.refresh }; mocks.refresh.mockResolvedValue(undefined);
  mocks.quote = { ok: true, quote: transactionQuote, offers: [] }; mocks.place.mockResolvedValue({ ok: false, error: 'unavailable', uncertain: true }); mocks.resume.mockResolvedValue({ ok: false, error: 'unavailable', uncertain: true });
  props = { accountId: transactionActor, catalog: { goods: [], ips: [] }, addressPrefill: { address: transactionInput.address, source: 'recent_order', book: [] }, paymentAvailable: true, bankTransferAvailable: true, resumeOrderId: null, userCouponId: transactionInput.userCouponId };
  render(); effects(); authenticate(); await flush();
});
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('중복 클릭은 한 요청이며 응답 불명 복구에는 원 식별자만 저장·전송한다', async () => {
  const pending = deferred(); mocks.place.mockReturnValueOnce(pending.promise);
  const first = submit(), second = submit(); expect(mocks.place).toHaveBeenCalledTimes(1); await second; await flush();
  const saved = JSON.parse([...storage.values()][0]); expect(Object.keys(saved).sort()).toEqual(['checkoutKey', 'expectedActorId', 'paymentMethod', 'quoteId', 'sessionId', 'version']);
  expect([...storage.values()][0]).not.toContain('123호'); expect([...storage.values()][0]).not.toContain('transaction-good');
  pending.resolve({ ok: false, error: 'unavailable', uncertain: true }); await first; await flush();
  expect(button('주문 만들고 결제하기')).toBeUndefined();
  await (button('같은 주문 다시 확인').props.onClick as () => Promise<void>)(); await flush(); expect(mocks.resume).toHaveBeenCalledWith(saved);
});
it('요청 중 외부 장바구니가 바뀌어도 원 품목과 견적을 함께 유지한다', async () => {
  const pending = deferred(); mocks.place.mockReturnValueOnce(pending.promise); const work = submit(); await flush();
  mocks.cart = { ...(mocks.cart as object), items: [{ ...transactionInput.items[0], qty: 7 }] };
  expect(text(render())).toContain('2개'); expect(text(render())).not.toContain('7개');
  expect(all(render()).find(node => node.type === GoodsTransactionSummary)?.props.display).toEqual(transactionDisplay);
  pending.resolve({ ok: false, error: 'unavailable', uncertain: true }); await work;
});
it('재로드는 같은 세션의 원 요청을 복구하고 새 주문 제출을 잠근다', async () => {
  await submit(); await flush(); const original = JSON.parse([...storage.values()][0]);
  for (const effect of hooks.effects) effect.cleanup?.(); resetHooks(); render(); effects(); authenticate(); await flush();
  expect(button('주문 만들고 결제하기')).toBeUndefined(); expect(text(render())).not.toContain('2개');
  await (button('같은 주문 다시 확인').props.onClick as () => Promise<void>)(); await flush(); expect(mocks.resume).toHaveBeenCalledWith(original);
});
it.each(['account', 'session', 'signout'])('%s 변경 뒤 늦은 주문 응답은 화면 이동과 개인정보 표시를 하지 않는다', async kind => {
  const pending = deferred(); mocks.place.mockReturnValueOnce(pending.promise); const work = submit(); await flush();
  if (kind === 'account') authenticate(transactionOrder); if (kind === 'session') authenticate(transactionActor, transactionOrder);
  if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  pending.resolve({ ok: true, orderId: transactionOrder }); await work; await flush();
  expect(mocks.push).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(text(render())).toContain('로그인 상태를 다시 확인');
  expect(all(render()).some(node => node.type === 'input')).toBe(false);
});
it('견적이 만료된 순간 제출하면 서버 요청 없이 다시 견적을 받는다', async () => {
  vi.setSystemTime(new Date('2026-10-14T03:10:00Z')); await submit(); await flush(); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.reprice).toHaveBeenCalled();
});
it('복구 성공은 저장 식별자를 지우고 원 주문의 결제를 이어간다', async () => {
  await submit(); await flush(); mocks.resume.mockResolvedValueOnce({ ok: true, orderId: transactionOrder });
  await (button('같은 주문 다시 확인').props.onClick as () => Promise<void>)(); await flush();
  expect(storage.size).toBe(0); expect(mocks.push).toHaveBeenCalledWith(`/checkout/${transactionOrder}`);
});
it('명시적 견적 만료 거절 후에만 원 요청을 해제한다', async () => {
  await submit(); await flush(); mocks.resume.mockResolvedValueOnce({ ok: false, error: 'quote_changed', uncertain: false });
  await (button('같은 주문 다시 확인').props.onClick as () => Promise<void>)(); await flush(); expect(storage.size).toBe(0); expect(button('주문 만들고 결제하기')).toBeDefined();
});
it('새 세션은 이전 세션의 복구 식별자를 재사용하지 않는다', async () => {
  storage.set(`icons.cart-order-recovery.v1:${transactionActor}`, JSON.stringify(transactionRecovery));
  for (const effect of hooks.effects) effect.cleanup?.(); resetHooks(); render(); effects(); authenticate(transactionActor, transactionOrder); await flush();
  expect(storage.size).toBe(0); expect(button('같은 주문 다시 확인')).toBeUndefined();
});
/* 주소록(L7 · MY-11) · 미리 채우기 정정(10/14 S6a) — 거래 주문서도 같은 선택·안내를 쓴다. */
it('주소록 배송지를 고르면 폼을 채우고 배송 메모는 두며, 미리 채운 출처 안내는 그 배송지일 때만 보인다', async () => {
  const home = { id: '7a570000-0000-4000-8000-000000000011', label: '집', recipientName: '수령인', phone: '01012345678', postalCode: '04799', address1: '서울 성동구 테스트길', address2: '123호', isDefault: true };
  const office = { ...home, id: '7a570000-0000-4000-8000-000000000012', label: '회사', recipientName: '회사 수령인', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };
  props = { ...props, addressPrefill: { address: { ...transactionInput.address, deliveryNote: '' }, source: 'address_book', book: [home, office] } };
  for (const effect of hooks.effects) effect.cleanup?.(); resetHooks(); render(); effects(); authenticate(); await flush();
  const field = (id: string) => all(render()).find(node => node.type === 'input' && node.props.id === id)!;
  expect(text(render())).toContain('주소록의 기본 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.');
  const picker = all(render()).find(node => node.type === CheckoutAddressBook)!;
  expect(picker.props.book).toEqual([home, office]);
  (field('checkout-deliveryNote').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '문 앞' } });
  (picker.props.onPick as (entry: unknown) => void)(office);
  expect(field('checkout-recipientName').props.value).toBe('회사 수령인');
  expect(field('checkout-address1').props.value).toBe('서울 강남구 테헤란로 152');
  expect(field('checkout-address2').props.value).toBe('');
  expect(all(render()).find(node => node.type === PostcodeField)!.props.value).toBe('04799');
  expect(field('checkout-deliveryNote').props.value).toBe('문 앞');
  expect(text(render())).not.toContain('불러왔어요');
  (all(render()).find(node => node.type === CheckoutAddressBook)!.props.onPick as (entry: unknown) => void)(null);
  expect(field('checkout-recipientName').props.value).toBe('');
  expect(all(render()).find(node => node.type === PostcodeField)!.props.value).toBe('');
  expect(field('checkout-deliveryNote').props.value).toBe('문 앞');
});
