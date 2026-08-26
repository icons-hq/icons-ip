import { describe, expect, it } from 'vitest';
import { LAST_BELL_ROUTE_LABELS } from './routes';

describe('Last Bell route labels', () => {
  it('keeps the approved route names in one shared player-facing registry', () => {
    expect(LAST_BELL_ROUTE_LABELS).toEqual({
      central: '중앙 복도',
      rear: '후면 복도',
      systems: '시스템 통로',
    });
  });
});
