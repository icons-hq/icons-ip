import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: false,
  memo: [] as unknown[], memoIndex: 0,
  effects: [] as (() => void)[],
  authListener: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void),
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { onAuthStateChange: (listener: typeof mocks.authListener) => {
    mocks.authListener = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  } } }),
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => {
      const index = mocks.memoIndex++;
      if (!(index in mocks.memo)) mocks.memo[index] = factory();
      return mocks.memo[index];
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useEffect: (effect: () => void) => { mocks.effects.push(effect); },
  };
});

import { useInquiryDraft } from './useInquiryDraft';

function Harness(accountId: string) {
  // Drives the mocked hook runtime; it is never rendered by React.
  return useInquiryDraft(accountId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reply');
}
function render(accountId: string) {
  mocks.memoIndex = 0;
  return Harness(accountId);
}
function run(accountId: string) {
  render(accountId);
  mocks.effects.splice(0).forEach((effect) => effect());
  return render(accountId);
}

beforeEach(() => {
  mocks.configured = false; mocks.memo = []; mocks.memoIndex = 0; mocks.effects = []; mocks.authListener = null;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

/* R4: Supabase가 없는 환경(시각 fixture·로컬 미리보기)에서는 인증 이벤트가 오지 않는다.
   그때도 답변 입력이 영원히 잠기지 않고 이 탭 안에서만 쓰는 초안으로 열린다. */
it('Supabase 미설정 환경에서도 답변 입력이 열린다', () => {
  const draft = run('11111111-1111-4111-8111-111111111111');
  expect(draft.ready).toBe(true);
  expect(draft.blocked).toBe(false);
  draft.change('안녕하세요');
  expect(render('11111111-1111-4111-8111-111111111111').body).toBe('안녕하세요');
});

it('계정 id가 없는 미리보기에서도 잠기지 않는다', () => {
  const draft = run('');
  expect(draft.ready).toBe(true);
  expect(draft.blocked).toBe(false);
});

it('Supabase가 설정되어 있으면 로그인 세션을 확인한 뒤에만 연다', () => {
  mocks.configured = true;
  const before = run('11111111-1111-4111-8111-111111111111');
  expect(before.ready).toBe(false);
  expect(mocks.authListener).not.toBeNull();
});
