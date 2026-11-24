import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), adult: vi.fn() }));
vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsVisibility: mocks.adult }));
vi.mock('@/app/admin/adult-goods-visibility-actions', () => ({ setAdultGoodsVisibilityAction: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
import Page from './page';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'admin' } });
  mocks.adult.mockResolvedValue({ enabled: true, revision: 1 });
});

it('관리자 전용 접근을 확인한 뒤에만 설정을 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.adult).not.toHaveBeenCalled();
  mocks.guard.mockResolvedValue({ user: { id: 'admin' } });
  await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/features', { adminOnly: true });
});

it.each([true, false])('성인 상품의 현재 상태와 전환 버튼을 보여준다 (%s)', async (enabled) => {
  mocks.adult.mockResolvedValue({ enabled, revision: 4 });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('기능 공개 관리');
  expect(html).toContain('성인(19금) 상품 공개 설정');
  expect(html).toContain(`value="${enabled ? 'visible' : 'hidden'}" aria-pressed="true"`);
  expect(html).toContain(`value="${enabled ? 'hidden' : 'visible'}" aria-pressed="false"`);
});

it('성인 상품 상태를 읽지 못하면 그 설정의 변경 버튼을 감춘다', async () => {
  mocks.adult.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('성인 상품 공개 설정을 불러오지 못했습니다');
  expect(html).not.toContain('name="visibility"');
});

/* 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치는 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052). */
it('지운 수집·거래 기능의 공개 스위치는 그리지 않는다', async () => {
  const html = renderToStaticMarkup(await Page());
  for (const label of ['카드 바인더', '굿즈 마켓', '카드 트레이드']) expect(html).not.toContain(label);
  expect(html).not.toContain('role="switch"');
});
