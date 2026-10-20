'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { respondGiftAction } from '@/app/gifts/actions';
import { GiftAddressFields, GiftItems, GiftRequestFeedback, EMPTY_GIFT_ADDRESS } from '@/components/gifts/GiftParts';
import { useGiftRequest, useGiftUnsaved } from '@/components/gifts/useGiftRequest';
import type { GiftInvitation } from '@/lib/gifts';
import { normalizeCheckoutAddress } from '@/lib/checkout';
import { routes } from '@/lib/routes';

export function GiftReceive({ actorId, actorLabel, invitation }: { actorId: string; actorLabel: string; invitation: GiftInvitation }) {
  const router = useRouter(), [address, setAddress] = useState({ ...EMPTY_GIFT_ADDRESS }), [privacy, setPrivacy] = useState(false), [finished, setFinished] = useState(false);
  const lost = useCallback(() => { setAddress({ ...EMPTY_GIFT_ADDRESS }); setPrivacy(false); }, []);
  const request = useGiftRequest(actorId, lost);
  useGiftUnsaved(!finished && !request.blocked && (Object.values(address).some(Boolean) || request.pending || Boolean(request.failure?.uncertain)));
  const respond = (accept: boolean) => {
    const destination = accept ? normalizeCheckoutAddress(address) : null;
    if (accept && (!destination || !privacy)) return;
    const operationId = crypto.randomUUID();
    request.run(() => respondGiftAction(invitation.id, invitation.revision, accept, destination, operationId, actorId), result => { setFinished(true); setAddress({ ...EMPTY_GIFT_ADDRESS }); router.replace(routes.gift(result.gift.id)); });
  };
  return <main className="wc-root"><div className="wc-container wc-gifts"><header><h1>{request.blocked ? '선물 확인' : `${invitation.senderLabel}님의 선물`}</h1><p>선물을 받을 배송지를 입력해주세요. 보낸 사람에게 주소와 연락처가 공개되지 않아요.</p></header>
    {!request.blocked ? <><p>현재 로그인: <strong>{actorLabel}</strong> · 이 계정의 선물함에 보관됩니다.</p><GiftItems items={invitation.items} />{invitation.message ? <blockquote>{invitation.message}</blockquote> : null}
      <p>{new Date(invitation.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 수락할 수 있어요.</p>
      <form onSubmit={event => { event.preventDefault(); respond(true); }}><GiftAddressFields value={address} disabled={request.locked} onChange={setAddress} />
        <label className="wc-gifts__check"><input type="checkbox" checked={privacy} disabled={request.locked} onChange={event => setPrivacy(event.target.checked)} />선물 배송을 위해 배송지와 연락처를 제공하는 데 동의합니다. <Link href="/privacy">개인정보 처리방침</Link></label>
        <p>수락 후 보낸 사람이 결제를 완료하면 배송이 시작돼요. 선물 대금과 환불은 보낸 사람에게 귀속돼요.</p>
        <div className="wc-gifts__actions"><button type="submit" disabled={request.locked || !privacy}>선물 수락</button><button type="button" disabled={request.locked} onClick={() => { if (confirm('이 선물을 거절할까요?')) respond(false); }}>거절</button></div>
      </form></> : null}<GiftRequestFeedback {...request} />{request.failure?.conflict ? <p><Link href={routes.gifts()}>선물함에서 현재 상태 확인</Link></p> : null}
  </div></main>;
}
