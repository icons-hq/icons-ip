'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { claimCouponCodeAction } from '@/app/my/coupons/actions';
import { marketingCouponBenefit, type MarketingCoupon } from '@/lib/admin/marketing-coupons';
export function MarketingCouponAttachment({ code, coupon, preview }: { code: string; coupon?: MarketingCoupon | null; preview: boolean }) {
  const [pending, start] = useTransition(), [message, setMessage] = useState(''), [claimed, setClaimed] = useState(false);
  return <section className="wc-marketing-message__coupon" aria-label="첨부 쿠폰">
    <span>첨부 쿠폰</span><h3>{coupon?.name ?? code}</h3><strong>{coupon ? marketingCouponBenefit(coupon) : '현재 쿠폰 정보를 확인할 수 없습니다.'}</strong>
    {coupon ? <p>{coupon.minSubtotal ? `${coupon.minSubtotal.toLocaleString('ko-KR')}원 이상 상품 구매 시` : '최소 상품 구매금액 제한 없음'}{coupon.validDays !== null ? coupon.validDays === 0 ? ' · 발급 당일 마감' : ` · 발급일에서 ${coupon.validDays}일 뒤 마감` : ''}</p> : null}
    {coupon?.benefitKind === 'shipping' ? <p>선결제 운송비에 사용하며 설치비·착불 운송비는 제외됩니다.</p> : null}
    <p>사용 종료일이 더 빠르면 해당 기한을 적용해요. 발급 대상·기간·한도와 쿠폰함의 최종 사용기한을 확인해주세요.</p>
    <button type="button" disabled={preview || pending || !coupon || !coupon.available || claimed} onClick={() => start(async () => { try { const result = await claimCouponCodeAction(code); setMessage(result.message); setClaimed(result.ok); } catch { setMessage('등록 결과를 확인하지 못했어요. 내 쿠폰함을 확인해주세요.'); } })}>{preview ? '쿠폰 받기 (미리보기)' : pending ? '등록 중…' : claimed ? '쿠폰함 등록 완료' : coupon?.available ? '쿠폰 받기' : '현재 발급 불가'}</button>
    {!preview ? <Link href="/my/coupons">내 쿠폰함</Link> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}
