import { createClerkClient } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { sendEmail } from '../shared/email';
import { completeEmail } from '../shared/emailTemplates';
import { buildLink, capRemaining, deliverRequestEmail, type Sql } from '../shared/mailer';
import { REGIONS, getTemplate, type Lang, type Region } from '../shared/packs';
import { verifyToken } from '../shared/tokens';
import type { Env, FirmRow, Vars } from './types';

type AppEnv = { Bindings: Env; Variables: Vars };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_ITEM = 10;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isUuid = (s: string) => UUID_RE.test(s);
const sqlOf = (env: Env): Sql => neon(env.DATABASE_URL);
const cleanName = (n: string) => n.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 120) || 'document';
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

// Columns for a request row. Dates are cast to text so they stay YYYY-MM-DD (no time zone surprises).
const REQ_COLS =
  "r.id, r.firm_id, r.client_name, r.client_email, r.client_phone, r.language, r.template_id, r.title, r.due_date::text as due_date, r.link_version, r.status, r.initial_sent_at, r.reminders_sent, r.last_reminder_at, r.next_reminder_at, r.created_at";
const FIRM_COLS = 'id, owner_user_id, name, region, language, plan, notify_email, reply_to';

/** Mark a request complete when every required item is received/approved, or reopen it if one needs fixing. */
async function recomputeRequestStatus(sql: Sql, requestId: string): Promise<'open' | 'complete'> {
  const rows = await sql`select count(*)::int as missing from request_items where request_id = ${requestId} and required and status in ('pending','rejected')`;
  if (Number(rows[0]?.missing) === 0) {
    await sql`update requests set status = 'complete', next_reminder_at = null where id = ${requestId} and status = 'open'`;
    return 'complete';
  }
  await sql`update requests set status = 'open', next_reminder_at = case when initial_sent_at is not null and client_email is not null then now() + interval '3 days' else null end where id = ${requestId} and status = 'complete'`;
  return 'open';
}

// ------------------------------------------------------------------------------------------
// Signed-in firm routes  (/api/app/*)
// ------------------------------------------------------------------------------------------
const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origins = [new URL(c.env.APP_URL).origin, ...(c.env.EXTRA_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
  const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY, publishableKey: c.env.CLERK_PUBLISHABLE_KEY });
  const state = await clerk.authenticateRequest(c.req.raw, { authorizedParties: origins });
  if (!state.isSignedIn) return c.json({ error: 'unauthorized' }, 401);
  const userId = state.toAuth().userId;

  const sql = sqlOf(c.env);
  let rows = await sql`select ${sql.unsafe(FIRM_COLS)} from firms where owner_user_id = ${userId}`;
  if (!rows[0]) {
    await sql`insert into firms (owner_user_id) values (${userId}) on conflict (owner_user_id) do nothing`;
    rows = await sql`select ${sql.unsafe(FIRM_COLS)} from firms where owner_user_id = ${userId}`;
  }
  c.set('userId', userId);
  c.set('firm', rows[0] as FirmRow);
  await next();
};

const authed = new Hono<AppEnv>();
authed.use('*', requireUser);

authed.get('/me', async (c) => {
  const sql = sqlOf(c.env);
  return c.json({ firm: c.get('firm'), emailsLeft: await capRemaining(sql, c.env.DAILY_EMAIL_CAP) });
});

authed.put('/firm', async (c) => {
  const firm = c.get('firm');
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return c.json({ error: 'bad_request' }, 400);
  const name = str(b.name, 120);
  if (!name) return c.json({ error: 'name_required' }, 400);
  const region = String(b.region) as Region;
  if (!(region in REGIONS)) return c.json({ error: 'invalid_region' }, 400);
  const language: Lang = b.language === 'ar' ? 'ar' : 'en';
  const notifyEmail = str(b.notifyEmail, 200)?.toLowerCase() ?? null;
  const replyTo = str(b.replyTo, 200)?.toLowerCase() ?? null;
  if ((notifyEmail && !EMAIL_RE.test(notifyEmail)) || (replyTo && !EMAIL_RE.test(replyTo))) return c.json({ error: 'invalid_email' }, 400);

  const sql = sqlOf(c.env);
  const rows = await sql`update firms set name = ${name}, region = ${region}, language = ${language}, notify_email = ${notifyEmail}, reply_to = ${replyTo} where id = ${firm.id} returning ${sql.unsafe(FIRM_COLS)}`;
  return c.json({ firm: rows[0] });
});

