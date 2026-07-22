# Google·Apple·Kakao Social Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google·Apple·Kakao 버튼을 Supabase 관리형 OAuth에 연결하고 기존 정지 계정·온보딩·안전한 원래 경로 복귀 계약을 세 공급자에 동일하게 적용한다.

**Architecture:** 로그인 화면의 단일 Server Action form이 허용된 공급자와 안전한 `next`를 제출한다. Server Action은 Supabase SSR client로 PKCE OAuth URL을 만들고 서명된 `icons_auth_next` 쿠키에 `purpose: 'oauth'`를 기록하며, 기존 `/auth/callback`이 code exchange·사용자 재검증·정지 계정·온보딩·원래 경로 복귀를 처리한다. 외부 콘솔에는 ICONS 전용 Google·Kakao·Apple 앱과 production Supabase callback만 등록한다.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4 Server Actions/`useActionState`, TypeScript 5, Supabase Auth (`@supabase/ssr` 0.12.x, `@supabase/supabase-js` 2.108.x), Vitest 4.1.9

## Global Constraints

- Production Supabase project ref는 `sbutbsghcxmxmxgrshwq`이고 provider callback은 `https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback`이다.
- 앱 callback은 `https://iconsip.com/auth/callback`이며 기존 trusted-origin과 redirect allow-list를 재사용한다.
- 허용 provider는 정확히 `google`, `apple`, `kakao` 세 개다.
- OAuth `next` 상태는 서명된 httpOnly `icons_auth_next` 쿠키로 10분만 신뢰한다.
- 공급자 오류 원문, client id, client secret, Apple key/team id, authorization code, token을 UI·로그·저장소에 노출하지 않는다.
- 기존 Grapit 또는 다른 서비스의 OAuth 앱·동의 화면·키를 재사용하지 않는다.
- 임시 이용약관·개인정보처리방침 URL이나 추정한 Kakao 회사명을 입력하지 않는다.
- Apple client secret은 최대 6개월 수명으로 만들고 교체 절차를 문서화한다.
- 사용자 요청에 없는 staging, commit, push, PR, merge, production 배포는 수행하지 않는다.
- 사용자가 기존에 만든 `.claude/` 미추적 파일은 건드리지 않는다.

---

### Task 1: 서명된 OAuth next 상태

**Files:**
- Modify: `lib/auth/recovery.server.ts:14,85-112`
- Test: `lib/auth/recovery.server.test.ts:17-66`

**Interfaces:**
- Consumes: `safeNextPath(value: unknown): string`, `AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS = 600`
- Produces: `AuthNextPurpose = 'signup' | 'oauth' | 'recovery'`; `signedAuthNextCookieValue(next, 'oauth', issuedAt, secret)`; `authNextStateFromCookie(...)`가 `oauth`를 10분 동안 반환

- [ ] **Step 1: OAuth round-trip과 10분 만료 회귀 테스트를 추가한다**

```ts
it('round-trips oauth state with the signup ten-minute lifetime', () => {
  const value = signedAuthNextCookieValue('/shop?tab=goods', 'oauth', NOW, SECRET);

  expect(authNextStateFromCookie(value, NOW, SECRET)).toEqual({
    issuedAt: NOW,
    next: '/shop?tab=goods',
    purpose: 'oauth',
  });
  expect(authNextStateFromCookie(
    value,
    NOW + AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS * 1000 - 1,
    SECRET,
  )).toMatchObject({ purpose: 'oauth' });
  expect(authNextStateFromCookie(
    value,
    NOW + AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS * 1000,
    SECRET,
  )).toBeNull();
});
```

- [ ] **Step 2: 집중 테스트가 현재 구현에서 실패하는지 확인한다**

Run: `npm test -- lib/auth/recovery.server.test.ts`

Expected: TypeScript 또는 assertion failure로 `oauth` purpose가 아직 허용되지 않음을 확인한다.

- [ ] **Step 3: purpose union과 decoder allow-list에 OAuth를 최소 추가한다**

