'use client';

import { useState, useTransition } from 'react';
import { claimCouponCodeAction } from '@/app/my/coupons/actions';

export function CouponCodeClaim() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return <form className="wc-coupon-claim" onSubmit={event => {
    event.preventDefault();
    startTransition(async () => {
      const saved = await claimCouponCodeAction(code); setResult(saved);
      if (saved.ok) setCode('');
    });
  }}>
    <label htmlFor="my-coupon-code">쿠폰 코드 등록</label>
    <div><input id="my-coupon-code" autoComplete="off" maxLength={24} required value={code} onChange={event => setCode(event.target.value)} disabled={pending} placeholder="쿠폰 코드를 입력해주세요" /><button type="submit" disabled={pending}>{pending ? '등록 중…' : '등록'}</button></div>
    <p>사용 시작 전에도 발급기간 중에는 쿠폰함에 등록할 수 있어요.</p>
    {result ? <p role={result.ok ? 'status' : 'alert'}>{result.message}</p> : null}
  </form>;
}
