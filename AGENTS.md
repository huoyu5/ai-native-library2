# AGENTS.md

## Repo state

- Greenfield repository: **zero commits** on `master`, no remote configured, no source code.
- No `package.json`, no build/test/lint/typecheck tooling, no CI, no `opencode.json`. There are no commands to run yet — the first commit has not been made. The repo name suggests an AI-native library, but no stack is scaffolded.
- Do not hunt for existing code, fixtures, or conventions; there are none.

## Agent skills

This repo carries Matt Pocock's engineering skills as project-level skills in `.agents/skills/`:

- The skills encode the intended engineering workflow: `to-spec` → `tdd` → `implement` → `code-review`, with `diagnosing-bugs` / `research` / `domain-modeling` for investigation, and `triage` / `to-tickets` for issue tracking.
- `.agents/skills/` and `skills-lock.json` are managed by the skills.sh CLI (`npx skills`). `skills-lock.json` pins each skill's source and hash — **do not hand-edit it**; use `npx skills check` / `npx skills update` / `npx skills add <owner/repo@skill>`.
- Treat `.agents/skills/` as tooling, not project code. It is all vendor content from upstream and should not be refactored.

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
