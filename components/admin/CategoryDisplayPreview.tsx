'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shop } from '@/components/screens/Shop';
import { CategoryDisplayContents } from '@/components/shop/CategoryDisplayContents';
import type { CategoryDisplayPage } from '@/lib/category-display';
import type { ShopListQuery } from '@/lib/shop-catalog';

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
  return <div ref={stage} className="admin-category-display__preview-stage"><div style={{ width: width > 0 ? viewport * scale : '100%', height: 700 }}>
    {width > 0 ? <iframe ref={frame} data-preview-ready={Boolean(portal)} onLoad={mount} srcDoc={DOCUMENT} sandbox="allow-same-origin" title={`${mobile ? '모바일' : 'PC'} 카테고리 전시 미리보기`}
      style={{ width: viewport, height: 700 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }} /> : <p role="status">미리보기 준비 중…</p>}
    {portal ? createPortal(<div onClickCapture={event => { if ((event.target as HTMLElement).closest('a')) event.preventDefault(); }}>
      <CategoryDisplayContents page={page} /><Shop view="all" title={page.category.name} query={page.query} result={page.result} onQueryChange={onQueryChange}
        refreshScheduledContent={false} overlayContainer={portal.ownerDocument.body} paging={{ loading: false, hasMore: false, onLoadMore: () => undefined }} />
      {page.result.filteredTotal > 20 ? <p className="wc-container">전체 {page.result.filteredTotal.toLocaleString()}개 중 첫 20개를 미리 봅니다.</p> : null}
    </div>, portal) : null}
  </div></div>;
}
