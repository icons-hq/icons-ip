# Production Toss Test Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every figure good from public catalog data and temporarily allow the approved TossPayments widget test-key pair on `iconsip.com` for staff/admin human payment testing.

**Architecture:** Preserve historical `goods` and `order_items` rows by archiving figure goods instead of deleting them. Keep preview and local mock/seed data aligned, remove figure references from the goods demo, and add one explicit server-only production override that remains fail-closed unless the key pair is valid and the override equals `true`.

**Tech Stack:** Next.js 16, React 19, Vitest, Supabase Postgres migrations, Vercel CLI, TossPayments payment widget.

## Global Constraints

- Existing orders and payment history must remain queryable.
- Production test mode must require test-mode widget keys, the approved pair fingerprint, `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION=true`, and an active staff/admin reviewer.
- Live widget keys must continue to work without the test-mode override.
- Figure goods must not appear in production, preview, or local catalog/game data.
- Secrets must stay in Vercel sensitive environment variables and must never be logged or committed.

---

### Task 1: Lock the production test-mode contract with failing tests

**Files:**
- Modify: `lib/payments/config.test.ts`
- Modify: `scripts/check-vercel-build-env.test.mjs`

**Interfaces:**
- Consumes: existing `paymentsEnabledForRuntime` and `validateVercelBuildEnvironment` contracts.
- Produces: strict opt-in behavior for production test keys.

- [ ] **Step 1: Add tests proving production test keys stay disabled without an override and become enabled only with the exact override.**
- [ ] **Step 2: Run the two focused test files and confirm they fail because the override is not implemented.**
- [ ] **Step 3: Add the minimal optional override parameter and environment forwarding.**
- [ ] **Step 4: Re-run the focused tests and confirm they pass.**

### Task 2: Remove figure goods from every durable catalog source

**Files:**
- Modify: `lib/data.ts`
- Modify: `supabase/seed.sql`
- Create: `supabase/migrations/<generated>_archive_figure_goods.sql`
- Modify: `supabase/tests/catalog_baseline.sql`
- Modify: `supabase/tests/checkout_order.sql`

**Interfaces:**
- Consumes: `goods.archived_at` public discovery filter and active-catalog count triggers.
- Produces: 10 active baseline goods, no figure references in local/preview mock data, and an idempotent production data migration.

- [ ] **Step 1: Update the catalog canary to require no active figure goods and the remaining ten baseline IDs.**
- [ ] **Step 2: Generate a migration with `supabase migration new archive_figure_goods`.**
- [ ] **Step 3: Archive matching figure rows, revise affected IP synopsis text, and remove figure IDs from the goods-game JSON without deleting historical rows.**
- [ ] **Step 4: Remove the same goods, type filter, synopsis, community copy, counts, and game IDs from `lib/data.ts` and `supabase/seed.sql`.**
- [ ] **Step 5: Replace the checkout sold-out fixture's dependency on archived `g12` with an active non-figure fixture.**

### Task 3: Document the temporary production review mode

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRD.md`
- Modify: `docs/launch-readiness-plan.md`

**Interfaces:**
- Consumes: the production test-mode environment contract.
- Produces: an explicit temporary review procedure and rollback instruction.

- [ ] **Step 1: Document the server-only override and state that Toss test payments never debit a real payment method.**
- [ ] **Step 2: Document rollback: remove the override and restore live keys after review approval.**

### Task 4: Verify locally and deploy through the repository production path

**Files:**
- Verify only: all changed files and live environments.

**Interfaces:**
- Consumes: migration, app build, Vercel environments, and the canonical `iconsip.com` domain.
- Produces: deployed production review mode with read-back evidence.

- [ ] **Step 1: Run focused tests, full tests, lint, build, local database reset, SQL smoke tests, and database lint.**
- [ ] **Step 2: Commit the isolated logical change, push its branch, open a reviewable PR, and merge only after CI is green.**
- [ ] **Step 3: Copy the existing preview Toss widget test-key pair to production using stdin-safe Vercel environment commands and set the override as sensitive.**
- [ ] **Step 4: Apply or verify the migration through the main production pipeline and inspect the final Vercel deployment.**
- [ ] **Step 5: Read back production data, browse `iconsip.com`, and verify figure goods are absent and the test payment widget can be opened by an authenticated human tester.**
