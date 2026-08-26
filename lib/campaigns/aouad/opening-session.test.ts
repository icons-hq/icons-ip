import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('AOUAD opening document session', () => {
  it('does not mutate during Strict Mode-safe reads and only dismisses after a visitor response', async () => {
    const {
      isAouadOpeningDismissedInDocument,
      markAouadOpeningDismissedInDocument,
    } = await import('./opening-session');

    expect(isAouadOpeningDismissedInDocument()).toBe(false);
    expect(isAouadOpeningDismissedInDocument()).toBe(false);
    markAouadOpeningDismissedInDocument();
    expect(isAouadOpeningDismissedInDocument()).toBe(true);
  });
});
