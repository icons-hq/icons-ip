import { describe, expect, it } from 'vitest';
import { adminSectionFromQuery } from './sections';

describe('adminSectionFromQuery', () => {
  /*
   * 새 섹션을 union 에만 추가하면 ?section= 링크가 조용히 개요로 떨어진다.
   * '메일 발송 이력'이 실제로 그렇게 빠져 있었다.
   */
  it.each([
    'orders',
    'good',
    'pool',
    'policy',
    'grants',
    'game',
    'ticket',
    'curations',
    'notifications',
    'emails',
    'members',
  ])('%s 딥링크를 그대로 연다', (section) => {
    expect(adminSectionFromQuery(section)).toBe(section);
  });

  it('모르는 값·비문자열은 개요로 떨어진다', () => {
    for (const value of ['', 'nope', '../roles', undefined, null, 42, ['orders']]) {
      expect(adminSectionFromQuery(value)).toBe('overview');
    }
  });
});
