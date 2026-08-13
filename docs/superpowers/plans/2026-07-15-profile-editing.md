# Profile Editing Direct-Upload Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every implementation task follows red → green → focused verification → exact-path commit.

**Goal:** 로그인·온보딩 완료 사용자가 `/settings`에서 1~30 grapheme 닉네임과 5MiB private Storage 아바타를 편집하게 한다.

**Architecture:** 브라우저가 로그인 세션의 standard upload로 Supabase Storage에 파일을 직접 올리고, Server Action은 작은 metadata/path만 처리한다. prepare Action은 service-only `pending` claim을 먼저 남기고 path만 반환한다. Storage RLS는 실제 upload 시점에 claim과 account write fence를 다시 평가한다. 최종 Action은 저장 객체의 metadata와 magic bytes를 검증한 뒤 service-role-only RPC로 profile 행과 claim을 잠그고 1회만 갱신한다. Settings와 onboarding은 같은 닉네임 validator를 사용한다.

**Tech Stack:** Next.js 16 App Router/Server Actions, React 19, Supabase Auth/Postgres/Storage/RLS, Vitest, SQL smoke, local Supabase CLI.

**Current Status:** Tasks 1~7의 branch 구현·local browser QA·independent review는 완료됐다. Task 8의 PR/CI/merge/production proof가 남았으며, #136 issue와 Project item은 아직 완료 상태가 아니다.

## Global Constraints

- 닉네임은 trim 후 1~30 Unicode grapheme이고 raw ceiling은 512 UTF-16 code units다.
- grapheme iterator는 31번째에서 즉시 중단한다.
- 아바타는 JPEG/PNG/WebP, `1..5 * 1024 * 1024` bytes다.
- 파일 바이트는 Server Action FormData에 절대 포함하지 않는다.
- 서버가 `<uid>/profile/<lowercase UUID v4>.<ext>` 경로를 만든다.
- 최종 Action은 Storage metadata와 실제 magic bytes를 검증한다.
- authenticated Data API의 nickname/avatar 직접 update를 금지하고 service-role-only RPC를 사용한다.
- RPC는 row lock 뒤 같은 사용자의 `pending` claim만 소비하고 실제 이전 avatar path를 반환한다. replay·unknown transport는 candidate cleanup을 허용하지 않는다.
- Storage INSERT도 같은 사용자의 strict profile path와 `pending` claim을 함께 요구한다. 기존 community strict path 업로드는 유지한다.
- DB가 cleanup-safe 전이를 확정한 exact path 하나만 service client로 cleanup하고 resolved error와 rejection을 모두 처리한다.
- 이메일 read-only, birth date·consents·follow·onboarding completion, 마케팅 동의를 유지한다.
- 회원 탈퇴 #102/#137, community 대용량 upload 개선, abandoned upload cron은 제외한다.

---

### Task 1: 공용 닉네임·아바타 순수 계약

**Files:**

- Modify: `lib/profile.test.ts`
- Modify: `lib/profile.ts`

**Produces:**

- `normalizeProfileNickname(raw)`
- `normalizeProfileImageMetadata({ mimeType, size })`
- `buildProfileAvatarPath({ userId, mimeType, nonce })`
- `parseProfileAvatarPath(raw, userId)`
- `matchesProfileImageMagicBytes(bytes, mimeType)`
- `profileAvatarInitial(nickname)`

- [x] Write failing tests for empty/trimmed nickname, 30/31 graphemes, 30 long family-ZWJ emoji, raw 513 code units, and early exit before expensive segmentation.
- [x] Write failing metadata tests for zero, non-integer, exact 5MiB, 5MiB+1, unsupported MIME.
- [x] Write strict path tests for exact user ID, lowercase UUID v4, MIME/extension match, traversal, uppercase UUID, wrong version and wrong user.
- [x] Write JPEG/PNG/WebP signature and mismatch tests plus `I` fallback initial.
- [x] Run `npx vitest run lib/profile.test.ts` and confirm red.
- [x] Implement the minimal pure helpers. Never materialize all grapheme segments into an array.
- [x] Run the focused test and confirm green.
- [x] Stage exact files and commit `feat(account): 프로필 검증 계약을 강화`.

### Task 2: DB/RPC·Storage trust boundary

**Files:**

- Modify: `supabase/migrations/20260715040001_profile_editing.sql`
- Modify: `supabase/tests/profile_editing.sql`
- Modify: `supabase/config.toml`
- Modify if needed: `.github/workflows/pipeline.yml`

**Migration contract:**

