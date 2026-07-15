# Profile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인·온보딩 완료 사용자가 `/settings`에서 중복 없는 닉네임과 private Storage 아바타를 편집하게 한다.

**Architecture:** 순수 `lib/profile.ts`가 입력·경로 계약을 소유하고, 기존 settings Server Action이 세션/RLS 아래에서 Storage 업로드와 profile update를 조정한다. DB에는 정규화 닉네임 unique index만 추가하며, Server Component가 signed URL을 만들어 client UI에 전달한다.

**Tech Stack:** Next.js 16 App Router/Server Actions, React 19 `useActionState`, Supabase Auth/Postgres/Storage/RLS, Vitest, SQL smoke, Tailwind v4 + 기존 inline screen 패턴.

## Global Constraints

- 닉네임은 Unicode를 허용하고 trim 후 1~30자다.
- 아바타는 JPEG/PNG/WebP, 5MB 이하이고 서버가 `<uid>/profile/<uuid>.<ext>`를 만든다.
- 브라우저 입력에서 user id나 Storage path를 받지 않는다.
- 요청 시작 시 auth profile의 `avatar_path`를 안전한 이전 객체 경로로 캡처한다.
- DB 실패 시 신규 업로드를 제거하고, 성공 후에는 캡처한 이전 경로가 안전할 때 그 객체 하나만 best-effort로 제거한다. 폴더를 list하거나 나중의 동시 요청이 만든 다른 객체를 삭제하지 않는다. 정리 실패는 프로필 저장을 되돌리지 않으며 고아 객체는 후속 운영 정리를 위해 남을 수 있다.
- 이메일 read-only, required consent, 마케팅 동의 동작을 유지한다.
- 신규 migration은 immutable이고 shared migration을 수정하지 않는다.
- 회원 탈퇴 #102/#137과 커뮤니티 avatar 노출은 제외한다.

---

### Task 1: 프로필 입력 계약과 DB 유일성

**Files:**
- Create: `lib/profile.test.ts`
- Create: `lib/profile.ts`
- Create: `supabase/migrations/20260715040001_profile_editing.sql`
- Create: `supabase/tests/profile_editing.sql`
- Modify: `.github/workflows/pipeline.yml`

**Interfaces:**
- Produces: `normalizeProfileForm(formData): ProfileFormResult`
- Produces: `buildProfileAvatarPath({ userId, mimeType, nonce }): string`
- Produces: `profileAvatarFolder(userId): string`
- Produces: `isProfileAvatarPathForUser(path, userId): boolean`

- [ ] **Step 1: Write failing pure-contract tests**

Cover exact cases in `lib/profile.test.ts`:

```ts
expect(normalizeProfileForm(profileForm({ nickname: '  새닉네임  ' }))).toEqual({
  ok: true,
  value: { nickname: '새닉네임', avatar: null },
});
expect(normalizeProfileForm(profileForm({ nickname: '   ' }))).toEqual({
  ok: false,
  errors: { nickname: '닉네임을 입력해주세요.' },
});
expect(normalizeProfileForm(profileForm({ nickname: '가'.repeat(31) }))).toEqual({
  ok: false,
  errors: { nickname: '닉네임은 30자 이하로 입력해주세요.' },
});
expect(normalizeProfileForm(profileForm({ nickname: 'fan', avatar: new File(['x'], 'a.svg', { type: 'image/svg+xml' }) })).toEqual({
  ok: false,
  errors: { avatar: '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.' },
});
expect(buildProfileAvatarPath({ userId: 'user-1', mimeType: 'image/png', nonce: 'asset-1' }))
  .toBe('user-1/profile/asset-1.png');
expect(isProfileAvatarPathForUser('user-1/profile/asset-1.png', 'user-1')).toBe(true);
expect(isProfileAvatarPathForUser('user-2/profile/asset-1.png', 'user-1')).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npx vitest run lib/profile.test.ts`  
Expected: FAIL because `@/lib/profile` does not exist.

- [ ] **Step 3: Implement the pure contract**

`lib/profile.ts` must export these exact values and types:

```ts
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

export type ProfileFormResult =
  | { ok: true; value: { nickname: string; avatar: File | null } }
  | { ok: false; errors: { nickname?: string; avatar?: string } };

export function normalizeProfileForm(formData: FormData): ProfileFormResult;
export function profileAvatarFolder(userId: string): string;
export function buildProfileAvatarPath(input: { userId: string; mimeType: string; nonce: string }): string;
export function isProfileAvatarPathForUser(path: string | null | undefined, userId: string): boolean;
```

Use a fixed MIME→extension map for `image/jpeg`, `image/png`, `image/webp`. Treat a zero-byte `File` as no new avatar; reject unsupported MIME or files over the maximum.

- [ ] **Step 4: Run the focused test and verify green**

Run: `npx vitest run lib/profile.test.ts`  
Expected: 1 test file passes with all normalization/path cases.

