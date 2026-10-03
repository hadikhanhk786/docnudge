import { neon } from '@neondatabase/serverless';
import type { EmailEnv } from '../../shared/email';
import { capRemaining, deliverRequestEmail, type MailEnv, type Sql } from '../../shared/mailer';
import type { Region } from '../../shared/packs';
import { inSendWindow } from '../../shared/schedule';

interface CronEnv extends EmailEnv, MailEnv {
  DATABASE_URL: string;
}

/** Send due reminders, never more than DAILY_EMAIL_CAP per rolling 24 hours, and only in business hours. */
export async function runReminders(env: CronEnv, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const sql: Sql = neon(env.DATABASE_URL);
  let remaining = await capRemaining(sql, env.DAILY_EMAIL_CAP);
  if (remaining <= 0) return { sent: 0, failed: 0 };

  const due = await sql`
    select r.id, r.client_name, r.client_email, r.language, r.title, r.due_date::text as due_date,
           r.link_version, r.reminders_sent, f.name as firm_name, f.reply_to, f.region
    from requests r join firms f on f.id = r.firm_id
    where r.status = 'open'
      and r.client_email is not null
      and r.initial_sent_at is not null
      and r.next_reminder_at is not null
      and r.next_reminder_at <= now()
      and f.plan in ('trial', 'active')
    order by r.next_reminder_at asc
    limit 200`;

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    if (remaining <= 0) break;
    if (!inSendWindow(row.region as Region, now)) continue; // try again next hour
    try {
      await deliverRequestEmail(sql, env, {
        id: row.id,
        client_name: row.client_name,
        client_email: row.client_email,
        language: row.language,
        title: row.title,
        due_date: row.due_date,
        link_version: Number(row.link_version),
        reminders_sent: Number(row.reminders_sent),
        firm_name: row.firm_name,
        reply_to: row.reply_to,
      }, 'reminder');
      sent++;
      remaining--;
    } catch (err) {
      failed++;
      console.error('reminder failed', row.id, err);
      await sql`update requests set next_reminder_at = now() + interval '6 hours' where id = ${row.id}`; // back off
    }
  }
  return { sent, failed };
}

export default {
  async scheduled(_controller: ScheduledController, env: CronEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runReminders(env).then((r) => console.log('reminders', r)));
  },
  async fetch(): Promise<Response> {
    return new Response('docchase-cron ok');
  },
} satisfies ExportedHandler<CronEnv>;
