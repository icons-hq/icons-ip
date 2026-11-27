import { adminConfirm } from './confirm';
import { reopenClosedDialog, TEMPLATE_CLOSE_DIRTY_CONFIRM } from './goods-template-save';

/** 적은 내용이 있는 창을 닫을 때의 확인창. 배송지 수정·템플릿 창과 같은 말이고, 닫지 않는 버튼은 [돌아가기]다. */
export const ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM = { ...TEMPLATE_CLOSE_DIRTY_CONFIRM, cancelLabel: '돌아가기' } as const;

/**
 * 창을 닫는다. 적은 내용이 있으면(`dirty`) 닫기 전에 한 번 묻는다(화면 규칙 7 — 다시 입력해야 하는 값이 있으면 묻는다).
 * 적은 것이 없으면 묻지 않고 바로 닫는다. [닫기]·X·Esc가 모두 이 길을 지나게 창의 onClose에 건다.
 *
 * 확인창에서 돌아가는데 브라우저가 창을 이미 닫았으면(Esc를 거듭 누르면 생긴다) 다시 연다 — `inside`는 그 창 안의 아무 요소나 돌려준다.
 * 훅을 쓰지 않는다(화면 부품의 훅 순서를 바꾸지 않고 붙일 수 있다).
 */
export function closeAdminDialog(dirty: boolean, onClose: () => void, inside: () => Element | null | undefined = () => null): void {
  if (!dirty) { onClose(); return; }
  void adminConfirm(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM).then(
    (ok) => { if (ok) onClose(); else reopenClosedDialog(inside()); },
    () => { /* 확인창을 띄우지 못했다 — 적은 내용을 지키려고 닫지 않는다. */ },
  );
}
