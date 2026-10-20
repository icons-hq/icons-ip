import { expect, it } from 'vitest';
import { parseProductionTerms, parseShipmentProductionSummary, productionLeadLabel } from './order-production';
const terms = { version: 1, goodId: 'made-a', revision: 2, leadDays: 5, dayBasis: 'business', closedDates: ['2026-10-19'], publicNote: 'TEST' };
it('납기 계약의 정수·실제 날짜·중복 휴무일·예상하지 못한 필드를 검사한다', () => {
 expect(parseProductionTerms(terms)).toEqual(terms);
 for (const patch of [{ leadDays: 366 }, { leadDays: 0.5 }, { closedDates: ['2026-02-31'] }, { closedDates: ['2026-10-19', '2026-10-19'] }, { dayBasis: 'calendar' }, { internal: true }])
  expect(parseProductionTerms({ ...terms, ...patch })).toBeNull();
 expect(productionLeadLabel(parseProductionTerms(terms)!)).toContain('설정 휴무일 제외');
});
it('출고 가능 여부를 실제 제작 완료 건수와 대조한다', () => {
 expect(parseShipmentProductionSummary({ count: 2, completed: 1, ready: true, dueAt: null })).toBeNull();
 expect(parseShipmentProductionSummary({ count: 0, completed: 0, ready: true, dueAt: null })).not.toBeNull();
 expect(parseShipmentProductionSummary({ count: 1, completed: 2, ready: true, dueAt: null })).toBeNull();
});
