import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), build: vi.fn(), record: vi.fn(), encrypt: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
vi.mock('@/lib/admin/list-export-data.server', async () => {
  class AdminListExportAuditError extends Error {
    constructor() { super('다운로드 기록을 남기지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.'); }
  }
  class AdminListExportChangedError extends Error {
    constructor() { super('목록이 바뀌는 중이라 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.'); }
  }
  return { AdminListExportAuditError, AdminListExportChangedError, loadAdminListExportSheet: mocks.load, recordAdminListExport: mocks.record };
});
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('@/lib/admin/encrypted-export-audit.server', () => ({ recordEncryptedListExport: mocks.record }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

import { GET, POST, maxDuration, runtime } from './route';
import { AdminListExportLimitError, adminListExportHref, type AdminListExportScreenId } from '@/lib/admin/list-export';
import { AdminListExportAuditError, AdminListExportChangedError } from '@/lib/admin/list-export-data.server';

const sheet = { screen: 'dispatch', rows: [['a'], ['b']], recordCount: 1, filters: { tab: 'ready' } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date('2026-10-07T06:04:00.000Z'), toFake: ['Date'] });
  mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.load.mockResolvedValue(sheet);
  mocks.build.mockResolvedValue(Buffer.from('xlsx-bytes'));
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-xlsx'), sha256: 'a'.repeat(64) });
  mocks.record.mockResolvedValue('10000000-0000-4000-8000-00000000a501');
});

afterEach(() => { vi.useRealTimers(); });

function request(query: string, password = 'StrongTEST123!') {
  return new Request(`https://example.test/api/admin/list-export?${query}`, { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password, passwordConfirmation: password }) });
}

