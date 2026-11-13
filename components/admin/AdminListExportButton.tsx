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
  /* 미결제 확인과 환불 송금 대기는 한 행이 주문·요청 한 건이다(상품 줄로 펼치지 않는다). */
  const expandsLines = !['unpaid', 'refund-transfers'].includes(new URLSearchParams(href.split('?')[1] ?? '').get('screen') ?? '');
  const fullHint = `현재 검색 조건의 전체 ${total.toLocaleString('ko-KR')}건을 받습니다(최대 ${limit}건). ${expandsLines ? `한 행은 상품 한 줄이며 한 파일은 최대 ${limit}행입니다. ` : ''}개인정보가 담긴 파일이라 내려받은 기록이 남습니다. 파일을 열 비밀번호를 설정해주세요.`;
  /* 좁은 화면(640px 아래)에서는 왼쪽 정렬 — 여러 줄 안내문이 오른쪽 정렬이면 줄 시작이 들쭉날쭉하다. */
  return <div className="flex flex-col items-start gap-1 sm:items-end" data-admin-list-export="" data-export-href={href}>
    <EncryptedWorkbookDownloadButton href={href} label={ADMIN_LIST_EXPORT_BUTTON_LABEL} disabled={overLimit} describedBy={hintId} />
    {/* 매일 쓰는 목록의 머리를 밀어내지 않도록 보이는 안내는 한 줄이다. 전체 문구는 도움말(title)과 스크린리더로 읽는다. */}
    <span className="max-w-md text-left text-xs leading-snug text-pretty text-muted-foreground sm:text-right" id={hintId} title={overLimit ? undefined : fullHint}>{overLimit ? adminListExportLimitMessage() : `현재 검색 조건 전체 ${total.toLocaleString('ko-KR')}건 · 최대 ${limit}건`}<span className="sr-only">{overLimit ? null : ` ${fullHint}`}</span></span>
  </div>;
}
