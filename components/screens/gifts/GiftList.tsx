import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import { GiftEmpty, GiftItems } from '@/components/gifts/GiftParts';
import { giftStateLabel, type GiftPage, type GiftParty } from '@/lib/gifts';
import { routes } from '@/lib/routes';

export function GiftList({ page, party, available }: { page: GiftPage; party: GiftParty; available: boolean }) {
  const last = page.items.at(-1);
  return <MypageShell active={routes.gifts()}><div className="wc-gifts"><header><h1>선물함</h1><p>보낸 선물과 받은 선물의 진행 상태를 확인하세요.</p>{available ? <Link className="wc-gifts__button" href={routes.giftNew()}>선물 준비</Link> : null}</header>
    <nav className="wc-gifts__tabs" aria-label="선물함 종류"><Link aria-current={party === 'sender' ? 'page' : undefined} href="/gifts?party=sender">보낸 선물</Link><Link aria-current={party === 'recipient' ? 'page' : undefined} href="/gifts?party=recipient">받은 선물</Link></nav>
    {page.items.length ? <ul className="wc-gifts__list">{page.items.map(gift => <li key={gift.id}><article><div className="wc-gifts__card-heading"><h2><Link href={routes.gift(gift.id)}>{party === 'sender' ? gift.recipientLabel ? `${gift.recipientLabel}님께 보낸 선물` : '수락을 기다리는 선물' : `${gift.senderLabel}님의 선물`}</Link></h2><span>{giftStateLabel(gift.state, gift.order?.status)}</span></div>
      <GiftItems items={gift.items} /><p>{new Date(gift.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 준비</p></article></li>)}</ul> : <GiftEmpty title={party === 'sender' ? '보낸 선물이 없어요' : '받은 선물이 없어요'}><p>{party === 'sender' ? '마음을 전할 굿즈를 골라보세요.' : '선물 링크에서 수락하면 여기에 표시돼요.'}</p></GiftEmpty>}
    {page.hasMore && last ? <Link href={`/gifts?party=${party}&before=${encodeURIComponent(last.createdAt)}&id=${last.id}`}>이전 선물 보기</Link> : null}
  </div></MypageShell>;
}
