import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDate } from '../../shared/messages';
import { LangToggle } from '../components/LangToggle';
import { ProgressRail, type Segment } from '../components/ProgressRail';
import { useI18n, type Key, type Lang } from '../i18n';
import { fileSize } from '../lib/format';
import type { ItemStatus } from '../lib/types';

interface PubItem {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  required: boolean;
  status: ItemStatus;
  note: string | null;
  files: { id: string; original_name: string; size_bytes: number }[];
}
interface PubData {
  firmName: string;
  clientName: string;
  title: string;
  dueDate: string | null;
  language: Lang;
  status: string;
  items: PubItem[];
}

const MAX_BYTES = 25 * 1024 * 1024;
const TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};
// Some phones send HEIC photos with an empty MIME type, so fall back to the file extension.
const typeOf = (f: File) => f.type || TYPE_BY_EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';

function Mark({ status }: { status: ItemStatus }) {
  return (
    <span className="mark" aria-hidden="true">
      {status === 'rejected' ? (
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2v6M7 10.5v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : status === 'pending' ? null : (
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </span>
  );
}

export default function ClientUpload() {
  const { token = '' } = useParams();
  const { t, lang, setLang } = useI18n();
  const [data, setData] = useState<PubData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, Key | undefined>>({});
  const langSet = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/${encodeURIComponent(token)}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const d = (await res.json()) as PubData;
    setData(d);
    if (!langSet.current) {
      langSet.current = true;
      setLang(d.language); // the request decides the starting language; the toggle can override it
    }
  }, [token, setLang]);

  useEffect(() => {
    load().catch(() => setNotFound(true));
  }, [load]);

  async function upload(item: PubItem, files: FileList | null) {
    if (!files?.length) return;
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: undefined }));
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setErrors((e) => ({ ...e, [item.id]: 'client_err_large' }));
        break;
      }
      try {
        const res = await fetch(`/api/public/${encodeURIComponent(token)}/items/${item.id}/upload?name=${encodeURIComponent(file.name)}`, {
          method: 'PUT',
          headers: { 'content-type': typeOf(file) },
          body: file,
        });
        if (!res.ok) {
          const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
          setErrors((e) => ({ ...e, [item.id]: code === 'too_large' ? 'client_err_large' : code === 'unsupported_type' ? 'client_err_type' : 'client_err_generic' }));
          break;
        }
      } catch {
        setErrors((e) => ({ ...e, [item.id]: 'client_err_generic' }));
        break;
      }
    }
    await load().catch(() => undefined);
    setBusy(null);
  }

  async function remove(itemId: string, fileId: string) {
    setBusy(itemId);
    await fetch(`/api/public/${encodeURIComponent(token)}/files/${fileId}`, { method: 'DELETE' }).catch(() => undefined);
    await load().catch(() => undefined);
    setBusy(null);
  }

  if (notFound) {
    return (
      <main className="client">
        <h1 className="client-title">{t('client_not_found_title')}</h1>
        <p className="lead">{t('client_not_found_body')}</p>
      </main>
    );
  }
  if (!data) return <main className="client"><p className="hint">…</p></main>;

  const required = data.items.filter((i) => i.required);
  const segments: Segment[] = required.map((i) => (i.status === 'received' || i.status === 'approved' ? 'on' : i.status === 'rejected' ? 'warn' : 'off'));
  const done = segments.filter((s) => s === 'on').length;
  const allDone = required.length > 0 && done === required.length;

  return (
    <main className="client">
      <header className="client-top">
        <span className="client-firm">{data.firmName}</span>
        <LangToggle />
      </header>

      <h1 className="client-title">{data.title}</h1>
      <p className="lead">
        {t('client_greeting', { name: data.clientName })} {t('client_intro', { firm: data.firmName })}
      </p>

      <section className="tally" aria-live="polite">
        <ProgressRail large segments={segments} />
        <p>{t('client_progress', { done, total: required.length })}</p>
        {data.dueDate && <p>{t('client_due', { date: formatDate(data.dueDate, lang) })}</p>}
      </section>

      {allDone && (
        <div className="done-note" role="status">
          <strong>{t('client_done_title')}</strong>
          <p>{t('client_done_body', { firm: data.firmName })}</p>
        </div>
      )}

      <ol className="items">
        {data.items.map((item) => {
          const label = lang === 'ar' && item.label_ar ? item.label_ar : item.label_en;
          const err = errors[item.id];
          return (
            <li key={item.id} className={`item ${item.status}`}>
              <Mark status={item.status} />
              <div className="item-body">
                <p className="item-label">
                  {label}
                  {!item.required && <span className="opt">{t('client_optional')}</span>}
                </p>
                {item.status === 'rejected' && <p className="item-note">{item.note ? t('client_fix', { note: item.note }) : t('client_fix_generic')}</p>}
                {item.files.length > 0 && (
                  <ul className="files">
                    {item.files.map((f) => (
                      <li key={f.id}>
                        <span className="fname">{f.original_name}</span>
                        <span className="hint"> {fileSize(f.size_bytes)}</span>
                        {item.status !== 'approved' && (
                          <button type="button" className="linkish" onClick={() => remove(item.id, f.id)} disabled={busy === item.id}>
                            {t('client_remove')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {err && <p className="hint bad" role="alert">{t(err)}</p>}
              </div>
              {item.status !== 'approved' && (
                <label className={`btn upload ${item.files.length ? 'ghost' : 'primary'}`} aria-busy={busy === item.id}>
                  <input
                    className="vh"
                    type="file"
                    multiple
                    accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.heic,.heif"
                    disabled={busy === item.id}
                    onChange={(e) => {
                      void upload(item, e.target.files);
                      e.target.value = '';
                    }}
                  />
                  {busy === item.id ? t('client_uploading') : item.files.length ? t('client_add_more') : t('client_upload')}
                </label>
              )}
            </li>
          );
        })}
      </ol>

      <footer className="client-foot">{t('client_secure', { firm: data.firmName })}</footer>
    </main>
  );
}