authed.get('/requests', async (c) => {
  const firm = c.get('firm');
  const sql = sqlOf(c.env);
  const rows = await sql`
    select ${sql.unsafe(REQ_COLS)},
      (count(i.id) filter (where i.required))::int as required_total,
      (count(i.id) filter (where i.required and i.status in ('received','approved')))::int as required_done
    from requests r left join request_items i on i.request_id = r.id
    where r.firm_id = ${firm.id} and r.status <> 'archived'
    group by r.id
    order by r.created_at desc
    limit 200`;
  const requests = await Promise.all(rows.map(async (r) => ({ ...r, link: await buildLink(c.env, r.id, Number(r.link_version)) })));
  return c.json({ requests });
});

authed.post('/requests', async (c) => {
  const firm = c.get('firm');
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return c.json({ error: 'bad_request' }, 400);

  const clientName = str(b.clientName, 120);
  if (!clientName) return c.json({ error: 'client_name_required' }, 400);
  const template = getTemplate(String(b.templateId));
  if (!template) return c.json({ error: 'unknown_template' }, 400);
  const email = str(b.clientEmail, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return c.json({ error: 'invalid_email' }, 400);
  const phone = typeof b.clientPhone === 'string' && b.clientPhone.trim() ? b.clientPhone.replace(/\D/g, '') : null;
  if (phone && (phone.length < 8 || phone.length > 15)) return c.json({ error: 'invalid_phone' }, 400);
  const language: Lang = b.language === 'ar' ? 'ar' : 'en';
  const dueDate = typeof b.dueDate === 'string' && DATE_RE.test(b.dueDate) ? b.dueDate : null;
  const title = str(b.title, 160) ?? template[language];

  if (firm.plan === 'canceled') return c.json({ error: 'plan_inactive' }, 402);
  const sql = sqlOf(c.env);
  const limit = Number(c.env.TRIAL_REQUEST_LIMIT ?? 25);
  if (firm.plan === 'trial' && limit > 0) {
    const n = await sql`select count(*)::int as n from requests where firm_id = ${firm.id} and status <> 'archived'`;
    if (Number(n[0]?.n) >= limit) return c.json({ error: 'plan_limit' }, 402);
  }

  const id = crypto.randomUUID();
  const items = template.items;
  await sql.transaction([
    sql`insert into requests (id, firm_id, client_name, client_email, client_phone, language, template_id, title, due_date)
        values (${id}, ${firm.id}, ${clientName}, ${email}, ${phone}, ${language}, ${template.id}, ${title}, ${dueDate})`,
    sql`insert into request_items (request_id, position, key, label_en, label_ar, required)
        select ${id}::uuid, t.pos, t.key, t.en, t.ar, t.req
        from unnest(${items.map((_, i) => i)}::int[], ${items.map((x) => x.key)}::text[], ${items.map((x) => x.en)}::text[], ${items.map((x) => x.ar)}::text[], ${items.map((x) => x.required)}::boolean[]) as t(pos, key, en, ar, req)`,
  ]);

  const link = await buildLink(c.env, id, 1);
  let emailStatus: 'skipped' | 'sent' | 'cap' | 'failed' = 'skipped';
  if (b.sendNow === true && email) {
    if ((await capRemaining(sql, c.env.DAILY_EMAIL_CAP)) <= 0) emailStatus = 'cap';
    else {
      try {
        await deliverRequestEmail(sql, c.env, { id, client_name: clientName, client_email: email, language, title, due_date: dueDate, link_version: 1, reminders_sent: 0, firm_name: firm.name, reply_to: firm.reply_to }, 'initial');
        emailStatus = 'sent';
      } catch (err) {
        console.error('initial email failed', err);
        emailStatus = 'failed';
      }
    }
  }
  return c.json({ id, link, emailStatus }, 201);
});

authed.get('/requests/:id', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const rows = await sql`select ${sql.unsafe(REQ_COLS)} from requests r where r.id = ${id} and r.firm_id = ${firm.id}`;
  const r = rows[0];
  if (!r) return c.json({ error: 'not_found' }, 404);
  const [items, files] = await Promise.all([
    sql`select id, position, key, label_en, label_ar, required, status, note from request_items where request_id = ${id} order by position`,
    sql`select id, item_id, original_name, content_type, size_bytes::int as size_bytes, uploaded_at from files where request_id = ${id} order by uploaded_at`,
  ]);
  return c.json({
    request: { ...r, link: await buildLink(c.env, r.id, Number(r.link_version)) },
    items: items.map((i) => ({ ...i, files: files.filter((f) => f.item_id === i.id) })),
  });
});

