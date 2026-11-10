'use client';

import type { ReactNode } from 'react';

/** Review URLs choose the initial detail tab, so keep the existing document-navigation contract. */
export function ProductDetailReviewLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(href, window.location.href);
    if (target.pathname === window.location.pathname && target.search === window.location.search) {
      // A same-document anchor would leave a manually selected detail tab active.
      event.preventDefault();
      window.location.hash = target.hash;
      // A reload restores the old scroll position instead of the anchor; HashLanding lands it and restores the default.
      window.history.scrollRestoration = 'manual';
      window.location.reload();
    }
  }}>{children}</a>;
}
