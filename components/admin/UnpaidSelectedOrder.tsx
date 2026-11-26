'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import type { AdminUnpaidOrderRow } from '@/lib/admin/unpaid';
import { UnpaidActionsPanel } from './UnpaidActionsPanel';

const LINK_CLASS = 'font-medium underline underline-offset-4';

/**
 * 고른 주문이 목록에 없을 때 그 자리에 보이는 안내.
 * 방금 이 화면에서 처리한 주문이면(`processed`) 그 결과를 말하고, 아니면 다른 곳에서 이미 처리됐을 수 있다고 말한다.
 */
export function UnpaidSelectionNotice({ processed, listHref, detailHref }: {
  /** 방금 처리한 결과 한 줄(`unpaidProcessedNotice`). 이 화면에서 처리한 적이 없으면 null. */
  processed: string | null;
  /** 고른 주문을 푼 목록 주소. */
  listHref: string;
  /** 그 주문의 주문 상세. 주문 번호 꼴이 아닌 값이면 null. */
  detailHref: string | null;
}) {
  if (processed) {
    return (
      <AdminNotice role="status" tone="success">
        {processed}{' '}
        {detailHref ? <><Link className={LINK_CLASS} href={detailHref}>주문 상세</Link>{' · '}</> : null}
        <Link className={LINK_CLASS} href={listHref}>목록으로</Link>
      </AdminNotice>
    );
  }
  return (
    <AdminNotice role="status" tone="warning">
      고른 주문이 목록에 없습니다. 이미 처리됐을 수 있어요.{' '}
      <Link className={LINK_CLASS} href={listHref}>목록으로</Link>
      {detailHref ? <>{' · '}<Link className={LINK_CLASS} href={detailHref}>주문 상세에서 처리 결과 확인</Link></> : null}
    </AdminNotice>
  );
}

/**
 * 미결제 확인 화면에서 고른 주문 한 건의 자리. 주문이 목록에 있으면 처리 패널을, 없으면 안내를 보인다.
 *
 * 입금 확인·즉시 취소가 끝나면 그 주문은 바로 목록에서 빠진다. 처리 패널이 결과 문구를 가진 채 함께 사라지면 화면에는
 * "고른 주문이 목록에 없습니다"만 남아, 방금 자기가 처리한 운영자가 다른 사람이 먼저 처리한 것으로 읽는다. 그래서 주문이 목록에서 빠져도
 * 남는 이 부품이 방금 처리한 결과를 들고 있다가 그 자리에 보인다. 화면은 고른 주문 번호를 key로 줘, 다른 주문을 고르면 새로 연다.
 */
export function UnpaidSelectedOrder({ order, now, detailHref, listHref }: {
  /** 목록에서 찾은 그 주문. 목록에 없으면 null. */
  order: AdminUnpaidOrderRow | null;
  /** 남은 시간을 셀 기준 시각(ms). */
  now?: number;
  detailHref: string | null;
  listHref: string;
}) {
  const [processed, setProcessed] = useState<string | null>(null);
  if (order) {
    return <UnpaidActionsPanel detailHref={detailHref ?? undefined} now={now} onProcessed={setProcessed} order={order} />;
  }
  return (
    <div className="scroll-mt-16" id="unpaid-actions">
      <UnpaidSelectionNotice detailHref={detailHref} listHref={listHref} processed={processed} />
    </div>
  );
}
