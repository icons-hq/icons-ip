import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ detail: vi.fn(), production: vi.fn(), downloads: vi.fn(), note: vi.fn(), acknowledgement: vi.fn() }));
vi.mock('./order-detail.server', () => ({ getAdminOrderDetail: mocks.detail }));
vi.mock('./pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('./order-downloads.server', () => ({ loadAdminOrderDownloads: mocks.downloads }));
vi.mock('./order-acknowledgement.server', () => ({ loadAdminOrderAcknowledgement: mocks.acknowledgement }));
vi.mock('@/lib/order-production.server', () => ({ loadAdminOrderProduction: mocks.production }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { loadAdminOrderPreview } from './order-preview.server';

const ORDER = '50000000-0000-4000-8000-000000000001';
const staff = { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' as const, operatorAccess: legacyOperatorAccessFixture() };
beforeEach(() => { vi.clearAllMocks(); mocks.detail.mockResolvedValue({ order: { id: ORDER } }); mocks.production.mockResolvedValue(null); mocks.downloads.mockResolvedValue(null); mocks.acknowledgement.mockResolvedValue(null); });

describe('목록 위 주문 상세 팝업 로더 (S36-075)', () => {
  it('전용 상세 라우트와 같은 로더로 읽고 처리 권한을 함께 돌려준다', async () => {
    expect(await loadAdminOrderPreview(staff, ORDER)).toMatchObject({ kind: 'loaded', detail: { order: { id: ORDER } }, canManage: true });
    expect(mocks.detail).toHaveBeenCalledWith(ORDER, true);
    expect(mocks.production).toHaveBeenCalledWith(ORDER); expect(mocks.downloads).toHaveBeenCalledWith(ORDER);
    expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff', action: 'view', surface: 'order.detail',
      path: `/admin/sales/orders/${ORDER}`, subjectKind: 'order', subjectIds: [ORDER], detail: { via: 'popup' } });
  });
  it('주문 상세 화면 권한이 없으면 읽지 않고, 없는 주문·읽기 실패는 값으로 돌려 목록을 막지 않는다', async () => {
    expect(await loadAdminOrderPreview({ ...staff, operatorAccess: configuredOperatorAccessFixture('deputy') }, ORDER)).toEqual({ kind: 'forbidden' });
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.detail.mockResolvedValue(null);
    expect(await loadAdminOrderPreview(staff, ORDER)).toEqual({ kind: 'not_found' });
    expect(mocks.note).not.toHaveBeenCalled();
    mocks.detail.mockRejectedValue(new Error('주문 상세를 불러오지 못했습니다.'));
    expect(await loadAdminOrderPreview(staff, ORDER)).toEqual({ kind: 'error' });
  });
});

describe('목록 위 주문 상세 팝업 — 결제 전 확인 동의', () => {
  it('동의 기록을 함께 읽어 싣고, 읽지 못한 값(undefined)은 싣지 않는다', async () => {
    const recorded = { orderId: ORDER, acknowledgedAt: '2026-11-19T01:02:03+00:00', noticeVersion: '2026-11-19', restrictedGoods: [] };
    mocks.acknowledgement.mockResolvedValueOnce(recorded);
    expect(await loadAdminOrderPreview(staff, ORDER)).toMatchObject({ kind: 'loaded', acknowledgement: recorded });
    expect(mocks.acknowledgement).toHaveBeenCalledWith(ORDER);
    mocks.acknowledgement.mockResolvedValueOnce(undefined);
    expect(await loadAdminOrderPreview(staff, ORDER)).not.toHaveProperty('acknowledgement');
    mocks.acknowledgement.mockResolvedValueOnce(null);
    expect(await loadAdminOrderPreview(staff, ORDER)).toMatchObject({ acknowledgement: null });
  });
});