describe('목록 엑셀 다운로드 라우트', () => {
  it.each(['1234', 'A'.repeat(16)])('배송현황 목록은 허용 길이의 암호 %s를 암호화에 그대로 전달한다', async password => {
    const response = await POST(request('screen=shipping&tab=transit', password));
    expect(response.status).toBe(200);
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.any(Buffer), password);
  });
  it.each(['123', 'A'.repeat(17)])('허용 길이 밖의 암호 %s는 조회·암호화·감사 전에 거부한다', async password => {
    const response = await POST(request('screen=shipping&tab=transit', password));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('4~16자');
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('GET은 평문 우회를 허용하지 않는다', async () => {
    const response = await GET(); expect(response.status).toBe(405);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('다른 origin과 비밀번호 URL은 생성과 감사 전에 거부한다', async () => {
    const other = request('screen=orders'); other.headers.set('origin', 'https://evil.test');
    expect((await POST(other)).status).toBe(403);
    expect((await POST(request('screen=orders&password=NeverInUrl'))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('암호화 실패는 평문 응답과 감사로 진행하지 않는다', async () => {
    mocks.encrypt.mockImplementation(() => { throw new Error('crypto failure'); });
    const response = await POST(request('screen=orders'));
    expect(response.status).toBe(500); expect(response.headers.get('content-type')).toContain('json');
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('화면 경로로 권한을 확인하고, 기록을 남긴 뒤 비공개 xlsx로 응답한다', async () => {
    const response = await POST(request('screen=dispatch&tab=ready&query=%ED%99%8D&page=4'));
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/dispatch');
    expect(mocks.load).toHaveBeenCalledWith('dispatch', { screen: 'dispatch', tab: 'ready', query: '홍', page: '4' }, new Date('2026-10-07T06:04:00.000Z'), 'staff');
    expect(mocks.record).toHaveBeenCalledWith('staff', sheet, 'a'.repeat(64));
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.encrypt.mock.invocationCallOrder[0]);
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="icons-dispatch-20261007-1504.xlsx"; filename*=UTF-8''${encodeURIComponent('icons-발주발송-발송대기-20261007-1504.xlsx')}`,
    );
    expect(response.headers.get('x-icons-export-audit')).toBe('10000000-0000-4000-8000-00000000a501');
    expect(response.headers.get('x-icons-export-rows')).toBe('2');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-xlsx');
  });

  it('클레임 화면은 유형별 화면 경로로 권한을 확인한다', async () => {
    await POST(request('screen=claims-returns&stage=open'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/claims/returns');
  });

  it('주문통합검색의 상품주문별 보기는 주문별과 구분되는 파일명으로 내려준다', async () => {
    mocks.load.mockResolvedValue({ ...sheet, screen: 'orders', filters: { view: 'items' } });
    const items = await POST(request('screen=orders&view=items'));
    expect(decodeURIComponent(items.headers.get('content-disposition')!)).toContain('icons-상품주문별조회-20261007-1504.xlsx');
    expect(items.headers.get('content-disposition')).toContain('filename="icons-order-items-20261007-1504.xlsx"');
    mocks.load.mockResolvedValue({ ...sheet, screen: 'orders', filters: { status: 'all' } });
    const orders = await POST(request('screen=orders'));
    expect(decodeURIComponent(orders.headers.get('content-disposition')!)).toContain('icons-주문통합검색-20261007-1504.xlsx');
  });
  it.each(['orders', 'unpaid', 'dispatch', 'shipping', 'claims-returns'] as AdminListExportScreenId[])(
    '%s 목록 수를 바꿔도 전체 목록 다운로드 요청은 허용된다', async screen => {
      const href = adminListExportHref(screen, '/admin/sales/shipping?tab=transit&page=3&pageSize=50&sort=newest');
      const response = await POST(request(href.split('?')[1]));
      expect(response.status).toBe(200);
      expect(mocks.load).toHaveBeenCalledWith(screen, { screen, tab: 'transit', sort: 'newest' }, expect.any(Date), 'staff');
    },
  );

  it('권한 거절은 로더를 실행하지 않는다', async () => {
    mocks.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(POST(request('screen=orders'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('모르는 화면은 권한 확인 뒤 400으로 거절한다', async () => {
    const response = await POST(request('screen=settled'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '내려받을 화면을 확인해주세요.' });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('상한을 넘으면 파일과 기록 없이 조건을 좁히라는 400을 준다', async () => {
    mocks.load.mockRejectedValue(new AdminListExportLimitError(12_000));
    const response = await POST(request('screen=orders'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: '한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 10,000건).' });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('상품 줄로 펼친 행이 상한을 넘으면 행 기준 안내로 400을 준다', async () => {
    mocks.load.mockRejectedValue(new AdminListExportLimitError(12_000, 10_000, 'rows'));
    const response = await POST(request('screen=orders'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('상품 한 줄을 한 행으로 펼치면 한 파일에 담을 수 있는 10,000행을 넘습니다. 기간·상태를 좁혀 나누어 받아 주세요.');
  });

  it('읽는 사이 목록이 바뀌면 파일과 기록 없이 409로 다시 받도록 안내한다', async () => {
    mocks.load.mockRejectedValue(new AdminListExportChangedError());
    const response = await POST(request('screen=dispatch&tab=new'));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('목록이 바뀌는 중이라 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('감사 기록에 실패하면 파일을 내보내지 않는다', async () => {
    mocks.record.mockRejectedValue(new AdminListExportAuditError());
    const response = await POST(request('screen=unpaid'));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).error).toContain('다운로드 기록을 남기지 못해');
  });

  it('영문 내부 오류는 한국어 안내로 바꾼다', async () => {
    mocks.load.mockRejectedValue(new Error('Failed to load admin orders: boom'));
    const response = await POST(request('screen=orders'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '목록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.' });
  });
});

describe('환불 송금 대기 목록 엑셀(계좌 포함, 1007-047·048)', () => {
  const refundSheet = { screen: 'refund-transfers', rows: [['요청']], recordCount: 1, filters: { accountExportId: '10000000-0000-4000-8000-00000000a777' } };
  it('화면 경로로 권한을 확인하고 운영자를 넘겨 계좌를 실은 시트를 암호화한 뒤 기록하고 응답한다', async () => {
    mocks.load.mockResolvedValue(refundSheet);
    const response = await POST(request(adminListExportHref('refund-transfers', '/admin/sales/claims/refund-transfers?page=2').split('?')[1]));
    expect(response.status).toBe(200);
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/claims/refund-transfers');
    expect(mocks.load).toHaveBeenCalledWith('refund-transfers', { screen: 'refund-transfers' }, expect.any(Date), 'staff');
    // 평문 바이트는 암호화 직후 0으로 지운다(그래서 호출 인자 내용은 비교하지 않는다).
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.any(Buffer), 'StrongTEST123!');
    expect(mocks.record).toHaveBeenCalledWith('staff', refundSheet, 'a'.repeat(64));
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[0]);
    expect(response.headers.get('x-icons-export-encryption')).toBe('ECMA-376-Agile');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-xlsx');
    expect(decodeURIComponent(response.headers.get('content-disposition')!)).toContain('icons-환불송금대기-20261007-1504.xlsx');
  });
  it.each([
    ['비밀번호 없음', JSON.stringify({})],
    ['확인 불일치', JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'Other123!' })],
    ['짧은 비밀번호', JSON.stringify({ password: '123', passwordConfirmation: '123' })],
  ])('%s이면 목록 조회·계좌 열람·파일·기록 없이 거절한다', async (_label, body) => {
    const response = await POST(new Request('https://example.test/api/admin/list-export?screen=refund-transfers', {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body,
    }));
    expect(response.status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('GET·본문 없는 요청·다른 출처로는 받을 수 없다', async () => {
    expect((await GET()).status).toBe(405);
    const empty = await POST(new Request('https://example.test/api/admin/list-export?screen=refund-transfers', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' } }));
    expect(empty.status).toBe(400);
    const other = request('screen=refund-transfers'); other.headers.set('origin', 'https://evil.test');
    expect((await POST(other)).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

describe('비밀번호 없이 계좌를 내려받는 경로가 없다(소스 계약)', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? (entry.name === 'node_modules' ? [] : sources(`${dir}/${entry.name}`))
    : /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
  const files = ['app', 'lib', 'components'].flatMap(sources);
  const users = (pattern: RegExp) => files.filter(file => pattern.test(readFileSync(file, 'utf8'))).sort();
  it('계좌 일괄 열람 RPC는 목록 엑셀 로더 한 곳에서만 부르고, 그 로더는 비밀번호를 확인한 POST 라우트만 쓴다', () => {
    expect(users(/\.rpc\(\s*['"]service_export_bank_transfer_refund_accounts['"]/)).toEqual(['lib/admin/list-export-refund-transfers.server.ts']);
    expect(users(/revealRefundTransferAccounts\b/)).toEqual(['lib/admin/list-export-data.server.ts', 'lib/admin/list-export-refund-transfers.server.ts']);
    expect(users(/\bloadAdminListExportSheet\b/)).toEqual(['app/api/admin/list-export/route.ts', 'lib/admin/list-export-data.server.ts']);
  });
  it('라우트는 비밀번호를 읽은 뒤에만 조회하고, 암호화한 바이트만 응답한다', () => {
    const route = readFileSync('app/api/admin/list-export/route.ts', 'utf8');
    const post = route.slice(route.indexOf('export async function POST'));
    const at = (needle: string) => { const index = post.indexOf(needle); expect(index, needle).toBeGreaterThan(-1); return index; };
    expect(at('readExportPassword(')).toBeLessThan(at('loadAdminListExportSheet('));
    expect(at('loadAdminListExportSheet(')).toBeLessThan(at('encryptAdminWorkbook('));
    expect(at('encryptAdminWorkbook(')).toBeLessThan(at('new Response('));
    expect(post).toContain('new Response(new Uint8Array(bytes)');
    expect(post).not.toMatch(/new Response\((plain|sheet)/);
    // GET은 조회 없이 405다.
    const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
    expect(get).toContain('405'); expect(get).not.toContain('loadAdminListExportSheet');
  });
});
