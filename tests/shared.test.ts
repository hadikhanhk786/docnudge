import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';
import { planForEvent, verifyWebhook } from '../shared/billing';
import { completeEmail, requestEmail } from '../shared/emailTemplates';
import { requestsToCsv } from '../src/lib/csv';
import type { RequestRow } from '../src/lib/types';
import { capRemaining, type Sql } from '../shared/mailer';
import { formatDate, waLink, waMessage } from '../shared/messages';
import { ALL_TEMPLATES, REGIONS, getTemplate, suggestDueDate } from '../shared/packs';
import { MAX_REMINDERS, nextReminderAt } from '../shared/reminders';
import { inSendWindow } from '../shared/schedule';
import { makeToken, verifyToken } from '../shared/tokens';

const SECRET = 'test-secret';
const ID = '3f2b8c1e-7a4d-4e9b-8c55-0d1f2a3b4c5d';

describe('client link tokens', () => {
  it('round-trips', async () => {
    const token = await makeToken(SECRET, ID, 1);
    expect(await verifyToken(SECRET, token)).toEqual({ requestId: ID, version: 1 });
  });

  it('rejects wrong secret, tampered signature, tampered version and junk', async () => {
    const token = await makeToken(SECRET, ID, 1);
    expect(await verifyToken('another-secret', token)).toBeNull();
    expect(await verifyToken(SECRET, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).toBeNull();
    expect(await verifyToken(SECRET, token.replace('.1.', '.2.'))).toBeNull();
    expect(await verifyToken(SECRET, 'nonsense')).toBeNull();
    expect(await verifyToken(SECRET, `${ID}.1.`)).toBeNull();
    expect(await verifyToken(SECRET, `not-a-uuid.1.abc`)).toBeNull();
  });

  it('gives every link version a different signature (so rotating revokes old links)', async () => {
    expect(await makeToken(SECRET, ID, 1)).not.toBe(await makeToken(SECRET, ID, 2));
  });

  it('is deterministic and rejects malformed shapes', async () => {
    const token = await makeToken(SECRET, ID, 3);
    expect(await makeToken(SECRET, ID, 3)).toBe(token);
    expect(await verifyToken(SECRET, `${token}.extra`)).toBeNull();
    expect(await verifyToken(SECRET, `${ID}.1234567.${token.split('.')[2]}`)).toBeNull();
    expect(await verifyToken(SECRET, `${ID}.-1.${token.split('.')[2]}`)).toBeNull();
  });
});

describe('reminder cadence', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);

  it('every 3 days when there is no due date or it is far away', () => {
    expect(nextReminderAt({ now, dueDate: null, sent: 0 })).toEqual(inDays(3));
    expect(nextReminderAt({ now, dueDate: inDays(30), sent: 2 })).toEqual(inDays(3));
  });
  it('every 2 days in the last week', () => {
    expect(nextReminderAt({ now, dueDate: inDays(6), sent: 1 })).toEqual(inDays(2));
  });
  it('daily in the last 2 days and after the due date', () => {
    expect(nextReminderAt({ now, dueDate: inDays(1), sent: 1 })).toEqual(inDays(1));
    expect(nextReminderAt({ now, dueDate: inDays(-4), sent: 1 })).toEqual(inDays(1));
  });
  it('stops after the maximum number of reminders', () => {
    expect(nextReminderAt({ now, dueDate: null, sent: MAX_REMINDERS })).toBeNull();
  });
  it('still sends the last allowed reminder', () => {
    expect(nextReminderAt({ now, dueDate: null, sent: MAX_REMINDERS - 1 })).toEqual(inDays(3));
  });
  it('switches cadence exactly at the 7 and 2 day boundaries', () => {
    expect(nextReminderAt({ now, dueDate: inDays(7), sent: 1 })).toEqual(inDays(2));
    expect(nextReminderAt({ now, dueDate: inDays(8), sent: 1 })).toEqual(inDays(3));
    expect(nextReminderAt({ now, dueDate: inDays(2), sent: 1 })).toEqual(inDays(1));
    expect(nextReminderAt({ now, dueDate: inDays(3), sent: 1 })).toEqual(inDays(2));
  });
});

describe('daily email cap', () => {
  const sqlWith = (n: number) => (async () => [{ n }]) as unknown as Sql;

  it('subtracts emails already sent from the cap', async () => {
    expect(await capRemaining(sqlWith(4), '10')).toBe(6);
  });
  it('never goes below zero', async () => {
    expect(await capRemaining(sqlWith(25), '10')).toBe(0);
  });
  it('defaults to 90 when no cap is configured', async () => {
    expect(await capRemaining(sqlWith(0))).toBe(90);
  });
});