```ts
export type AuthNextPurpose = 'signup' | 'oauth' | 'recovery';

// authNextStateFromCookie 내부
if (
  candidate.purpose !== 'signup'
  && candidate.purpose !== 'oauth'
  && candidate.purpose !== 'recovery'
) return null;
```

`maxAgeSeconds`의 기존 recovery-vs-signup ternary는 그대로 두어 `oauth`가 signup과 같은 600초 수명을 사용하게 한다.

- [ ] **Step 4: 집중 테스트 통과를 확인한다**

Run: `npm test -- lib/auth/recovery.server.test.ts`

Expected: 해당 파일의 모든 테스트 PASS.

---

### Task 2: Supabase OAuth Server Action

**Files:**
- Modify: `app/login/actions.ts:24-55,135-157,287 이전`
- Test: `app/login/actions.test.ts:1-99`와 새 `signInWithSocialAction` describe

**Interfaces:**
- Consumes: `authCallbackUrl(origin: string): string`, `safeNextPath(value: unknown): string`, `authCookieSecret(): string | null`, `rememberAuthNextPath(origin, next, 'oauth', issuedAt, secret)`, `createClient().auth.signInWithOAuth(...)`
- Produces: `export type SocialAuthProvider = 'google' | 'apple' | 'kakao'`; `signInWithSocialAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState>`

- [ ] **Step 1: OAuth mock와 helper를 테스트 파일에 추가한다**

```ts
import {
  requestPasswordResetAction,
  signInWithSocialAction,
  signUpWithEmailAction,
} from './actions';

// mocks에 추가
signInWithOAuth: vi.fn(),

// createClient().auth에 추가
signInWithOAuth: mocks.signInWithOAuth,

function socialFormData(provider: string, next = '/community?sort=hot') {
  const data = new FormData();
  data.set('provider', provider);
  data.set('next', next);
  return data;
}
```

- [ ] **Step 2: allow-list, callback, cookie, 안전한 오류 테스트를 추가한다**

```ts
describe('signInWithSocialAction', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signInWithOAuth.mockReset();
    mocks.signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe' },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) {
      delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    } else {
      process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
    }
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it.each(['google', 'apple', 'kakao'])('starts %s OAuth with the trusted callback', async (provider) => {
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { provider, url: `https://provider.example/${provider}` },
      error: null,
    });

    await expect(signInWithSocialAction({}, socialFormData(provider))).rejects.toThrow(
      `NEXT_REDIRECT:https://provider.example/${provider}`,
    );
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: { redirectTo: 'https://iconsip.com/auth/callback' },
    });
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({
      next: '/community?sort=hot',
      purpose: 'oauth',
    });
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.options).toMatchObject({
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/auth/callback',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('rejects an unknown provider before calling Supabase', async () => {
    const state = await signInWithSocialAction({}, socialFormData('github'));
    expect(state.errors?.form).toBe('현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('normalizes an unsafe next path before signing it', async () => {
    mocks.signInWithOAuth.mockResolvedValueOnce({ data: { url: 'https://provider.example/google' }, error: null });
    await expect(signInWithSocialAction({}, socialFormData('google', 'https://evil.example'))).rejects.toThrow();
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({ next: '/' });
  });

  it('does not expose provider errors or set auth-next state when OAuth cannot start', async () => {
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { code: 'provider_disabled', message: 'private provider detail' },
    });
    const state = await signInWithSocialAction({}, socialFormData('google'));
    expect(state).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });
    expect(JSON.stringify(state)).not.toContain('private provider detail');
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)).toBeUndefined();
  });

  it('fails closed when Supabase or the signing secret is unavailable', async () => {
    mocks.isConfigured = false;
    expect(await signInWithSocialAction({}, socialFormData('google'))).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });
    mocks.isConfigured = true;
    delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    expect(await signInWithSocialAction({}, socialFormData('google'))).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});
