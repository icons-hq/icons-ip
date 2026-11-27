import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { ignoreUnconfirmedUnpaidSubmit, submitUnpaidAfterConfirm } from './unpaid-submit';

/* 입금 확인·즉시 취소는 되돌릴 수 없다. 확인창을 통과하기 전에는 어떤 경로로도 서버 액션이 불리지 않아야 한다. */
const request = { title: '주문을 취소할까요?', message: '주문 1 · 홍길동 · 23,000원', confirmLabel: '주문 취소', cancelLabel: '돌아가기' };
const form = { name: 'form' } as unknown as HTMLFormElement;
const formData = { name: 'formData' } as unknown as FormData;
const readForm = vi.fn(() => formData);

function submitEvent() {
  return { currentTarget: form, preventDefault: vi.fn() };
}

let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
afterEach(() => {
  confirm?.restore();
  confirm = null;
  setAdminConfirmHandler(null);
  readForm.mockClear();
});

describe('submitUnpaidAfterConfirm', () => {
  it('제출을 먼저 막고, 확인창에 문구를 보인 뒤, 확인하면 읽어 둔 입력을 그대로 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const event = submitEvent();
    const dispatch = vi.fn();

    await expect(submitUnpaidAfterConfirm(event, request, dispatch, readForm)).resolves.toBe(true);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toBe(request.message);
    expect(readForm).toHaveBeenCalledWith(form);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(formData);
  });

  it('양식 값은 확인창을 띄우기 전에 읽는다(확인을 기다리는 동안 이벤트가 끝난다)', async () => {
    const order: string[] = [];
    readForm.mockImplementationOnce(() => { order.push('read'); return formData; });
    confirm = stubAdminConfirm(() => { order.push('confirm'); return true; });
    await submitUnpaidAfterConfirm(submitEvent(), request, vi.fn(), readForm);
    expect(order).toEqual(['read', 'confirm']);
  });

  it('확인창에서 돌아가면 아무것도 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const event = submitEvent();
    const dispatch = vi.fn();

    await expect(submitUnpaidAfterConfirm(event, request, dispatch, readForm)).resolves.toBe(false);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('확인창이 없으면(셸이 아직 없을 때) 확인되지 않은 것으로 보고 보내지 않는다', async () => {
    const dispatch = vi.fn();
    await expect(submitUnpaidAfterConfirm(submitEvent(), request, dispatch, readForm)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('확인창이 실패해도 보내지 않고 오류를 밖으로 던지지 않는다', async () => {
    setAdminConfirmHandler(async () => { throw new Error('dialog failed'); });
    const dispatch = vi.fn();
    await expect(submitUnpaidAfterConfirm(submitEvent(), request, dispatch, readForm)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('같은 확인창이 떠 있는 동안 거듭 눌러도 한 번만 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const dispatch = vi.fn();
    const results = await Promise.all([
      submitUnpaidAfterConfirm(submitEvent(), request, dispatch, readForm),
      submitUnpaidAfterConfirm(submitEvent(), request, dispatch, readForm),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(confirm).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

describe('ignoreUnconfirmedUnpaidSubmit', () => {
  /* 양식 action 자리다. 하이드레이션 전에 눌린 제출을 React가 이 자리로 재생하는데, 그 길은 확인창을 거치지 않으므로 아무것도 하지 않는다. */
  it('아무것도 보내지 않는다', () => {
    expect(ignoreUnconfirmedUnpaidSubmit()).toBeUndefined();
  });
});
