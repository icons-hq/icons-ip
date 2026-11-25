import { GOOD_EDITOR_HELP } from './good-editor';
import { GOOD_FIELDS_A_HELP } from './good-fields-a';
import { GOOD_FIELDS_B_HELP } from './good-fields-b';
import { GOOD_OPTIONS_HELP } from './good-options';
import { GOOD_PICKERS_B_HELP } from './good-pickers-b';
import { GOOD_SALE_TIMING_HELP } from './good-sale-timing';
import type { AdminHelpBook } from './types';

/**
 * 어드민 "?" 도움말 묶음 전체. 화면을 하나 정리할 때마다 `lib/admin/help/<화면>.ts`를 만들고 여기에 등록한다 —
 * 등록해야 문구 검사(help-contract.test.ts)가 본다.
 */
export const ADMIN_HELP_BOOKS: Readonly<Record<string, AdminHelpBook>> = {
  'good-editor': GOOD_EDITOR_HELP,
  'good-fields-a': GOOD_FIELDS_A_HELP,
  'good-fields-b': GOOD_FIELDS_B_HELP,
  'good-options': GOOD_OPTIONS_HELP,
  'good-pickers-b': GOOD_PICKERS_B_HELP,
  'good-sale-timing': GOOD_SALE_TIMING_HELP,
};