- [ ] **Step 5: Add normalized DB uniqueness and SQL smoke**

Migration requirements:

```sql
do $$
begin
  if exists (
    select lower(btrim(nickname))
    from public.profiles
    where nickname is not null
    group by lower(btrim(nickname))
    having count(*) > 1
  ) then
    raise exception using message = 'profiles contain normalized nickname conflicts';
  end if;
end;
$$;

create unique index profiles_nickname_normalized_unique_idx
  on public.profiles (lower(btrim(nickname)))
  where nickname is not null;
```

`supabase/tests/profile_editing.sql` must create two Auth/profile rows in a transaction, prove `FanName` then ` fanname ` raises `unique_violation`, prove user A cannot update user B under authenticated RLS, prove self nickname/avatar update succeeds, and assert `public_profiles` received both fields. End with `rollback`.

Add this exact CI command after the catalog smoke:

```bash
docker exec -i supabase_db_icons-ip psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_editing.sql
```

- [ ] **Step 6: Apply reset and smoke locally**

Run:

```bash
supabase db start
supabase db reset --local --no-seed
docker exec -i supabase_db_icons-ip psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_editing.sql
```

Expected: migration applies and every assertion completes with exit 0.

- [ ] **Step 7: Commit the contract**

```bash
git add lib/profile.ts lib/profile.test.ts supabase/migrations/20260715040001_profile_editing.sql supabase/tests/profile_editing.sql .github/workflows/pipeline.yml
git commit -m "feat(account): 프로필 입력 계약을 추가"
```

### Task 2: 세션 기반 프로필 저장 orchestration

**Files:**
- Modify: `lib/auth/onboarding.ts`
- Modify: `lib/auth/server.ts`
- Modify: `app/settings/actions.test.ts`
- Modify: `app/settings/actions.ts`

**Interfaces:**
- Consumes: Task 1 profile normalizer/path helpers.
- Produces: `updateProfileAction(state, formData): Promise<SettingsActionState>`.
- Extends: `ProfileForOnboarding.avatar_path?: string | null`.

- [ ] **Step 1: Extend action tests with Storage and profile-update mocks**

Add cases that assert:

```ts
await expect(updateProfileAction({}, profileForm('  new fan  '))).resolves.toEqual({
  message: '프로필을 저장했어요.',
});
expect(mocks.update).toHaveBeenCalledWith({ nickname: 'new fan' });
```

For an image, assert upload uses a server-generated `user-1/profile/...png` path, `{ contentType: 'image/png', upsert: false }`, and profile update includes that path. Add exact cases for config/auth/onboarding redirects, invalid input before writes, upload error, `23505` nickname error, and DB error removing the new path. On success, assert the request-start `avatar_path` is the only removal target, Storage `list` is never called, an unrelated object created by a later concurrent request is never removed, an unsafe path is ignored, and cleanup rejection still returns profile-save success. Keep all existing marketing tests green.

- [ ] **Step 2: Run the focused action test and verify red**

Run: `npx vitest run app/settings/actions.test.ts`  
Expected: FAIL because `updateProfileAction` and avatar auth data do not exist.

- [ ] **Step 3: Extend auth profile reads**

Add `avatar_path?: string | null` to `ProfileForOnboarding`, `avatar_path: string | null` to the internal row, and change the Supabase select to:

```ts
.select('email,nickname,birth_date,avatar_path,consents,onboarded_at,role')
```

- [ ] **Step 4: Implement `updateProfileAction`**

Reuse a small private `requireSettingsAuth()` for the same config/login/onboarding gates as marketing without changing redirect strings. The Action must:

```ts
const normalized = normalizeProfileForm(formData);
if (!normalized.ok) return { errors: normalized.errors };

const avatarPath = avatar
  ? buildProfileAvatarPath({ userId: auth.user.id, mimeType: avatar.type, nonce: crypto.randomUUID() })
  : null;
```

Capture `auth.profile?.avatar_path` as `previousAvatarPath` at request start. Upload first when present, update `{ nickname, ...(avatarPath ? { avatar_path: avatarPath } : {}) }`, map `23505` to `errors.nickname`, and remove the new path on DB failure. After success, only when `previousAvatarPath` belongs to the authenticated user's profile folder and differs from the new path, best-effort `remove([previousAvatarPath])`. Never list the folder or delete unrelated objects that a later concurrent request may have created. Cleanup failure must not undo the profile save and may leave an orphan for later operational cleanup. Revalidate `/settings`, `/`, `/community`, `/search`.

- [ ] **Step 5: Run focused tests and verify green**

Run: `npx vitest run lib/profile.test.ts app/settings/actions.test.ts`  
Expected: both files pass, including existing marketing consent cases.

- [ ] **Step 6: Commit the orchestration**

