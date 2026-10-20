import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: vi.fn(), update: vi.fn(), sameOrigin: vi.fn() }));
vi.mock('@/lib/customer-demographics.server', () => ({ customerDemographicState: mocks.state, updateCustomerDemographicChoice: mocks.update }));
vi.mock('@/lib/http/same-origin.server', () => ({ isSameOriginRequest: mocks.sameOrigin }));
import { GET, POST } from './route';
const identity = { actorId: 'a6191000-0000-4000-8000-000000000001', sessionId: 'a6191000-0000-4000-9000-000000000001', revision: 0 };
const body = { identity, choice: 'accepted', gender: 'female', consent: true };
const request = (value: unknown) => new Request('https://example.test/api/customer-demographics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); mocks.sameOrigin.mockReturnValue(true); mocks.update.mockResolvedValue({ ok: true, status: 200 }); });
describe('demographic choice endpoint', () => {
  it('saves only an explicit choice with identity', async () => { expect((await POST(request(body))).status).toBe(200); expect(mocks.update).toHaveBeenCalledWith('accepted', 'female', identity); });
  it.each([{ consent: false }, { consent: undefined }, { gender: null }, { gender: 'guessed' }, { actorId: identity.actorId }])('does not collect invalid input %j', async patch => { expect((await POST(request({ ...body, ...patch }))).status).toBe(400); expect(mocks.update).not.toHaveBeenCalled(); });
  it('rejects cross-origin writes', async () => { mocks.sameOrigin.mockReturnValue(false); expect((await POST(request(body))).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled(); });
  it('erases gender only through an explicit declined choice', async () => { expect((await POST(request({ ...body, choice: 'declined', gender: null, consent: false }))).status).toBe(200); expect(mocks.update).toHaveBeenCalledWith('declined', null, identity); });
  it('rejects oversized streamed input', async () => { expect((await POST(request({ ...body, extra: 'x'.repeat(3000) }))).status).toBe(413); });
  it('never caches identity or gender', async () => { mocks.state.mockResolvedValue(null); const r = await GET(); expect(r.headers.get('Cache-Control')).toContain('no-store'); expect(await r.json()).toEqual({ state: null }); });
  it('reports a failed read separately from no choice', async () => { mocks.state.mockRejectedValue(new Error('network')); expect((await GET()).status).toBe(503); });
});