- Fail closed on normalized nickname conflicts, blank/untrimmed/over-raw-bound nickname, and legacy invalid avatar paths.
- Add nickname and strict row-owned avatar path CHECK constraints.
- ECMAScript `String.trim()`의 WhiteSpace·LineTerminator 문자 집합을 명시한 `btrim`을 preflight, CHECK, normalized partial unique index에 동일 적용한다.
- Revoke only authenticated `UPDATE(nickname, avatar_path)`; preserve unrelated profile columns.
- Create service-only prepare/reject/finalize RPCs and a durable `profile_avatar_claims` ledger. Seed existing non-null avatar paths as `active`.
- Finalize RPC is `SECURITY DEFINER`, uses a fixed safe search path and schema-qualified relations, locks the profile row and pending claim, updates atomically, and returns structured `applied/error_code/cleanup_safe/previous_avatar_path` fields.
- Mark a candidate `rejected` on known failure and authorize cleanup only after that exact transition succeeds; replay and transport exceptions remain cleanup-unsafe. Mark the previous claim `retired` on success.
- Revoke execute from `public`, `anon`, `authenticated`, `service_role`, then grant only `service_role`.
- Set `user-uploads` to 5MiB with JPEG/PNG/WebP/GIF. GIF remains for existing community uploads.
- Replace Storage INSERT policy with same-user strict profile UUID path + `pending` claim, or the existing same-user strict community UUID path.
- Replace Storage DELETE policy so authenticated users retain owned non-profile/community cleanup but cannot delete any `profile/*` object; profile cleanup is service-only.

- [x] Write or revise SQL smoke first: ECMAScript trim constraints/normalized duplicate, direct authenticated nickname/avatar denial, other-user denial, first finalize/replay, known-failure exactly-once cleanup, previous retirement, nickname-only flow, RPC/table ACL, exact bucket settings, and actual Storage INSERT RLS behavior(unclaimed·active 거부, pending·community 허용) plus DELETE/catalog contracts.
- [x] Run SQL smoke against the current schema and confirm the new assertions fail.
- [x] Implement the draft migration and per-bucket limits. Local config and pipeline needed no additional change beyond the existing smoke command.
- [x] Run:

```bash
supabase db reset --local --no-seed
docker exec -i supabase_db_icons-ip psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_editing.sql
supabase db lint --local --level warning
```

- [x] Confirm no new DB lint warning. The pre-existing `refund_ticket_order` unused `p_reason` warning remains recorded separately.
- [x] Stage exact files and commit `feat(account): 프로필 저장 경계를 봉인`.

### Task 3: server profile orchestration과 onboarding 공용 validator

**Files:**

- Create: `lib/profile.server.ts`
- Create: `lib/profile.server.test.ts`
- Modify: `app/onboarding/actions.test.ts`
- Modify: `app/onboarding/actions.ts`

**Produces:**

- A server-only identity update helper that calls the service RPC.
- Exact-path profile cleanup through the service client with a validated service-only `audit_log` RPC fallback.
- Onboarding nickname validation and nickname-only service RPC connection.

- [x] Write failing server-helper tests for prepare/reject/finalize mappings, previous path return, cleanup-safe `23505`, replay/transport cleanup denial, service-only remove, and audit fallback without raw error text.
- [x] Write failing onboarding tests for 30/31 graphemes and raw 513 rejection before DB calls.
- [x] Run focused tests and confirm red.
- [x] Implement the minimal helper. Do not expose the service credential or raw provider errors.
- [x] Update onboarding to use the shared nickname validator and service identity RPC for nickname while preserving existing birth date, consent, follow and completion order.
- [x] Run:

```bash
npx vitest run lib/profile.server.test.ts app/onboarding/actions.test.ts lib/profile.test.ts
```

- [x] Stage exact files and commit `feat(account): 프로필 서버 저장을 연결`.

### Task 4: upload claim 준비와 final Action

**Files:**

- Modify: `app/settings/actions.test.ts`
- Modify: `app/settings/actions.ts`
- Modify: `next.config.ts`

**Produces:**

- `prepareProfileAvatarUploadAction({ nickname, mimeType, size })`
- `updateProfileAction(state, formData)` accepting nickname and optional path only.

- [x] Rewrite action tests around prepare/finalize. Assert no server Storage `upload()` and no file object in final payload.
- [x] Cover config/login/onboarding gates, claim-before-path ordering, path-only response, exact-user path rejection before Storage reads, `info()` size/contentType, `download()` signature, uniqueness, exactly-once candidate cleanup, replay/unknown cleanup denial and previous-path cleanup.
- [x] Assert cleanup resolved error and rejection both trigger the safe fallback but preserve successful profile state.
- [x] Run `npx vitest run app/settings/actions.test.ts` and confirm red.
- [x] Implement prepare and final Actions with small inputs only.
- [x] Remove any `experimental.serverActions.bodySizeLimit` override from `next.config.ts`.
- [x] Run focused action/server/pure tests and confirm green.
- [x] Stage exact files and commit `feat(account): 아바타 direct upload를 연결`.

### Task 5: browser direct-upload helper와 Settings UI

**Files:**

- Create: `lib/profile-upload.client.ts`
- Create: `lib/profile-upload.client.test.ts`
- Modify: `components/screens/Settings.test.tsx`
- Modify: `components/screens/Settings.tsx`
- Modify: `app/settings/page.test.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/globals.css`

