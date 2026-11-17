import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PopupItem } from '@/lib/popups';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  items: [] as PopupItem[],
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/PopupHub', () => ({ PopupHub: mocks.screen }));
vi.mock('@/lib/popups.server', () => ({ loadPopupItems: async () => mocks.items }));

const item: PopupItem = {
  key: 'campaign:little-riize',
  source: 'campaign',
  id: 'little-riize',
  title: '리틀 라이즈 팝업',
  href: '/popups/little-riize',
  imageBg: null,
  phase: 'ongoing',
  startsAtMs: 0,
  meta: '오프라인 · 서울 마포구',
};

beforeEach(() => {
  mocks.screen.mockClear();
  mocks.items = [item];
});

describe('/popups POP-UP 목록', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 로더가 낸 항목을 그대로 넘긴다. */
  it('로더가 낸 항목을 화면에 그대로 넘긴다', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.screen.mock.calls[0]?.[0]?.items).toEqual([item]);
  });

  /* 열려 있는 POP-UP 이 없으면 로더가 빈 배열을 낸다 — 화면이 Figma 빈 상태를 그린다. */
  it('빈 목록도 그대로 넘긴다', async () => {
    mocks.items = [];

    renderToStaticMarkup(await Page());

    expect(mocks.screen.mock.calls[0]?.[0]?.items).toEqual([]);
  });

  it('페이지 제목을 지금 패턴(— ICONS)으로 낸다', () => {
    expect(metadata.title).toBe('POP-UP — ICONS');
  });
});
