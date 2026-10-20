import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailDispatcher, type EmailDispatcher, type EmailDispatcherRepository } from './dispatcher';
import { dispatchOperatorInvitations, operatorInvitationToken, operatorInvitationTokenHash, prepareOperatorInvitationEntry, renderOperatorInvitationEmail, type OperatorInvitationEmailJob, type OperatorInvitationEmailRepository } from './operator-invitations.server';
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(), getServiceRoleConfig: () => ({ isConfigured: false }) }));
const id = (n: number) => `87000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { id: id(1), email: 'member@example.test', name: '<초대받은 사람>', managerRole: 'deputy' as const, duty: 'cs' as const };
const job = (): OperatorInvitationEmailJob => ({ ...input, recipient: input.email, claimId: id(2), intentId: id(3), expiresAt: '2026-10-20T00:00:00Z', tokenHash: prepareOperatorInvitationEntry(input).tokenHash });
const repository = (value = job()): OperatorInvitationEmailRepository => ({ prepare: vi.fn().mockResolvedValue(value), finish: vi.fn().mockResolvedValue(true) });
beforeEach(() => { vi.stubEnv('EMAIL_DISPATCH_HMAC_SECRET', 'synthetic-invitation-secret-for-tests-only-2026'); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('invitation tokens and provider boundaries', () => {
  it('derives a stable token per invitation and stores only hashes in the entry', () => {
    const token = operatorInvitationToken(input.id, input.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(operatorInvitationToken(input.id.toUpperCase(), ' MEMBER@EXAMPLE.TEST ')).toBe(token);
    expect(operatorInvitationToken(id(4), input.email)).not.toBe(token);
    expect(JSON.stringify(prepareOperatorInvitationEntry(input))).not.toContain(token);
    expect(prepareOperatorInvitationEntry(input).tokenHash).toBe(operatorInvitationTokenHash(token));
  });
  it('puts the token only in a fragment and escapes recipient-controlled HTML', () => {
    const token = operatorInvitationToken(input.id, input.email);
    const message = renderOperatorInvitationEmail(job(), token, 'https://icons.example.test');
    expect(message.text).toContain(`/manager-invitation#token=${token}`);
    expect(message.text).not.toContain('?token=');
    expect(message.html).toContain('&lt;초대받은 사람&gt;');
    expect(message.html).not.toContain('<초대받은 사람>');
  });
  it('does not dispatch after repository observes cancellation or lost authority', async () => {
    const repo = repository(); vi.mocked(repo.prepare).mockResolvedValue(null);
    const dispatcher = { dispatch: vi.fn() } as unknown as EmailDispatcher;
    expect(await dispatchOperatorInvitations([id(1)], id(9), { repository: repo, dispatcher, siteUrl: 'https://icons.example.test' })).toEqual({ accepted: 0, pending: 0, unavailable: 1, needsReview: 0 });
    expect(dispatcher.dispatch).not.toHaveBeenCalled(); expect(repo.finish).not.toHaveBeenCalled();
  });
  it('requires reissue after HMAC rotation instead of sending a new unmatched link', async () => {
    const repo = repository(); vi.stubEnv('EMAIL_DISPATCH_HMAC_SECRET', 'synthetic-rotated-secret-for-tests-only-2026');
    const dispatcher = { dispatch: vi.fn() } as unknown as EmailDispatcher;
    expect(await dispatchOperatorInvitations([id(1)], id(9), { repository: repo, dispatcher, siteUrl: 'https://icons.example.test' })).toHaveProperty('needsReview', 1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled(); expect(repo.finish).toHaveBeenCalledWith(id(1), id(2), 'token_key_changed');
  });
  it('retains confirmed invitation creation when no provider is configured', async () => {
    const repo = repository();
    expect(await dispatchOperatorInvitations([id(1)], id(9), { repository: repo, dispatcher: null, siteUrl: 'https://icons.example.test' })).toHaveProperty('pending', 1);
    expect(repo.finish).toHaveBeenCalledWith(id(1), id(2), 'provider_not_configured');
  });
  it('uses the existing durable claim and a fake provider, separating acceptance from delivery', async () => {
    const repo = repository(); const send = vi.fn().mockResolvedValue({ kind: 'accepted', providerReference: 'synthetic-provider-receipt' });
    const outbox = { claimDispatch: vi.fn().mockResolvedValue({ kind: 'claimed', intentId: id(3), claimId: id(4), idempotencyKey: `email/${id(3)}` }), recordAccepted: vi.fn().mockResolvedValue({ state: 'accepted' }) } as unknown as EmailDispatcherRepository;
    const dispatcher = createEmailDispatcher({ repository: outbox, provider: { send } });
    const summary = await dispatchOperatorInvitations([id(1)], id(9), { repository: repo, dispatcher, siteUrl: 'https://icons.example.test' });
    expect(summary).toEqual({ accepted: 1, pending: 0, unavailable: 0, needsReview: 0 });
    expect(send).toHaveBeenCalledOnce(); expect(outbox.claimDispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify(summary)).not.toContain(input.email); expect(JSON.stringify(summary)).not.toContain(operatorInvitationToken(input.id, input.email));
    expect(repo.finish).toHaveBeenCalledWith(id(1), id(2), null);
  });
  it('honors the default-off outbox gate without calling the fake provider', async () => {
    const repo = repository(); const send = vi.fn();
    const outbox = { claimDispatch: vi.fn().mockResolvedValue({ kind: 'disabled', state: 'queued' }) } as unknown as EmailDispatcherRepository;
    const dispatcher = createEmailDispatcher({ repository: outbox, provider: { send } });
    expect(await dispatchOperatorInvitations([id(1)], id(9), { repository: repo, dispatcher, siteUrl: 'https://icons.example.test' })).toHaveProperty('pending', 1);
    expect(send).not.toHaveBeenCalled(); expect(repo.finish).toHaveBeenCalledWith(id(1), id(2), 'delivery_disabled');
  });
});
