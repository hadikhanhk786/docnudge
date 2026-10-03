import type { Lang, Region } from '../../shared/packs';
export type { Lang, Region };

export interface Firm {
  id: string;
  name: string;
  region: Region;
  language: Lang;
  plan: 'trial' | 'active' | 'past_due' | 'canceled';
  notify_email: string | null;
  reply_to: string | null;
  billing_customer_id: string | null;
  current_period_end: string | null;
}

export type ItemStatus = 'pending' | 'received' | 'approved' | 'rejected';

export interface FileInfo {
  id: string;
  item_id: string;
  original_name: string;
  size_bytes: number;
}

export interface Item {
  id: string;
  position: number;
  key: string;
  label_en: string;
  label_ar: string | null;
  required: boolean;
  status: ItemStatus;
  note: string | null;
  files: FileInfo[];
}

export interface RequestRow {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  language: Lang;
  template_id: string;
  title: string;
  due_date: string | null;
  status: 'open' | 'complete' | 'archived';
  initial_sent_at: string | null;
  reminders_sent: number;
  next_reminder_at: string | null;
  created_at: string;
  link: string;
  required_total?: number;
  required_done?: number;
}
