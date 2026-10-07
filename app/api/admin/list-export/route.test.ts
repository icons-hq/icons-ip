import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), build: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
vi.mock('@/lib/admin/list-export-data.server', async () => {
  class AdminListExportAuditError extends Error {
    constructor() { super('다운로드 기록을 남기지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.'); }
  }
  return { AdminListExportAuditError, loadAdminListExportSheet: mocks.load, recordAdminListExport: mocks.record };
});
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

import { GET, maxDuration, runtime } from './route';
import { AdminListExportLimitError } from '@/lib/admin/list-export';
import { AdminListExportAuditError } from '@/lib/admin/list-export-data.server';

const sheet = { screen: 'dispatch', rows: [['a'], ['b']], recordCount: 1, filters: { tab: 'ready' } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date('2026-10-07T06:04:00.000Z'), toFake: ['Date'] });
  mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.load.mockResolvedValue(sheet);
  mocks.build.mockResolvedValue(Buffer.from('xlsx-bytes'));
  mocks.record.mockResolvedValue('10000000-0000-4000-8000-00000000a501');
});

afterEach(() => { vi.useRealTimers(); });

function request(query: string) {
  return new Request(`https://example.test/api/admin/list-export?${query}`);
}

describe('목록 엑셀 다운로드 라우트', () => {
  it('화면 경로로 권한을 확인하고, 기록을 남긴 뒤 비공개 xlsx로 응답한다', async () => {
    const response = await GET(request('screen=dispatch&tab=ready&query=%ED%99%8D&page=4'));
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/dispatch');
    expect(mocks.load).toHaveBeenCalledWith('dispatch', { screen: 'dispatch', tab: 'ready', query: '홍', page: '4' }, new Date('2026-10-07T06:04:00.000Z'));
    expect(mocks.record).toHaveBeenCalledWith(sheet);
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="icons-dispatch-20261007-1504.xlsx"; filename*=UTF-8''${encodeURIComponent('icons-발주발송-발송대기-20261007-1504.xlsx')}`,
    );
    expect(response.headers.get('x-icons-export-audit')).toBe('10000000-0000-4000-8000-00000000a501');
    expect(response.headers.get('x-icons-export-rows')).toBe('2');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('xlsx-bytes');
  });

  it('클레임 화면은 유형별 화면 경로로 권한을 확인한다', async () => {
    await GET(request('screen=claims-returns&stage=open'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/claims/returns');
  });

  it('권한 거절은 로더를 실행하지 않는다', async () => {
    mocks.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(GET(request('screen=orders'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('모르는 화면은 권한 확인 뒤 400으로 거절한다', async () => {
    const response = await GET(request('screen=settled'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '내려받을 화면을 확인해주세요.' });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('상한을 넘으면 파일과 기록 없이 조건을 좁히라는 400을 준다', async () => {
    mocks.load.mockRejectedValue(new AdminListExportLimitError(12_000));
    const response = await GET(request('screen=orders'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: '한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 10,000건).' });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('감사 기록에 실패하면 파일을 내보내지 않는다', async () => {
    mocks.record.mockRejectedValue(new AdminListExportAuditError());
    const response = await GET(request('screen=unpaid'));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).error).toContain('다운로드 기록을 남기지 못해');
  });

  it('영문 내부 오류는 한국어 안내로 바꾼다', async () => {
    mocks.load.mockRejectedValue(new Error('Failed to load admin orders: boom'));
    const response = await GET(request('screen=orders'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '목록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.' });
  });
});
