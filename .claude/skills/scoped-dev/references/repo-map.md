# Repo map (DocNudge)

Generated regions are owned by `scripts/repo-map.mjs --write` (heuristic regex parsing). The map says where; the source says what. If they disagree, trust the source and refresh the map. Everything outside the markers is hand-written and preserved.

## Architecture
- Cloudflare Pages serves the Vite SPA from `dist`; only `/api/*` runs Functions (`public/_routes.json`).
- `functions/api/[[route]].ts` hands every `/api/*` request to the Hono app in `server/app.ts` (basePath `/api`).
- Firm side: `/api/app/*`, Clerk Bearer token → `requireUser` loads or creates the firm row.
- Client side: `/api/public/:token/*`, no login; the HMAC token (`shared/tokens.ts`) is the credential.
- Data: Neon Postgres over HTTP (`neon()` tagged templates); files in R2 (`BUCKET`); email via `shared/email.ts`.
- `cron/` is a separate Worker (hourly) running `runReminders`; it shares `shared/*` with the API.
- `shared/` is imported by API, cron and UI; changing it touches all three tsconfigs.
- UI: `/r/:token` (ClientUpload) never loads Clerk; everything else sits inside `PreparerApp`.
- Tests: `tests/shared.test.ts` (pure units), `tests/api.integration.test.ts` (real SQL on PGlite).

## Where to change X
| change | files, in order | test |
|---|---|---|
| region template | shared/packs.ts (new region also: Region type, REGIONS, schema.sql firms.region check, shared/schedule.ts, `region_xx` locale keys) | tests/shared.test.ts "region packs"; ae.vat item count is also asserted in tests/api.integration.test.ts:203 |
| API route | server/app.ts (`authed` or `pub`) → src/lib/types.ts → page | tests/api.integration.test.ts |
| DB schema | schema.sql → migrations/NNN_name.sql (rule, folder not created yet) → REQ_COLS/FIRM_COLS in server/app.ts → src/lib/types.ts | tests/api.integration.test.ts |
| env var / binding | server/types.ts Env (or MailEnv/EmailEnv/CronEnv) → wrangler.toml and/or cron/wrangler.toml → .dev.vars.example | baseEnv in tests/api.integration.test.ts:86 |
| UI string | src/locales/en.json + ar.json (same key) | npm run typecheck |
| reminder cadence / send windows | shared/reminders.ts, shared/schedule.ts | tests/shared.test.ts + cron tests in integration |
| email template / provider | shared/emailTemplates.ts, shared/email.ts, shared/mailer.ts | tests/shared.test.ts "emails and WhatsApp" |
| upload rules | server/app.ts (MAX_UPLOAD_BYTES, ALLOWED_TYPES, MAX_FILES_PER_ITEM) AND src/pages/ClientUpload.tsx (MAX_BYTES, TYPE_BY_EXT, accept) | integration "validates uploads" |
| SPA page | src/pages/X.tsx → route in src/PreparerApp.tsx (or src/App.tsx if public, outside Clerk) → locale keys | typecheck + build |
| design tokens | src/styles.css `:root` | npm run build |

## Gotchas (verified against code)
- `tests/` is in no tsconfig: `npm run typecheck` never checks test files; vitest only transpiles.
- The Neon driver is faked in tests (tests/api.integration.test.ts:7-55): `sql.unsafe`, `sql.transaction`, array params run on PGlite, not Neon. Say "unverified on Neon".
- Date columns are cast `::text` in SELECTs (REQ_COLS server/app.ts:43, cron query) to avoid TZ shifts; do the same for new date columns.
- Firm routes scope by `firm_id = ${firm.id}`, or check request ownership first then query by request id (server/app.ts:260).
- Clerk `authorizedParties` = origin of APP_URL + EXTRA_ORIGINS (server/app.ts:61); locally APP_URL must be the Vite origin.
- Arabic lives in four places: src/locales/ar.json, shared/packs.ts labels, shared/emailTemplates.ts, shared/messages.ts.
- i18n.tsx:169-170 catches keys missing from ar.json but not extra ones; the i18n region below catches both.
- Upload limits are duplicated client-side (ClientUpload.tsx) and server-side (app.ts); change both.
- Cron applies the send window in JS after `limit 200` (cron/src/index.ts:28,34).
- LINK_SECRET must be identical for Pages and cron, which builds client links in reminder emails.

