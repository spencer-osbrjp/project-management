# project-management

A Tauri desktop app: GitHub Desktop + Jira, in one matte dark-grey window.

- **Repo explorer sidebar** — add your repos folders (e.g. `~/Documents/Works`); every directory with a `.git` inside (scanned 3 levels deep) is listed, click to switch.
- **Dashboard** — total commits, open/due-soon/overdue ticket counts, and a "Coming up" list sorted by deadline. Add tickets, edit them, and set or adjust deadlines from the same dialog; completed tickets collapse below.
- **Calendar** — month view of every open ticket's deadline across all repos, color-coded per repo (auto-assigned; same colors dot the sidebar). Click an entry to jump to that repo.
- **GitHub issue sync** (via `gh` CLI) — new tickets become GitHub issues, Done closes them, Reopen reopens them, and "Sync GitHub issues" imports open issues. "Comments" on a card shows the issue thread.
- **Pull Requests tab** — open PRs; click one to read its comments.
- **Accounts** — switch between `gh`-authenticated GitHub accounts from the topbar (add new ones with `gh auth login` in a terminal).
- **Reminders** — desktop notification when a ticket is due within 24h or overdue (re-reminds every 4h).
- **Git** — branch + ahead/behind badge, auto-fetch every 5 min, fetch/pull/push, status, commit-all, recent log.

Data is stored in a JSON file in the app-data dir (tauri-plugin-store), keyed per repo.

## Run

```sh
pnpm install
pnpm dev      # develop
pnpm build    # release bundle (.app / .dmg in src-tauri/target/release/bundle)
```

Requires Rust, `git`, and optionally `gh` (logged in) on PATH.
