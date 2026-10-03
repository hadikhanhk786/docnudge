# DocNudge (working name)

Document collection for tax preparers, bookkeepers and accountants. The accountant picks a regional checklist
(US, Australia, UAE), the client opens a no-login link on their phone, uploads documents item by item
(English or Arabic), and gets reminders until everything is in.

**Stack, all on free tiers:** Cloudflare Pages (UI + `/api` Functions), Neon Postgres, Clerk (accountant logins),
Cloudflare R2 (files), Resend or Amazon SES (email), and one Cloudflare Worker on a cron trigger (reminders).

## How it works

- **Accountant** signs in (Clerk), creates a request from a template, then shares the link by copy, WhatsApp
  (free click-to-chat link, no API) or email.
- **Client** opens `/r/<token>`. No account. The token is signed (HMAC) so nothing secret is stored; "Replace link"
  bumps a version number and the old link stops working.
- **Reminders** run hourly in a separate Worker. They only send during business hours for the firm's region and never
  beyond `DAILY_EMAIL_CAP` per rolling 24 hours (default 90, to stay under Resend's free 100/day).

```
shared/    Logic shared by UI, API and cron: region packs (EN+AR), reminder cadence, send windows,
           signed links, email templates + providers, daily cap
server/    Hono API: /api/app/* (signed-in firm) and /api/public/:token/* (client)
functions/ Pages Functions entry (one file that hands /api/* to server/app.ts)
cron/      Reminder Worker (own wrangler.toml)
src/       React app. Firm side: dashboard, new request, request detail, settings. Client side: upload page
schema.sql Database tables
tests/     35 tests (see Tests)
```

## Setup (about 45 minutes)

0. `npx wrangler login`
1. `npm install`
2. **Neon:** create a project, run `schema.sql` in the SQL editor, copy the connection string.
3. **Clerk:** create an application, copy the publishable and secret keys.
4. **R2:** `npx wrangler r2 bucket create docnudge-uploads` (Cloudflare asks for a payment method; the free allowance still applies).
5. **Email:** create a Resend account, verify your sending domain, create an API key. Set `EMAIL_FROM` in **both** `wrangler.toml` and `cron/wrangler.toml`.
6. **Run locally:** copy `.dev.vars.example` to `.dev.vars` and `.env.example` to `.env`, fill them in
   (`LINK_SECRET`: `openssl rand -base64 32`), then `npm run dev` and open **http://localhost:5173**.
   Vite serves the UI and proxies `/api` to the local Workers runtime on port 8788.
7. **Deploy the app:**
   - `npx wrangler pages project create docnudge`
   - for each of `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `LINK_SECRET`, `RESEND_API_KEY`:
     `npx wrangler pages secret put NAME --project-name docnudge`
   - `npm run deploy` (builds locally, so `.env` supplies `VITE_CLERK_PUBLISHABLE_KEY`)
   - set `APP_URL` in `wrangler.toml` to the live URL (or your custom domain) and deploy again.
   - Use Clerk **production** keys for the live site. Preview deployments need their origin in `EXTRA_ORIGINS`.
8. **Deploy reminders:** `npx wrangler secret put DATABASE_URL --config cron/wrangler.toml`, then the same for
   `LINK_SECRET` (must match the app's) and `RESEND_API_KEY`, then `npm run deploy:cron`.
9. **Protect uploads:** add a Cloudflare WAF rate-limiting rule for `/api/public/*` (for example 30 requests/minute per IP).

## Tests

`npm test` runs 35 tests. The API and cron code run against a real Postgres engine (PGlite, in memory) using
`schema.sql`, so the SQL, token checks, upload rules, reminder windows and daily cap are exercised for real.
Faked in tests: the Neon HTTP transport, Clerk sign-in, R2 and the email provider.
**Not tested:** live Neon, Clerk, R2, Resend or SES calls, and the React UI in a browser. Do a real run-through
on a phone (iOS Safari photos and Android Chrome) before you show anyone.

## Email: Resend now, SES later

Free Resend stops at 100 emails a day, so the default cap is 90. To move to Amazon SES (about $0.10 per 1,000
emails, needs an AWS production-access request): set `EMAIL_PROVIDER = "ses"` in both toml files, add
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` as secrets for both projects, and raise `DAILY_EMAIL_CAP`.

## Billing is not built

Every firm starts on `plan = 'trial'`, limited to `TRIAL_REQUEST_LIMIT` open requests (default 25).
While you validate, activate a firm by hand:

```sql
update firms set plan = 'active' where owner_user_id = 'user_xxx';  -- the Clerk user id
```

`POST /api/billing/webhook` is a stub that returns 501. When you pick a merchant of record that pays out to your
country, verify its webhook signature there and map its events to `firms.plan` (`active`, `past_due`, `canceled`).
Canceled firms stop getting reminders and their client links stop working.

## Before you launch

- **Arabic** text was drafted by an AI. Have a native speaker review `src/locales/ar.json`, the email templates and the
  checklist labels in `shared/packs.ts`.
- **Deadlines** in `shared/packs.ts` are hints with a note telling the accountant to verify them. Check them against the
  official source for each tax year, and keep them updated.
- **Privacy:** uploads can contain IDs and tax numbers. Write a privacy policy and a retention/deletion routine
  (nothing deletes files automatically yet), and check data-protection rules in each country you sell to
  (EU, Saudi Arabia and others restrict moving personal data abroad). This is not legal advice.
- **Security:** links are signed and revocable, downloads are served as attachments with `nosniff`, and uploads are
  limited by type (no HTML or SVG) and size (25 MB). There is no virus scanning. Turn on MFA for accountants in Clerk.
- **Email deliverability:** verify SPF and DKIM with your provider and send test messages to Gmail and Outlook.

## Known gaps

No zip export of a client's files. The client is not notified automatically when you ask for a new file (nudge them
by email or WhatsApp). Send windows use the firm's region, not the client's time zone. Deadline notes are in English
only. No AI document checks (v2: they cost money per document, so price them into a plan).