authed.patch('/requests/:id', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return c.json({ error: 'bad_request' }, 400);
  const sql = sqlOf(c.env);
  if (b.status === 'archived') {
    await sql`update requests set status = 'archived', next_reminder_at = null where id = ${id} and firm_id = ${firm.id}`;
  }
  if ('dueDate' in b) {
    const due = typeof b.dueDate === 'string' && DATE_RE.test(b.dueDate) ? b.dueDate : null;
    await sql`update requests set due_date = ${due} where id = ${id} and firm_id = ${firm.id}`;
  }
  return c.json({ ok: true });
});

authed.post('/requests/:id/send', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const rows = await sql`select ${sql.unsafe(REQ_COLS)} from requests r where r.id = ${id} and r.firm_id = ${firm.id}`;
  const r = rows[0];
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (!r.client_email) return c.json({ error: 'no_client_email' }, 400);
  if (r.status !== 'open') return c.json({ error: 'not_open' }, 409);
  if ((await capRemaining(sql, c.env.DAILY_EMAIL_CAP)) <= 0) return c.json({ error: 'daily_email_cap' }, 429);
  const kind = r.initial_sent_at ? 'reminder' : 'initial';
  try {
    await deliverRequestEmail(sql, c.env, {
      id: r.id,
      client_name: r.client_name,
      client_email: r.client_email,
      language: r.language,
      title: r.title,
      due_date: r.due_date,
      link_version: Number(r.link_version),
      reminders_sent: Number(r.reminders_sent),
      firm_name: firm.name,
      reply_to: firm.reply_to,
    }, kind);
  } catch (err) {
    console.error('send failed', err);
    return c.json({ error: 'email_failed' }, 502);
  }
  return c.json({ ok: true, kind });
});

authed.post('/requests/:id/rotate-link', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const rows = await sql`update requests set link_version = link_version + 1 where id = ${id} and firm_id = ${firm.id} returning id, link_version`;
  if (!rows[0]) return c.json({ error: 'not_found' }, 404);
  return c.json({ link: await buildLink(c.env, id, Number(rows[0].link_version)) });
});

authed.patch('/requests/:id/items/:itemId', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!isUuid(id) || !isUuid(itemId)) return c.json({ error: 'not_found' }, 404);
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const status = b?.status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'received') return c.json({ error: 'invalid_status' }, 400);
  const note = status === 'rejected' ? str(b?.note, 300) : null;

  const sql = sqlOf(c.env);
  const own = await sql`select 1 as ok from requests where id = ${id} and firm_id = ${firm.id}`;
  if (!own[0]) return c.json({ error: 'not_found' }, 404);
  const upd = await sql`update request_items set status = ${status}, note = ${note} where id = ${itemId} and request_id = ${id} returning id`;
  if (!upd[0]) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, requestStatus: await recomputeRequestStatus(sql, id) });
});

