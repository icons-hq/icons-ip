import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminInquiryConsoleData, getAdminInquiryNavigation } from './inquiries.server';
import { normalizeAdminInquiryFilters } from './inquiries';
const filters = normalizeAdminInquiryFilters({ status: 'all', satisfaction: 'dissatisfied', page: '3', category: 'order', from: '2026-10-01', to: '2026-10-15', field: 'title', query: '배송' });
const row = { id: 'd5150000-0000-4000-8000-000000000001', reference: 1, category: 'order', title: '문의', status: 'answered', user_id: 'd5150000-0000-4000-8000-000000000002',
  buyer_name: '고객', buyer_email: null, order_id: null, good_id: null, good_name: null, handled_by: null, assignee_id: null, waiting_since: null, handler_name: null, assignee_name: null,
  created_at: '2026-10-15T01:00:00Z', last_message_at: '2026-10-15T02:00:00Z', answered_at: '2026-10-15T02:00:00Z', closed_at: null, message_count: 2, satisfaction: 'dissatisfied' };
const summary = { satisfied: 3, dissatisfied: 41, unrated: 6 };
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockImplementation(async name => ({ error: null, data: name === 'admin_inquiry_status_counts' ? [] : { rows: [], total: 41, summary } })); });

it('out-of-range pages keep total and summary; filter is sent before server pagination', async () => {
  const data = await getAdminInquiryConsoleData(filters);
  expect(data.rows).toEqual([]); expect(data.total).toBe(41); expect(data.satisfactionSummary).toEqual(summary);
  expect(mocks.rpc).toHaveBeenCalledWith('admin_inquiry_satisfaction_console_numbered', expect.objectContaining({ p_satisfaction: 'dissatisfied', p_offset: 40, p_limit: 20, p_category: 'order', p_query: '배송' }));
});
it.each([null, [], { rows: [], total: 0 }, { rows: [{ ...row, satisfaction: undefined }], total: 41, summary }, { rows: [], total: 41, summary: { ...summary, unrated: null } }])('reader corruption is a load error, never unrated/zero', async input => {
  mocks.rpc.mockImplementation(async name => ({ error: null, data: name === 'admin_inquiry_status_counts' ? [] : input }));
  await expect(getAdminInquiryConsoleData(filters)).rejects.toThrow('Invalid inquiry satisfaction console');
});
it('previous/next boundary lookups keep the same satisfaction and current query', async () => {
  mocks.rpc.mockImplementation(async name => ({ error: null, data: name === 'admin_inquiry_status_counts' ? [] : { rows: [row], total: 41, summary } }));
  const data = await getAdminInquiryConsoleData(filters);
  mocks.rpc.mockClear();
  await getAdminInquiryNavigation(row.id, data, 'detail');
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_inquiry_satisfaction_console_numbered', expect.objectContaining({ p_satisfaction: 'dissatisfied', p_limit: 1, p_offset: 39, p_query: '배송', p_from: '2026-10-01', p_to: '2026-10-15' }));
});
