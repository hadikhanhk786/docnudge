import { useState } from 'react';
import { waLink, waMessage } from '../../shared/messages';
import { useI18n } from '../i18n';
import { ApiError, useApi } from '../lib/api';
import type { RequestRow } from '../lib/types';

/** Copy link, open WhatsApp with a pre-filled message, or email the client right now. */
export function ClientActions({ req, firmName, onChanged }: { req: RequestRow; firmName: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const [copied, setCopied] = useState(false);
  const [mail, setMail] = useState<'idle' | 'sending' | 'sent' | 'cap' | 'error'>('idle');

  const wa = waLink(
    req.client_phone,
    waMessage(req.language, { clientName: req.client_name, firmName, title: req.title, link: req.link, dueDate: req.due_date }),
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(req.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('', req.link);
    }
  }

  async function email() {
    setMail('sending');
    try {
      await api.post(`/requests/${req.id}/send`);
      setMail('sent');
      onChanged?.();
    } catch (e) {
      setMail(e instanceof ApiError && e.code === 'daily_email_cap' ? 'cap' : 'error');
    }
  }

  return (
    <div className="actions">
      <button type="button" className="btn ghost" onClick={copy}>
        {copied ? t('btn_copied') : t('btn_copy_link')}
      </button>
      <a className="btn ghost" href={wa} target="_blank" rel="noreferrer">
        {t('btn_whatsapp')}
      </a>
      <button type="button" className="btn ghost" onClick={email} disabled={!req.client_email || mail === 'sending' || req.status !== 'open'}>
        {mail === 'sent' ? t('btn_email_sent') : t('btn_email')}
      </button>
      {mail === 'cap' && (
        <p className="hint warn" role="status">
          {t('error_cap')}
        </p>
      )}
      {mail === 'error' && (
        <p className="hint bad" role="alert">
          {t('error_generic')}
        </p>
      )}
    </div>
  );
}