authed.get('/files/:id', async (c) => {
  const firm = c.get('firm');
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const rows = await sql`select f.r2_key, f.original_name, f.content_type from files f join requests r on r.id = f.request_id where f.id = ${id} and r.firm_id = ${firm.id}`;
  const f = rows[0];
  if (!f) return c.json({ error: 'not_found' }, 404);
  const obj = await c.env.BUCKET.get(f.r2_key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': f.content_type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

// ------------------------------------------------------------------------------------------
// Client routes  (/api/public/:token/*)  No login. The signed token in the URL is the credential.
// ------------------------------------------------------------------------------------------
interface PubReq {
  id: string;
  firm_id: string;
  client_name: string;
  title: string;
  due_date: string | null;
  language: Lang;
  status: 'open' | 'complete' | 'archived';
  firm_name: string;
  firm_notify_email: string | null;
  firm_language: Lang;
}

async function resolveToken(env: Env, token: string): Promise<PubReq | null> {
  const parsed = await verifyToken(env.LINK_SECRET, token); // signature check first: no DB hit for junk
  if (!parsed) return null;
  const sql = sqlOf(env);
  const rows = await sql`
    select r.id, r.firm_id, r.client_name, r.title, r.due_date::text as due_date, r.language, r.status, r.link_version,
           f.name as firm_name, f.notify_email as firm_notify_email, f.language as firm_language, f.plan as firm_plan
    from requests r join firms f on f.id = r.firm_id where r.id = ${parsed.requestId}`;
  const r = rows[0];
  if (!r || Number(r.link_version) !== parsed.version) return null;
  if (r.status === 'archived' || r.firm_plan === 'canceled') return null;
  return r as PubReq;
}

async function notifyComplete(env: Env, sql: Sql, r: PubReq): Promise<void> {
  if (!r.firm_notify_email) return;
  try {
    if ((await capRemaining(sql, env.DAILY_EMAIL_CAP)) <= 0) return;
    const link = `${env.APP_URL.replace(/\/+$/, '')}/request/${r.id}`;
    const mail = completeEmail({ lang: r.firm_language, clientName: r.client_name, title: r.title, link });
    await sendEmail(env, { to: r.firm_notify_email, ...mail });
    await sql`insert into email_log (request_id, to_email, kind, provider) values (${r.id}, ${r.firm_notify_email}, 'complete', ${env.EMAIL_PROVIDER ?? 'resend'})`;
  } catch (err) {
    console.error('notifyComplete failed', err);
  }
}

const pub = new Hono<AppEnv>();
pub.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
});

pub.get('/:token', async (c) => {
  const r = await resolveToken(c.env, c.req.param('token'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const [items, files] = await Promise.all([
    sql`select id, position, key, label_en, label_ar, required, status, note from request_items where request_id = ${r.id} order by position`,
    sql`select id, item_id, original_name, size_bytes::int as size_bytes from files where request_id = ${r.id} order by uploaded_at`,
  ]);
  return c.json({
    firmName: r.firm_name,
    clientName: r.client_name,
    title: r.title,
    dueDate: r.due_date,
    language: r.language,
    status: r.status,
    items: items.map((i) => ({ ...i, files: files.filter((f) => f.item_id === i.id) })),
  });
});

pub.put('/:token/items/:itemId/upload', async (c) => {
  const r = await resolveToken(c.env, c.req.param('token'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const itemId = c.req.param('itemId');
  if (!isUuid(itemId)) return c.json({ error: 'not_found' }, 404);

  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return c.json({ error: 'unsupported_type' }, 415);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (!declared || declared > MAX_UPLOAD_BYTES) return c.json({ error: 'too_large', maxBytes: MAX_UPLOAD_BYTES }, 413);

  const sql = sqlOf(c.env);
  const item = (await sql`select id, status from request_items where id = ${itemId} and request_id = ${r.id}`)[0];
  if (!item) return c.json({ error: 'not_found' }, 404);
  if (item.status === 'approved') return c.json({ error: 'item_approved' }, 409);
  const count = await sql`select count(*)::int as n from files where item_id = ${itemId}`;
  if (Number(count[0]?.n) >= MAX_FILES_PER_ITEM) return c.json({ error: 'too_many_files' }, 409);

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: 'too_large', maxBytes: MAX_UPLOAD_BYTES }, 413);

  const fileId = crypto.randomUUID();
  const name = cleanName(c.req.query('name') ?? 'document');
  const key = `${r.firm_id}/${r.id}/${itemId}/${fileId}`; // never put user-supplied names in the key
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  await sql.transaction([
    sql`insert into files (id, request_id, item_id, r2_key, original_name, content_type, size_bytes) values (${fileId}, ${r.id}, ${itemId}, ${key}, ${name}, ${type}, ${bytes.byteLength})`,
    sql`update request_items set status = 'received', note = null where id = ${itemId}`,
  ]);

  const status = await recomputeRequestStatus(sql, r.id);
  if (r.status === 'open' && status === 'complete') c.executionCtx.waitUntil(notifyComplete(c.env, sql, r));
  return c.json({ ok: true, fileId, requestStatus: status });
});

pub.delete('/:token/files/:fileId', async (c) => {
  const r = await resolveToken(c.env, c.req.param('token'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const fileId = c.req.param('fileId');
  if (!isUuid(fileId)) return c.json({ error: 'not_found' }, 404);
  const sql = sqlOf(c.env);
  const f = (await sql`select f.id, f.item_id, f.r2_key, i.status as item_status from files f join request_items i on i.id = f.item_id where f.id = ${fileId} and f.request_id = ${r.id}`)[0];
  if (!f) return c.json({ error: 'not_found' }, 404);
  if (f.item_status === 'approved') return c.json({ error: 'item_approved' }, 409);
  await c.env.BUCKET.delete(f.r2_key);
  await sql`delete from files where id = ${fileId}`;
  const left = await sql`select count(*)::int as n from files where item_id = ${f.item_id}`;
  if (Number(left[0]?.n) === 0) await sql`update request_items set status = 'pending' where id = ${f.item_id}`;
  return c.json({ ok: true, requestStatus: await recomputeRequestStatus(sql, r.id) });
});

// ------------------------------------------------------------------------------------------
// App
// ------------------------------------------------------------------------------------------
export const app = new Hono<AppEnv>().basePath('/api');
app.use('*', secureHeaders());
app.get('/health', (c) => c.json({ ok: true }));
app.route('/app', authed);
app.route('/public', pub);

// Billing is intentionally a stub. Pick a merchant of record that pays out to your country
// (Dodo Payments or Paddle), then verify its webhook signature here and set firms.plan.
app.post('/billing/webhook', (c) => c.json({ error: 'billing_not_configured' }, 501));

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});
