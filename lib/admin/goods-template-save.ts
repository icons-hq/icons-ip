/**
 * 사이즈·A/S·이벤트 템플릿 관리와 상품의 같은 안내 패널이 함께 쓰는 말과 조회.
 * 저장 결과를 모를 때·다른 사람이 먼저 바꿨을 때의 말은 화면마다 같아야 한다(docs/admin-screen-rules.md 규칙 4).
 */

/** 저장 결과를 모를 때 누르는 버튼. 방금 보낸 내용을 그대로 다시 보내 결과만 받아 온다. */
export const SAVE_CHECK_LABEL = '저장됐는지 확인';
/** 저장 결과를 모를 때의 문장. 버튼 이름은 화면에 적힌 그대로 쓴다. */
export const SAVE_UNKNOWN_MESSAGE = `저장됐는지 확인하지 못했습니다. [${SAVE_CHECK_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.`;
export const CHANGED_BY_OTHER = '다른 사람이 먼저 바꿨습니다.';
/** 앞서 누른 저장을 이어서 확인하려 했는데 그사이 내용이나 로그인한 계정이 달라진 경우. */
export const SAVE_MISMATCH_MESSAGE = '앞서 누른 저장과 내용이나 로그인한 계정이 달라 이어서 저장하지 못했습니다. 지금 저장된 내용을 확인한 뒤 다시 저장해 주세요.';
export const CATALOG_PERMISSION_MESSAGE = '상품 관리 권한이 없습니다. 판매자 정보 > 매니저 관리 담당자에게 권한을 받은 뒤 다시 저장해 주세요.';
/** 원인을 알 수 없는 저장 실패. 입력은 화면에 남는다. */
export const SAVE_FAILED_MESSAGE = '저장하지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.';

/* 템플릿 편집 창(사이즈·A/S·이벤트)이 함께 쓰는 버튼 이름과 확인창. 세 화면이 같은 일을 같은 말로 부른다. */
export const TEMPLATE_SAVE_OVER_LATEST_LABEL = '최신 내용 위에 내 입력으로 저장';
export const TEMPLATE_DISCARD_INPUT_LABEL = '내 입력 버리기';
export const TEMPLATE_LATEST_UNREAD_MESSAGE = '지금 저장된 내용을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
/** 적은 내용이 있는 채로 창을 닫을 때. 등록 팝업(AdminCreateDialogButton의 confirmDiscard)도 이 상수를 쓴다. */
export const TEMPLATE_CLOSE_DIRTY_CONFIRM = { title: '적은 내용을 저장하지 않고 닫을까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장하지 않고 닫기' } as const;
/**
 * 저장됐는지 모르는 채 닫을 때. 닫으면 목록을 다시 불러온다.
 * `keptInBrowser`: 저장하려던 내용이 브라우저에 보관돼 다시 열어 확인할 수 있는 화면(사이즈)이면 true, 닫으면 입력이 사라지는 화면이면 false.
 */
export function templateCloseUnknownConfirm(keptInBrowser: boolean) {
  const next = keptInBrowser ? `목록에 없으면 같은 템플릿을 다시 열어 [${SAVE_CHECK_LABEL}]을 눌러 주세요.` : '목록에 없으면 다시 적어야 합니다.';
  return { title: '저장됐는지 모르는 채 닫을까요?', message: `닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. ${next}`, confirmLabel: '닫기' };
}
export const TEMPLATE_DISCARD_INPUT_CONFIRM = { title: '내 입력을 버릴까요?', message: '지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.', confirmLabel: TEMPLATE_DISCARD_INPUT_LABEL } as const;
/** [보관]·[복원]은 보관 상태만 바꾼다. 고친 내용이 있으면 그것이 사라진다고 먼저 묻는다. */
export function templateArchiveConfirm(archive: boolean) {
  const verb = archive ? '보관' : '복원';
  return { title: `고친 내용은 저장하지 않고 ${verb}할까요?`, message: `[${verb}]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.`, confirmLabel: `저장하지 않고 ${verb}` };
}

/**
 * 확인창에서 취소했는데 브라우저가 창을 이미 닫아 버린 경우(Esc를 거듭 누르면 생긴다) 창을 다시 연다.
 * 닫힌 채 두면 화면에서는 사라졌는데 편집 상태만 남아 다시 열 수 없다.
 */
export function reopenClosedDialog(inside: Element | null | undefined): void {
  const dialog = inside?.closest?.('dialog');
  if (!dialog || !dialog.isConnected || dialog.open) return;
  try { dialog.showModal(); } catch { /* 문서에서 빠지는 중이면 그대로 둔다. */ }
}

/** 선택창 줄·확인창에 넣는 한 줄 발췌. 첫 줄만, 길면 줄임표로 자른다. */
export function templateExcerpt(text: string, limit = 30): string {
  const chars = Array.from(text.trim().split('\n')[0]?.trim() ?? '');
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : chars.join('');
}

type TemplateListResult<T> = { ok: true; value: { rows: readonly T[]; total: number } } | { ok: false };
const LOOKUP_PAGE_SIZE = 20;
const LOOKUP_MAX_PAGES = 50;

/**
 * 템플릿 한 건의 지금 저장된 내용을 목록 조회로 찾는다(한 건만 읽는 조회가 없다). 사용 중 → 보관됨 순서로 20개씩 넘겨 본다.
 * 찾으면 그 템플릿, 끝까지 없으면 null, 조회하지 못했으면 'failed'.
 */
export async function findSavedTemplate<T extends { id: string }>(
  id: string, list: (archived: boolean, page: number) => Promise<TemplateListResult<T>>,
): Promise<T | null | 'failed'> {
  try {
    for (const archived of [false, true]) {
      for (let page = 1; page <= LOOKUP_MAX_PAGES; page += 1) {
        const result = await list(archived, page);
        if (!result?.ok) return 'failed';
        const found = result.value.rows.find(row => row.id === id);
        if (found) return found;
        if (page * LOOKUP_PAGE_SIZE >= result.value.total) break;
      }
    }
    return null;
  } catch { return 'failed'; }
}
