import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler, type AdminConfirmRequest } from './confirm';
import { ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM, closeAdminDialog } from './dialog-close';

/* 적은 내용이 있는 창을 닫을 때는 한 번 묻는다(화면 규칙 7). 적은 것이 없으면 묻지 않는다. */
let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('closeAdminDialog', () => {
  it('적은 내용이 없으면 묻지 않고 바로 닫는다', () => {
    const asked: AdminConfirmRequest[] = [];
    restore = setAdminConfirmHandler(async request => { asked.push(request); return true; });
    const onClose = vi.fn();
    closeAdminDialog(false, onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(asked).toEqual([]);
  });

  it('적은 내용이 있으면 배송지 수정·템플릿 창과 같은 말로 묻고, [저장하지 않고 닫기]를 눌러야 닫는다', async () => {
    const asked: AdminConfirmRequest[] = [];
    restore = setAdminConfirmHandler(async request => { asked.push(request); return true; });
    const onClose = vi.fn();
    closeAdminDialog(true, onClose);
    expect(onClose).not.toHaveBeenCalled();
    await settle();
    expect(asked).toEqual([{ title: '적은 내용을 저장하지 않고 닫을까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장하지 않고 닫기', cancelLabel: '돌아가기' }]);
    expect(asked[0]).toEqual(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('돌아가면 닫지 않고, 브라우저가 이미 닫은 창이면 다시 연다', async () => {
    restore = setAdminConfirmHandler(async () => false);
    const onClose = vi.fn(); const showModal = vi.fn();
    const dialog = { isConnected: true, open: false, showModal };
    closeAdminDialog(true, onClose, () => ({ closest: () => dialog }) as unknown as Element);
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(showModal).toHaveBeenCalledOnce();
  });

  it('확인창을 띄우지 못하면 닫지 않는다(적은 내용을 지킨다)', async () => {
    restore = setAdminConfirmHandler(async () => { throw new Error('host gone'); });
    const onClose = vi.fn();
    closeAdminDialog(true, onClose);
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });
});
