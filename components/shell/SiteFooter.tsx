'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hrefFor } from '@/lib/routes';

/* 디자인 핸드오프의 미니 푸터 + 고아 라우트 방지용 보조 링크 줄 */
const AUX_LINKS: [label: string, route: string | null][] = [
  ['바인더', 'binder'],
  ['카드 교환', 'exchange'],
  ['마켓', 'market'],
  ['이용약관', null],
  ['개인정보처리방침', null],
];

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    <footer style={{ borderTop: '1px solid var(--line)', padding: '26px 0', position: 'relative', zIndex: 2 }}>
      <div className="wrap between mobile-footer-bottom" style={{ flexWrap: 'wrap', gap: 14 }}>
        <span className="brand" style={{ fontSize: 17, letterSpacing: '-0.03em', gap: 7 }}>
          <span className="dot" style={{ width: 7, height: 7, boxShadow: 'none' }} />ICONS
        </span>
        <span className="money-caption">공식 라이선스 · 확률 공시 · 토스페이먼츠 안전 결제</span>
      </div>
      <div className="wrap" style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
        {AUX_LINKS.map(([label, route]) =>
          route ? (
            <Link key={label} className="mono faint" style={{ fontSize: 11 }} href={hrefFor(route)}>
              {label}
            </Link>
          ) : (
            <span key={label} className="mono faint" style={{ fontSize: 11 }}>{label}</span>
          ),
        )}
      </div>
    </footer>
  );
}
