'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestRestockAlertAction, requestVariantRestockAlertAction } from '@/app/shop/actions';
import { WcButton } from '@/components/wc/WcButton';

export interface RestockCtaProps {
  goodId: string;
  /**
   * 고른 품절 옵션(PD-11). 있으면 그 옵션의 재입고 알림이고, 없으면 굿즈 단위 신청이다 —
   * 모든 옵션이 품절일 때 옵션 중 하나라도 다시 판매되면 알린다.
   */
  variantId?: string | null;
  /** 옵션 이름. 보조기기가 어느 옵션의 알림인지 버튼 이름으로 함께 읽는다. */
  optionName?: string | null;
  initialRequested: boolean;
  /** 어드민 미리보기처럼 실제로 신청하면 안 되는 자리에서 쓴다. */
  disabled?: boolean;
  className?: string;
}

/** 신청 직후 서버 사실이 오기 전까지의 낙관 표시 키. 옵션마다 따로다 — 옵션을 바꾸면 그 옵션의 상태로 보인다. */
export function restockRequestKey(variantId: string | null | undefined): string {
  return variantId ? `variant:${variantId}` : 'good';
}

/** 비로그인 신청의 로그인 복귀 주소. 옵션 신청은 그 옵션을 고른 상세로 돌아온다(?variant=, PD-14). */
export function restockLoginPath(pathname: string, variantId: string | null | undefined): string {
  const next = variantId ? `${pathname}?variant=${encodeURIComponent(variantId)}` : pathname;
  return `/login?next=${encodeURIComponent(next)}`;
}

/*
 * 재입고 알림 신청 (#326 S4 · 옵션 단위 PD-11).
 *
 * 품절 굿즈의 구매 CTA 자리를 대신한다 — 살 수 없는 굿즈에 살아 있는 담기 버튼을
 * 남겨 두면 누른 사람이 재고 에러를 만난다. 다른 옵션은 판매 중인데 고른 옵션만 품절이면
 * 그 옵션의 알림이다(LD-5).
 *
 * 신청 뒤에는 되돌리지 않는다. 신청 취소는 알림함 설정의 범위이고, 여기서 토글로
 * 만들면 실수로 한 번 더 눌러 알림을 잃는다.
 */
export function RestockCta({ className, disabled, goodId, initialRequested, optionName, variantId = null }: RestockCtaProps) {
  const [requestedKeys, setRequestedKeys] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  const key = restockRequestKey(variantId);
  /* 신청은 단방향이라 서버 사실(prop — refresh 로 갱신)과 낙관 상태의 OR 이 곧 표시다.
     useState(initialRequested) 로 들면 refresh 가 prop 을 바꿔도 이 인스턴스는 못 본다.
     같은 인스턴스가 옵션을 바꿔 가며 쓰이므로 낙관 상태는 옵션 키로 든다. */
  const requested = initialRequested || requestedKeys.includes(key);

  function request() {
    if (requested) return;
    setRequestedKeys((keys) => [...keys, key]);

    startTransition(async () => {
      const result = variantId
        ? await requestVariantRestockAlertAction(goodId, variantId)
        : await requestRestockAlertAction(goodId);
      if (result.ok) {
        /* PDP 는 이 버튼을 세 표면(패널·모바일 바/시트·레일 박스)에 둔다. 서버 렌더를 다시
           받아 나머지 인스턴스의 initialRequested 도 같은 사실이 되게 한다. */
        router.refresh();
        return;
      }

      setRequestedKeys((keys) => keys.filter((item) => item !== key));
      if (result.error === 'auth_required') {
        router.push(restockLoginPath(pathname, variantId));
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
        {variantId && optionName ? <span className="wc-sr-only">{`${optionName} 옵션 `}</span> : null}
        {requested ? '재입고 알림 신청됨' : '재입고 알림 받기'}
      </WcButton>
    </div>
  );
}
