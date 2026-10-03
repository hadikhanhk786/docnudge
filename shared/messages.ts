import type { Lang } from './packs';

export interface MessageInput {
  clientName: string;
  firmName: string;
  title: string;
  link: string;
  dueDate: string | null;
}

export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/** Text the preparer sends over WhatsApp (opened pre-filled with a free click-to-chat link). */
export function waMessage(lang: Lang, i: MessageInput): string {
  if (lang === 'ar') {
    const due = i.dueDate ? ` يرجى إرسالها قبل ${formatDate(i.dueDate, lang)}.` : '';
    return `مرحبًا ${i.clientName}، هنا ${i.firmName}. نحتاج بعض المستندات منك بخصوص "${i.title}". يمكنك رفعها من هاتفك عبر هذا الرابط:\n${i.link}${due}`;
  }
  const due = i.dueDate ? ` Please send them by ${formatDate(i.dueDate, lang)}.` : '';
  return `Hi ${i.clientName}, it's ${i.firmName}. We need a few documents from you for "${i.title}". You can upload them from your phone here:\n${i.link}${due}`;
}

/** wa.me click-to-chat link. Free, no API. Pass digits only (country code included), or null to pick a contact. */
export function waLink(phoneDigits: string | null, text: string): string {
  const base = phoneDigits ? `https://wa.me/${phoneDigits}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}
