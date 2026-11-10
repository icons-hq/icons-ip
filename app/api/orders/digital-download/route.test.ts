import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn(), rpc: vi.fn(), download: vi.fn(), bucket: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user, getSession: mocks.session } }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, storage: { from: mocks.bucket } }) }));
import { POST } from './route';
const id = (n: number) => `c7160850-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bytes = new TextEncoder().encode('TEST purchased private file\n');
const sha = createHash('sha256').update(bytes).digest('hex');
const body = { itemId: id(3), assetId: id(4), operationId: id(5) };
const info = { orderId: id(6), itemId: id(3), assetId: id(4), name: 'TEST 구매 파일.txt', mimeType: 'text/plain', size: bytes.length, sha256: sha, path: `${id(9)}/${id(4)}.txt` };
const request = (patch: Record<string, unknown> = {}, headers = {}) => new Request('https://example.test/api/orders/digital-download', { method: 'POST', headers: { host: 'example.test', origin: 'https://example.test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...patch }) });
beforeEach(() => {
 vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: id(1) } } });
 mocks.session.mockResolvedValue({ data: { session: { user: { id: id(1) }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: id(2) })).toString('base64url')}.x` } } });
 mocks.bucket.mockReturnValue({ download: mocks.download }); mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
 mocks.rpc.mockImplementation(async (name: string) => name === 'service_get_digital_download_info' ? { data: info, error: null } : { data: { operationId: id(5), itemId: id(3), assetId: id(4) }, error: null });
});
describe('private purchased file transfer', () => {
 it('authorizes twice and returns attachment bytes with no durable storage URL', async () => {
  const response = await POST(request()); expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
  expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(['service_get_digital_download_info', 'service_record_digital_download']);
  expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_actor: id(1), p_session: id(2), p_sha256: sha, p_operation: id(5) });
 });
 it('rejects cross origin, unknown payload fields, and unverified sessions before private reads', async () => {
  expect((await POST(request({}, { origin: 'https://other.test' }))).status).toBe(403);
  expect((await POST(request({ path: info.path }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ data: { session: null } }); expect((await POST(request())).status).toBe(401); expect(mocks.download).not.toHaveBeenCalled();
 });
 it('a refund or claim between storage read and transfer returns no bytes', async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === 'service_get_digital_download_info' ? { data: info, error: null } : { data: null, error: { code: '23514' } });
  const response = await POST(request()); expect(response.status).toBe(409); expect(await response.text()).not.toContain('TEST purchased');
 });
 it('rejects a mutated blob or mismatched private path without recording delivery', async () => {
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes.length)]), error: null }); expect((await POST(request())).status).toBe(503); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  mocks.rpc.mockResolvedValue({ data: { ...info, path: `${id(9)}/${id(7)}.txt` }, error: null }); expect((await POST(request())).status).toBe(503);
 });
});