```bash
git add lib/auth/onboarding.ts lib/auth/server.ts app/settings/actions.ts app/settings/actions.test.ts
git commit -m "feat(account): 프로필 저장 경로를 연결"
```

### Task 3: Settings avatar/nickname UI and signed preview

**Files:**
- Create: `components/screens/Settings.test.tsx`
- Create: `app/settings/page.test.tsx`
- Modify: `components/screens/Settings.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `updateProfileAction`, `PROFILE_IMAGE_ACCEPT`, `auth.profile.avatar_path`.
- `Settings` adds prop `avatarUrl: string | null` without changing existing props.

- [ ] **Step 1: Write failing Settings component tests**

Mock `useActionState` by action identity and render static markup. Assert:

```ts
expect(html).toContain('action=');
expect(html).toContain('name="nickname"');
expect(html).toContain('name="avatar"');
expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
expect(html).toContain('프로필 저장');
expect(html).toContain('변경사항 저장');
expect(html).toContain('src="https://signed.example/avatar.png"');
```

Render with `avatarUrl={null}` and assert the nickname first character appears in the fallback. Inject profile error/message and marketing error/message independently and assert each stays inside its own form status region.

- [ ] **Step 2: Write failing Settings page tests**

Mock auth, redirect, Supabase Storage signed URL, and `Settings`. Assert unauthenticated and onboarding redirects retain exact paths. For an avatar path, assert:

```ts
expect(mocks.createSignedUrl).toHaveBeenCalledWith('user-1/profile/avatar.png', 3600);
expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({
  avatarUrl: 'https://signed.example/avatar.png',
}));
```

On signing error, expect `avatarUrl: null` and no page throw.

- [ ] **Step 3: Run the UI/page tests and verify red**

Run: `npx vitest run components/screens/Settings.test.tsx app/settings/page.test.tsx`  
Expected: FAIL because editable profile UI and signed preview are absent.

- [ ] **Step 4: Implement the two independent forms**

Add a profile `useActionState(updateProfileAction, emptyState)`, avatar circle with `<img alt="프로필 아바타">` or fallback initial, editable nickname input, file input, field errors, and profile submit button. Keep marketing `useActionState(updateMarketingConsentAction, emptyState)` and existing required-consent copy unchanged.

In the page, use the authenticated Supabase server client to call `createSignedUrl(auth.profile.avatar_path, 3600)` and pass its URL only when no error. Update metadata description to include profile editing.

Set the documented Next 16 option:

```ts
experimental: {
  serverActions: { bodySizeLimit: '6mb' },
},
```

- [ ] **Step 5: Run UI/page/action tests and verify green**

Run: `npx vitest run components/screens/Settings.test.tsx app/settings/page.test.tsx app/settings/actions.test.ts lib/profile.test.ts`  
Expected: all focused files pass.

- [ ] **Step 6: Commit the UI**

```bash
git add components/screens/Settings.tsx components/screens/Settings.test.tsx app/settings/page.tsx app/settings/page.test.tsx next.config.ts
git commit -m "feat(account): 프로필 편집 화면을 완성"
```

### Task 4: Documentation and complete verification

**Files:**
- Modify: `DESIGN.md`
- Modify: `docs/launch-readiness-plan.md`

**Interfaces:**
- Documents the shipped #136 surface and the #102/#137 split.

- [ ] **Step 1: Update durable documentation**

In `DESIGN.md`, state that Settings has separate profile and consent forms, a circular signed-image avatar, and nickname-initial fallback. In `docs/launch-readiness-plan.md`, replace the combined #102 text with `#102 [human] 탈퇴 보존 정책`, `#136 프로필 편집`, and `#137 탈퇴 실행(Blocked by #102)` without claiming completion before merge.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm test
npm run lint
npm run build
supabase db reset --local --no-seed
docker exec -i supabase_db_icons-ip psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_editing.sql
supabase db lint --local --level warning
```

Expected: 0 test failures, lint exit 0, production build exit 0, migration/smoke exit 0, DB lint without new warnings.

- [ ] **Step 3: Review changed scope and secrets**

Run:

```bash
git status --short
git diff --check
git diff main...HEAD --stat
git diff main...HEAD -- . ':!package-lock.json' | rg -n 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_|eyJ[A-Za-z0-9_-]{20,}'
```

Expected: only intended files, no whitespace errors, and the secret scan returns no matches.

- [ ] **Step 4: Commit documentation**

```bash
git add DESIGN.md docs/launch-readiness-plan.md
git commit -m "docs(account): 프로필 편집 운영 상태를 반영"
```

- [ ] **Step 5: Browser QA**

Run local Next/Supabase, create a temporary confirmed user, complete onboarding, and verify desktop plus 390px mobile: current fallback, nickname save, 5MB-bounded image upload, second image replacement, refreshed signed preview, and unchanged marketing toggle. Remove the temporary Auth user and owned Storage objects afterward.
