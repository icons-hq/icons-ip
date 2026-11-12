import { vi } from 'vitest';
import { setAdminConfirmHandler } from './confirm';

/**
 * 시험용 어드민 확인창. 호스트 대신 `vi.fn`이 확인 문구를 받아 true·false를 돌려준다.
 * `confirm.mock.calls[n][0]`이 확인창에 뜬 문구다. 시험이 끝나면 `restore()`로 해제한다.
 */
export function stubAdminConfirm(answer: boolean | ((message: string) => boolean | Promise<boolean>) = true) {
  const confirm = vi.fn((message: string): boolean | Promise<boolean> => (typeof answer === 'function' ? answer(message) : answer));
  const restore = setAdminConfirmHandler(async (request) => confirm(request.message));
  return Object.assign(confirm, { restore });
}
