import type { Lang } from './packs';
import { formatDate } from './messages';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export interface RequestEmailInput {
  kind: 'initial' | 'reminder';
  lang: Lang;
  clientName: string;
  firmName: string;
  title: string;
  link: string;
  dueDate: string | null;
  remaining: number;
}

interface Out { subject: string; html: string; text: string }

function wrap(lang: Lang, heading: string, paragraphs: string[], buttonLabel: string, link: string, footer: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join('');
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#EEF2F4;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#16262D">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px"><tr><td style="padding:28px;text-align:${align}">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(heading)}</h1>${body}
<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#0A6B6B;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:bold">${esc(buttonLabel)}</a></p>
<p style="margin:0;font-size:12px;color:#4B5E67;line-height:1.5">${esc(footer)}</p>
</td></tr></table></body></html>`;
}

export function requestEmail(i: RequestEmailInput): Out {
  const due = i.dueDate ? formatDate(i.dueDate, i.lang) : null;
  if (i.lang === 'ar') {
    const subject = i.kind === 'initial' ? `${i.firmName}: مطلوب مستندات لـ ${i.title}` : `تذكير: ما زالت هناك مستندات مطلوبة لـ ${i.title}`;
    const paras = [
      `مرحبًا ${i.clientName}،`,
      i.kind === 'initial'
        ? `تحتاج ${i.firmName} إلى بعض المستندات منك بخصوص "${i.title}". يستغرق الأمر دقائق ويعمل من هاتفك.`
        : `ما زال ينقصنا ${i.remaining} من المستندات المطلوبة بخصوص "${i.title}".`,
      ...(due ? [`يرجى إرسالها قبل ${due}.`] : []),
    ];
    const footer = 'إذا كان هذا الطلب غير متوقع، تجاهل الرسالة أو تواصل مع مكتبك المحاسبي.';
    return { subject, html: wrap('ar', i.firmName, paras, 'رفع المستندات', i.link, footer), text: `${paras.join('\n\n')}\n\n${i.link}\n\n${footer}` };
  }
  const subject = i.kind === 'initial' ? `${i.firmName}: documents needed for ${i.title}` : `Reminder: documents still needed for ${i.title}`;
  const paras = [
    `Hi ${i.clientName},`,
    i.kind === 'initial'
      ? `${i.firmName} needs a few documents from you for "${i.title}". It takes a few minutes and works from your phone.`
      : `We're still missing ${i.remaining} required ${i.remaining === 1 ? 'item' : 'items'} for "${i.title}".`,
    ...(due ? [`Please send everything by ${due}.`] : []),
  ];
  const footer = "If you weren't expecting this request, ignore this email or contact your accountant.";
  return { subject, html: wrap('en', i.firmName, paras, 'Upload documents', i.link, footer), text: `${paras.join('\n\n')}\n\n${i.link}\n\n${footer}` };
}

export interface CompleteEmailInput { lang: Lang; clientName: string; title: string; link: string }

/** Sent to the firm when a client has uploaded every required item. */
export function completeEmail(i: CompleteEmailInput): Out {
  if (i.lang === 'ar') {
    const subject = `${i.clientName} رفع جميع المستندات المطلوبة`;
    const paras = [`رفع ${i.clientName} كل المستندات المطلوبة لـ "${i.title}".`, 'افتح الطلب لمراجعة الملفات واعتمادها.'];
    return { subject, html: wrap('ar', subject, paras, 'فتح الطلب', i.link, ''), text: `${paras.join('\n\n')}\n\n${i.link}` };
  }
  const subject = `${i.clientName} uploaded all required documents`;
  const paras = [`${i.clientName} has uploaded every required item for "${i.title}".`, 'Open the request to review and approve the files.'];
  return { subject, html: wrap('en', subject, paras, 'Open request', i.link, ''), text: `${paras.join('\n\n')}\n\n${i.link}` };
}
