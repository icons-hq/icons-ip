'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { sendMarketingTestAction } from '@/app/admin/marketing-attachment-actions';
import { useGoodsGroupSession } from './GoodsGroupOperation';
export function MarketingTestReceiptButton({ campaignId, revision, actorId, sessionId }: { campaignId: string; revision: number; actorId: string; sessionId: string | null }) {
  const [pending, start] = useTransition(), [error, setError] = useState(''), [link, setLink] = useState(''), [uncertain, setUncertain] = useState(false);
  const operation = useRef<string | null>(null), session = useGoodsGroupSession(actorId, sessionId);
  function send() { if (!session.current() || !sessionId) return; operation.current ??= crypto.randomUUID(); const id = operation.current;
    start(async () => {
      const result = await sendMarketingTestAction(campaignId, revision, id, { actorId, sessionId }); if (!session.current()) return;
      if ('receipt' in result && result.receipt) { setLink(result.receipt.linkPath); setError(''); setUncertain(false); operation.current = null; }
      else { setError(result.error ?? '테스트 결과를 확인하지 못했습니다.'); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) operation.current = null; }
    });
  }
  return <div className="wc-admin-marketing__test"><p>저장본 버전 {revision}을 현재 운영자 본인의 알림함으로 보냅니다. 고객 발송 이력·통계에는 포함하지 않습니다.</p>
    <button type="button" className="wc-admin-kit__button" disabled={pending || session.blocked} onClick={send}>{pending ? '등록 중…' : uncertain ? '같은 테스트 요청 결과 확인' : '내 알림함으로 테스트'}</button>
    {link ? <p role="status">내 알림함에 테스트를 등록했습니다. <Link href={link}>테스트 알림 열기</Link></p> : null}{error ? <p role="alert">{error}</p> : null}
  </div>;
}
