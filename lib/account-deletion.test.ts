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

    expect(normalizeAccountDeletionPreview({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_ticket_payment', count: 1, path: '/tickets' }],
    })).toEqual({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_ticket_payment', count: 1, path: '/tickets' }],
    });

    expect(normalizeAccountDeletionPreview({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_ticket_refund', count: 1, path: '/tickets' }],
    })).toEqual({
      available: true,
      eligible: false,
      blockers: [{ code: 'active_ticket_refund', count: 1, path: '/tickets' }],
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

  // A prototype key would have passed an `in` allowlist. The path contract catches it
  // today, so this pins the rejection instead of leaving it to a single downstream guard.
  it.each(['toString', 'constructor', 'valueOf'])(
    'rejects the prototype key %s as a blocker code',
    (code) => {
      expect(normalizeAccountDeletionPreview({
        available: true,
        eligible: false,
        blockers: [{ code, count: 1, path: '/settings' }],
      })).toEqual({
        available: false,
        eligible: false,
        blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
      });
    },
  );

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
