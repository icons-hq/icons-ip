/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and mounts one hook root per test. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAddress } from '@/lib/checkout';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }];
  },
}));

import { setCustomerConfirmHandler, type CustomerConfirmRequest } from '@/lib/customer-confirm';
import { useAddressFormGuard } from './useAddressFormGuard';

const render = () => { hooks.index = 0; return useAddressFormGuard('gift-address'); };
const filled: CheckoutAddress = { recipientName: '김팬', phone: '010-1234-5678', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '' };

/* 선물 받기·정기구독 폼: 주소 칸이 검색 결과로 잠기면 브라우저 필수 검사에서 빠지므로 제출 전에 직접 검사한다. */
describe('useAddressFormGuard', () => {
  const focused: string[] = [];
  beforeEach(() => {
    hooks.states = [];
    focused.length = 0;
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) });
  });
  afterEach(() => { vi.unstubAllGlobals(); setCustomerConfirmHandler(null); });

  it('주소를 검색하지 않았으면 주문서와 같은 문장으로 알리고 첫 틀린 칸으로 간다', async () => {
    expect(await render().check({ ...filled, postalCode: '', address1: '' }, '수락')).toBe(false);
    expect(render().fieldProps(filled, vi.fn()).errors).toEqual({ postalCode: '우편번호 5자리를 입력해주세요.', address1: '기본 주소를 입력해주세요.' });
    expect(focused).toEqual(['gift-address-postalCode']);
    expect(await render().check(filled, '수락')).toBe(true);
    expect(render().fieldProps(filled, vi.fn()).errors).toEqual({});
  });

  it('고친 칸의 오류만 지우고 값은 넘긴다', async () => {
    await render().check({ ...filled, recipientName: '', phone: '1' }, '수락');
    const onChange = vi.fn();
    render().fieldProps({ ...filled, recipientName: '', phone: '1' }, onChange).onChange({ ...filled, recipientName: '박팬', phone: '1' });
    expect(onChange).toHaveBeenCalledWith({ ...filled, recipientName: '박팬', phone: '1' });
    expect(Object.keys(render().fieldProps(filled, vi.fn()).errors)).toEqual(['phone']);
  });

  it('검색한 주소가 공동주택인데 상세 주소가 비면 한 번 확인받고, 취소하면 상세 주소 칸으로 간다', async () => {
    const asked: CustomerConfirmRequest[] = [];
    let answer = false;
    setCustomerConfirmHandler(async (request) => { asked.push(request); return answer; });
    render().fieldProps(filled, vi.fn()).onSearched(true);
    expect(await render().check(filled, '수락')).toBe(false);
    expect(asked[0].confirmLabel).toBe('이대로 수락');
    expect(focused).toEqual(['gift-address-address2']);
    answer = true;
    expect(await render().check(filled, '수락')).toBe(true);
    expect(await render().check({ ...filled, address2: '101동' }, '수락')).toBe(true);
    expect(asked).toHaveLength(2);
  });
});
