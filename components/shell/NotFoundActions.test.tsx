import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundActions, previousPageTarget } from './NotFoundActions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

describe('404 2CTA (CH-14)', () => {
  /* 새 탭·주소 직접 입력으로 온 404는 이 탭의 기록이 1개라 뒤로 가기가 아무 일도 하지 않는다 — 홈으로 보낸다. */
  it('돌아갈 기록이 없으면 이전 페이지 대신 홈으로 보낸다', () => {
    expect(previousPageTarget(0)).toBe('home');
    expect(previousPageTarget(1)).toBe('home');
    expect(previousPageTarget(2)).toBe('back');
    expect(previousPageTarget(12)).toBe('back');
  });

  it('[이전 페이지] 잉크 버튼과 [메인으로] 아웃라인 링크를 한 그룹으로 세운다', () => {
    const html = renderToStaticMarkup(<NotFoundActions />);

    expect(html).toMatch(/^<div class="wc-btn-group wc-not-found__actions">/);
    expect(html).toContain('<button class="wc-btn primary" type="button">이전 페이지</button>');
    expect(html).toContain('<a class="wc-btn" href="/">메인으로</a>');
    expect(html.indexOf('이전 페이지')).toBeLessThan(html.indexOf('메인으로'));
  });
});
