import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), adult: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsVisibility: mocks.adult }));
vi.mock('@/app/admin/adult-goods-visibility-actions', () => ({ setAdultGoodsVisibilityAction: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/collectible-features.server', () => ({ loadAdminCollectibleFeatures: mocks.load }));
vi.mock('@/app/admin/collectible-features-actions', () => ({ saveCollectibleFeaturesAction: mocks.save }));
import Page from './page';

const state = { revision: 3, binder: false, market: true, exchange: false, updatedAt: '2026-11-18T01:45:26Z', updatedBy: '운영 담당' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'admin' } });
  mocks.load.mockResolvedValue(state);
  mocks.adult.mockResolvedValue({ enabled: true, revision: 1 });
});

it('관리자 전용 접근을 확인한 뒤에만 설정을 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.adult).not.toHaveBeenCalled();
  mocks.guard.mockResolvedValue({ user: { id: 'admin' } });
  await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/features', { adminOnly: true });
});

it.each([true, false])('성인 상품의 현재 상태와 전환 버튼을 보여준다 (%s)', async (enabled) => {
  mocks.adult.mockResolvedValue({ enabled, revision: 4 });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('성인(19금) 상품 공개 설정');
  expect(html).toContain(`value="${enabled ? 'visible' : 'hidden'}" aria-pressed="true"`);
  expect(html).toContain(`value="${enabled ? 'hidden' : 'visible'}" aria-pressed="false"`);
});

it('성인 상품 상태를 읽지 못하면 그 설정의 변경 버튼을 감춘다', async () => {
  mocks.adult.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('성인 상품 공개 설정을 불러오지 못했습니다');
  expect(html).not.toContain('name="visibility"');
  expect(html).toContain('카드 바인더');
});

it('세 기능의 공개 여부를 kit 스위치와 상태 배지로 보이고 마지막 변경자를 밝힌다', async () => {
  const html = renderToStaticMarkup(await Page());

  expect(html).toContain('기능 공개 관리');
  expect(html).toContain('운영 담당');
  for (const label of ['카드 바인더', '굿즈 마켓', '카드 트레이드']) expect(html).toContain(label);
  expect(html.match(/role="switch"/g)).toHaveLength(3);
  expect(html.match(/data-slot="switch"/g)).toHaveLength(3);
  expect(html.match(/>공개 중</g)).toHaveLength(1);
  expect(html.match(/>숨김</g)).toHaveLength(2);
  /* kit Button 은 기본 type=button 이라 제출 버튼은 type=submit 을 명시한다(AGENTS.md). 바꾸기 전에는 눌리지 않는다. */
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>설정 저장<\/button>|<button[^>]*disabled=""[^>]*type="submit"[^>]*>설정 저장<\/button>/);
});

it('설정을 읽지 못하면 저장 폼 없이 고객 화면이 숨김으로 동작한다고 안내한다', async () => {
  mocks.load.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());

  expect(html).toContain('현재 설정을 불러오지 못했습니다');
  expect(html).toContain('세 기능을 모두 숨깁니다');
  expect(html).not.toContain('role="switch"');
});
