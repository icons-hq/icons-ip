import { vi } from 'vitest';
import { setCustomerConfirmHandler, type CustomerConfirmRequest } from './customer-confirm';

/**
 * 시험용 고객 확인창. 호스트 대신 `vi.fn`이 확인 요청을 받아 true·false를 돌려준다.
 * `confirm.mock.calls[n][0]`이 확인창에 뜬 요청(제목·설명·버튼)이다. 시험이 끝나면 `restore()`로 해제한다.
 */
export function stubCustomerConfirm(answer: boolean | ((request: CustomerConfirmRequest) => boolean | Promise<boolean>) = true) {
  const confirm = vi.fn((request: CustomerConfirmRequest): boolean | Promise<boolean> => (typeof answer === 'function' ? answer(request) : answer));
  const restore = setCustomerConfirmHandler(async (request) => confirm(request));
  return Object.assign(confirm, { restore });
}