```

OAuth describe 자체의 `afterEach`가 환경변수와 fake timer를 복구하게 한다.

- [ ] **Step 3: 집중 테스트가 export 부재로 실패하는지 확인한다**

Run: `npm test -- app/login/actions.test.ts`

Expected: `signInWithSocialAction` export 또는 OAuth mock 호출 assertion failure.

- [ ] **Step 4: provider parser와 Server Action을 구현한다**

```ts
export type SocialAuthProvider = 'google' | 'apple' | 'kakao';

const SOCIAL_AUTH_PROVIDERS = new Set<SocialAuthProvider>(['google', 'apple', 'kakao']);
const SOCIAL_AUTH_UNAVAILABLE_MESSAGE = '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';

function socialAuthProvider(value: FormDataEntryValue | null): SocialAuthProvider | null {
  return typeof value === 'string' && SOCIAL_AUTH_PROVIDERS.has(value as SocialAuthProvider)
    ? value as SocialAuthProvider
    : null;
}

export async function signInWithSocialAction(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const provider = socialAuthProvider(formData.get('provider'));
  if (!provider) return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };

  const { isConfigured } = getSupabaseConfig();
  const secret = authCookieSecret();
  if (!isConfigured || !secret) {
    return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };
  }

  const next = safeNextPath(formData.get('next'));
  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authCallbackUrl(origin) },
  });

  if (error || !data.url) {
    return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };
  }

  await rememberAuthNextPath(origin, next, 'oauth', Date.now(), secret);
  redirect(data.url);
}
```

Supabase가 URL을 정상 반환한 뒤에만 auth-next 쿠키를 기록해 실패한 시작 시도를 남기지 않는다. `redirect()`는 Next.js 16 문서대로 try/catch 밖에서 absolute URL에 호출한다.

- [ ] **Step 5: 집중 테스트 통과를 확인한다**

Run: `npm test -- app/login/actions.test.ts`

Expected: 기존 가입/재설정 테스트와 새 OAuth 테스트 모두 PASS.

---

### Task 3: 로그인 화면의 세 공급자 form

**Files:**
- Modify: `components/screens/Login.tsx:4-11,86-101,233-255`
- Test: `components/screens/Login.test.tsx:4-47`와 새 social form assertions

**Interfaces:**
- Consumes: `signInWithSocialAction`, `AuthActionState`, `next`, `isConfigured`
- Produces: reset이 아닌 모드에서 `provider=google|apple|kakao` submit button 세 개와 hidden `next`; `socialState.errors.form` alert

- [ ] **Step 1: social action mock과 상태를 컴포넌트 테스트에 추가한다**

```ts
const mocks = vi.hoisted(() => ({
  signInState: {} as Record<string, unknown>,
  signUpState: {} as Record<string, unknown>,
  resetState: {} as Record<string, unknown>,
  socialState: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  social: vi.fn(),
}));

vi.mock('@/app/login/actions', () => ({
  signInWithEmailAction: mocks.signIn,
  signUpWithEmailAction: mocks.signUp,
  requestPasswordResetAction: mocks.reset,
  signInWithSocialAction: mocks.social,
}));

// useActionState mock에 추가
if (action === mocks.social) return [mocks.socialState, vi.fn(), false];
```

기존 test `beforeEach`에도 `mocks.socialState = {};`를 추가해 test 간 action state를 격리한다.

- [ ] **Step 2: 세 submit value, next, disabled/error/reset 계약 테스트를 추가한다**

```ts
it('renders one social form with provider submit values and the preserved next path', () => {
  const html = render();
  expect(html).toContain('name="next" value="/community?sort=hot"');
  expect(html).toContain('name="provider" value="google"');
  expect(html).toContain('name="provider" value="apple"');
  expect(html).toContain('name="provider" value="kakao"');
  expect(html.match(/type="submit"/g)).toHaveLength(4);
});

it('disables all auth submits when Supabase is not configured', () => {
  const html = render({ isConfigured: false });
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});

