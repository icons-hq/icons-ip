'use client';

/**
 * THROWAWAY PROTOTYPE: 같은 실측 구조를 세 가지 정보 우선순위로 비교하면 어느 방향이 맞는가?
 * production build에는 노출하지 않는다.
 */

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PROTOTYPE_VARIANTS, type PrototypeVariant } from './variants';

const VARIANT_LABEL: Record<PrototypeVariant, string> = {
  A: '원형 충실',
  B: '굿즈 우선',
  C: '에디토리얼',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, select, textarea, [contenteditable="true"]')
    || Boolean(target.closest('[contenteditable="true"]'));
}

export function PrototypeSwitcher({ variant }: { variant: PrototypeVariant }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const moveTo = (next: PrototypeVariant) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const step = (offset: number) => {
    const current = PROTOTYPE_VARIANTS.indexOf(variant);
    const next = (current + offset + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
    moveTo(PROTOTYPE_VARIANTS[next]);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const current = PROTOTYPE_VARIANTS.indexOf(variant);
        const offset = event.key === 'ArrowLeft' ? -1 : 1;
        const next = (current + offset + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
        const params = new URLSearchParams(searchParams.toString());
        params.set('variant', PROTOTYPE_VARIANTS[next]);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, router, searchParams, variant]);

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <aside aria-label="프로토타입 변형 선택" className="lfp-switcher">
      <button aria-label="이전 변형" onClick={() => step(-1)} type="button">←</button>
      <div className="lfp-switcher__variants">
        {PROTOTYPE_VARIANTS.map((item) => (
          <button
            aria-pressed={item === variant}
            className={item === variant ? 'is-active' : undefined}
            key={item}
            onClick={() => moveTo(item)}
            type="button"
          >
            <strong>{item}</strong>
            <span>{VARIANT_LABEL[item]}</span>
          </button>
        ))}
      </div>
      <button aria-label="다음 변형" onClick={() => step(1)} type="button">→</button>
    </aside>
  );
}
