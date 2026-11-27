import { startTransition, type FormEvent } from 'react';
import { adminConfirm, type AdminConfirmRequest } from '@/lib/admin/confirm';

/*
 * 미결제 확인 화면의 확인 뒤 제출.
 *
 * 입금 확인·즉시 취소는 되돌릴 수 없다. 양식의 React action에 서버 액션을 그대로 물리면, 하이드레이션 전에 눌린 제출을
 * React가 담아 두었다가 그 action으로 재생한다 — 그 길은 onSubmit도 확인창도 거치지 않는다(주문 콘솔의 취소 양식·클레임
 * 처리 패널이 같은 이유로 이렇게 한다). 그래서 양식의 action 자리는 비워 두고(`ignoreUnconfirmedUnpaidSubmit`),
 * 제출은 늘 막은 뒤 확인창을 통과한 경우에만 transition으로 직접 보낸다. 양식 action을 거치지 않으니 서버가 거절해도
 * 운영자가 적은 근거·사유가 지워지지 않는다.
 */

/** 양식의 React action 자리. 아무것도 보내지 않는다. 하이드레이션 전에 눌린 제출은 확인 없이 나가지 않고 버려진다. */
export function ignoreUnconfirmedUnpaidSubmit() {}

/**
 * 양식 제출을 막고 확인창을 띄운다. 확인하면 입력을 그대로 담아 `dispatch`(useActionState의 action)로 보낸다.
 * 취소·닫기·확인창이 없을 때는 아무것도 보내지 않는다. 보냈으면 true.
 * 브라우저 입력 검사(required·minLength)는 submit 이벤트 전에 끝나므로, 검사에 걸린 입력은 확인창까지 오지 않는다.
 */
export async function submitUnpaidAfterConfirm(
  event: Pick<FormEvent<HTMLFormElement>, 'currentTarget' | 'preventDefault'>,
  request: AdminConfirmRequest,
  dispatch: (formData: FormData) => void,
  readForm: (form: HTMLFormElement) => FormData = (form) => new FormData(form),
): Promise<boolean> {
  event.preventDefault();
  /* 확인을 기다리는 동안 이벤트가 끝나므로, 양식 값은 확인창을 띄우기 전에 읽어 둔다. */
  const formData = readForm(event.currentTarget);
  let confirmed = false;
  try { confirmed = await adminConfirm(request); } catch { confirmed = false; }
  if (!confirmed) return false;
  startTransition(() => dispatch(formData));
  return true;
}

/**
 * 서버 액션이 성공하면 그 결과 문구를 바깥에도 알린다. 입금 확인·즉시 취소가 끝나면 그 주문이 목록에서 빠지며 처리 패널과 패널이 가진
 * 결과 문구가 함께 사라진다 — 패널 바깥(`UnpaidSelectedOrder`)이 그 자리에 결과를 남길 수 있게 성공 문구만 넘긴다.
 * 서버 액션은 그대로 한 번 부르고 결과도 그대로 돌려준다(거절은 알리지 않는다 — 거절된 주문은 목록에 남아 패널이 오류를 보인다).
 */
export function reportUnpaidProcessed<State extends { message?: string }>(
  action: (state: State, formData: FormData) => Promise<State>,
  onProcessed: (message: string) => void,
): (state: State, formData: FormData) => Promise<State> {
  return async (state, formData) => {
    const result = await action(state, formData);
    if (result.message) onProcessed(result.message);
    return result;
  };
}
