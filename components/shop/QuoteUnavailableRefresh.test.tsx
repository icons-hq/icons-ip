import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ refresh: vi.fn(), effect: null as (() => void) | null }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => void) => { mock.effect = effect; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
import { QuoteUnavailableRefresh } from './QuoteUnavailableRefresh';
beforeEach(() => vi.clearAllMocks());
describe('QuoteUnavailableRefresh', () => {
  it('불가 줄 조합이 있을 때만 서버 속성을 다시 읽는다', () => {
    QuoteUnavailableRefresh({ signature: null }); mock.effect!(); expect(mock.refresh).not.toHaveBeenCalled();
    QuoteUnavailableRefresh({ signature: 'g13' }); mock.effect!(); expect(mock.refresh).toHaveBeenCalledOnce();
  });
});