**UI contract:**

- File input has no `name`; FormData cannot include file bytes.
- Browser helper calls prepare then authenticated `upload(path, file, { contentType, upsert: false })`; no signed upload token is minted.
- Final FormData contains only nickname and optional `avatarPath` string.
- `busy = uploadPending || finalPending` blocks duplicate submission.
- Upload and marketing form statuses remain independent.
- Page computes `avatarInitial` server-side; client does not recompute with `Intl`.
- Inputs and buttons expose visible cyan keyboard focus rings.

- [x] Write failing helper tests proving the file is sent only to authenticated Storage `upload` and prepare receives metadata, not bytes.
- [x] Write failing Settings tests for nameless file input, final path-only FormData, direct-upload failure, pending state, independent forms, signed avatar/fallback `I`, and focus classes.
- [x] Write failing page tests for server-computed initial, 3600-second signed preview, and signing-error fallback.
- [x] Run focused tests and confirm red.
- [x] Implement helper, UI, page and minimal CSS.
- [x] Run:

```bash
npx vitest run lib/profile-upload.client.test.ts components/screens/Settings.test.tsx app/settings/page.test.tsx app/settings/actions.test.ts
```

- [x] Stage exact files and commit `feat(account): 프로필 편집 화면을 direct upload로 전환`.

### Task 6: 문서와 전체 검증

**Files:**

- Modify: `DESIGN.md`
- Modify: `docs/launch-readiness-plan.md`
- Modify: this design and plan only if implementation truth changed.

- [x] Ensure durable docs describe separate profile/consent forms, browser authenticated direct upload, final metadata/magic validation, service-role-only locked identity RPC, server initial fallback, and the #102/#136/#137 split without claiming merge before it occurs.
- [x] Run all verification:

```bash
npm test
npm run lint
npm run build
supabase db reset --local --no-seed
docker exec -i supabase_db_icons-ip psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/profile_editing.sql
supabase db lint --local --level warning
git diff --check main...HEAD
```

- [x] Final pre-PR evidence after Task 7 findings: `npm test` 94 files/998 tests, `npm run lint` clean, Next 16.2.9 production build and 31 static pages, fresh local reset/profile smoke success. DB lint has only the pre-existing `refund_ticket_order` unused `p_reason` warning.
- [x] Review `git status --short`, branch diff stat, token-shaped secret-pattern scan and `git diff --check main...HEAD`.
- [x] Stage exact documentation files and commit `docs(account): 프로필 direct upload 운영을 기록`.

### Task 7: local browser QA와 independent review

- [x] Start local Supabase and Next using non-secret environment loading.
- [x] Local Storage API RLS regression: unclaimed·active profile INSERT 거부, pending profile·community INSERT 허용, owner의 `profile/*` delete 거절·객체 존속, owner의 `community/*` delete 성공·객체 제거를 확인했다.
- [x] Create a temporary confirmed test user and satisfy the onboarding gate.
- [x] Upload an exactly 5MiB valid PNG whose decoder tolerates trailing bytes. Storage에 객체가 생기고 Next Action body는 76/446 bytes에 머무는 것을 확인했다.
- [x] Verify 5MiB+1 rejects before any Storage request.
- [x] Replace the avatar with a second 4MiB image, refresh and sign in again; prove one `active`, one `retired` claim and only the current profile object remain.
- [x] Verify nickname and marketing persistence, 390px no-overflow, bottom action clearance, 2px keyboard focus ring and zero application console warnings/errors.
- [x] Remove the temporary Auth user, profile, claims, owned Storage objects, cookies and browser handles; exact DB/Storage counts are zero.
- [x] Request independent concurrency/security and whole-branch standards/spec reviews from `main`.
- [x] Address every valid finding with focused tests: finalize TOCTOU/replay cleanup, unclaimed Storage INSERT, ECMAScript trim and stale success feedback. Final re-review has no actionable finding.

### Task 8: PR, CI, merge and production proof

- [ ] Push the branch and open a review-ready PR with Korean `요약`, `배경`, `검증`, `참고`, including `Closes #136`.
- [ ] Confirm exact-head CI and preview deployment success. Preview에서는 route/render만 smoke한다. Supabase migration은 `main` production pipeline에서 적용되므로 authenticated direct upload를 preview 단독으로 검증할 수 없다.
- [ ] Squash merge only after checks and review are green.
- [ ] Confirm the exact merge SHA production pipeline(Supabase → Vercel), `iconsip.com` route and controlled exact 5MiB profile direct-upload/replacement smoke.
- [ ] Remove all production test data and Storage objects.
- [ ] Confirm #136 is closed and Project #8 item is `Done`; repair synchronization if needed within the authorized scope.
- [ ] Fast-forward local `main`, remove the worktree/branch, and choose the next unblocked launch issue.
