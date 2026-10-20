import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import { MarketingMessageContent } from '@/components/marketing/MarketingMessageContent';
import type { MyMarketingMessage } from '@/lib/admin/marketing-messages';
export function CustomerMarketingMessage({message,test=false}:{message:MyMarketingMessage;test?:boolean}){
 return <MypageShell active="/notifications"><div className="wc-mypage__headbar"><h1 className="wc-mypage__headbar-title">{test?'운영자 테스트 알림':'마케팅 소식'}</h1><Link className="wc-mypage__headbar-link" href="/notifications">알림함</Link></div><div className="wc-marketing-message__page">{test?<p>저장 당시 내용의 본인 수신 테스트입니다. 쿠폰 발급과 고객 발송 통계에 포함하지 않습니다.</p>:null}<MarketingMessageContent content={message.content} goods={message.goods} coupon={message.coupon} preview={test} /><p className="wc-marketing-message__footnote">{new Date(message.registeredAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} 등록 · <Link href="/settings">마케팅 수신 동의 관리</Link></p></div></MypageShell>;
}
