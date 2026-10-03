import type { NeonQueryFunction } from '@neondatabase/serverless';
import { sendEmail, type EmailEnv } from './email';
import { requestEmail } from './emailTemplates';
import type { Lang } from './packs';
import { nextReminderAt } from './reminders';
import { makeToken } from './tokens';

export type Sql = NeonQueryFunction<false, false>;

export interface MailEnv extends EmailEnv {
  APP_URL: string;
  LINK_SECRET: string;
  DAILY_EMAIL_CAP?: string;
}

export interface ReqForMail {
  id: string;
  client_name: string;
  client_email: string | null;
  language: Lang;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  link_version: number;
  reminders_sent: number;
  firm_name: string;
  reply_to: string | null;
}

export async function buildLink(env: Pick<MailEnv, 'APP_URL' | 'LINK_SECRET'>, requestId: string, version: number): Promise<string> {
  return `${env.APP_URL.replace(/\/+$/, '')}/r/${await makeToken(env.LINK_SECRET, requestId, version)}`;
}

/** Emails left under the daily cap (rolling 24h). Keeps you inside a free-tier limit such as Resend's 100/day. */
export async function capRemaining(sql: Sql, capRaw?: string): Promise<number> {
  const cap = Number(capRaw ?? 90);
  const rows = await sql`select count(*)::int as n from email_log where sent_at > now() - interval '24 hours'`;
  return Math.max(0, cap - Number(rows[0]?.n ?? 0));
}

/** Send the initial email or a reminder to the client, log it, and schedule the next reminder. */
export async function deliverRequestEmail(sql: Sql, env: MailEnv, r: ReqForMail, kind: 'initial' | 'reminder'): Promise<void> {
  if (!r.client_email) throw new Error('Request has no client email');
  const link = await buildLink(env, r.id, r.link_version);
  const missing = await sql`select count(*)::int as n from request_items where request_id = ${r.id} and required and status in ('pending','rejected')`;
  const mail = requestEmail({
    kind,
    lang: r.language,
    clientName: r.client_name,
    firmName: r.firm_name,
    title: r.title,
    link,
    dueDate: r.due_date,
    remaining: Number(missing[0]?.n ?? 0),
  });
  await sendEmail(env, { to: r.client_email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: r.reply_to ?? undefined });

  const now = new Date();
  const sent = kind === 'initial' ? r.reminders_sent : r.reminders_sent + 1;
  const next = nextReminderAt({ now, dueDate: r.due_date ? new Date(`${r.due_date}T00:00:00Z`) : null, sent });
  await sql.transaction([
    sql`insert into email_log (request_id, to_email, kind, provider) values (${r.id}, ${r.client_email}, ${kind}, ${env.EMAIL_PROVIDER ?? 'resend'})`,
    sql`update requests set initial_sent_at = coalesce(initial_sent_at, ${now.toISOString()}), reminders_sent = ${sent}, last_reminder_at = ${now.toISOString()}, next_reminder_at = ${next ? next.toISOString() : null} where id = ${r.id}`,
  ]);
}
