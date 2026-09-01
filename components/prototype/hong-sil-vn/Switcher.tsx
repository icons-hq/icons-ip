'use client';

/* PROTOTYPE 변형 스위처 — 버릴 코드다.
 * ?variant=A|B|C 를 바꾸고, ← → 로도 순환한다(입력 요소 포커스 중엔 가로채지 않는다).
 * 평가 대상 디자인과 섞이지 않도록 일부러 고대비 알약 모양으로 띄운다. */

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export interface VariantEntry {
  key: string;
  name: string;
}

export function Switcher({
  variants,
  current,
  onChange,
}: {
  variants: VariantEntry[];
  current: string;
  onChange: (key: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const cycle = useCallback(
    (delta: number) => {
      const next = variants[(index + delta + variants.length) % variants.length];
      onChange(next.key);
      router.replace(`${pathname}?variant=${next.key}`, { scroll: false });
    },
    [index, onChange, pathname, router, variants],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      event.preventDefault();
      cycle(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycle]);

  const arrow: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    fontSize: 15,
    lineHeight: 1,
    cursor: 'pointer',
    color: '#F4F1FF',
    background: 'rgba(255,255,255,.1)',
    border: '1px solid rgba(255,255,255,.22)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(14px + env(safe-area-inset-bottom))',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 9px',
        borderRadius: 999,
        background: 'rgba(8,6,15,.92)',
        border: '1px solid rgba(255,255,255,.26)',
        boxShadow: '0 20px 50px -18px rgba(0,0,0,.9)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <button type="button" aria-label="이전 변형" style={arrow} onClick={() => cycle(-1)}>
        ←
      </button>
      <span style={{ display: 'grid', minWidth: 172, textAlign: 'center' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '.2em', color: '#FFB23D' }}>
          PROTOTYPE {index + 1}/{variants.length}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#F4F1FF', letterSpacing: '-.01em' }}>
          {current} — {variants[index]?.name}
        </span>
      </span>
      <button type="button" aria-label="다음 변형" style={arrow} onClick={() => cycle(1)}>
        →
      </button>
    </div>
  );
}
