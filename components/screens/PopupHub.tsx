import { EmptyState } from '@/components/wc/EmptyState';
import { PromoCard } from '@/components/wc/PromoCard';
import { WcButton } from '@/components/wc/WcButton';
import { POPUP_EMPTY_TEXT, POPUP_UPCOMING_BADGE, type PopupItem } from '@/lib/popups';

/* POP-UP 목록 (Figma 2026-11-12 POP-UP·Event 프레임, 스펙 C §2.6).
 *
 * 맨 위 스트립 배너 없이 제목 "POP-UP" → 3열 프로모션 카드다(EVENT 와 같은 카드 틀). 카드는 오프라인 팝업(예매 도메인)과
 * POP-UP 캠페인을 가리지 않는다 — 어느 쪽이든 제목 아래에 `{온라인|오프라인|온·오프라인} · {장소} · {기간}` 한 줄을 싣고,
 * 곧 열리는 것은 왼쪽 위에 "오픈 예정" 배지를 단다.
 *
 * 열려 있는 POP-UP 이 하나도 없으면 Figma POP-UP 프레임 그대로 빈 상태다(GNB 의 POP-UP 은 항상 보인다 — 스펙 D10).
 * 빈 상태에는 보이는 제목이 없어 h1 은 시각만 숨긴다.
 *
 * 서버 컴포넌트다. 항목 준비(원천 읽기·합치기·정렬·상한)는 `lib/popups.server.ts`가 끝냈다. */

/* 첫 줄(데스크톱 3장)은 첫 화면이다 — 배경 이미지를 우선 내려받는다. */
const PRIORITY_CARDS = 3;

export interface PopupHubProps {
  items: PopupItem[];
}

export function PopupHub({ items }: PopupHubProps) {
  return (
    <main className="wc-root wc-promo-page wc-popup-hub">
      <div className="wc-container wc-container--wide">
        {items.length ? (
          <>
            <h1 className="wc-promo-page__title">POP-UP</h1>
            <ul className="wc-promo-grid">
              {items.map((item, index) => (
                <li key={item.key}>
                  <PromoCard
                    badge={item.phase === 'upcoming' ? POPUP_UPCOMING_BADGE : undefined}
                    href={item.href}
                    imageBg={item.imageBg}
                    meta={item.meta || undefined}
                    priority={index < PRIORITY_CARDS}
                    title={item.title}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h1 className="wc-sr-only">POP-UP</h1>
            <EmptyState
              action={<WcButton href="/">{POPUP_EMPTY_TEXT.action}</WcButton>}
              className="wc-promo-page__empty"
              description={POPUP_EMPTY_TEXT.description}
              title={POPUP_EMPTY_TEXT.title}
              titleAs="h2"
            />
          </>
        )}
      </div>
    </main>
  );
}
