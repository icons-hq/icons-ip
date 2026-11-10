import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: false,
  memo: [] as unknown[], memoIndex: 0,
  effects: [] as (() => void | (() => void))[],
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
    useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect); },
  };
});

import { useCsEditorDraft } from './useCsEditorDraft';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const parse = (value: unknown) => (typeof value === 'string' ? value : null);

function Harness(accountId: string, enabled: boolean) {
  // Drives the mocked hook runtime; it is never rendered by React.
  return useCsEditorDraft<string>({ accountId, scope: 'inquiry-templates', recordId: 'shared', parse, enabled });
}
function render(accountId: string, enabled = true) {
  mocks.memoIndex = 0;
  return Harness(accountId, enabled);
}
function run(accountId: string, enabled = true) {
  render(accountId, enabled);
  mocks.effects.splice(0).forEach((effect) => effect());
  return render(accountId, enabled);
}

beforeEach(() => {
  mocks.configured = false; mocks.memo = []; mocks.memoIndex = 0; mocks.effects = []; mocks.authListener = null;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

/* m27 G4-2: Supabase가 없는 환경(시각 fixture·로컬 미리보기)에는 인증 이벤트가 오지 않는다.
   useInquiryDraft(R4)와 같게 이 탭 안에서만 쓰는 고정 식별자로 열어, 답변 템플릿 창이 영원히 잠기지 않게 한다. */
it('Supabase 미설정 환경에서도 답변 템플릿 창이 잠기지 않는다', () => {
  const draft = run(ACCOUNT);
  expect(draft.ready).toBe(true);
  expect(draft.blocked).toBe(false);
  expect(draft.isActive()).toBe(true);
  expect(draft.change('작성 중인 템플릿')).toBe(true);
  expect(render(ACCOUNT).value).toBe('작성 중인 템플릿');
});

it('계정 id가 없는 미리보기에서도 잠기지 않는다', () => {
  const draft = run('');
  expect(draft.ready).toBe(true);
  expect(draft.blocked).toBe(false);
});

it('닫힌 편집기(enabled=false)는 미설정 환경에서도 보관소를 열지 않는다', () => {
  const draft = run(ACCOUNT, false);
  expect(draft.ready).toBe(false);
});

it('Supabase가 설정되어 있으면 지금처럼 로그인 세션을 확인한 뒤에만 연다', () => {
  mocks.configured = true;
  const before = run(ACCOUNT);
  expect(before.ready).toBe(false);
  expect(mocks.authListener).not.toBeNull();
  const token = `header.${btoa(JSON.stringify({ session_id: '22222222-2222-4222-8222-222222222222' }))}.sig`;
  mocks.authListener!('SIGNED_IN', { user: { id: ACCOUNT }, access_token: token });
  const after = render(ACCOUNT);
  expect(after.ready).toBe(true);
  expect(after.blocked).toBe(false);
});

it('Supabase가 설정되어 있으면 다른 계정의 세션으로는 열리지 않는다', () => {
  mocks.configured = true;
  run('');
  const token = `header.${btoa(JSON.stringify({ session_id: '22222222-2222-4222-8222-222222222222' }))}.sig`;
  mocks.authListener!('SIGNED_IN', { user: { id: ACCOUNT }, access_token: token });
  expect(render('').blocked).toBe(true);
});
