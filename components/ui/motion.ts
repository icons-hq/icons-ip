'use client';

/* 디자인 핸드오프의 마우스 인터랙션(히어로 패럴랙스 · 카드 3D 틸트) 공용 훅.
   상태 재렌더 없이 ref로 style을 직접 갱신하고, prefers-reduced-motion을 존중한다. */
import { useRef, type MouseEvent, type RefObject } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useHeroParallax(strength: { x: number; y: number } = { x: -20, y: -14 }): {
  artRef: RefObject<HTMLDivElement | null>;
  onMouseMove: (e: MouseEvent) => void;
  onMouseLeave: () => void;
} {
  const artRef = useRef<HTMLDivElement>(null);
  return {
    artRef,
    onMouseMove: (e: MouseEvent) => {
      if (!artRef.current || prefersReducedMotion()) return;
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      artRef.current.style.transform = `translate3d(${x * strength.x}px, ${y * strength.y}px, 0) scale(1.08)`;
    },
    onMouseLeave: () => {
      if (artRef.current) artRef.current.style.transform = 'scale(1.04)';
    },
  };
}

export function useTilt(): {
  cardRef: RefObject<HTMLDivElement | null>;
  glareRef: RefObject<HTMLDivElement | null>;
  onMouseMove: (e: MouseEvent) => void;
  onMouseLeave: () => void;
} {
  const cardRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  return {
    cardRef,
    glareRef,
    onMouseMove: (e: MouseEvent) => {
      if (!cardRef.current || prefersReducedMotion()) return;
      const r = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cardRef.current.style.transform = `rotateX(${py * -16}deg) rotateY(${px * 18}deg) scale(1.03)`;
      if (glareRef.current) {
        glareRef.current.style.backgroundPosition = `${(px + 0.5) * 100}% ${(py + 0.5) * 100}%`;
        glareRef.current.style.opacity = '0.8';
      }
    },
    onMouseLeave: () => {
      if (cardRef.current) cardRef.current.style.transform = 'rotateX(0deg) rotateY(0deg) scale(1)';
      if (glareRef.current) {
        glareRef.current.style.backgroundPosition = '20% 20%';
        glareRef.current.style.opacity = '0.55';
      }
    },
  };
}
