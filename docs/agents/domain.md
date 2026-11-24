# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one `CONTEXT.md` + `docs/adr/` at the repo root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary (canonical terms + aliases to avoid).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in (e.g. `0052-general-shopping-mall-pivot.md`).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── CONTEXT.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── adr/
│       └── 0052-general-shopping-mall-pivot.md
└── app/ · components/ · lib/ · supabase/
```

(A multi-context repo would instead have a `CONTEXT-MAP.md` at the root pointing at one `CONTEXT.md` per context, with per-context `src/<context>/docs/adr/`. That does not apply here.)

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids — e.g. say **카드** for the collectible digital card and **굿즈** for physical merchandise; never the reverse.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0052 (general shopping mall pivot) — but worth reopening because…_
