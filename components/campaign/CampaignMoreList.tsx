'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ViewMore } from '@/components/wc/ViewMore';
import {
  CAMPAIGN_HUB_PAGE_SIZE,
  campaignMoreLabel,
  nextCampaignVisibleCount,
} from '@/lib/campaigns';

/* EVENT·DROP 탭의 [더보기 (n/총)] (11 §6 B21).
 *
 * 카드는 서버가 이미 그려서 넘긴다(<li> 배열) — 이 컴포넌트는 몇 장까지 보일지만 쥔다.
 * 레퍼런스처럼 페이지 주소는 바꾸지 않고 같은 목록 뒤에 10장씩 이어 붙인다.
 *
 * 더보기를 누르면 새로 붙은 첫 카드로 포커스를 옮긴다. 버튼에 남겨 두면 스크린리더
 * 사용자는 위쪽에 카드가 늘어난 줄 모르고, 마지막 묶음에서는 버튼 자체가 사라져 포커스가
 * 문서 맨 앞으로 튄다. */

export interface CampaignMoreListProps {
  items: ReactNode[];
  className?: string;
  pageSize?: number;
}

export function CampaignMoreList({ className, items, pageSize = CAMPAIGN_HUB_PAGE_SIZE }: CampaignMoreListProps) {
  const total = items.length;
  const [visible, setVisible] = useState(() => Math.min(pageSize, total));
  const listRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const shown = Math.min(visible, total);

  useEffect(() => {
    const index = focusFrom.current;
    if (index === null) return;
    focusFrom.current = null;
    const target = listRef.current?.children[index]?.querySelector<HTMLElement>('a[href], button');
    target?.focus();
  }, [shown]);

  const showMore = () => {
    focusFrom.current = shown;
    setVisible(nextCampaignVisibleCount(shown, total, pageSize));
  };

  return (
    <>
      <ul className={className} ref={listRef}>{items.slice(0, shown)}</ul>
      {shown < total ? (
        <div className="wc-campaign-more">
          <ViewMore label={campaignMoreLabel(shown, total)} onClick={showMore} />
        </div>
      ) : null}
    </>
  );
}
