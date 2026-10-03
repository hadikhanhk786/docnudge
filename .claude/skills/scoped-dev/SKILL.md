---
name: scoped-dev
description: Use for any code change in this repo (feature, fix, refactor, test, config, schema, migration, styling, copy in the app, dependency or build change). Use it even for small edits and when the request just says "add", "fix", "change", "rename", "update", "wire up", "make it", "support", "remove" or "clean up". It gives the repo map (files, routes, tables, env vars, tests to run), a scope contract, no-guessing rules, dead-code rules and the done gate. Not needed for pure questions, explanations or git housekeeping.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/repo-map.mjs *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/check.mjs *) Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git show *)
---

# Scoped dev

Map status: !`node ${CLAUDE_SKILL_DIR}/scripts/repo-map.mjs --status`

## Hard rules
1. Map first: read `${CLAUDE_SKILL_DIR}/references/repo-map.md` once, grep before reading, open only files you will edit or must understand, never re-read what is in context, no repo-wide scans.
2. Scope contract before the first edit on anything beyond tiny; a file outside it means stop and ask, or list it under "noticed, not touched".
3. No guessing: every API, option, column, route, env var, import path and config key is cited from this repo, node_modules types or docs fetched this session; otherwise say "unverified" and test or ask.
4. Smallest correct diff: nothing speculative, nothing unused, nothing commented out.
5. Prove it: narrowest check first, full gates before "done"; never claim a pass you did not run.
6. Keep the map true: structural change means refresh the map in the same change.
7. Ask only when the answer changes the design or is hard to undo; otherwise state the assumption and go.

## Size ladder
Pick the smallest rung that fits, so tiny tasks stay tiny.
- **Tiny** (one file, obvious, about 10 lines): no contract. Edit, run the narrowest check, report.
- **Small** (1-3 files): one-line contract, targeted tests, then `check.mjs`.
- **Medium** (multi-file, API, schema or behaviour): full contract, tests written with the code, full gates, map refresh.
- **Large or unclear**: propose a plan with 2-3 options and your recommendation, then wait.

## Navigate
- Use the map's "Where to change X" table and the modules table (exports, importers) to pick files; use its routes, db and env sections for names and line numbers.
- The map says where, the source says what: read the cited lines before relying on them. If they disagree, trust the source and refresh the map.
- Batch independent reads and greps in one turn.
- If the map cannot answer a broad "where is X", delegate read-only exploration to the Explore subagent (if available) instead of reading many files here.
- Read `${CLAUDE_SKILL_DIR}/references/conventions.md` before touching API, SQL, uploads, i18n, CSS or dependencies.

## Scope contract
Write it in chat before the first edit (small: one line; medium: all four):
```
Goal: <one line>
Files: <paths you will touch>
Out of scope: <what you will not touch>
Acceptance: <the check that proves it, e.g. npx vitest run tests/shared.test.ts>
```
- No drive-by renames, reformatting, refactors or dependency changes.
- Unrelated failing tests are reported, not fixed.
- Need another file mid-task? Stop and ask, or record it under "noticed, not touched".

## Verification (no guessing)
- Pattern already in the repo: copy it and cite `file:line`.
- New library API: read its types in `node_modules/<pkg>` or current docs, and name the source.
- Schema, routes, env vars: read the source lines the map points to.
- Unknown behaviour: write a failing test or a tiny probe first.
- Anything the tests fake (Neon transport, Clerk, R2, email provider): label it "unverified on the live service".

## Dead code
- No speculative params, options, flags, abstractions or config; no TODO stubs; no compat shims without a real caller.
- No unused imports, exports, types, files or dependencies.
- Validate at trust boundaries (HTTP input, env, DB rows); skip checks for states the types already rule out.
- Remove only what your change orphaned; leave pre-existing dead code alone and mention it.
- Before finishing, name a caller for every symbol you added. No caller means delete it.

## Done
Run in this order, narrowest first:
1. The targeted test: `npx vitest run <test file>` (the map's tests section maps sources to test files).
2. Full gates from package.json: `npm run typecheck`, `npm test`, and `npm run build` when UI or build config changed.
3. Mechanical gate with the contract files: `node ${CLAUDE_SKILL_DIR}/scripts/check.mjs --allow <comma-separated paths or globs>`. It typechecks with unused-code flags, scans unused exports, flags files outside the contract, and lists added exports (justify each one).
4. If you added, renamed or removed a file, route, table, env var, script or export: `node ${CLAUDE_SKILL_DIR}/scripts/repo-map.mjs --write`, then fill each "TODO: describe" it reports with `node ${CLAUDE_SKILL_DIR}/scripts/repo-map.mjs --describe <path> <purpose>` (edit tools cannot write under `.claude/`).

Final report, 8 lines max:
```
Changed: <files>
Evidence: <command> -> <result> (one line each)
Assumptions: <or none>
Unverified: <live-service behaviour, or none>
Noticed, not touched: <or none>
Decisions needed: <or none>
```

## Read when
- `references/repo-map.md`: at the start of every task (architecture, where to change X, gotchas, files, modules, tests, routes, db, env, scripts, i18n, templates).
- `references/conventions.md`: before touching API, SQL, uploads, i18n, CSS or dependencies.
