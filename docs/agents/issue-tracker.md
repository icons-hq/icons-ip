# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues (`sangwopark19/icons-ip`). Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone. (`origin` → `git@github.com:sangwopark19/icons-ip.git`.)

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Project boards

This repo uses GitHub Projects as execution boards. Pick the board that matches the work scope:

- `ICONS v1 Launch Readiness` (`https://github.com/users/sangwopark19/projects/8`): the active board — v1 launch gap work across user features and admin operations. Plan source: `docs/launch-readiness-plan.md`.
- Closed history boards: `ICONS v1 P0 Foundation` (#3), `ICONS v1 Frontend UX` (#4), `ICONS 온라인 팝업 게임 레이어` (#5). Do not add new items there.

Use the issue body as the spec source, and use the Project fields as the scheduling source:

- `Status`: `Todo` → `In Progress` → `Done`.
- `Phase`: release slice such as `Launch Blocker` or `Post-launch`.
- `Track`: parallel work stream such as `Payments`, `Commerce`, `Ticketing`, `Rewards Ops`, `Account`, `Notifications`, `Community`, `Admin Ops`, or `Popup Layer`.
- `Dependency`: startability. Pick `Unblocked` work first.

Do not maintain a second dependency source with GitHub native parent/sub-issue or blocked-by relationships unless the user explicitly asks for that migration. If issue text and Project fields disagree, call out the conflict before acting.
