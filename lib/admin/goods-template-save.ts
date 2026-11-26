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
export const TEMPLATE_SAVE_OVER_LATEST_LABEL = '내 입력으로 덮어쓰기';
/** [내 입력으로 덮어쓰기] 위의 한 줄. 합쳐지는 것이 아니라 다른 사람이 저장한 내용이 통째로 내 입력으로 바뀐다(되돌릴 수 없다). */
export const TEMPLATE_SAVE_OVER_LATEST_NOTE = `[${TEMPLATE_SAVE_OVER_LATEST_LABEL}]를 누르면 다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.`;
export const TEMPLATE_DISCARD_INPUT_LABEL = '내 입력 버리기';
export const TEMPLATE_LATEST_UNREAD_MESSAGE = '지금 저장된 내용을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
/** 적은 내용이 있는 채로 창을 닫을 때. 등록 팝업(AdminCreateDialogButton의 confirmDiscard)도 이 상수를 쓴다. */
export const TEMPLATE_CLOSE_DIRTY_CONFIRM = { title: '적은 내용을 저장하지 않고 닫을까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장하지 않고 닫기' } as const;
/**
 * 저장됐는지 모르는 채 닫을 때. 닫으면 목록을 다시 불러온다.
 * `keptInBrowser`: 저장하려던 내용이 브라우저에 보관돼 다시 열어 확인할 수 있는 화면(사이즈)이면 true, 닫으면 입력이 사라지는 화면이면 false.
 * `registerLabel`: 새로 등록하던 템플릿이면 그 등록 버튼의 이름. 목록에 없는 템플릿은 다시 열 줄이 없으므로 등록 버튼을 다시 누르라고 말한다.
 */
export function templateCloseUnknownConfirm(keptInBrowser: boolean, registerLabel?: string) {
  const next = !keptInBrowser ? '목록에 없으면 다시 적어야 합니다.'
    : registerLabel ? `목록에 없으면 [${registerLabel}]을 다시 눌러 [${SAVE_CHECK_LABEL}]을 눌러 주세요.`
      : `목록에 없으면 같은 템플릿을 다시 열어 [${SAVE_CHECK_LABEL}]을 눌러 주세요.`;
  return { title: '저장됐는지 모르는 채 닫을까요?', message: `닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. ${next}`, confirmLabel: '닫기' };
}
/**
 * 저장하지 않고 닫았지만 적던 내용이 브라우저에 남아 있을 때(사이즈 템플릿) 목록 위에 보이는 한 줄.
 * 그 화면은 묻지 않고 닫히므로, 적던 것이 사라지지 않았다는 것과 되찾는 길을 닫히는 순간에 말한다(2026-11-26 브라우저 확인 F5).
 * `savedName`: 저장돼 있는 템플릿을 고치던 중이면 목록에 보이는 그 이름. 새로 등록하던 중이면 주지 않는다(등록 버튼을 다시 누르라고 말한다).
 */
export function templateKeptInBrowserNotice(registerLabel: string, savedName?: string): string {
  const reopen = savedName ? `‘${savedName}’ 줄의 [수정]` : `[${registerLabel}]`;
  return `적던 내용은 이 브라우저에 남아 있습니다(최대 7일). ${reopen}을 다시 누른 뒤 [템플릿 복구]를 누르면 이어서 쓸 수 있습니다.`;
}
export const TEMPLATE_DISCARD_INPUT_CONFIRM = { title: '내 입력을 버릴까요?', message: '지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.', confirmLabel: TEMPLATE_DISCARD_INPUT_LABEL } as const;
/** [보관]·[복원]은 보관 상태만 바꾼다. 고친 내용이 있으면 그것이 사라진다고 먼저 묻는다. */
export function templateArchiveConfirm(archive: boolean) {
  const verb = archive ? '보관' : '복원';
  return { title: `고친 내용은 저장하지 않고 ${verb}할까요?`, message: `[${verb}]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.`, confirmLabel: `저장하지 않고 ${verb}` };
}

/**
 * 적은 내용이 저장된 것과 다른데 저장된 내용을 다시 불러올 때(상품의 A/S·사은품 안내, 수령 방식, 주문 후 제작). 적은 내용이 사라진다고 먼저 묻는다(화면 규칙 7).
 * 고친 것이 없으면 묻지 않는다.
 */
export const RELOAD_SAVED_CONFIRM = { title: '적은 내용을 버리고 저장된 내용을 불러올까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장된 내용 불러오기' } as const;

/** 편집 창을 닫으며 목록에 알리는 것: 저장했는지, 보관했는지, 복원했는지. */
export type TemplateSavedKind = 'saved' | 'archived' | 'restored';
/** 저장한 보관 상태가 목록에서 보던 것과 달라졌으면 보관·복원, 같으면 저장이다. */
export function templateSavedKind(wasArchived: boolean, archived: boolean): TemplateSavedKind {
  return archived === wasArchived ? 'saved' : archived ? 'archived' : 'restored';
}
/**
 * 저장·보관·복원 뒤 목록 위에 보이는 결과 한 줄. 보관·복원한 템플릿은 지금 보는 목록에서 사라지므로 어디서 다시 보는지까지 말한다.
 * 보관한 템플릿의 줄에는 [수정]뿐이고 [복원]은 그 창 안에 있어, 되살리는 길도 함께 말한다(2026-11-26 브라우저 확인). 사진 보관함은 줄에 [복원]이 있어 앞 문장만 쓴다.
 */
export function templateSavedNotice(kind: TemplateSavedKind): string {
  return kind === 'archived' ? "보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있고, 그 줄의 [수정]을 열어 [복원]을 누르면 되살아납니다."
    : kind === 'restored' ? "복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다." : '템플릿을 저장했습니다.';
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
