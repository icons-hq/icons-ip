'use client';
import { OrderReshipmentHistory } from '@/components/orders/OrderReshipmentHistory';
import { ClaimContactHistory } from '@/components/claim-contact/ClaimContactHistory';
import { ClaimCollectionPlan } from '@/components/orders/ClaimCollectionPlan';
import { OrderClaimFees } from '@/components/orders/ClaimFeePanel';
import { useCallback, useState } from 'react';
import { reloadGiftClaimAction, requestGiftClaimAction, setGiftRefundAccountAction, withdrawGiftClaimAction } from '@/app/gifts/claim-actions';
import type { GiftClaimContext } from '@/lib/gift-claims';
import { GiftRequestFeedback } from './GiftParts';
import { useGiftRequest, useGiftUnsaved } from './useGiftRequest';
const STAGES: Record<string, string> = { requested: '접수', in_review: '확인 중', collecting: '수거 중', collected: '입고 완료', on_hold: '보류', processing: '처리 중', needs_review: '확인 필요', completed: '완료', rejected: '반려', withdrawn: '철회' };
export function GiftClaims({ actorId, orderId, initialContext }: { actorId: string; orderId?: string; initialContext: GiftClaimContext }) {
  const [context, setContext] = useState(initialContext), [type, setType] = useState<'return' | 'exchange'>('return'), [reason, setReason] = useState<'change_of_mind' | 'defect'>('change_of_mind');
  const [bankName, setBankName] = useState(''), [accountNumber, setAccountNumber] = useState(''), [accountHolder, setAccountHolder] = useState(''), [notice, setNotice] = useState('');
  const lost = useCallback(() => { setContext(previous => ({ ...previous, canRequest: false, claim: null, reshipmentHistory: [] })); setBankName(''); setAccountNumber(''); setAccountHolder(''); setNotice(''); }, []);
  const request = useGiftRequest(actorId, lost), claim = context.claim;
  useGiftUnsaved(!request.blocked && Boolean(bankName || accountNumber || accountHolder || request.pending || request.failure?.uncertain));
  return <section><h2>교환·반품 요청</h2>{!request.blocked ? <>
    <p>선물 전체를 기준으로 요청할 수 있어요. 환불금과 사용한 결제 혜택은 보낸 사람에게 돌아가요.</p>
    <OrderReshipmentHistory receipts={context.reshipmentHistory ?? []} />
    {orderId ? <OrderClaimFees actorId={actorId} orderId={orderId} /> : null}
    {claim ? <div><p>{({ cancel: '취소', return: '반품', exchange: '교환' })[claim.type]} · {STAGES[claim.stage]}</p>
      {claim.reshipTrackingNumber ? <p>교환 굿즈 {claim.reshipCarrier} · {claim.reshipTrackingNumber}</p> : null}
      {orderId && (claim.type === 'return' || claim.type === 'exchange') ? <><ClaimCollectionPlan actorId={actorId} claimId={claim.id} /><ClaimContactHistory key={claim.id} actorId={actorId} orderId={orderId} claimId={claim.id} /></> : null}
      {claim.canWithdraw ? <button type="button" disabled={request.locked} onClick={() => {
        if (!confirm('진행 중인 요청을 철회할까요? 주문은 유지돼요.')) return;
        const id = crypto.randomUUID(), revision = claim.revision, claimId = claim.id;
        request.run(() => withdrawGiftClaimAction(context.giftId, claimId, revision, id, actorId), result => { setContext(result.context); setNotice('요청을 철회했습니다.'); });
      }}>요청 철회</button> : null}
      {claim.maskedRefundAccount ? <p>환불계좌 확인됨 · {claim.maskedRefundAccount}</p> : null}
      {claim.refundAccountNeeded ? <form onSubmit={event => {
        event.preventDefault(); const id = crypto.randomUUID(), claimId = claim.id, bank = bankName, number = accountNumber, holder = accountHolder;
        request.run(() => setGiftRefundAccountAction(context.giftId, claimId, bank, number, holder, id, actorId), result => { setContext(result.context); setBankName(''); setAccountNumber(''); setAccountHolder(''); setNotice('환불계좌를 확인했습니다.'); });
      }}><h3>환불계좌 확인 필요</h3><p>계좌로 환불이 필요한 요청이에요. 결제한 분의 계좌를 확인한 뒤 진행해요.</p><fieldset disabled={request.locked}><legend>보낸 사람의 환불계좌</legend>
        <label>은행<input value={bankName} maxLength={40} required autoComplete="off" onChange={event => setBankName(event.target.value)} /></label>
        <label>계좌번호<input value={accountNumber} pattern="[0-9-]{8,30}" maxLength={30} required inputMode="numeric" autoComplete="off" onChange={event => setAccountNumber(event.target.value)} /></label>
        <label>예금주<input value={accountHolder} maxLength={40} required autoComplete="off" onChange={event => setAccountHolder(event.target.value)} /></label><button type="submit">환불계좌 확인</button></fieldset></form> : null}
    </div> : null}
    {context.canRequest ? <form onSubmit={event => { event.preventDefault(); if (!confirm(`${type === 'return' ? '반품' : '교환'}을 요청할까요? 선물 전체에 적용돼요.`)) return;
      const id = crypto.randomUUID(), requestedType = type, requestedReason = reason;
      request.run(() => requestGiftClaimAction(context.giftId, requestedType, requestedReason, id, actorId), result => { setContext(result.context); setNotice('요청을 접수했습니다.'); });
    }}><fieldset disabled={request.locked}><legend>배송받은 선물 요청</legend><label>유형<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="return">반품</option><option value="exchange">교환</option></select></label>
      <label>사유<select value={reason} onChange={event => setReason(event.target.value as typeof reason)}><option value="change_of_mind">단순 변심</option><option value="defect">굿즈 하자·오배송</option></select></label><button type="submit">요청 접수</button></fieldset></form> : null}
    <button type="button" disabled={request.pending || Boolean(request.failure?.uncertain)} onClick={() => request.recover(() => reloadGiftClaimAction(context.giftId, actorId), result => { setContext(result.context); setNotice('최신 요청 상태를 확인했습니다.'); })}>요청 상태 확인</button>
    {notice ? <p role="status">{notice}</p> : null}</> : null}<GiftRequestFeedback {...request} /></section>;
}