describe('send windows', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 3, h, 30));
  it('UAE: 05:00-14:00 UTC', () => {
    expect(inSendWindow('ae', at(5))).toBe(true);
    expect(inSendWindow('ae', at(13))).toBe(true);
    expect(inSendWindow('ae', at(14))).toBe(false);
    expect(inSendWindow('ae', at(4))).toBe(false);
  });
  it('Australia wraps past midnight UTC', () => {
    expect(inSendWindow('au', at(23))).toBe(true);
    expect(inSendWindow('au', at(0))).toBe(true);
    expect(inSendWindow('au', at(7))).toBe(true);
    expect(inSendWindow('au', at(8))).toBe(false);
    expect(inSendWindow('au', at(12))).toBe(false);
  });
  it('window edges are decided by the UTC hour, not the minute', () => {
    const atMin = (h: number, m: number) => new Date(Date.UTC(2026, 9, 3, h, m));
    expect(inSendWindow('ae', atMin(4, 59))).toBe(false);
    expect(inSendWindow('ae', atMin(5, 0))).toBe(true);
    expect(inSendWindow('ae', atMin(13, 59))).toBe(true);
    expect(inSendWindow('ae', atMin(14, 0))).toBe(false);
    expect(inSendWindow('au', atMin(22, 59))).toBe(false);
    expect(inSendWindow('au', atMin(23, 0))).toBe(true);
    expect(inSendWindow('au', atMin(7, 59))).toBe(true);
    expect(inSendWindow('au', atMin(8, 0))).toBe(false);
  });
  it('US: 15:00-23:00 UTC', () => {
    expect(inSendWindow('us', at(15))).toBe(true);
    expect(inSendWindow('us', at(23))).toBe(false);
    expect(inSendWindow('us', at(3))).toBe(false);
  });
});

describe('region packs', () => {
  it('every template is well formed and has Arabic labels', () => {
    const ids = new Set<string>();
    for (const t of ALL_TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.id.startsWith(`${t.region}.`)).toBe(true);
      expect(/[\u0600-\u06FF]/.test(t.ar)).toBe(true);
      expect(t.items.some((i) => i.required)).toBe(true);
      expect(new Set(t.items.map((i) => i.key)).size).toBe(t.items.length);
      for (const i of t.items) {
        expect(i.en.length).toBeGreaterThan(0);
        expect(/[\u0600-\u06FF]/.test(i.ar)).toBe(true);
      }
    }
  });
  it('covers every region', () => {
    for (const r of Object.keys(REGIONS)) expect(ALL_TEMPLATES.some((t) => t.region === r)).toBe(true);
  });
});

describe('suggestDueDate', () => {
  const us = getTemplate('us.individual')!.deadline;
  const bas = getTemplate('au.bas')!.deadline;
  const vat = getTemplate('ae.vat')!.deadline;
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it('annual rules roll over after the date has passed', () => {
    expect(suggestDueDate(us, d('2026-02-01'))).toBe('2026-04-15');
    expect(suggestDueDate(us, d('2026-04-15'))).toBe('2026-04-15');
    expect(suggestDueDate(us, d('2026-10-03'))).toBe('2027-04-15');
  });
  it('quarterly rules pick the next date, including across a year end', () => {
    expect(suggestDueDate(vat, d('2026-10-03'))).toBe('2026-10-28');
    expect(suggestDueDate(vat, d('2026-10-29'))).toBe('2027-01-28');
    expect(suggestDueDate(bas, d('2026-11-02'))).toBe('2027-02-28');
  });
  it('a deadline falling on the current day is still suggested', () => {
    expect(suggestDueDate(vat, d('2026-10-28'))).toBe('2026-10-28');
  });
  it('rolls over on the last day of the year', () => {
    expect(suggestDueDate(us, d('2026-12-31'))).toBe('2027-04-15');
    expect(suggestDueDate(vat, d('2026-12-31'))).toBe('2027-01-28');
  });
  it('manual rules give no suggestion', () => {
    expect(suggestDueDate(getTemplate('ae.corporate_tax')!.deadline, d('2026-10-03'))).toBeNull();
  });
});

