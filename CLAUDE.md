# DocChase

## Working here
- For any code change (feature, fix, refactor, test, config, schema), use the `scoped-dev` skill.
- Orient with `node .claude/skills/scoped-dev/scripts/repo-map.mjs --status`, then read .claude/skills/scoped-dev/references/repo-map.md instead of scanning the repo.
- Gates: `npm run typecheck`, `npm test` (PGlite, no network), `npm run build` when UI changes.

## Hard rules
- Map first: grep before reading; open only files you will edit or must understand.
- Before a non-trivial edit, state goal, files, out of scope and the acceptance check; touch nothing else.
- No guessing: cite this repo, node_modules types or docs fetched this session; otherwise say "unverified".
- Smallest correct diff: no unused code, no speculative options, no drive-by refactors or reformatting.
- Never claim a check passed unless you ran it; anything only the test fakes cover is "unverified on the live service".
- Never open or print .dev.vars, .env or secrets; ask before new dependencies, schema changes, deploys or cloud actions.
