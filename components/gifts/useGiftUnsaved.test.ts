/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and mounts one hook root per test. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 선물 입력 이탈 경고(원장 재작업 후속 4): 링크 이동은 브라우저 기본 confirm 대신 고객 공용 확인창으로 묻는다. DOM 없이 리스너만 본다. */
const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[] }));
vi.mock('react', () => ({ useState: vi.fn(), useRef: vi.fn(), useEffect: (callback: () => void | (() => void)) => { hooks.effects.push(callback); } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { stubCustomerConfirm } from '@/lib/customer-confirm.test-support';
import { useGiftUnsaved } from './useGiftRequest';

class FakeElement { closest() { return null as unknown; } }
class FakeLink extends FakeElement {
  href: string; target = ''; isConnected = true; click = vi.fn(() => { listeners.click?.(clickEvent(this)); });
  constructor(href: string) { super(); this.href = href; }
  hasAttribute() { return false; }
  closest() { return this; }
}
const listeners: { click?: (event: ReturnType<typeof clickEvent>) => void; beforeunload?: (event: unknown) => void } = {};
function clickEvent(target: unknown) {
  return { target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) { this.defaultPrevented = true; }), stopPropagation: vi.fn() };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
let confirm: ReturnType<typeof stubCustomerConfirm>;

beforeEach(() => {
  hooks.effects = []; hooks.cleanups = [];
  delete listeners.click; delete listeners.beforeunload;
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('location', { href: 'https://iconsip.test/gifts/g1', origin: 'https://iconsip.test', pathname: '/gifts/g1', search: '' });
  vi.stubGlobal('document', { addEventListener: (type: 'click', handler: (event: ReturnType<typeof clickEvent>) => void) => { listeners[type] = handler; },
    removeEventListener: (type: 'click') => { delete listeners[type]; } });
  vi.stubGlobal('window', { addEventListener: (type: 'beforeunload', handler: (event: unknown) => void) => { listeners[type] = handler; },
    removeEventListener: (type: 'beforeunload') => { delete listeners[type]; }, confirm: vi.fn(() => { throw new Error('native confirm must not be used'); }) });
  vi.stubGlobal('confirm', (globalThis as unknown as { window: { confirm: () => boolean } }).window.confirm);
});
afterEach(() => { for (const cleanup of hooks.cleanups) cleanup(); confirm?.restore(); vi.unstubAllGlobals(); });

function mount(dirty: boolean) {
  useGiftUnsaved(dirty);
  hooks.cleanups = hooks.effects.splice(0).map((effect) => effect()).filter(Boolean) as (() => void)[];
}

describe('useGiftUnsaved', () => {
  it('다른 화면으로 가는 링크는 이동을 멈추고 고객 확인창에 묻는다 — 계속 작성을 고르면 그대로 머문다', async () => {
    confirm = stubCustomerConfirm(false);
    mount(true);
    const link = new FakeLink('https://iconsip.test/gifts');
    const event = clickEvent(link);
    listeners.click!(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    await flush();
    expect(confirm).toHaveBeenCalledWith({ title: '작성 중인 내용을 두고 이동할까요?', message: '입력한 내용은 저장되지 않아요.', confirmLabel: '이동하기', cancelLabel: '계속 작성' });
    expect(link.click).not.toHaveBeenCalled();
    expect(listeners.beforeunload).toBeDefined();
  });
  it('이동하기를 고르면 같은 링크를 다시 눌러 원래 이동을 잇고, 브라우저가 한 번 더 묻지 않게 한다', async () => {
    confirm = stubCustomerConfirm(true);
    mount(true);
    const link = new FakeLink('https://iconsip.test/gifts');
    listeners.click!(clickEvent(link));
    await flush();
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(listeners.beforeunload).toBeUndefined();
  });
  it('같은 화면 링크·입력이 없는 화면은 묻지 않는다', async () => {
    confirm = stubCustomerConfirm(true);
    mount(true);
    const same = clickEvent(new FakeLink('https://iconsip.test/gifts/g1#claims'));
    listeners.click!(same);
    expect(same.preventDefault).not.toHaveBeenCalled();
    for (const cleanup of hooks.cleanups) cleanup(); hooks.cleanups = [];
    mount(false);
    expect(listeners.click).toBeUndefined();
    await flush();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('선물 화면 확인창 계약', () => {
  it('선물 화면은 브라우저 기본 confirm을 쓰지 않고 고객 공용 확인창을 쓴다', () => {
    const files = ['components/gifts/GiftClaims.tsx', 'components/gifts/useGiftRequest.ts', 'components/screens/gifts/GiftDetail.tsx', 'components/screens/gifts/GiftReceive.tsx'];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/(^|[^A-Za-z_.])confirm\(|window\.confirm/);
      expect(source, file).toContain('customerConfirm(');
    }
  });
});
