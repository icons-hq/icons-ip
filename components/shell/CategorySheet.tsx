'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Slider } from '@/components/wc/Slider';
import { campaignDetailHref, hrefFor, type NavItem } from '@/lib/routes';
import {
  categoryMenuTiles,
  chunkMenuItems,
  menuMonogram,
  type StorefrontCategoryNode,
  type StorefrontMenuCampaign,
  type StorefrontMenuIp,
} from '@/lib/storefront-mega-menu';
import { CategorySheetTabs } from './CategorySheetTabs';
import { useOverlayA11y } from './useOverlayA11y';

/* 바로가기 아이콘은 라우트 데이터가 아니라 표면의 표현이라 여기서 고정한다(BottomTabBar 와 같은 규율).
   ICONS 아이콘 세트에서 목적지로 고른다 — 레퍼런스 일러스트를 쓰지 않는다(ADR-0011). */
const SHORTCUT_ICONS: Record<string, string> = {
  shop: 'shop',
  new: 'spark',
  best: 'star',
  events: 'event',
  stories: 'image',
};

interface SheetTile {
  id: string;
  name: string;
  href: string;
  /* 'icon' = 전시분류 아이콘(정사각 라인아트 — 칸 안에 맞춤), 'art' = IP 키아트(CSS background — 칸을 채움). */
  image: { kind: 'icon'; url: string } | { kind: 'art'; background: string } | null;
}

/* 이미지가 없으면 칸 안에 이름 첫 글자를 둔다 — 카테고리 아이콘(LG-7)이 오기 전에도 그리드가 깨지지 않는다. */
function TileImage({ tile }: { tile: SheetTile }) {
  if (tile.image?.kind === 'icon') {
    return <span aria-hidden className="wc-catsheet__tile-image wc-catsheet__tile-image--icon" style={{ backgroundImage: `url("${tile.image.url}")` }} />;
  }
  if (tile.image?.kind === 'art') {
    return <span aria-hidden className="wc-catsheet__tile-image wc-catsheet__tile-image--art" style={{ background: tile.image.background }} />;
  }
  return <span aria-hidden className="wc-catsheet__tile-image wc-catsheet__tile-image--text">{menuMonogram(tile.name)}</span>;
}

function TileGrid({ onNavigate, tiles }: { onNavigate: () => void; tiles: SheetTile[] }) {
  return (
    <ul className="wc-catsheet__grid">
      {tiles.map((tile) => (
        <li key={tile.id}>
          <Link className="wc-catsheet__tile" href={tile.href} onClick={onNavigate}>
            <TileImage tile={tile} />
            <span className="wc-catsheet__tile-label">{tile.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SheetSection({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className={`wc-sheet__section wc-catsheet__section${title ? '' : ' wc-catsheet__section--untitled'}`}>
      {title ? <h2 className="wc-sheet__title">{title}</h2> : null}
      {children}
    </section>
  );
}

/* MC-05 — 모바일 '카테고리' 탭 전용 시트(메뉴 시트와 분리). 레퍼런스 카테고리 바텀시트의 세 단:
   ① 아이콘 바로가기(가로 스크롤) → ② 기획전 카드 2×2 슬라이드 + 점 → ③ [카테고리 | 온라인 팝업] 탭 + 아이콘 그리드.
   전체 메뉴 시트와 같은 75% 바텀시트·딤·닫기를 쓰고, 접근성(배경 inert·포커스 트랩·Escape·포커스 복귀·스크롤 잠금)은
   useOverlayA11y 가 맡는다. 호출부(Nav)가 body 직계 포털로 열린 동안에만 마운트한다. */
export function CategorySheet({
  campaigns,
  categoryLabel = '카테고리',
  featuredIps,
  nodes,
  onClose,
  onlinePopupLabel = '온라인 팝업',
  shortcuts,
}: {
  campaigns: StorefrontMenuCampaign[];
  /** 시트를 연 GNB 항목(카테고리)의 운영 이름 — 대화상자 이름과 첫 탭 이름이다. */
  categoryLabel?: string;
  featuredIps: StorefrontMenuIp[];
  nodes: StorefrontCategoryNode[];
  onClose: () => void;
  /** 온라인 팝업 GNB 항목의 운영 이름 — 둘째 탭 이름이다. */
  onlinePopupLabel?: string;
  shortcuts: NavItem[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* 콘텐츠가 닫기 버튼 줄 아래로 들어간 동안만 머리줄에 지면색을 깐다(QA l5-qa-5, wc-chrome.css .wc-catsheet::before). */
  const [scrolled, setScrolled] = useState(false);
  useOverlayA11y({ open: true, onClose, panelRef });

  const categoryTiles: SheetTile[] = categoryMenuTiles(nodes).map((tile) => ({
    id: tile.id, name: tile.name, href: tile.href, image: tile.imageUrl ? { kind: 'icon', url: tile.imageUrl } : null,
  }));
  const ipTiles: SheetTile[] = featuredIps.map((ip) => ({
    id: ip.id, name: ip.name, href: ip.href, image: ip.imageBg ? { kind: 'art', background: ip.imageBg } : null,
  }));
  const categoryGrid = <TileGrid onNavigate={onClose} tiles={categoryTiles} />;

  return (
    <>
      <div aria-hidden className="wc-sheet-dim wc-catsheet-dim" onClick={onClose} />
      <div ref={panelRef} aria-label={categoryLabel} aria-modal="true" className="wc-sheet wc-catsheet" data-scrolled={scrolled ? 'true' : undefined} role="dialog">
        <button aria-label={`${categoryLabel} 닫기`} className="wc-icon-btn wc-sheet__close" onClick={onClose} type="button">
          <Icon name="close" size={24} />
        </button>
        <div className="wc-sheet__inner" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
          {shortcuts.length > 0 ? (
            <SheetSection title="바로가기">
              <ul className="wc-catsheet__shortcuts">
                {shortcuts.map((item) => (
                  <li key={item.id}>
                    <Link className="wc-catsheet__shortcut" href={hrefFor(item.id)} onClick={onClose}>
                      <span aria-hidden className="wc-catsheet__icon"><Icon name={SHORTCUT_ICONS[item.id] ?? 'grid'} size={26} /></span>
                      <span className="wc-catsheet__label">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetSection>
          ) : null}

          {campaigns.length > 0 ? (
            <SheetSection title="기획전">
              <Slider className="wc-catsheet__collections" indicator="dots" label="기획전">
                {chunkMenuItems(campaigns).map((page) => (
                  <ul key={page[0].id} className="wc-catsheet__collection-page">
                    {page.map((campaign) => (
                      <li key={campaign.id}>
                        <Link className="wc-catsheet__collection" href={campaignDetailHref(campaign.id)} onClick={onClose}>
                          <span
                            aria-hidden
                            className="wc-catsheet__collection-image"
                            style={campaign.imageUrl ? { backgroundImage: `url("${campaign.imageUrl}")` } : undefined}
                          />
                          <span className="wc-catsheet__collection-title">{campaign.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ))}
              </Slider>
            </SheetSection>
          ) : null}

          {ipTiles.length > 0 ? (
            <SheetSection>
              <CategorySheetTabs
                tabs={[
                  { id: 'categories', label: categoryLabel, content: categoryGrid },
                  { id: 'ips', label: onlinePopupLabel, content: <TileGrid onNavigate={onClose} tiles={ipTiles} /> },
                ]}
              />
            </SheetSection>
          ) : (
            <SheetSection title={categoryLabel}>{categoryGrid}</SheetSection>
          )}
        </div>
      </div>
    </>
  );
}
