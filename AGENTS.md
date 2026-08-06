# AGENTS.md

## Repo state

- Public repository on GitHub (`huoyu5/ai-native-library2`), default branch `master`. Contains domain docs (`CONTEXT.md`, `docs/adr/`), the MVP spec and the implementation ticket queue (as GitHub issues).
- No source code yet — no `package.json`, no build/test/lint/typecheck tooling, no CI. The first implementation ticket (`01 — 工程骨架`) scaffolds the TypeScript full-stack web app.

## Agent skills

This repo carries Matt Pocock's engineering skills as project-level skills in `.agents/skills/`:

- The skills encode the intended engineering workflow: `to-spec` → `tdd` → `implement` → `code-review`, with `diagnosing-bugs` / `research` / `domain-modeling` for investigation, and `triage` / `to-tickets` for issue tracking.
- `.agents/skills/` and `skills-lock.json` are managed by the skills.sh CLI (`npx skills`). `skills-lock.json` pins each skill's source and hash — **do not hand-edit it**; use `npx skills check` / `npx skills update` / `npx skills add <owner/repo@skill>`.
- Treat `.agents/skills/` as tooling, not project code. It is all vendor content from upstream and should not be refactored.

### Issue tracker

Issues and specs live as GitHub issues (spec = `#1`, tickets = `#2`–`#15`). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
