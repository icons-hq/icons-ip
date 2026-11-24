'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { formatGoodBadgeText, GOOD_BADGES, parseGoodBadgeText, type GoodBadge } from '@/lib/goods-taxonomy';

/**
 * 상품 표시문구 여러 개 고르기(2026-11-24 MD 요청, migration 20261125140000).
 *
 * 고른 순서가 상품 카드 칩·상세 배지 순서다 — 체크하면 맨 뒤에 붙고, 끄면 빠진다. 순서를 바꾸려면 끄고 다시 고른다.
 * 제출 값은 숨은 칸 'badge' 하나에 고른 순서대로 쉼표로 이은 글자(`NEW, EXCLUSIVE`)다. 브라우저 자동복구·서버 임시저장·
 * 상품 엑셀 '상품 표시문구' 열과 같은 모양이라 옛 한 값(`NEW`)도 그대로 읽힌다. 체크 상자에는 name이 없다(순서는 화면 상태가 갖는다).
 *
 * 숨은 칸 값은 React가 바꾸므로 폼의 input 이벤트가 나지 않는다. 바꾼 뒤 숨은 칸에서 input 이벤트를 내서 편집기 요약·미리보기·
 * 떠나기 경고·자동복구가 새 값을 읽게 한다.
 */
export function GoodBadgesField({ defaultValue, error }: { defaultValue: string; error?: string }) {
  const [selected, setSelected] = useState<GoodBadge[]>(() => parseGoodBadgeText(defaultValue).badges);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const changed = useRef(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  useEffect(() => {
    if (!changed.current) return;
    hiddenRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [selected]);
  function toggle(badge: GoodBadge, checked: boolean) {
    changed.current = true;
    setSelected((current) => {
      const rest = current.filter((value) => value !== badge);
      return checked ? [...rest, badge] : rest;
    });
  }
  return (
    <fieldset aria-describedby={error ? `${hintId} ${errorId}` : hintId} aria-invalid={error ? true : undefined}
      className="group/field m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-admin-kit="field" data-good-badges=""
      data-invalid={error ? 'true' : undefined}>
      <legend className="mb-2 text-sm leading-snug font-medium text-foreground">상품 표시문구</legend>
      <input name="badge" ref={hiddenRef} type="hidden" value={formatGoodBadgeText(selected)} />
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {GOOD_BADGES.map((badge) => {
          const order = selected.indexOf(badge);
          return (
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm" key={badge}>
              <input checked={order >= 0} onChange={(event) => toggle(badge, event.target.checked)} type="checkbox" />
              <span>{badge}</span>
              {order >= 0 ? <span className="text-xs text-muted-foreground" data-good-badge-order="">{order + 1}번째</span> : null}
            </label>
          );
        })}
      </div>
      <p className="text-sm leading-normal text-muted-foreground" id={hintId}>
        {selected.length
          ? `상품 카드와 상세에 ${selected.join(' → ')} 순서로 보입니다.`
          : '고르지 않으면 상품 카드와 상세에 표시문구가 없습니다.'}
        {' '}여러 개를 고를 수 있고 고른 순서대로 보입니다. 순서를 바꾸려면 체크를 끄고 다시 고릅니다.
      </p>
      {error ? <p className="text-sm text-destructive" id={errorId} role="alert">{error}</p> : null}
    </fieldset>
  );
}
