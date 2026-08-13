import { describe, expect, it } from 'vitest';
import {
  normalizeAccountDeletionPreview,
  normalizeAccountDeletionStatus,
} from './account-deletion';

describe('account deletion public DTO', () => {
  it('accepts only allowlisted blocker codes and paths', () => {
    expect(normalizeAccountDeletionPreview({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_order', count: 2, path: '/orders' }],
    })).toEqual({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_order', count: 2, path: '/orders' }],
    });
  });

  it('fails closed without reflecting malformed provider data', () => {
    expect(normalizeAccountDeletionPreview({
      available: true,
      eligible: true,
      blockers: [{ code: 'private_internal', count: -1, path: 'https://evil.test' }],
      subjectUserId: 'secret',
    })).toEqual({
      available: false,
      eligible: false,
      blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
    });
  });

  it('returns only opaque request phases and safe next actions', () => {
    expect(normalizeAccountDeletionStatus({
      status: 'blocked',
      phase: 'fenced',
      nextAction: '/tickets',
      blockers: [{ code: 'active_ticket', count: 1, path: '/tickets' }],
      deletionEventId: 'must-not-leak',
    })).toEqual({
      status: 'blocked',
      phase: 'fenced',
      nextAction: '/tickets',
      blockers: [{ code: 'active_ticket', count: 1, path: '/tickets' }],
    });

    expect(normalizeAccountDeletionStatus(null)).toEqual({
      status: 'not_requested',
      phase: 'none',
      nextAction: '/settings',
      blockers: [],
    });
  });
});
