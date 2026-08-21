# Design QA

Status: passed

- Reference: ICONS — IP World Preview (`sites-project://appgprj_6a606cb970508191982fba6e41bfa332`)
- Viewports: 1280 × 720 and 390 × 844
- Compared: header, hero states, announcement, IP marquee, film, experiences, feature panels, stats, final CTA, footer, and mobile menu
- Interactions: hero pause/resume, film scene selection and pause/resume, one-card carousel movement, mobile menu focus trap/Escape/inert behavior, and mobile hero CTA
- Live contracts: production curation order, followed-IP personalization, catalog-derived content, and the empty state remain intact
- Review: no P0, P1, or P2 visual, interaction, or accessibility issues remain
- Tooling note: the Next.js development indicator appears only in the local development preview and does not ship in production

## 2026-07-27 — Centered film line controls regression check

- Ran `npm run test -- components/screens/Home.test.tsx` successfully (74 tests across the root and isolated worktree matches), including one-, two-, and three-scene render contracts.
- Verified the film carousel semantics, labeled scene-selection group, active `aria-pressed` state, stable live-region policy, reduced-motion final frame, and one-scene render guard without adding visible labels or a separate playback button.
- Checked Chromium at 1440 × 900, 1280 × 720, and 1024 × 768. The original three 42 × 27px controls and 3px hairlines measured exactly at the film window's horizontal center, with 142px total width and no clipping or horizontal overflow.
- Checked Chromium at 390 × 844 and 360 × 800. The original responsive line controls remained 34px from both film edges and 55px from the bottom, with an 18px copy-to-control gap and no clipping or horizontal overflow.
- Verified direct selection pauses rotation, pressing the active line resumes the 4.2-second cycle, hover and external keyboard focus pause it, Tab order follows the three lines, and reduced motion keeps the selected scene static.
- Browser console reported zero errors and zero warnings.

## 2026-08-12 — LINE FRIENDS SQUARE storefront prototype

## Scope

- Reference observed live on 2026-08-12: `https://linefriendssquare.com/`
- Prototype routes: `/` and `/shop/[goodId]` with `ICONS_PROTOTYPE=1` and `?variant=A|B|C`
- Variant A is the fidelity target. B is commerce-first; C is editorial-first.
- Reference code, logo, copy, and image assets were not reused. The implementation uses the current ICONS catalog, curation, IP, and goods assets only.
- Auth, catalog loading, Supabase, payment, order, and route metadata contracts remain unchanged.

## Capture environment

- Browser: Codex in-app browser
- Desktop viewport: 1440 × 1000, DPR 1; captured content 1430 × 993 after scrollbar/browser bounds
- Mobile viewport: 390 × 844, DPR 1; captured content 380 × 822 after scrollbar/browser bounds
- Reference desktop capture: 1425 × 990; reference mobile capture: 375 × 812
- States checked: initial, compact sticky header, category mega menu, search panel/focus, mobile menu/Escape, detail sticky tabs/buy dock, mobile purchase sheet/Escape, sold-out CTA, A/B/C switcher, editable-input arrow-key guard

## Source truth

- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-home-desktop-fold.png`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-home-mobile-fold.png`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-home-desktop-category-mega-menu.png`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-home-desktop-search-state.png`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-pdp-desktop-1280-fold.png`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-square-reference/source-pdp-mobile-fold.png`

## Implementation evidence

- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-desktop-fold.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-desktop-fold-final.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-mobile-fold.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-desktop-sticky-header.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-desktop-mega-menu.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-desktop-search.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/home-a-mobile-menu.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-desktop-fold.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-desktop-fold-final.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-desktop-tabs.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-mobile-fold.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-mobile-buy-sheet.jpg`
- `/Users/sangwopark19/.codex/visualizations/2026/08/12/019ff45c-da0d-7ac2-82e2-84cdd69190a7/line-friends-implementation/detail-a-mobile-soldout.jpg`
- Variant alternatives: `home-b-*`, `home-c-*`, `detail-b-*`, and `detail-c-*` in the same implementation directory.

## Comparison

### Full-view structure

- Home A matches the measured sequence: campaign/locale/header/nav, 770px desktop and 450px mobile hero, editor cards, campaign-plus-four-goods collections, category tabs/grid, IP-popular goods, benefits, responsive footer, and mobile fixed navigation.
- Desktop header ends at 189px; compact state is 69px. Mobile promo/header/nav measure 60/81/40px, and compact state keeps the 40px nav.
- Detail A uses the measured 1180px inner content: 649px media, 446px summary, and 85px gap. Mobile media is 3:4 (380 × 506.7px), equivalent to the reference 375 × 500px.
- Detail tabs pin below the compact header at desktop top 68px and mobile top 40px. The desktop purchase dock is 340px wide.
- No positive horizontal overflow was found at 1440px or 390px for A, B, or C.

### Focused states

- Category mega menu opens from pointer hover or activation, reports `aria-expanded=true`, and closes through the backdrop/search transition.
- Search panel closes the mega menu, focuses `#lfp-search`, and preserves variant through a hidden query value.
- Mobile menu locks scroll, exposes a modal navigation surface, and closes with Escape.
- Mobile menu traps focus, marks the background inert, restores the trigger focus, and layers above the detail purchase bar.
- Mobile purchase sheet is an `aria-modal` dialog, focuses its close control, traps Tab, closes with Escape, and restores focus/scroll.
- Mobile gallery dots are 24px interactive targets that switch every real catalog frame; the hero pauses on hover/focus and has an explicit pause/resume control.
- Cart integration was exercised with the actual `CartProvider`: adding one item produced both `장바구니 총 1개` and the detail live status; the QA item was then deleted and the cart returned to zero.
- Auth-aware login/My/logout behavior and the shared legal/business information remain available inside the replacement chrome.
- Sold-out `g13` exposes `품절` and a disabled mobile CTA. No review, rating, discount, option, or related-goods data was invented.
- ArrowRight changed A → B; the same key inside the focused search input did not change variants.

## Iteration history

- P1 — Existing `form[action="/search"]` global CSS expanded the prototype header to 412px. Fixed by giving the prototype search action a distinct query-marked action; final header is 153px before scroll.
- P1 — Global button color inheritance made the black purchase CTA text invisible. Fixed with a scoped higher-specificity solid CTA rule.
- P1 — Pointer movement opened the mega menu before click, causing the click toggle to close it. Fixed activation to idempotently open while backdrop/mouse-leave/search close it.
- P1 — The first pass did not retain the reference compact sticky header. Added the measured desktop 69px and mobile 40px compact states and aligned detail sticky-tab offsets.
- P2 — Detail A carried a breadcrumb and oversized title absent from the source. Removed the breadcrumb in A and aligned 1180/649/446/85px proportions and 18px desktop title.
- P1 — Prototype CSS was initially imported by the root layout, then still appeared in guarded-route chunks after a dynamic import. Moved it to conditionally referenced static assets; final env-off build chunks and prerendered routes contain neither prototype selectors nor asset references.
- P1 — The first mobile drawer lacked focus isolation and sat below the fixed detail buy bar. Added focus trapping/restoration, inert background state, and corrected stacking.
- P1 — Cart persistence failures could be reported as success before navigating to `/cart`. Cart mutations now return an explicit success result and the prototype only reports/navigates after success.
- P1 — The first chrome bypassed signed-in/out shell behavior and shared seller information. Reused `AuthButton`, legal-link truth, and `BusinessInfo` in the prototype chrome.
- P2 — Mobile galleries initially had passive indicators only, and hero rotation lacked a pause surface. Added accessible frame controls and hover/focus/explicit pause behavior.
- P0 — none.

## Automated verification

- `npm test`: 191 files, 1,993 tests passed.
- Targeted route/cart/detail/IP tests: 5 files, 42 tests passed; env-off current UI, production guard, A/B/C, invalid/missing → A, 404, metadata, and cart consumers covered.
- `npm run lint -- --ignore-pattern '.worktrees/**' --ignore-pattern '.next/**'`: 0 errors; one pre-existing unused-variable warning in `scripts/hong-sil-downloader.mjs`.
- `npm run build`: Next.js 16.2.9 production build and TypeScript passed.
- Env-off production smoke: `/?variant=B` and `/shop/g1?variant=C` rendered the existing screens with no prototype shell or prototype asset reference.
- Final browser regression: conditional style markers present only in prototype branches; 1440px and 390px horizontal overflow 0; desktop detail retained 649/446/85px geometry; drawer focus/stacking, auth/legal/business content, and hero focus-pause behavior passed.
- Browser console: 0 warning/error entries during final interaction pass.

final_result: passed
