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