## files
<!-- gen:files:start -->
| file | lines | purpose |
|---|---|---|
| `.dev.vars.example` | 7 | server secret names for wrangler (local) |
| `.env.example` | 2 | Vite browser var names |
| `CLAUDE.md` | 14 | always-on agent rules → scoped-dev skill |
| `README.md` | 96 | setup, deploy, known gaps |
| `cron/src/index.ts` | 66 | reminder Worker: runReminders + scheduled handler |
| `cron/tsconfig.json` | 15 | tsconfig for cron + shared |
| `cron/wrangler.toml` | 19 | cron Worker config (hourly trigger, vars) |
| `functions/api/[[route]].ts` | 5 | Pages Functions entry → server/app.ts |
| `index.html` | 22 | SPA shell, Google Fonts links |
| `package.json` | 37 | scripts + deps |
| `public/_headers` | 12 | static security/cache headers (/r/*, /assets/*) |
| `public/_redirects` | 1 | SPA fallback |
| `public/_routes.json` | 1 | only /api/* runs Functions |
| `schema.sql` | 73 | full DB schema (tests load it) |
| `server/app.ts` | 424 | Hono API: firm routes, client routes, upload rules |
| `server/tsconfig.json` | 15 | tsconfig for server + functions + shared |
| `server/types.ts` | 25 | Env bindings, FirmRow, Hono Vars |
| `shared/email.ts` | 73 | sendEmail via Resend or SES |
| `shared/emailTemplates.ts` | 70 | request/complete email HTML+text, EN/AR |
| `shared/mailer.ts` | 64 | buildLink, daily cap, deliverRequestEmail |
| `shared/messages.ts` | 30 | formatDate, WhatsApp text + wa.me link |
| `shared/packs.ts` | 207 | region templates (EN/AR labels), deadline rules |
| `shared/reminders.ts` | 24 | reminder cadence (nextReminderAt) |
| `shared/schedule.ts` | 15 | UTC send windows per region |
| `shared/tokens.ts` | 40 | HMAC client-link tokens |
| `src/App.tsx` | 30 | router: /r/:token outside Clerk, rest → PreparerApp |
| `src/PreparerApp.tsx` | 63 | ClerkProvider, nav, firm routes |
| `src/components/ClientActions.tsx` | 63 | copy / WhatsApp / email buttons |
| `src/components/LangToggle.tsx` | 15 | EN/AR toggle |
| `src/components/ProgressRail.tsx` | 17 | segmented progress rail |
| `src/i18n.tsx` | 72 | I18nProvider, t(), compile-time key parity |
| `src/lib/api.ts` | 52 | useApi: Clerk Bearer fetch + download |
| `src/lib/format.ts` | 7 | todayIso, fileSize |
| `src/lib/types.ts` | 52 | UI-side API row types |
| `src/locales/ar.json` | 95 | Arabic UI strings |
| `src/locales/en.json` | 95 | English UI strings |
| `src/main.tsx` | 10 | React entry |
| `src/pages/ClientUpload.tsx` | 218 | client upload page (main surface) |
| `src/pages/Dashboard.tsx` | 93 | request list + email cap hint |
| `src/pages/NewRequest.tsx` | 154 | create request from template |
| `src/pages/RequestDetail.tsx` | 188 | review items, approve/reject, rotate, archive |
| `src/pages/Settings.tsx` | 90 | firm settings form |
| `src/styles.css` | 160 | design tokens + all styles |
| `tests/api.integration.test.ts` | 345 | API + cron on PGlite (Neon/Clerk/R2/email faked) |
| `tests/shared.test.ts` | 156 | unit tests for shared/* |
| `tsconfig.json` | 16 | tsconfig for src + shared + vite.config |
| `vite.config.ts` | 10 | Vite build + /api proxy to :8788 |
| `wrangler.toml` | 26 | Pages config: R2 binding, vars |
<!-- gen:files:end -->

## modules
<!-- gen:modules:start -->
| module | exports | changing it affects: direct importers (+transitive) |
|---|---|---|
| `cron/src/index.ts` | default, runReminders | tests/api.integration.test.ts |
| `functions/api/[[route]].ts` | onRequest | - |
| `server/app.ts` | app | functions/api/[[route]].ts, tests/api.integration.test.ts |
| `server/types.ts` | Env, FirmRow, Vars | server/app.ts (+2 transitive) |
| `shared/email.ts` | EmailEnv, EmailError, EmailMessage, sendEmail | cron/src/index.ts, server/app.ts, shared/mailer.ts (+3 transitive) |
| `shared/emailTemplates.ts` | CompleteEmailInput, RequestEmailInput, completeEmail, esc, requestEmail | server/app.ts, shared/mailer.ts, tests/shared.test.ts (+4 transitive) |
| `shared/mailer.ts` | MailEnv, ReqForMail, Sql, buildLink, capRemaining, deliverRequestEmail | cron/src/index.ts, server/app.ts, server/types.ts (+2 transitive) |
| `shared/messages.ts` | MessageInput, formatDate, waLink, waMessage | shared/emailTemplates.ts, src/components/ClientActions.tsx, src/pages/ClientUpload.tsx, src/pages/Dashboard.tsx, src/pages/RequestDetail.tsx, tests/shared.test.ts (+9 transitive) |
| `shared/packs.ts` | ALL_TEMPLATES, ChecklistItem, DeadlineRule, Lang, REGIONS, Region, Template, getTemplate, suggestDueDate, templatesForRegion | cron/src/index.ts, server/app.ts, server/types.ts, shared/emailTemplates.ts, shared/mailer.ts, shared/messages.ts, shared/schedule.ts, src/lib/types.ts, src/pages/NewRequest.tsx, src/pages/Settings.tsx, tests/shared.test.ts (+9 transitive) |
| `shared/reminders.ts` | MAX_REMINDERS, ReminderInput, nextReminderAt | shared/mailer.ts, tests/shared.test.ts (+5 transitive) |
| `shared/schedule.ts` | SEND_WINDOWS, inSendWindow | cron/src/index.ts, tests/shared.test.ts (+1 transitive) |
| `shared/tokens.ts` | makeToken, verifyToken | server/app.ts, shared/mailer.ts, tests/shared.test.ts (+4 transitive) |
| `src/App.tsx` | default | src/main.tsx |
| `src/PreparerApp.tsx` | default | src/App.tsx (+1 transitive) |
| `src/components/ClientActions.tsx` | ClientActions | src/pages/Dashboard.tsx, src/pages/RequestDetail.tsx (+3 transitive) |
| `src/components/LangToggle.tsx` | LangToggle | src/PreparerApp.tsx, src/pages/ClientUpload.tsx (+2 transitive) |
| `src/components/ProgressRail.tsx` | ProgressRail, Segment, segmentsFromCounts | src/pages/ClientUpload.tsx, src/pages/Dashboard.tsx, src/pages/RequestDetail.tsx (+3 transitive) |
| `src/i18n.tsx` | I18nProvider, Key, Lang, useI18n | src/App.tsx, src/PreparerApp.tsx, src/components/ClientActions.tsx, src/components/LangToggle.tsx, src/pages/ClientUpload.tsx, src/pages/Dashboard.tsx, src/pages/NewRequest.tsx, src/pages/RequestDetail.tsx, src/pages/Settings.tsx (+1 transitive) |
| `src/lib/api.ts` | ApiError, useApi | src/components/ClientActions.tsx, src/pages/Dashboard.tsx, src/pages/NewRequest.tsx, src/pages/RequestDetail.tsx, src/pages/Settings.tsx (+3 transitive) |
| `src/lib/format.ts` | fileSize, todayIso | src/pages/ClientUpload.tsx, src/pages/Dashboard.tsx, src/pages/RequestDetail.tsx (+3 transitive) |
| `src/lib/types.ts` | FileInfo, Firm, Item, ItemStatus, Lang, Region, RequestRow | src/components/ClientActions.tsx, src/pages/ClientUpload.tsx, src/pages/Dashboard.tsx, src/pages/NewRequest.tsx, src/pages/RequestDetail.tsx, src/pages/Settings.tsx (+3 transitive) |
| `src/pages/ClientUpload.tsx` | default | src/App.tsx (+1 transitive) |
| `src/pages/Dashboard.tsx` | default | src/PreparerApp.tsx (+2 transitive) |
| `src/pages/NewRequest.tsx` | default | src/PreparerApp.tsx (+2 transitive) |
| `src/pages/RequestDetail.tsx` | default | src/PreparerApp.tsx (+2 transitive) |
| `src/pages/Settings.tsx` | default | src/PreparerApp.tsx (+2 transitive) |
| `vite.config.ts` | default | - |
<!-- gen:modules:end -->

## tests
<!-- gen:tests:start -->
- `npx vitest run tests/api.integration.test.ts` reaches: cron/src/index.ts, server/app.ts, server/types.ts, shared/email.ts, shared/emailTemplates.ts, shared/mailer.ts, shared/messages.ts, shared/packs.ts, shared/reminders.ts, shared/schedule.ts, shared/tokens.ts
- `npx vitest run tests/shared.test.ts` reaches: shared/emailTemplates.ts, shared/messages.ts, shared/packs.ts, shared/reminders.ts, shared/schedule.ts, shared/tokens.ts
<!-- gen:tests:end -->

## routes
<!-- gen:routes:start -->
| method | path | where |
|---|---|---|
| GET | `/api/app/me` | server/app.ts:81 |
| PUT | `/api/app/firm` | server/app.ts:86 |
| GET | `/api/app/requests` | server/app.ts:104 |
| POST | `/api/app/requests` | server/app.ts:120 |
| GET | `/api/app/requests/:id` | server/app.ts:172 |
| PATCH | `/api/app/requests/:id` | server/app.ts:190 |
| POST | `/api/app/requests/:id/send` | server/app.ts:207 |
| POST | `/api/app/requests/:id/rotate-link` | server/app.ts:239 |
| PATCH | `/api/app/requests/:id/items/:itemId` | server/app.ts:249 |
| GET | `/api/app/files/:id` | server/app.ts:267 |
| GET | `/api/public/:token` | server/app.ts:337 |
| PUT | `/api/public/:token/items/:itemId/upload` | server/app.ts:356 |
| DELETE | `/api/public/:token/files/:fileId` | server/app.ts:391 |
| GET | `/api/health` | server/app.ts:412 |
| POST | `/api/billing/webhook` | server/app.ts:418 |
| SPA | `/r/:token` | src/App.tsx:11 |
| SPA | `/*` | src/App.tsx:19 |
| SPA | `/` | src/PreparerApp.tsx:30 |
| SPA | `/new` | src/PreparerApp.tsx:31 |
| SPA | `/request/:id` | src/PreparerApp.tsx:32 |
| SPA | `/settings` | src/PreparerApp.tsx:33 |
<!-- gen:routes:end -->

## db
<!-- gen:db:start -->
- **firms** (schema.sql:3): id uuid, owner_user_id text, name text, region text, language text, plan text, notify_email text, reply_to text, created_at timestamptz
- **requests** (schema.sql:17): id uuid, firm_id uuid→firms, client_name text, client_email text, client_phone text, language text, template_id text, title text, due_date date, link_version integer, status text, initial_sent_at timestamptz, reminders_sent integer, last_reminder_at timestamptz, next_reminder_at timestamptz, created_at timestamptz
- **request_items** (schema.sql:38): id uuid, request_id uuid→requests, position integer, key text, label_en text, label_ar text, required boolean, status text, note text
- **files** (schema.sql:52): id uuid, request_id uuid→requests, item_id uuid→request_items, r2_key text, original_name text, content_type text, size_bytes bigint, uploaded_at timestamptz
- **email_log** (schema.sql:65): id bigserial, request_id uuid→requests, to_email text, kind text, provider text, sent_at timestamptz
- indexes: requests_firm_idx(requests), requests_due_idx(requests), items_request_idx(request_items), files_request_idx(files), files_item_idx(files), email_log_sent_idx(email_log)
<!-- gen:db:end -->

## env
<!-- gen:env:start -->
- `CronEnv` (cron/src/index.ts) extends EmailEnv, MailEnv: DATABASE_URL
- `Env` (server/types.ts) extends MailEnv: BUCKET, DATABASE_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, TRIAL_REQUEST_LIMIT, EXTRA_ORIGINS
- `EmailEnv` (shared/email.ts): EMAIL_PROVIDER, EMAIL_FROM, RESEND_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
- `MailEnv` (shared/mailer.ts) extends EmailEnv: APP_URL, LINK_SECRET, DAILY_EMAIL_CAP
- cron/wrangler.toml [triggers]: crons
- cron/wrangler.toml [vars]: APP_URL, EMAIL_PROVIDER, EMAIL_FROM, DAILY_EMAIL_CAP
- wrangler.toml [r2_buckets]: BUCKET
- wrangler.toml [vars]: APP_URL, EMAIL_PROVIDER, EMAIL_FROM, DAILY_EMAIL_CAP, TRIAL_REQUEST_LIMIT
- .dev.vars.example: DATABASE_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, LINK_SECRET, APP_URL, RESEND_API_KEY
- .env.example: VITE_CLERK_PUBLISHABLE_KEY
- browser (Vite): VITE_CLERK_PUBLISHABLE_KEY (src/PreparerApp.tsx)
<!-- gen:env:end -->

## scripts
<!-- gen:scripts:start -->
- `npm run predev`: node -e "require('fs').mkdirSync('dist',{recursive:true})"
- `npm run dev`: concurrently -k -n web,api -c cyan,magenta "vite" "wrangler pages dev dist --port 8788"
- `npm run build`: vite build
- `npm run typecheck`: tsc -p tsconfig.json && tsc -p server/tsconfig.json && tsc -p cron/tsconfig.json
- `npm run test`: vitest run
- `npm run deploy`: npm run build && wrangler pages deploy dist --project-name docnudge
- `npm run deploy:cron`: wrangler deploy --config cron/wrangler.toml
<!-- gen:scripts:end -->

## i18n
<!-- gen:i18n:start -->
- src/locales/ar.json: 93 keys (parity ok)
- src/locales/en.json: 93 keys (parity ok)
<!-- gen:i18n:end -->

## templates
<!-- gen:templates:start -->
us.individual (8 items, 4 optional, annual) · us.self_employed (7 items, 3 optional, annual) · au.individual (8 items, 6 optional, annual) · au.bas (5 items, 2 optional, quarterly) · au.bookkeeping (5 items, 2 optional, manual) · ae.vat (6 items, 3 optional, quarterly) · ae.corporate_tax (6 items, 3 optional, manual) · ae.onboarding (8 items, 3 optional, manual)
<!-- gen:templates:end -->