it('shows a safe social error and omits social login in reset mode', () => {
  mocks.socialState = { errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' } };
  expect(render()).toContain('현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
  const resetHtml = render({ initialMode: 'reset' });
  expect(resetHtml).not.toContain('name="provider"');
  expect(resetHtml).not.toContain('Google로 계속하기');
});
```

- [ ] **Step 3: 집중 테스트가 inactive button 구조 때문에 실패하는지 확인한다**

Run: `npm test -- components/screens/Login.test.tsx`

Expected: `provider` submit values와 hidden `next`가 없어 FAIL.

- [ ] **Step 4: 별도 social action state와 단일 form을 구현한다**

```tsx
const [socialState, socialAction, socialPending] = useActionState(signInWithSocialAction, emptyState);
const formError = socialState.errors?.form ?? state.errors?.form ?? (state.message ? undefined : initialError);

{!isReset && (
  <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', color: 'var(--faint)' }}>또는</span>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
    </div>
    <form action={socialAction} className="col" style={{ gap: 9 }}>
      <input type="hidden" name="next" value={next} />
      <button type="submit" name="provider" value="google" disabled={!isConfigured || socialPending} style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#1F1F1F', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <span style={{ fontWeight: 700 }}>G</span> Google로 계속하기
      </button>
      <button type="submit" name="provider" value="apple" disabled={!isConfigured || socialPending} style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#fff', background: '#000', border: '1px solid rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        Apple로 계속하기
      </button>
      <button type="submit" name="provider" value="kakao" disabled={!isConfigured || socialPending} style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#191919', background: '#FEE500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
        <span style={{ fontWeight: 800 }}>K</span> 카카오로 계속하기
      </button>
    </form>
  </>
)}
```

social error는 기존 `role="alert"` 한 곳에서 우선 표시하여 중복 alert를 만들지 않는다.

- [ ] **Step 5: 집중 테스트 통과를 확인한다**

Run: `npm test -- components/screens/Login.test.tsx`

Expected: 기존 reset/signin 테스트와 새 social form 테스트 모두 PASS.

---

### Task 4: 공용 OAuth callback의 next 복귀

**Files:**
- Modify: `app/auth/callback/route.ts:37-54,74-117`
- Test: `app/auth/callback/route.test.ts:71,163-242`

**Interfaces:**
- Consumes: `AuthNextState`의 `purpose: 'oauth'`, Supabase `exchangeCodeForSession`, `getUser`, 기존 `isAccountSuspended`, `isOnboarded`, `onboardingPath`
- Produces: OAuth 신규 사용자는 `onboardingPath(oauthNext)`, 완료 사용자는 `oauthNext`, 취소/실패는 `authErrorLoginPath(code, oauthNext)`

- [ ] **Step 1: 테스트 cookie helper에 OAuth를 허용하고 성공·취소 테스트를 추가한다**

```ts
function signedCookie(purpose: 'signup' | 'oauth' | 'recovery', next = '/community?sort=hot') {
  return signedAuthNextCookieValue(next, purpose, Date.now(), SECRET);
}

it('sends a new OAuth user through onboarding with the original next path', async () => {
  mocks.getProfileForUser.mockResolvedValue({ ...completeProfile, onboarded_at: null });
  const response = await GET(request('/auth/callback?code=oauth-code', signedCookie('oauth')));
  expect(locationPath(response)).toBe('/onboarding?next=%2Fcommunity%3Fsort%3Dhot');
  expect(response.headers.get('set-cookie')).toContain(`${AUTH_NEXT_COOKIE_NAME}=;`);
});

it('returns an onboarded OAuth user to the original safe path', async () => {
  const response = await GET(request('/auth/callback?code=oauth-code', signedCookie('oauth')));
  expect(locationPath(response)).toBe('/community?sort=hot');
});

it('keeps OAuth cancellation on safe signin UX with the original next path', async () => {
  const response = await GET(request('/auth/callback?error=access_denied', signedCookie('oauth')));
  expect(locationPath(response)).toBe(
    '/login?mode=signin&auth_error=access_denied&next=%2Fcommunity%3Fsort%3Dhot',
  );
});
```

- [ ] **Step 2: 집중 테스트가 OAuth next를 `/`로 잃어 실패하는지 확인한다**

Run: `npm test -- app/auth/callback/route.test.ts`

Expected: OAuth onboarding/return/error 경로 중 적어도 하나가 `/community?sort=hot`을 보존하지 못해 FAIL.

- [ ] **Step 3: signup 전용 이름을 일반 로그인 next로 바꾸고 OAuth를 포함한다**

```ts
const loginNext = queryNext !== null
  ? safeNextPath(queryNext)
  : signedState?.purpose === 'signup' || signedState?.purpose === 'oauth'
    ? signedState.next
    : fallbackNext;

return {
  fallbackNext,
  loginNext,
  recoveryNext: signedState?.purpose === 'recovery' ? signedState.next : '/',
  signedState,
};
```

`GET()`의 모든 비-recovery `state.signupNext` 참조를 `state.loginNext`로 바꾼다. code exchange, `getUser()`, suspension, onboarding, cookie clear 로직은 변경하지 않는다.

- [ ] **Step 4: 집중 테스트 통과를 확인한다**

Run: `npm test -- app/auth/callback/route.test.ts`

Expected: 기존 signup/recovery와 새 OAuth 테스트 모두 PASS.

---

### Task 5: 코드 전체 회귀 검증

**Files:**
- Verify only: Task 1~4의 코드와 테스트

**Interfaces:**
- Consumes: Task 1~4의 모든 public contract
- Produces: 외부 공급자 설정 전에 독립적으로 검증된 앱 OAuth 배선

- [ ] **Step 1: 관련 테스트를 한 번에 실행한다**

Run:

```bash
npm test -- \
  lib/auth/recovery.server.test.ts \
  app/login/actions.test.ts \
  components/screens/Login.test.tsx \
  app/auth/callback/route.test.ts
```

Expected: 네 파일 모두 PASS.

- [ ] **Step 2: 전체 테스트와 lint를 실행한다**

Run: `npm test && npm run lint`

Expected: exit code 0. 실패하면 새 변경으로 인한 회귀인지 기존 실패인지 정확한 test/lint 항목을 분리한다.

- [ ] **Step 3: production 환경 사전검사를 포함한 build를 실행한다**

Run: `npm run build`

Expected: exit code 0. 로컬 환경변수 부족으로 `prebuild`가 실패하면 누락된 변수 이름만 기록하고 비밀값은 출력하지 않는다.

---

### Task 6: ICONS 전용 외부 OAuth 앱과 Supabase provider 설정

**Files:**
- External state: Google Cloud Console, Kakao Developers, Apple Developer, Supabase Dashboard
- Modify after live verification: `docs/superpowers/specs/2026-07-22-social-login-oauth-design.md`의 Apple 현재 상태

**Interfaces:**
- Consumes: Supabase callback `https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback`; production domain `iconsip.com`; production Supabase Auth provider fields
- Produces: Supabase의 Google·Kakao·Apple provider Enabled와 ICONS 전용 자격 증명

- [ ] **Step 1: Chrome에서 현재 로그인 세션과 새 Apple 계정의 Program membership를 읽기 전용으로 확인한다**

Expected: Apple Developer account에 Program membership와 Identifiers/Keys 접근 권한이 표시된다. 여전히 가입/결제 화면이면 구매하지 않고 정확한 차단 상태를 보고한다.

- [ ] **Step 2: Google Cloud에 ICONS 전용 project·Auth Platform·Web client를 만든다**

Exact configuration:

```text
Project / app name: ICONS
OAuth client name: ICONS Web
Authorized JavaScript origins:
  https://iconsip.com
  https://www.iconsip.com
Authorized redirect URI:
  https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback
Scopes: openid, email, profile
```

Grapit project id `grapit-491806`은 선택하거나 수정하지 않는다. 법무 URL을 요구하지만 실제 공개 URL이 없으면 허위 값을 저장하지 않고 심사 차단으로 기록한다.

- [ ] **Step 3: Google client id/secret을 production Supabase Google provider에 브라우저 내부에서 옮겨 저장하고 Enabled로 전환한다**

Expected: Supabase Google provider가 Enabled로 표시된다. secret은 채팅·터미널·클립보드 출력에 노출하지 않는다.

- [ ] **Step 4: Kakao Developers에 새 ICONS app을 만든다**

Exact configuration:

```text
App name: ICONS
Representative domain: https://iconsip.com
Company name: 현재 Kakao Business 계정에 등록된 실제 상호/법인/단체명
Redirect URI: https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback
```

화면에서 실제 회사명을 확인할 수 없으면 생성 submit 직전에만 사용자에게 정확한 회사명을 질문한다. App icon이 필수라면 저장소의 기존 정사각형 ICONS 앱 아이콘을 사용하고, 없으면 임의 로고를 만들지 않고 차단으로 기록한다.

- [ ] **Step 5: Kakao Login, REST API key, Client Secret Code, account_email 동의를 구성한다**

Kakao Login을 ON으로 하고 Client Secret Code를 생성·활성화한다. `account_email`을 필수 동의로 설정할 권한이 있을 때만 진행한다. Biz App 권한 부족으로 필수 동의가 불가능하면 email optional이나 별도 이메일 수집을 임의 활성화하지 않고 출시 차단으로 기록한다.

- [ ] **Step 6: Kakao REST API key/secret을 production Supabase Kakao provider에 브라우저 내부에서 옮겨 저장하고 Enabled로 전환한다**

Expected: Supabase Kakao provider가 Enabled로 표시된다. key/secret 값을 출력하지 않는다.

- [ ] **Step 7: Apple Developer에 ICONS용 primary App ID, Services ID, Sign in with Apple key를 만든다**

Exact web configuration:

```text
Primary App ID description: ICONS
Services ID description: ICONS Web
Domain: iconsip.com
Return URL: https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback
Key description: ICONS Sign in with Apple
```

Apple console이 요구하는 identifier 문자열은 기존 계정의 reverse-DNS namespace를 확인해 ICONS 전용으로 충돌 없이 정한다. `.p8`은 1회 다운로드 후 로컬 저장 위치를 사용자에게만 알려주고 내용을 열거나 출력하지 않는다.

- [ ] **Step 8: Team ID, Key ID, Services ID, `.p8`로 최대 6개월 Apple client secret을 생성한다**

Repository 파일이나 shell history에 `.p8` 원문과 secret을 남기지 않는 일회성 안전 경로를 사용한다. 생성 전후로 secret 값은 출력하지 않고 만료일만 기록한다.

- [ ] **Step 9: Apple client id/secret을 production Supabase Apple provider에 브라우저 내부에서 옮겨 저장하고 Enabled로 전환한다**

Expected: Supabase Apple provider가 Enabled로 표시되고 `.p8` 원문은 Supabase에 직접 저장하지 않는다.

- [ ] **Step 10: 세 provider의 Enabled 상태와 callback 일치를 읽기 전용으로 재확인한다**

Expected: Google, Kakao, Apple 모두 Enabled이며 callback이 정확히 production Supabase callback이다. 값은 마스킹된 상태로만 확인한다.

---

### Task 7: 운영 문서 갱신

**Files:**
- Modify: `README.md:15,58-75,129-135`
- Modify: `docs/ARCHITECTURE.md`의 Auth/OAuth 상태 섹션
- Modify: `docs/PRD.md:50-54,91-98`
- Modify: `docs/launch-readiness-plan.md:38-39,61-66`
- Modify: `docs/superpowers/specs/2026-07-22-social-login-oauth-design.md:13-26`

**Interfaces:**
- Consumes: Task 1~6의 실제 구현·provider Enabled 결과·Apple secret 만료일
- Produces: callback, 콘솔 위치, 비밀 취급, Apple 6개월 교체 절차와 미완료 gate가 현재 상태와 일치하는 문서

- [ ] **Step 1: README의 비활성 문구를 실제 provider 상태와 운영 절차로 바꾼다**

README에 아래 사실을 명시한다.

```text
- Google, Kakao, Apple 로그인은 Supabase 관리형 OAuth와 공용 /auth/callback을 사용한다.
- Provider console redirect URI는 https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback 이다.
- Google: Google Auth Platform의 ICONS / ICONS Web client.
- Kakao: Kakao Developers의 ICONS app, Kakao Login, REST API key, Client Secret Code.
- Apple: Apple Developer의 ICONS App ID / Services ID / Sign in with Apple key.
- 공급자 secret과 .p8은 저장소·문서·로그에 기록하지 않는다.
- Apple client secret은 기록된 만료일 전에, 늦어도 6개월마다 교체한다.
```

- [ ] **Step 2: ARCHITECTURE와 PRD를 실제 배선 상태로 바꾼다**

`docs/ARCHITECTURE.md`에는 Server Action → Supabase provider → 공용 callback → `getUser()` → suspension/onboarding/next 흐름과 signed OAuth cookie 10분 수명을 기록한다. `docs/PRD.md`의 “비활성 UI”·“현재 구현은 이메일/PW까지” 문구는 세 provider 연결 완료로 바꾸되, 외부 콘솔에서 끝내지 못한 provider가 있으면 그 provider만 명시적으로 미완료로 남긴다.

- [ ] **Step 3: 출시 준비 문서를 실제 provider 결과와 맞춘다**

세 provider가 모두 Enabled이고 smoke 가능한 경우에만 #17의 “무동작/human gate”를 완료 상태로 바꾼다. 한 provider라도 외부 심사·권한·법무 URL·email 동의 때문에 막히면 해당 gate와 이유를 그대로 유지한다.

- [ ] **Step 4: 설계 문서의 Apple 계정 현재 상태를 live verification 결과로 갱신한다**

미가입 계정이라는 문장을 Program 가입 계정 확인 결과와 생성 가능 여부로 교체한다. 확인되지 않은 membership를 완료로 쓰지 않는다.

- [ ] **Step 5: 문서 placeholder와 diff whitespace를 확인한다**

Run:

```bash
rg -n 'T[B]D|T[O]DO|implement[[:space:]]+later|추후[[:space:]]+입력' \
  README.md docs/ARCHITECTURE.md docs/PRD.md docs/launch-readiness-plan.md \
  docs/superpowers/specs/2026-07-22-social-login-oauth-design.md
git diff --check
```

Expected: placeholder 검색 결과 없음, `git diff --check` exit code 0.

---

### Task 8: 최종 로컬·브라우저 검증과 범위 확인

**Files:**
- Verify only: 전체 repository diff, production provider UI, production login UI

**Interfaces:**
- Consumes: Task 1~7 결과
- Produces: 로컬 구현 검증 결과와 배포 전 남은 정확한 gate

- [ ] **Step 1: fresh 전체 검증을 다시 실행한다**

Run: `npm test && npm run lint && npm run build`

Expected: 세 명령 모두 exit code 0. 성공 주장에는 이 fresh output만 사용한다.

- [ ] **Step 2: 변경 범위와 사용자 파일 보존을 확인한다**

Run:

```bash
git diff --check
git diff --stat
git status --short --branch
```

Expected: `ps/feat/social-login-oauth`에서 계획된 코드·테스트·문서와 기존 `.claude/`만 보인다. staging/commit은 하지 않는다.

- [ ] **Step 3: production login 화면의 현재 상태를 읽기 전용으로 확인한다**

현재 branch를 배포하지 않았으므로 production 버튼은 기존 무동작 상태일 수 있다. push/PR/merge/deploy 없이 production smoke 완료를 주장하지 않는다.

- [ ] **Step 4: provider console 자체 검증 범위와 배포 후 smoke 범위를 분리해 보고한다**

현재 세션에서 보고할 항목:

```text
완료: 로컬 OAuth 코드/테스트/문서, provider 앱 생성, Supabase provider Enabled 상태
미실행: branch publish, PR, merge, GitHub Actions, Vercel production deploy, production 신규/기존/취소 smoke
다음 승인 필요: commit/push/PR/merge 및 production 배포 경로
```

GitHub Issue #17 comment/close와 Project Done도 publish·merge·production 검증 범위가 승인될 때까지 수행하지 않는다.
