'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestRestockAlertAction } from '@/app/shop/actions';
import { WcButton } from '@/components/wc/WcButton';

export interface RestockCtaProps {
  goodId: string;
  initialRequested: boolean;
  /** 어드민 미리보기처럼 실제로 신청하면 안 되는 자리에서 쓴다. */
  disabled?: boolean;
  className?: string;
}

/*
 * 재입고 알림 신청 (#326 S4).
 *
 * 품절 굿즈의 구매 CTA 자리를 대신한다 — 살 수 없는 굿즈에 살아 있는 담기 버튼을
 * 남겨 두면 누른 사람이 재고 에러를 만난다.
 *
 * 신청 뒤에는 되돌리지 않는다. 신청 취소는 알림함 설정의 범위이고, 여기서 토글로
 * 만들면 실수로 한 번 더 눌러 알림을 잃는다.
 */
export function RestockCta({ className, disabled, goodId, initialRequested }: RestockCtaProps) {
  const [requested, setRequested] = useState(initialRequested);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();

  function request() {
    if (requested) return;
    setRequested(true);

    startTransition(async () => {
      const result = await requestRestockAlertAction(goodId);
      if (result.ok) return;

      setRequested(false);
      if (result.error === 'auth_required') {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });
  }

  return (
    <div className={`wc-restock-cta${className ? ` ${className}` : ''}`}>
      <WcButton disabled={disabled || requested || pending} onClick={request} variant="primary">
        <svg aria-hidden height="16" viewBox="0 0 24 24" width="16">
          <path
            d="M12 3a5.5 5.5 0 0 1 5.5 5.5V13l1.5 3H5l1.5-3V8.5A5.5 5.5 0 0 1 12 3Zm0 18a2.5 2.5 0 0 1-2.45-2h4.9A2.5 2.5 0 0 1 12 21Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        {requested ? '재입고 알림 신청됨' : '재입고 알림 받기'}
      </WcButton>
    </div>
  );
}
