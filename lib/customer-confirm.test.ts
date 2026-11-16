import { afterEach, describe, expect, it, vi } from 'vitest';
import { customerConfirm, setCustomerConfirmHandler } from './customer-confirm';
import { stubCustomerConfirm } from './customer-confirm.test-support';

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe('customerConfirm (원장 재작업 후속 4)', () => {
  it('호스트가 없으면 확인되지 않은 것으로 돌려준다 — 확인 없이 요청이 실행되지 않는다', async () => {
    await expect(customerConfirm({ title: '이 선물을 거절할까요?', confirmLabel: '선물 거절' })).resolves.toBe(false);
  });
  it('호스트가 받은 요청 그대로 고객의 선택을 돌려준다', async () => {
    const confirm = stubCustomerConfirm(true); restore = confirm.restore;
    await expect(customerConfirm({ title: '이 선물을 취소할까요?', message: '아직 결제된 금액은 없어요.', confirmLabel: '선물 취소' })).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith({ title: '이 선물을 취소할까요?', message: '아직 결제된 금액은 없어요.', confirmLabel: '선물 취소' });
    confirm.mockReturnValueOnce(false);
    await expect(customerConfirm({ title: '이 선물을 취소할까요?', confirmLabel: '선물 취소' })).resolves.toBe(false);
  });
  it('같은 확인이 떠 있는 동안의 거듭 호출(이중 탭)은 기다리지 않고 false다', async () => {
    let answer!: (value: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    restore = setCustomerConfirmHandler(handler);
    const first = customerConfirm({ title: '진행 중인 요청을 철회할까요?', confirmLabel: '요청 철회' });
    await expect(customerConfirm({ title: '진행 중인 요청을 철회할까요?', confirmLabel: '요청 철회' })).resolves.toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    answer(true);
    await expect(first).resolves.toBe(true);
    /* 닫힌 뒤에는 다시 물을 수 있다. */
    const again = customerConfirm({ title: '진행 중인 요청을 철회할까요?', confirmLabel: '요청 철회' });
    answer(false);
    await expect(again).resolves.toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it('해제한 호스트의 자리에 다른 호스트가 들어와 있으면 그 호스트를 지우지 않는다', async () => {
    const first = setCustomerConfirmHandler(async () => true);
    const second = stubCustomerConfirm(false);
    first();
    await expect(customerConfirm({ title: '확인', confirmLabel: '확인' })).resolves.toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
    second.restore();
  });
});
