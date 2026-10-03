import type { Lang, Region } from '../shared/packs';
import type { MailEnv } from '../shared/mailer';

export interface Env extends MailEnv {
  BUCKET: R2Bucket;
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  TRIAL_REQUEST_LIMIT?: string;
  /** Extra comma-separated origins allowed to call the API (for example preview deployments). */
  EXTRA_ORIGINS?: string;
  /** Dodo Payments: secrets DODO_API_KEY + DODO_WEBHOOK_KEY; vars DODO_ENV (test_mode | live_mode) and product ids. */
  DODO_API_KEY?: string;
  DODO_WEBHOOK_KEY?: string;
  DODO_ENV?: string;
  DODO_PRODUCT_FIRM_MONTHLY?: string;
  DODO_PRODUCT_FIRM_YEARLY?: string;
}

export interface FirmRow {
  id: string;
  owner_user_id: string;
  name: string;
  region: Region;
  language: Lang;
  plan: 'trial' | 'active' | 'past_due' | 'canceled';
  notify_email: string | null;
  reply_to: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  current_period_end: string | null;
}

export type Vars = { userId: string; firm: FirmRow };
