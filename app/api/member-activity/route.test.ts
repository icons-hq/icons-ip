import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: vi.fn(), record: vi.fn(), choice: vi.fn() }));
vi.mock('@/lib/member-activity.server', () => ({ memberActivityState: mocks.state, recordMemberActivity: mocks.record, updateMemberActivityChoice: mocks.choice }));
import { GET, POST } from './route';
const origin = 'https://icons.test', identity = { actorId: 'a6160000-0000-4000-8000-000000000001', sessionId: 'a6160000-0000-4000-8000-000000000002', revision: 1 };
const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/member-activity`, { method: 'POST', headers: { origin, host: 'icons.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.state.mockResolvedValue(null); mocks.record.mockResolvedValue({ ok: true, status: 200 }); mocks.choice.mockResolvedValue({ ok: true, status: 200 }); });
describe('member activity HTTP boundary', () => {
  it('disables shared caching and returns no identity when signed out', async () => { const response = await GET(); expect(await response.json()).toEqual({ state: null }); expect(response.headers.get('cache-control')).toContain('no-store'); });
  it('rejects cross-origin, oversized and unexpected fields before database access', async () => {
    expect((await POST(request({ action: 'accept', identity }, { origin: 'https://other.test' }))).status).toBe(403);
    expect((await POST(request({ action: 'accept', identity }, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(request({ action: 'accept', identity, extra: 'x'.repeat(5000) }))).status).toBe(413);
    expect((await POST(request({ action: 'accept', identity, marketing: true }))).status).toBe(400);
    expect(mocks.choice).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('binds both consent and collection to the exact member session and revision', async () => {
    expect((await POST(request({ action: 'decline', identity }))).status).toBe(200); expect(mocks.choice).toHaveBeenCalledWith('declined', identity);
    const event = { eventId: identity.actorId, kind: 'visit', pageKind: 'home', targetId: 'home', assetId: null };
    expect((await POST(request({ action: 'record', identity, event }))).status).toBe(200); expect(mocks.record).toHaveBeenCalledWith(event, identity);
    expect((await POST(request({ action: 'record', identity, event: { ...event, userId: identity.actorId } }))).status).toBe(400);
  });
});
