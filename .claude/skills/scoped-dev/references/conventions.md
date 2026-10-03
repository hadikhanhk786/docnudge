# Conventions (DocChase)

FACT = true in the code today (cited). RULE = required for new work; the code may not fully follow it yet.

## Security and privacy
- FACT: every `/api/app/*` query filters by `firm_id = ${firm.id}`, or first checks the request belongs to the firm and then queries by request id (server/app.ts:260-262, files join at :272). New firm routes do the same.
- FACT: client links are `requestId.version.hmac` (shared/tokens.ts); the signature is checked before any DB hit (server/app.ts:304); "replace link" bumps `requests.link_version`; archived requests and canceled firms resolve to 404 (:313).
- FACT: `/r/:token` renders outside Clerk (src/App.tsx:11); the client page must never import Clerk or `src/lib/api.ts`.
- FACT: R2 keys are `firmId/requestId/itemId/fileId`, never a user-supplied name (server/app.ts:379). Downloads are owner-only attachments with `nosniff` (:277-284).
- FACT: `/api/public/*` responses are `no-store` + `noindex` (server/app.ts:331-335); `/r/*` too (public/_headers).
- RULE: logs carry no tokens, PII, emails or file names. Gap: `cron/src/index.ts:52` logs the provider error text, which may echo an address; the file name travels in the upload URL query (`?name=`).
- RULE: nothing secret in URLs except the signed client token. No analytics or third-party trackers on the client page.
- RULE: never read, print or commit `.dev.vars`, `.env` or secret values; refer to env vars by name.

## Uploads
- FACT: allowlist of MIME types in `ALLOWED_TYPES` (server/app.ts:17-30), no html/svg; 25 MB cap checked on Content-Length and on the bytes (:364-375); max 10 files per item (:16, :371).
- FACT: the client mirrors the cap and the extension→type map (src/pages/ClientUpload.tsx `MAX_BYTES`, `TYPE_BY_EXT`, `accept`). RULE: change both sides together.

## Data and SQL
- FACT: Neon tagged templates (`sql\`...\``) only; dynamic SQL only via `sql.unsafe` with constant column lists (REQ_COLS / FIRM_COLS, server/app.ts:42-44).
- FACT: date columns are selected as `::text` (YYYY-MM-DD) to avoid time-zone shifts (server/app.ts:43, cron/src/index.ts:18).
- FACT: `schema.sql` is the full current schema and the integration tests load it (tests/api.integration.test.ts:143).
- RULE: schema changes also add an additive, numbered file `migrations/NNN_name.sql` for existing databases (folder does not exist yet). Nothing destructive without the owner's OK.
- RULE: multi-statement writes that must succeed together use `sql.transaction([...])` (pattern: server/app.ts:147, :381).

## Tests
- FACT: API and SQL behaviour is tested on PGlite with the real schema; Neon transport, Clerk, R2 and email are faked (tests/api.integration.test.ts:1-2).
- RULE: API/SQL changes add or update a test in tests/api.integration.test.ts; pure logic in shared/ gets a unit test in tests/shared.test.ts.
- RULE: behaviour that only the fakes cover is reported as "unverified on the live service".

## i18n
- FACT: src/locales/en.json and ar.json must have the same keys; missing AR keys fail typecheck (src/i18n.tsx:169-170).
- FACT: Arabic also lives in shared/packs.ts labels, shared/emailTemplates.ts and shared/messages.ts.
- RULE: every new user-facing string gets EN and AR; list new AR strings as "unreviewed" in the final report.

## CSS and design
- FACT: tokens live in `:root` of src/styles.css (--bg, --surface, --ink, --ink-2, --line, --accent, --accent-soft, --wait, --wait-soft, --ok, --bad, --bad-soft, --font-display, --font-body). Use them, not raw hex.
- FACT: the stylesheet uses logical properties only (margin-inline, padding-block…); no left/right. RULE: keep it that way for RTL.
- FACT: flat rows with hairline dividers, no shadows; radii: 2px rail segments, 10px buttons, 999px pills for status chips and the lang toggle; reduced-motion rule at src/styles.css:160.
- RULE: tap targets at least 48px. Gap: buttons are 44px, inputs 46px, lang toggle 36px (src/styles.css:50,64,78,87).

## Dependencies and bundle
- RULE: no new dependency without the owner's approval; no AI API calls or new paid services in v1.
- RULE: after adding a server-side dependency, re-check the Functions bundle: `npx wrangler pages functions build functions --outfile <tmp>/worker.js` (Workers free plan has a compressed size cap).
- FACT: only `/api/*` runs Functions (public/_routes.json); keep it that way.
