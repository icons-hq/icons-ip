import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminConfirm, adminPrompt, confirmAdminSubmit, setAdminConfirmHandler } from './confirm';

afterEach(() => { setAdminConfirmHandler(null); });

describe('adminConfirm', () => {
  it('호스트가 없으면 확인되지 않은 것으로 돌려준다(돈·재고 동작이 확인 없이 나가지 않는다)', async () => {
    expect(await adminConfirm('지울까요?')).toBe(false);
  });

  it('문자열과 옵션 객체를 모두 받아 호스트에 그대로 넘긴다', async () => {
    const handler = vi.fn(async () => true);
    setAdminConfirmHandler(handler);
    expect(await adminConfirm('지울까요?')).toBe(true);
    expect(handler).toHaveBeenLastCalledWith({ message: '지울까요?' });
    await adminConfirm({ message: '취소 승인', title: '전액 취소', destructive: true });
    expect(handler).toHaveBeenLastCalledWith({ message: '취소 승인', title: '전액 취소', destructive: true });
  });

  it('같은 확인이 떠 있는 동안의 거듭 호출(이중 클릭)은 실행으로 이어지지 않는다', async () => {
    let answer!: (ok: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    setAdminConfirmHandler(handler);
    const first = adminConfirm('환불할까요?');
    const second = adminConfirm('환불할까요?');
    const third = adminConfirm('환불할까요?');
    expect(handler).toHaveBeenCalledOnce();
    answer(true);
    expect([await first, await second, await third]).toEqual([true, false, false]);
    /* 닫힌 뒤의 다음 클릭은 새 확인이다. */
    const next = adminConfirm('환불할까요?');
    expect(handler).toHaveBeenCalledTimes(2);
    answer(false);
    expect(await next).toBe(false);
  });

  it('문구가 다른 확인은 따로 센다', async () => {
    const handler = vi.fn(() => new Promise<boolean>(() => undefined));
    setAdminConfirmHandler(handler);
    void adminConfirm('A');
    void adminConfirm('B');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('adminPrompt', () => {
  const request = { message: '이미 쓴 금액은 차감 예정액으로 남습니다.', input: { label: '회수 사유', minLength: 2, maxLength: 500 } };

  it('호스트가 없으면 null이다(사유 없이 실행되지 않는다)', async () => {
    expect(await adminPrompt(request)).toBeNull();
  });

  it('확인하면 호스트가 적은 입력값을, 취소하면 null을 돌려준다', async () => {
    setAdminConfirmHandler(async (asked) => { asked.receive?.('고객 요청'); return true; });
    expect(await adminPrompt(request)).toBe('고객 요청');
    setAdminConfirmHandler(async (asked) => { asked.receive?.('버려질 글'); return false; });
    expect(await adminPrompt(request)).toBeNull();
  });

  it('요청 객체를 바꾸지 않아 같은 요청을 다시 써도 이전 입력이 남지 않는다', async () => {
    setAdminConfirmHandler(async (asked) => { asked.receive?.('처음'); return true; });
    await adminPrompt(request);
    expect('receive' in request).toBe(false);
    setAdminConfirmHandler(async () => true);
    expect(await adminPrompt(request)).toBe('');
  });
});

describe('confirmAdminSubmit', () => {
  function formEvent(connected = true) {
    const submitter = { name: 'approve' };
    const form = { isConnected: connected, requestSubmit: vi.fn() };
    const preventDefault = vi.fn();
    return { form, submitter, preventDefault, event: { preventDefault, currentTarget: form, nativeEvent: { submitter } } as unknown as Parameters<typeof confirmAdminSubmit>[0] };
  }

  it('확인할 문구가 없으면 막지 않고 그대로 제출한다', () => {
    const { event, preventDefault } = formEvent();
    expect(confirmAdminSubmit(event, null)).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('확인하기 전에는 제출을 멈추고, 확인하면 같은 제출 버튼으로 다시 제출한다', async () => {
    let answer!: (ok: boolean) => void;
    setAdminConfirmHandler(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const { event, form, submitter, preventDefault } = formEvent();
    expect(confirmAdminSubmit(event, '환불 완료를 확정할까요?')).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(form.requestSubmit).not.toHaveBeenCalled();
    answer(true);
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledExactlyOnceWith(submitter));
  });

  it('취소하면 다시 제출하지 않는다', async () => {
    const confirm = vi.fn(async () => false);
    setAdminConfirmHandler(confirm);
    const { event, form } = formEvent();
    confirmAdminSubmit(event, '정지할까요?');
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it('확인창이 떠 있는 동안 같은 폼을 거듭 제출해도 확인창과 제출은 하나다', async () => {
    let answer!: (ok: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    setAdminConfirmHandler(handler);
    const { event, form } = formEvent();
    confirmAdminSubmit(event, '일괄 환불할까요?');
    confirmAdminSubmit(event, '일괄 환불할까요?');
    confirmAdminSubmit(event, '일괄 환불할까요?');
    expect(handler).toHaveBeenCalledOnce();
    answer(true);
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledOnce());
  });

  it('다시 제출하는 submit 이벤트는 묻지 않고 지나가고, 표식은 바로 지워진다', async () => {
    setAdminConfirmHandler(async () => true);
    const { event, form } = formEvent();
    form.requestSubmit.mockImplementation(() => {
      /* requestSubmit이 보내는 submit 이벤트를 흉내 낸다: 같은 폼의 두 번째 제출은 묻지 않는다. */
      const preventDefault = vi.fn();
      expect(confirmAdminSubmit({ preventDefault, currentTarget: form, nativeEvent: undefined } as unknown as Parameters<typeof confirmAdminSubmit>[0], '일괄 환불할까요?')).toBe(true);
      expect(preventDefault).not.toHaveBeenCalled();
    });
    confirmAdminSubmit(event, '일괄 환불할까요?');
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledOnce());
    const again = formEvent();
    again.form.requestSubmit.mockImplementation(() => undefined);
    expect(confirmAdminSubmit({ ...again.event, currentTarget: form } as unknown as Parameters<typeof confirmAdminSubmit>[0], '일괄 환불할까요?')).toBe(false);
  });

  it('확인하는 사이 폼이 사라졌으면 제출하지 않는다', async () => {
    setAdminConfirmHandler(async () => true);
    const { event, form } = formEvent(false);
    confirmAdminSubmit(event, '삭제할까요?');
    await Promise.resolve();
    await Promise.resolve();
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });
});
