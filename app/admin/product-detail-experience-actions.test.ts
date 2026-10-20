import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { saveDetailExperienceAction } from './product-detail-experience-actions';
import { DEFAULT_DETAIL_EXPERIENCES } from '@/lib/product-detail-experiences';
const operation = '92200000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({}); });
describe('save product detail experiences', () => {
  it('rejects an unauthorized actor and invalid thresholds before a write', async () => {
    mocks.access.mockResolvedValue(null); await saveDetailExperienceAction('messages', DEFAULT_DETAIL_EXPERIENCES.messages, 0, operation); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({}); await saveDetailExperienceAction('messages', { ...DEFAULT_DETAIL_EXPERIENCES.messages, minBuyers: 9 }, 0, operation); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('revalidates the detail and collection surfaces only for a matching receipt', async () => {
    mocks.rpc.mockResolvedValue({ data: { section: 'discovery', values: DEFAULT_DETAIL_EXPERIENCES.discovery, revision: 1 }, error: null });
    expect(await saveDetailExperienceAction('discovery', DEFAULT_DETAIL_EXPERIENCES.discovery, 0, operation)).toHaveProperty('revision', 1);
    expect(mocks.revalidate).toHaveBeenCalledWith('/interests');
    mocks.revalidate.mockClear(); mocks.rpc.mockResolvedValue({ data: { section: 'discovery', values: DEFAULT_DETAIL_EXPERIENCES.discovery, revision: 2 }, error: null });
    expect(await saveDetailExperienceAction('discovery', DEFAULT_DETAIL_EXPERIENCES.discovery, 0, operation)).toHaveProperty('uncertain', true); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('freezes unknown transport results and distinguishes a known CAS conflict', async () => {
    mocks.rpc.mockRejectedValue(new Error('network')); expect(await saveDetailExperienceAction('discovery', DEFAULT_DETAIL_EXPERIENCES.discovery, 0, operation)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } }); expect(await saveDetailExperienceAction('discovery', DEFAULT_DETAIL_EXPERIENCES.discovery, 0, operation)).not.toHaveProperty('uncertain');
  });
});