describe('emails and WhatsApp', () => {
  const base = {
    lang: 'en' as const,
    clientName: 'Sam <b>',
    firmName: 'Acme CPA',
    title: '2026 return',
    link: 'https://docnudge.test/r/abc',
    dueDate: '2027-04-15',
    remaining: 3,
  };

  it('escapes HTML and includes the link in both parts', () => {
    const m = requestEmail({ ...base, kind: 'initial' });
    expect(m.html).toContain('Sam &lt;b&gt;');
    expect(m.html).not.toContain('Sam <b>');
    expect(m.html).toContain(base.link);
    expect(m.text).toContain(base.link);
    expect(m.subject).toContain('Acme CPA');
  });
  it('reminders say how many items are missing', () => {
    const m = requestEmail({ ...base, kind: 'reminder' });
    expect(m.subject.startsWith('Reminder')).toBe(true);
    expect(m.text).toContain('3 required items');
  });
  it('Arabic emails are right-to-left', () => {
    const m = requestEmail({ ...base, lang: 'ar', kind: 'initial' });
    expect(m.html).toContain('dir="rtl"');
    expect(/[\u0600-\u06FF]/.test(m.subject)).toBe(true);
  });
  it('completion email links to the request', () => {
    const m = completeEmail({ lang: 'en', clientName: 'Sam', title: '2026 return', link: 'https://docnudge.test/request/1' });
    expect(m.html).toContain('https://docnudge.test/request/1');
  });
  it('builds WhatsApp links with and without a phone number', () => {
    const text = waMessage('en', { clientName: 'Sam', firmName: 'Acme CPA', title: '2026 return', link: base.link, dueDate: null });
    expect(text).toContain(base.link);
    expect(waLink('971501234567', text).startsWith('https://wa.me/971501234567?text=')).toBe(true);
    expect(waLink(null, text).startsWith('https://wa.me/?text=')).toBe(true);
  });
  it('round-trips Arabic text, quotes and ampersands through the WhatsApp link', () => {
    const text = waMessage('ar', { clientName: 'سامي & أحمد', firmName: 'مكتب "النور"', title: 'إقرار 2026', link: base.link, dueDate: '2026-04-15' });
    const url = waLink('971501234567', text);
    expect(url).not.toMatch(/[\s"&]/);
    expect(new URL(url).searchParams.get('text')).toBe(text);
  });
});

describe('formatDate', () => {
  it('formats en dates in UTC without day shifting', () => {
    expect(formatDate('2026-04-15', 'en')).toBe('15 Apr 2026');
    expect(formatDate('2026-12-31', 'en')).toBe('31 Dec 2026');
  });
  it('formats ar dates in the ar-AE style, differing from en', () => {
    const out = formatDate('2026-04-15', 'ar');
    expect(out.replace(/[\u200e\u200f]/g, '')).toBe('15/04/2026');
    expect(out).not.toBe(formatDate('2026-04-15', 'en'));
  });
});

describe('Dodo webhooks', () => {
  const secret = `whsec_${btoa('unit-test-signing-key-0123456789')}`;
  const body = '{"type":"subscription.active","data":{}}';
  const at = new Date('2026-10-03T10:00:00Z');
  const now = at.getTime() / 1000;
  const headers = (signature: string, timestamp = String(now)) => ({ id: 'msg_1', timestamp, signature });

  it('accepts a signature made by the Standard Webhooks reference library', async () => {
    const sig = new Webhook(secret).sign('msg_1', at, body);
    expect(await verifyWebhook(secret, headers(sig), body, now)).toBe(true);
    expect(await verifyWebhook(secret, headers(`v1,AAAA ${sig}`), body, now)).toBe(true); // any listed signature may match
  });

  it('rejects a changed body, a wrong key, a missing header or an old timestamp', async () => {
    const sig = new Webhook(secret).sign('msg_1', at, body);
    expect(await verifyWebhook(secret, headers(sig), body.replace('active', 'expired'), now)).toBe(false);
    expect(await verifyWebhook(`whsec_${btoa('another-key-another-key-another')}`, headers(sig), body, now)).toBe(false);
    expect(await verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: undefined }, body, now)).toBe(false);
    expect(await verifyWebhook(secret, headers(sig), body, now + 301)).toBe(false);
  });

  it('maps subscription events to plans', () => {
    expect(planForEvent('subscription.renewed', 'active')).toBe('active');
    expect(planForEvent('subscription.past_due', 'past_due')).toBe('past_due');
    expect(planForEvent('subscription.on_hold', 'on_hold')).toBe('canceled');
    expect(planForEvent('subscription.updated', 'expired')).toBe('canceled');
    expect(planForEvent('subscription.updated', 'paused')).toBeNull();
    expect(planForEvent('payment.failed', undefined)).toBeNull();
  });
});

describe('requests CSV export', () => {
  const row = (over: Partial<RequestRow>) =>
    ({ client_name: 'Ann', client_email: 'a@x.com', title: '2026 return', status: 'open', due_date: '2026-04-15', required_done: 2, required_total: 5, reminders_sent: 1, created_at: '2026-03-01T10:00:00Z', ...over }) as RequestRow;

  it('writes a header and one line per request', () => {
    expect(requestsToCsv([row({})])).toBe(
      'client,email,title,status,due_date,required_done,required_total,reminders_sent,created\r\n' + 'Ann,a@x.com,2026 return,open,2026-04-15,2,5,1,2026-03-01\r\n',
    );
  });
  it('quotes commas and quotes, leaves empty fields blank, defuses formulas', () => {
    const csv = requestsToCsv([row({ client_name: 'Smith, "Bob"', client_email: null, due_date: null, title: '=SUM(A1)' })]);
    expect(csv.split('\r\n')[1]).toBe(`"Smith, ""Bob""",,'=SUM(A1),open,,2,5,1,2026-03-01`);
  });
  it('quotes embedded newlines, defuses leading -/@, and treats missing counts as 0', () => {
    const csv = requestsToCsv([row({ client_name: 'Line1\nLine2', title: '-5 refund', client_email: '@evil', required_done: null, required_total: null } as Partial<RequestRow>)]);
    expect(csv.slice(csv.indexOf('\r\n') + 2)).toBe(`"Line1\nLine2",'@evil,'-5 refund,open,2026-04-15,0,0,1,2026-03-01\r\n`);
  });
});
