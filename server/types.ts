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
}

export type Vars = { userId: string; firm: FirmRow };
