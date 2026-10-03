import { describe, expect, it } from 'vitest';
import { completeEmail, requestEmail } from '../shared/emailTemplates';
import { waLink, waMessage } from '../shared/messages';
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
    link: 'https://docchase.test/r/abc',
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
    const m = completeEmail({ lang: 'en', clientName: 'Sam', title: '2026 return', link: 'https://docchase.test/request/1' });
    expect(m.html).toContain('https://docchase.test/request/1');
  });
  it('builds WhatsApp links with and without a phone number', () => {
    const text = waMessage('en', { clientName: 'Sam', firmName: 'Acme CPA', title: '2026 return', link: base.link, dueDate: null });
    expect(text).toContain(base.link);
    expect(waLink('971501234567', text).startsWith('https://wa.me/971501234567?text=')).toBe(true);
    expect(waLink(null, text).startsWith('https://wa.me/?text=')).toBe(true);
  });
});
