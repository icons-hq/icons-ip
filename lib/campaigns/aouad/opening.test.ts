import { describe, expect, it } from 'vitest';
import { isAouadOpeningReady } from './opening';

describe('AOUAD opening readiness', () => {
  it('opens the static form immediately for reduced-motion visitors', () => {
    expect(isAouadOpeningReady(false, true)).toBe(true);
  });

  it('otherwise waits for the first-visit ceremony timer', () => {
    expect(isAouadOpeningReady(false, false)).toBe(false);
    expect(isAouadOpeningReady(true, false)).toBe(true);
  });
});
