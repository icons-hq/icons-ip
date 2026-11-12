import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ detail: vi.fn(), production: vi.fn(), downloads: vi.fn() }));
vi.mock('./order-detail.server', () => ({ getAdminOrderDetail: mocks.detail }));
vi.mock('./order-downloads.server', () => ({ loadAdminOrderDownloads: mocks.downloads }));
vi.mock('@/lib/order-production.server', () => ({ loadAdminOrderProduction: mocks.production }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { loadAdminOrderPreview } from './order-preview.server';

const ORDER = '50000000-0000-4000-8000-000000000001';
const staff = { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' as const, operatorAccess: legacyOperatorAccessFixture() };
beforeEach(() => { vi.clearAllMocks(); mocks.detail.mockResolvedValue({ order: { id: ORDER } }); mocks.production.mockResolvedValue(null); mocks.downloads.mockResolvedValue(null); });

describe('목록 위 주문 상세 팝업 로더 (S36-075)', () => {
  it('전용 상세 라우트와 같은 로더로 읽고 처리 권한을 함께 돌려준다', async () => {
    expect(await loadAdminOrderPreview(staff, ORDER)).toMatchObject({ kind: 'loaded', detail: { order: { id: ORDER } }, canManage: true });
    expect(mocks.detail).toHaveBeenCalledWith(ORDER, true);
    expect(mocks.production).toHaveBeenCalledWith(ORDER); expect(mocks.downloads).toHaveBeenCalledWith(ORDER);
  });
  it('주문 상세 화면 권한이 없으면 읽지 않고, 없는 주문·읽기 실패는 값으로 돌려 목록을 막지 않는다', async () => {
    expect(await loadAdminOrderPreview({ ...staff, operatorAccess: configuredOperatorAccessFixture('deputy') }, ORDER)).toEqual({ kind: 'forbidden' });
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.detail.mockResolvedValue(null);
    expect(await loadAdminOrderPreview(staff, ORDER)).toEqual({ kind: 'not_found' });
    mocks.detail.mockRejectedValue(new Error('주문 상세를 불러오지 못했습니다.'));
    expect(await loadAdminOrderPreview(staff, ORDER)).toEqual({ kind: 'error' });
  });
});
