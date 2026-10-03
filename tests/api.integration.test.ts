// Runs the real API code (server/app.ts) and the cron job against a real Postgres engine (PGlite, in memory).
// Only three things are faked: the Neon HTTP driver (same SQL, different transport), Clerk sign-in and R2.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const ctx: { db: any } = { db: null };

  class Q implements PromiseLike<unknown[]> {
    text: string;
    params: unknown[];
    constructor(text: string, params: unknown[]) {
      this.text = text;
      this.params = params;
    }
    then<A = unknown[], B = never>(ok?: ((v: unknown[]) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return ctx.db
        .query(this.text, this.params)
        .then((r: { rows: unknown[] }) => r.rows)
        .then(ok, err);
    }
  }

  function makeSql() {
    const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = '';
      const params: unknown[] = [];
      strings.forEach((s, i) => {
        text += s;
        if (i < values.length) {
          const v = values[i] as { __raw?: string } | null;
          if (v && typeof v === 'object' && '__raw' in v) text += v.__raw;
          else {
            params.push(values[i]);
            text += `$${params.length}`;
          }
        }
      });
      return new Q(text, params);
    };
    sql.unsafe = (raw: string) => ({ __raw: raw });
    sql.query = (text: string, params: unknown[] = []) => new Q(text, params);
    sql.transaction = async (queries: Q[] | ((s: unknown) => Q[])) => {
      const list = typeof queries === 'function' ? queries(sql) : queries;
      return ctx.db.transaction(async (tx: any) => {
        const out: unknown[] = [];
        for (const q of list) out.push((await tx.query(q.text, q.params)).rows);
        return out;
      });
    };
    return sql;
  }
  return { ctx, makeSql };
});

vi.mock('@neondatabase/serverless', () => ({ neon: () => h.makeSql() }));
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async (req: Request) => {
      const auth = req.headers.get('authorization') ?? '';
      if (!auth.startsWith('Bearer user_')) return { isSignedIn: false };
      const userId = auth.slice('Bearer '.length);
      return { isSignedIn: true, toAuth: () => ({ userId }) };
    },
  }),
}));

import { runReminders } from '../cron/src/index';
import { app } from '../server/app';

// ---- fake R2, fake email transport, fake execution context ------------------------------
const objects = new Map<string, { bytes: ArrayBuffer; type?: string }>();
const BUCKET = {
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    objects.set(key, { bytes: value, type: opts?.httpMetadata?.contentType });
  },
  async get(key: string) {
    const o = objects.get(key);
    return o ? { body: new Response(o.bytes).body } : null;
  },
  async delete(key: string) {
    objects.delete(key);
  },
};
const baseEnv = {
  BUCKET,
  DATABASE_URL: 'unused',
  CLERK_SECRET_KEY: 'unused',
  CLERK_PUBLISHABLE_KEY: 'unused',
  LINK_SECRET: 'integration-test-secret-integration',
  APP_URL: 'https://app.test',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'DocNudge <hi@mail.test>',
  RESEND_API_KEY: 're_test',
  DAILY_EMAIL_CAP: '10',
  TRIAL_REQUEST_LIMIT: '25',
};
type TestEnv = typeof baseEnv;

const pending: Promise<unknown>[] = [];
const exec = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
const sent: { url: string; body: any }[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{"id":"msg_1"}', { status: 200 });
  }),
);

async function call(
  method: string,
  path: string,
  o: { user?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string>; env?: Partial<TestEnv> } = {},
) {
  const headers: Record<string, string> = { ...(o.user ? { authorization: `Bearer ${o.user}` } : {}), ...(o.headers ?? {}) };
  let body: BodyInit | undefined = o.raw;
  if (o.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  const res = await app.request(path, { method, headers, body }, { ...baseEnv, ...o.env }, exec as never);
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, res, json: (isJson ? await res.json() : null) as any };
}
const tokenOf = (link: string) => link.split('/r/')[1];
const bytes = (n: number) => new Uint8Array(n).fill(7);
const put = (token: string, itemId: string, name: string, type = 'application/pdf', size = 5) =>
  call('PUT', `/api/public/${token}/items/${itemId}/upload?name=${encodeURIComponent(name)}`, {
    raw: bytes(size),
    headers: { 'content-type': type, 'content-length': String(size) },
  });

