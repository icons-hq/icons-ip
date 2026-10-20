'use client';

import { useId } from 'react';
import { ADMIN_LIST_EXPORT_BUTTON_LABEL, ADMIN_LIST_EXPORT_ROW_LIMIT, adminListExportLimitMessage } from '@/lib/admin/list-export';
import { EncryptedWorkbookDownloadButton } from './EncryptedWorkbookDownloadButton';
export { adminListExportResponseError } from './EncryptedWorkbookDownloadButton';

/** Applied server-normalized conditions remain separate from password POST bodies. */
export function AdminListExportButton({ href, total }: { href: string; total: number }) {
  const hintId = useId();
  const overLimit = total > ADMIN_LIST_EXPORT_ROW_LIMIT;
  const limit = ADMIN_LIST_EXPORT_ROW_LIMIT.toLocaleString('ko-KR');
  const expandsLines = new URLSearchParams(href.split('?')[1] ?? '').get('screen') !== 'unpaid';
  return <div className="wc-admin-kit__actions admin-list-export" data-export-href={href}>
    <EncryptedWorkbookDownloadButton href={href} label={ADMIN_LIST_EXPORT_BUTTON_LABEL} disabled={overLimit} describedBy={hintId} />
    <span className="muted" id={hintId}>{overLimit ? adminListExportLimitMessage()
      : `현재 검색 조건의 전체 ${total.toLocaleString('ko-KR')}건을 받습니다(최대 ${limit}건). ${expandsLines ? `한 행은 상품 한 줄이며 한 파일은 최대 ${limit}행입니다. ` : ''}개인정보가 담긴 파일이라 내려받은 기록이 남습니다. 파일을 열 비밀번호를 설정해주세요.`}</span>
  </div>;
}
