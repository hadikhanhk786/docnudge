import { AwsClient } from 'aws4fetch';

// One function, two providers. Switch with EMAIL_PROVIDER = "resend" | "ses". No other code changes.

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export class EmailError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<void> {
  const provider = (env.EMAIL_PROVIDER ?? 'resend').toLowerCase();
  if (provider === 'ses') return sendViaSes(env, msg);
  return sendViaResend(env, msg);
}

async function sendViaResend(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) throw new EmailError(500, 'RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      reply_to: msg.replyTo,
    }),
  });
  if (!res.ok) throw new EmailError(res.status, `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendViaSes(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new EmailError(500, 'AWS credentials are not set');
  const region = env.AWS_REGION ?? 'us-east-1';
  const aws = new AwsClient({ accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, region, service: 'ses' });
  const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      FromEmailAddress: env.EMAIL_FROM,
      Destination: { ToAddresses: [msg.to] },
      ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: msg.html, Charset: 'UTF-8' }, Text: { Data: msg.text, Charset: 'UTF-8' } },
        },
      },
    }),
  });
  if (!res.ok) throw new EmailError(res.status, `SES ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