// ---- the scenario ------------------------------------------------------------------------
let requestId = '';
let link = '';
let items: { id: string; key: string; required: boolean; status: string; files: { id: string }[] }[] = [];

describe('API + cron against real Postgres', () => {
  beforeAll(async () => {
    h.ctx.db = new PGlite();
    await h.ctx.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  });

  it('rejects calls without a session', async () => {
    expect((await call('GET', '/api/app/me')).status).toBe(401);
    expect((await call('GET', '/api/app/requests')).status).toBe(401);
  });

  it('creates a firm on first sign-in and saves settings', async () => {
    const me = await call('GET', '/api/app/me', { user: 'user_1' });
    expect(me.status).toBe(200);
    expect(me.json.firm).toMatchObject({ region: 'us', plan: 'trial' });
    expect(me.json.emailsLeft).toBe(10);

    const bad = await call('PUT', '/api/app/firm', { user: 'user_1', body: { name: 'X', region: 'mars', language: 'en' } });
    expect(bad.status).toBe(400);
    const ok = await call('PUT', '/api/app/firm', {
      user: 'user_1',
      body: { name: 'Al Noor Accounting', region: 'ae', language: 'en', notifyEmail: 'owner@firm.test', replyTo: 'help@firm.test' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.firm).toMatchObject({ name: 'Al Noor Accounting', region: 'ae', notify_email: 'owner@firm.test' });
  });

  it('validates and creates a request, emailing the client in Arabic', async () => {
    expect((await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'L', templateId: 'nope' } })).status).toBe(400);
    expect((await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'L', templateId: 'ae.vat', clientEmail: 'bad' } })).status).toBe(400);

    const res = await call('POST', '/api/app/requests', {
      user: 'user_1',
      body: { clientName: 'Layla', clientEmail: 'Layla@Client.test', clientPhone: '+971 50 123 4567', templateId: 'ae.vat', dueDate: '2027-01-28', language: 'ar', sendNow: true },
    });
    expect(res.status).toBe(201);
    expect(res.json.emailStatus).toBe('sent');
    expect(res.json.link.startsWith('https://app.test/r/')).toBe(true);
    requestId = res.json.id;
    link = res.json.link;

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.resend.com/emails');
    expect(sent[0].body.to).toEqual(['layla@client.test']);
    expect(sent[0].body.reply_to).toBe('help@firm.test');
    expect(sent[0].body.html).toContain('dir="rtl"');
    expect(sent[0].body.html).toContain(link);
  });

  it('lists requests with progress counts and digits-only phone', async () => {
    const list = await call('GET', '/api/app/requests', { user: 'user_1' });
    expect(list.status).toBe(200);
    expect(list.json.requests).toHaveLength(1);
    expect(list.json.requests[0]).toMatchObject({ client_phone: '971501234567', required_total: 3, required_done: 0, status: 'open', due_date: '2027-01-28' });
  });

  it('lets the client open the link, and refuses tampered ones', async () => {
    const token = tokenOf(link);
    const ok = await call('GET', `/api/public/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ firmName: 'Al Noor Accounting', language: 'ar', clientName: 'Layla' });
    expect(ok.res.headers.get('cache-control')).toBe('no-store');
    items = ok.json.items;
    expect(items).toHaveLength(6);

    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect((await call('GET', `/api/public/${tampered}`)).status).toBe(404);
  });

  it('validates uploads', async () => {
    const token = tokenOf(link);
    const first = items[0].id;
    expect((await put(token, first, 'x.exe', 'application/x-msdownload')).status).toBe(415);
    expect((await put(token, first, 'big.pdf', 'application/pdf', 5)).status).toBe(200); // control: valid upload works
    const tooBig = await call('PUT', `/api/public/${token}/items/${first}/upload?name=big.pdf`, {
      raw: bytes(5),
      headers: { 'content-type': 'application/pdf', 'content-length': String(26 * 1024 * 1024) },
    });
    expect(tooBig.status).toBe(413);
    expect((await put(token, '00000000-0000-4000-8000-000000000000', 'a.pdf')).status).toBe(404);
  });

  it('completes the request once every required item is in, and notifies the firm', async () => {
    const token = tokenOf(link);
    const required = items.filter((i) => i.required);
    expect(required).toHaveLength(3);
    let last: Awaited<ReturnType<typeof put>> | null = null;
    for (const item of required.slice(1)) last = await put(token, item.id, `${item.key}.pdf`);
    expect(last!.json.requestStatus).toBe('complete');
    await Promise.all(pending);
    const note = sent.find((m) => m.body.to[0] === 'owner@firm.test');
    expect(note?.body.subject).toBe('Layla uploaded all required documents');
  });

  it('shows the firm the files and serves downloads only to the owner', async () => {
    const d = await call('GET', `/api/app/requests/${requestId}`, { user: 'user_1' });
    expect(d.status).toBe(200);
    expect(d.json.request.status).toBe('complete');
    const got = d.json.items.filter((i: any) => i.required);
    expect(got.every((i: any) => i.status === 'received' && i.files.length >= 1)).toBe(true);
    const fileId = got[0].files[0].id;

    const dl = await call('GET', `/api/app/files/${fileId}`, { user: 'user_1' });
    expect(dl.status).toBe(200);
    expect(dl.res.headers.get('content-disposition')).toContain('attachment');
    expect(dl.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await dl.res.arrayBuffer())).toEqual(bytes(5));

    expect((await call('GET', `/api/app/files/${fileId}`, { user: 'user_2' })).status).toBe(404);
    expect((await call('GET', `/api/app/requests/${requestId}`, { user: 'user_2' })).status).toBe(404);
  });

  it('reopens the request when the firm asks for a new file, and the client can fix it', async () => {
    const token = tokenOf(link);
    const bank = items.find((i) => i.key === 'bank')!;
    const rej = await call('PATCH', `/api/app/requests/${requestId}/items/${bank.id}`, { user: 'user_1', body: { status: 'rejected', note: 'Page 2 is cut off' } });
    expect(rej.json.requestStatus).toBe('open');

    const view = await call('GET', `/api/public/${token}`);
    const seen = view.json.items.find((i: any) => i.id === bank.id);
    expect(seen).toMatchObject({ status: 'rejected', note: 'Page 2 is cut off' });

    const again = await put(token, bank.id, 'bank-v2.pdf');
    expect(again.json.requestStatus).toBe('complete');
  });

  it('lets the client remove a file, and blocks removal after approval', async () => {
    const token = tokenOf(link);
    const purchases = items.find((i) => i.key === 'purchases')!;
    const view = await call('GET', `/api/public/${token}`);
    const file = view.json.items.find((i: any) => i.id === purchases.id).files[0];
    const del = await call('DELETE', `/api/public/${token}/files/${file.id}`);
    expect(del.status).toBe(200);
    expect(del.json.requestStatus).toBe('open');

    await put(token, purchases.id, 'p.pdf');
    await call('PATCH', `/api/app/requests/${requestId}/items/${purchases.id}`, { user: 'user_1', body: { status: 'approved' } });
    const after = await call('GET', `/api/public/${token}`);
    const f2 = after.json.items.find((i: any) => i.id === purchases.id).files[0];
    expect((await call('DELETE', `/api/public/${token}/files/${f2.id}`)).status).toBe(409);
    expect((await put(token, purchases.id, 'late.pdf')).status).toBe(409);
  });

  it('revokes the old link when it is replaced', async () => {
    const rot = await call('POST', `/api/app/requests/${requestId}/rotate-link`, { user: 'user_1', body: {} });
    expect(rot.status).toBe(200);
    expect((await call('GET', `/api/public/${tokenOf(link)}`)).status).toBe(404);
    link = rot.json.link;
    expect((await call('GET', `/api/public/${tokenOf(link)}`)).status).toBe(200);
  });

  it('enforces the daily email cap', async () => {
    const r = await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'Omar', clientEmail: 'omar@client.test', templateId: 'ae.vat', language: 'en' } });
    expect(r.status).toBe(201);
    expect(r.json.emailStatus).toBe('skipped');
    const capped = await call('POST', `/api/app/requests/${r.json.id}/send`, { user: 'user_1', body: {}, env: { DAILY_EMAIL_CAP: '0' } });
    expect(capped.status).toBe(429);
    expect(capped.json.error).toBe('daily_email_cap');
  });

  it('cron sends reminders only inside the region send window and records them', async () => {
    const mk = await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'Sara', clientEmail: 'sara@client.test', templateId: 'ae.vat', language: 'en', dueDate: '2027-01-28' } });
    const id = mk.json.id;
    expect((await call('POST', `/api/app/requests/${id}/send`, { user: 'user_1', body: {} })).json.kind).toBe('initial');
    await h.ctx.db.query(`update requests set next_reminder_at = now() - interval '1 hour' where id = $1`, [id]);

    const before = sent.length;
    const cronEnv = { ...baseEnv, DAILY_EMAIL_CAP: '50' };
    expect(await runReminders(cronEnv as never, new Date('2026-12-01T20:00:00Z'))).toEqual({ sent: 0, failed: 0 }); // 00:00 in the UAE
    expect(sent.length).toBe(before);

    expect(await runReminders(cronEnv as never, new Date('2026-12-01T06:00:00Z'))).toEqual({ sent: 1, failed: 0 });
    const email = sent[sent.length - 1].body;
    expect(email.to).toEqual(['sara@client.test']);
    expect(email.subject).toMatch(/^Reminder:/);

    const row = (await h.ctx.db.query(`select reminders_sent, next_reminder_at > now() as scheduled from requests where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ reminders_sent: 1, scheduled: true });
    const log = (await h.ctx.db.query(`select kind from email_log where request_id = $1 order by id`, [id])).rows.map((r: any) => r.kind);
    expect(log).toEqual(['initial', 'reminder']);
  });

  it('cron backs off when the email provider fails', async () => {
    const id = (await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'Noor', clientEmail: 'noor@client.test', templateId: 'ae.vat', language: 'en' } })).json.id;
    await call('POST', `/api/app/requests/${id}/send`, { user: 'user_1', body: {} });
    await h.ctx.db.query(`update requests set next_reminder_at = now() - interval '1 hour' where id = $1`, [id]);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response('nope', { status: 500 }));
    const res = await runReminders({ ...baseEnv, DAILY_EMAIL_CAP: '50' } as never, new Date('2026-12-01T06:00:00Z'));
    expect(res).toEqual({ sent: 0, failed: 1 });
    const row = (await h.ctx.db.query(`select next_reminder_at > now() as later from requests where id = $1`, [id])).rows[0];
    expect(row.later).toBe(true);
  });

  it('applies the trial limit until the firm is activated, and hides archived requests', async () => {
    const limited = await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'Z', templateId: 'ae.vat' }, env: { TRIAL_REQUEST_LIMIT: '1' } });
    expect(limited.status).toBe(402);
    expect(limited.json.error).toBe('plan_limit');

    await h.ctx.db.query(`update firms set plan = 'active' where owner_user_id = 'user_1'`);
    const allowed = await call('POST', '/api/app/requests', { user: 'user_1', body: { clientName: 'Z', templateId: 'ae.vat' }, env: { TRIAL_REQUEST_LIMIT: '1' } });
    expect(allowed.status).toBe(201);

    await call('PATCH', `/api/app/requests/${requestId}`, { user: 'user_1', body: { status: 'archived' } });
    expect((await call('GET', `/api/public/${tokenOf(link)}`)).status).toBe(404);
  });
});
