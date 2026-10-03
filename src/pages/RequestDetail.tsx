import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '../../shared/messages';
import { ClientActions } from '../components/ClientActions';
import { ProgressRail, type Segment } from '../components/ProgressRail';
import { useI18n, type Key } from '../i18n';
import { useApi } from '../lib/api';
import { fileSize } from '../lib/format';
import type { Item, ItemStatus, RequestRow } from '../lib/types';

const STATUS_KEY: Record<ItemStatus, Key> = {
  pending: 'item_pending',
  received: 'item_received',
  approved: 'item_approved',
  rejected: 'item_rejected',
};
const STATUS_CLASS: Record<ItemStatus, string> = { pending: 'off', received: 'wait', approved: 'ok', rejected: 'bad' };

export default function RequestDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const api = useApi();
  const nav = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [firmName, setFirmName] = useState('');
  const [data, setData] = useState<{ request: RequestRow; items: Item[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, d] = await Promise.all([
        api.get<{ firm: { name: string } }>('/me'),
        api.get<{ request: RequestRow; items: Item[] }>(`/requests/${id}`),
      ]);
      setFirmName(me.firm.name);
      setData(d);
    } catch {
      setMissing(true);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(itemId: string, status: 'approved' | 'rejected') {
    setError(false);
    try {
      await api.patch(`/requests/${id}/items/${itemId}`, { status, note: status === 'rejected' ? note : undefined });
      setFixing(null);
      setNote('');
      await load();
    } catch {
      setError(true);
    }
  }

  async function rotate() {
    if (!window.confirm(t('detail_rotate_confirm'))) return;
    try {
      const { link } = await api.post<{ link: string }>(`/requests/${id}/rotate-link`);
      setData((d) => (d ? { ...d, request: { ...d.request, link } } : d));
    } catch {
      setError(true);
    }
  }

  async function archive() {
    if (!window.confirm(t('detail_archive_confirm'))) return;
    try {
      await api.patch(`/requests/${id}`, { status: 'archived' });
      nav('/');
    } catch {
      setError(true);
    }
  }

  if (missing) return <p className="hint bad" role="alert">{t('error_generic')}</p>;
  if (!data) return <p className="hint">…</p>;

  const { request: r, items } = data;
  const segments: Segment[] = items
    .filter((i) => i.required)
    .map((i) => (i.status === 'received' || i.status === 'approved' ? 'on' : i.status === 'rejected' ? 'warn' : 'off'));
  const done = segments.filter((s) => s === 'on').length;

  return (
    <>
      <p className="crumb">
        <Link to="/">{t('detail_back')}</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{r.client_name}</h1>
          <p className="row-sub">{r.title}</p>
        </div>
      </div>

      {(notice === 'cap' || notice === 'failed') && (
        <p className="hint warn" role="status">
          {notice === 'cap' ? t('form_email_cap') : t('form_email_failed')}
        </p>
      )}

      <section className="detail-top">
        <ProgressRail large segments={segments} />
        <p className="row-count">{t('progress', { done, total: segments.length })}</p>
        {r.due_date && <p className="row-count">{t('due', { date: formatDate(r.due_date, lang) })}</p>}
        <ClientActions req={r} firmName={firmName} onChanged={load} />
        <p className="link-box" dir="ltr">
          <span className="hint">{t('detail_link')}</span>
          <code>{r.link}</code>
        </p>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={rotate}>
            {t('detail_rotate')}
          </button>
          <button type="button" className="btn ghost" onClick={archive}>
            {t('detail_archive')}
          </button>
        </div>
        {error && <p className="hint bad" role="alert">{t('error_generic')}</p>}
      </section>

      <h2 className="section-title">{t('detail_checklist')}</h2>
      <ul className="list">
        {items.map((item) => (
          <li className="row item-row" key={item.id}>
            <div className="row-main">
              <p className="row-title plain">
                {lang === 'ar' && item.label_ar ? item.label_ar : item.label_en}
                {!item.required && <span className="opt">{t('detail_optional')}</span>}
              </p>
              <p className="row-meta">
                <span className={`chip ${STATUS_CLASS[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
              </p>
              {item.status === 'rejected' && item.note && <p className="hint">{item.note}</p>}
              {item.files.length === 0 ? (
                <p className="hint">{t('detail_no_files')}</p>
              ) : (
                <ul className="files">
                  {item.files.map((f) => (
                    <li key={f.id}>
                      <button type="button" className="linkish" onClick={() => api.download(`/files/${f.id}`, f.original_name).catch(() => setError(true))}>
                        {t('detail_download')}: {f.original_name}
                      </button>
                      <span className="hint"> {fileSize(Number(f.size_bytes))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {item.status === 'received' && fixing !== item.id && (
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => review(item.id, 'approved')}>
                  {t('detail_approve')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setFixing(item.id)}>
                  {t('detail_needs_fix')}
                </button>
              </div>
            )}
            {fixing === item.id && (
              <div className="fix-box">
                <label htmlFor={`note-${item.id}`}>{t('detail_fix_note')}</label>
                <input id={`note-${item.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                <div className="actions">
                  <button type="button" className="btn primary" disabled={!note.trim()} onClick={() => review(item.id, 'rejected')}>
                    {t('detail_send_note')}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setFixing(null)}>
                    {t('detail_cancel')}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
