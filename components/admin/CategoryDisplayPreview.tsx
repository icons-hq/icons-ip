'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shop } from '@/components/screens/Shop';
import { categoryDisplayBanner, CategoryDisplayMedia } from '@/components/shop/CategoryDisplayContents';
import type { CategoryDisplayPage } from '@/lib/category-display';
import type { ShopListQuery } from '@/lib/shop-catalog';

/** iframe 안에 그리는 본문 — 고객 화면(`CategoryDisplayShop`)과 같은 틀이다: `Shop`(제목 줄·정렬·그리드) 머리에 전시 구성의 스트립 배너
 *  (`displayBanner`)를 얹고, 영상·추천 밴드(`CategoryDisplayMedia`)를 칩 영역과 제목 줄 사이에 끼운다. 칩·하위 탭(`categoryNav`)은
 *  공개 전시 트리에서 서버가 만드는 값이라 저장 전 구성을 보는 미리보기에는 없다. */
export function CategoryDisplayPreviewBody({ page, onQueryChange, overlayContainer }: { page: CategoryDisplayPage; onQueryChange: (query: ShopListQuery) => void; overlayContainer?: HTMLElement }) {
  /* 컬렉션 배너 슬롯이 없는 화면이라야 전시 구성 배너가 선다(`collectionBannerSlotFor`) — 전시 id 가 질의에 없는 값이 와도 배너가 빠지지 않게 보강한다. */
  const query = page.query.displayCategory ? page.query : { ...page.query, displayCategory: page.category.id };
  return <>
    <Shop view="all" title={page.category.name} query={query} result={page.result} onQueryChange={onQueryChange} displayBanner={categoryDisplayBanner(page)}
      refreshScheduledContent={false} overlayContainer={overlayContainer} paging={{ loading: false, hasMore: false, onLoadMore: () => undefined }}>
      <CategoryDisplayMedia page={page} />
    </Shop>
    {page.result.filteredTotal > 20 ? <p className="wc-container">전체 {page.result.filteredTotal.toLocaleString()}개 중 첫 20개를 미리 봅니다.</p> : null}
  </>;
}

const DOCUMENT = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>카테고리 전시 미리보기</title></head><body style="margin:0"><div id="root" class="wc-root"><div id="category-preview"></div></div></body></html>';
export function CategoryDisplayPreview({ page, mobile, onQueryChange }: { page: CategoryDisplayPage; mobile: boolean; onQueryChange: (query: ShopListQuery) => void }) {
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null), [portal, setPortal] = useState<HTMLElement | null>(null), [width, setWidth] = useState(0);
  const viewport = mobile ? 390 : 1212, scale = width > 0 ? Math.min(1, width / viewport) : 1;
  const mount = useCallback(() => {
    const doc = frame.current?.contentDocument; if (!doc) return;
    if (!doc.head.querySelector('[data-category-style]')) document.head.querySelectorAll('link[rel="stylesheet"],style').forEach(node => {
      const copy = node.cloneNode(true) as HTMLElement; copy.dataset.categoryStyle = ''; doc.head.append(copy);
    });
    setPortal(doc.getElementById('category-preview'));
  }, []);
  useEffect(() => { const element = stage.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); observer.observe(element); return () => observer.disconnect(); }, []);
  /* 관리자 쪽 틀만 유틸리티로 그린다(ADR-0028) — iframe 안은 공개 스토어프런트 그대로다. */
  return <div ref={stage} className="mt-1 w-full overflow-hidden rounded-lg bg-muted" data-category-preview-stage=""><div style={{ width: width > 0 ? viewport * scale : '100%', height: 700 }}>
    {width > 0 ? <iframe className="block border-0" ref={frame} data-preview-ready={Boolean(portal)} onLoad={mount} srcDoc={DOCUMENT} sandbox="allow-same-origin" title={`${mobile ? '모바일' : 'PC'} 카테고리 전시 미리보기`}
      style={{ width: viewport, height: 700 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} /> : <p className="p-4 text-sm text-muted-foreground" role="status">미리보기 준비 중…</p>}
    {portal ? createPortal(<div onClickCapture={event => { if ((event.target as HTMLElement).closest('a')) event.preventDefault(); }}>
      <CategoryDisplayPreviewBody page={page} onQueryChange={onQueryChange} overlayContainer={portal.ownerDocument.body} />
    </div>, portal) : null}
  </div></div>;
}
