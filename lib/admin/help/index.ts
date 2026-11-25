import { GOOD_EDITOR_HELP } from './good-editor';
import type { AdminHelpBook } from './types';

/**
 * 어드민 "?" 도움말 묶음 전체. 화면을 하나 정리할 때마다 `lib/admin/help/<화면>.ts`를 만들고 여기에 등록한다 —
 * 등록해야 문구 검사(help-contract.test.ts)가 본다.
 */
export const ADMIN_HELP_BOOKS: Readonly<Record<string, AdminHelpBook>> = {
  'good-editor': GOOD_EDITOR_HELP,
};
