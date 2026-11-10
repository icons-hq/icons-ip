import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { inquirySatisfactionPercent, parseAdminInquirySatisfactionDetail, parseInquirySatisfactionOperation, parseInquirySatisfactionRequest, parseMyInquirySatisfaction } from '@/lib/inquiry-satisfaction';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminInquiryConsoleData } from '@/lib/admin/inquiries.server';
import { normalizeAdminInquiryFilters } from '@/lib/admin/inquiries';
const path = process.env.INQUIRY_SATISFACTION_DTO_FILE;
if (!path) throw new Error('INQUIRY_SATISFACTION_DTO_FILE must come from the owned-clone runner');
const captures = JSON.parse(readFileSync(path, 'utf8')) as { kind: string; value: unknown; request?: unknown }[];
const captured = (kind: string) => { const found = captures.filter(row => row.kind === kind); expect(found).toHaveLength(1); return found[0]; };
it('parses the actual legacy SQL context without manufacturing a revision', () => {
  expect(parseMyInquirySatisfaction(captured('legacy').value)).toMatchObject({ revision: 0, canEvaluate: true, value: null });
});
it('parses the actual frozen SQL receipt and current context', () => {
  const source = captured('completed'), request = parseInquirySatisfactionRequest(source.request);
  expect(request).not.toBeNull();
  expect(parseInquirySatisfactionOperation(source.value, request!)).toMatchObject({ operation: 'completed', receipt: { afterRevision: 1, outcome: 'changed' }, current: { value: 'satisfied' } });
});
it('parses bounded admin history without exposing session IDs', () => {
  const source = captured('admin'); expect(parseAdminInquirySatisfactionDetail(source.value)).not.toBeNull();
  expect(JSON.stringify(source.value)).not.toContain('Session');
});
it('feeds actual console JSON through the production loader and uses evaluated-response denominator', async () => {
  mocks.rpc.mockImplementation(async name => ({ error: null, data: name === 'admin_inquiry_status_counts' ? [] : captured('console').value }));
  const result = await getAdminInquiryConsoleData(normalizeAdminInquiryFilters({ status: 'all', query: 'TEST 만족도 d515' }));
  expect(result.total).toBe(10); expect(result.rows).toHaveLength(10); expect(result.satisfactionSummary).toEqual({ satisfied: 3, dissatisfied: 1, unrated: 6 });
  expect(result.rows.find(row => row.orderId !== null)?.orderNumber).toMatch(/^[0-9]{8}1[0-9]{7}$/);
  expect(inquirySatisfactionPercent(result.satisfactionSummary!)).toBe(75);
});
