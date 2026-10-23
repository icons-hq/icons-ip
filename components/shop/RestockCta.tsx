'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestRestockAlertAction, requestVariantRestockAlertAction, type RestockAlertResult } from '@/app/shop/actions';
import { RestockBellGlyph } from './RestockBellGlyph';

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
  /**
   * 안내 줄을 둘 자리가 없는 좁은 표면(모바일 고정 바·데스크톱 레일 박스). 실패 안내를 버튼 글자로 보이고
   * 상태 줄은 보조기기에만 둔다 — 바는 72px 고정이고 레일 박스는 화면 하단에 붙어 있어 줄이 늘면 잘린다.
   */
  compact?: boolean;
  /**
   * 그 사이 판매 상태가 바뀌어 신청이 거절됐을 때(invalid_request) 이 버튼을 둔 표면에 알린다. 화면을 다시 받으면
   * 이 버튼 자리가 담기·구매로 바뀌며 이 버튼(과 상태 줄)이 사라지므로, 이유 안내와 포커스 이전은 그 표면이
   * 맡는다(GoodPurchasePanel·레일 박스·모바일 바). 주면 이 버튼은 그 안내를 따로 띄우지 않는다.
   */
  onStaleState?: (notice: string) => void;
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

export interface RestockNotice {
  tone: 'success' | 'error';
  /** 상태 줄(live region) 문장. */
  text: string;
  /** 좁은 표면에서 버튼 글자로 대신 보일 짧은 안내. 성공은 버튼이 이미 '신청됨'으로 말한다. */
  label?: string;
}

/**
 * 신청 결과의 안내 (DESIGN §9 — 서버가 확인한 결과만 말한다). 로그인 벽은 안내 대신 로그인으로 보낸다.
 * invalid_request 는 그 사이 판매 상태가 바뀐 경우다(재입고·예약판매 전환·내려간 굿즈) — 화면을 다시 받는다.
 */
export function restockResultNotice(result: RestockAlertResult): RestockNotice | null {
  if (result.ok) return { tone: 'success', text: '재입고 알림을 신청했어요.' };
  switch (result.error) {
    case 'auth_required':
      return null;
    case 'invalid_request':
      return { tone: 'error', text: '판매 상태가 바뀌었어요. 지금 상태를 확인해주세요.', label: '판매 상태가 바뀌었어요' };
    case 'account_suspended':
      return { tone: 'error', text: '정지된 계정은 재입고 알림을 신청할 수 없어요.', label: '신청할 수 없는 계정이에요' };
    default:
      return { tone: 'error', text: '재입고 알림을 신청하지 못했어요. 잠시 후 다시 시도해주세요.', label: '신청하지 못했어요 · 다시 시도' };
  }
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
 *
 * 누른 뒤(진행 중·신청됨)에는 disabled 가 아니라 aria-disabled 로 잠근다. 포커스를 가진 버튼을 disabled 로
 * 바꾸면 포커스가 body 로 빠진다 — 구매 시트(모달) 안이면 다이얼로그 밖이다. 결과는 버튼 옆 상태 줄
 * (role=status)이 알린다.
 */
export function RestockCta({ className, compact = false, disabled, goodId, initialRequested, onStaleState, optionName, variantId = null }: RestockCtaProps) {
  const [requestedKeys, setRequestedKeys] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<(RestockNotice & { key: string }) | null>(null);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  const key = restockRequestKey(variantId);
  /* 신청은 단방향이라 서버 사실(prop — refresh 로 갱신)과 낙관 상태의 OR 이 곧 표시다.
     useState(initialRequested) 로 들면 refresh 가 prop 을 바꿔도 이 인스턴스는 못 본다.
     같은 인스턴스가 옵션을 바꿔 가며 쓰이므로 낙관 상태·안내는 옵션 키로 든다. */
  const requested = initialRequested || requestedKeys.includes(key);
  const inactive = !disabled && (requested || pending);
  /* 실패 안내는 그 옵션을 다시 신청할 수 있을 때만 남긴다 — 다른 탭에서 신청해 서버 사실이 '신청됨'이 되면 지운다. */
  const shown = notice && notice.key === key && !(notice.tone === 'error' && requested) ? notice : null;
  const visibleError = shown?.tone === 'error' ? shown : null;

  function request() {
    if (disabled || inactive) return;
    setNotice(null);
    setRequestedKeys((keys) => [...keys, key]);

    startTransition(async () => {
      const result = variantId
        ? await requestVariantRestockAlertAction(goodId, variantId)
        : await requestRestockAlertAction(goodId);
      if (!result.ok) setRequestedKeys((keys) => keys.filter((item) => item !== key));
      const next = restockResultNotice(result);
      const stale = !result.ok && result.error === 'invalid_request';
      if (stale && next && onStaleState) {
        setNotice(null);
        onStaleState(next.text);
      } else {
        setNotice(next ? { ...next, key } : null);
      }

      if (result.ok) {
        /* PDP 는 이 버튼을 세 표면(패널·모바일 바/시트·레일 박스)에 둔다. 서버 렌더를 다시
           받아 나머지 인스턴스의 initialRequested 도 같은 사실이 되게 한다. */
        router.refresh();
        return;
      }
      if (result.error === 'auth_required') {
        router.push(restockLoginPath(pathname, variantId));
        return;
      }
      /* 그 사이 재입고·예약판매 전환·판매 중단이 있었다 — 서버 사실을 다시 받아 지금 할 수 있는 CTA 로 바꾼다
         (재입고된 옵션이면 담기·구매가 돌아온다). 다시 눌러도 같은 거절만 반복되는 버튼으로 남기지 않는다. */
      if (stale) router.refresh();
    });
  }

  return (
    <div className={`wc-restock-cta${className ? ` ${className}` : ''}`}>
      <button
        aria-disabled={inactive ? 'true' : undefined}
        className={`wc-btn primary${inactive ? ' disabled' : ''}`}
        disabled={disabled}
        onClick={request}
        type="button"
      >
        <RestockBellGlyph />
        {variantId && optionName ? <span className="wc-sr-only">{`${optionName} 옵션 `}</span> : null}
        {requested ? '재입고 알림 신청됨' : compact && visibleError?.label ? visibleError.label : '재입고 알림 받기'}
      </button>
      {/* 성공은 버튼 글자가 이미 말하므로 보조기기에만 알린다. 실패는 본문 패널에서 버튼 아래에 보이고(구매 패널
          상태 줄과 같은 서체), 좁은 표면에서는 버튼 글자가 대신 말한다. 비어 있으면 자리를 차지하지 않는다. */}
      <p
        aria-atomic="true"
        aria-live="polite"
        className={visibleError && !compact ? 'wc-buy-panel__status' : 'wc-sr-only'}
        role="status"
      >
        {shown?.text ?? ''}
      </p>
    </div>
  );
}
