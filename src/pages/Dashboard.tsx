import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../shared/messages';
import { ClientActions } from '../components/ClientActions';
import { ProgressRail, segmentsFromCounts } from '../components/ProgressRail';
import { useI18n } from '../i18n';
import { useApi } from '../lib/api';
import { todayIso } from '../lib/format';
import type { Firm, RequestRow } from '../lib/types';

export default function Dashboard() {
  const { t, lang } = useI18n();
  const api = useApi();
  const [firm, setFirm] = useState<Firm | null>(null);
  const [emailsLeft, setEmailsLeft] = useState<number | null>(null);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, list] = await Promise.all([
        api.get<{ firm: Firm; emailsLeft: number }>('/me'),
        api.get<{ requests: RequestRow[] }>('/requests'),
      ]);
      setFirm(me.firm);
      setEmailsLeft(me.emailsLeft);
      setRows(list.requests);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="hint bad" role="alert">{t('error_generic')}</p>;
  if (!rows || !firm) return <p className="hint">…</p>;

  return (
    <>
      <div className="page-head">
        <h1>{t('dash_title')}</h1>
        <Link className="btn primary" to="/new">
          {t('btn_new_request')}
        </Link>
      </div>
      {emailsLeft !== null && <p className="hint">{t('emails_left', { n: emailsLeft })}</p>}

      {rows.length === 0 ? (
        <section className="empty">
          <h2>{t('dash_empty_title')}</h2>
          <p>{t('dash_empty_body')}</p>
        </section>
      ) : (
        <ul className="list">
          {rows.map((r) => {
            const total = r.required_total ?? 0;
            const done = r.required_done ?? 0;
            const overdue = r.status === 'open' && r.due_date !== null && r.due_date < todayIso();
            return (
              <li className="row" key={r.id}>
                <div className="row-main">
                  <Link to={`/request/${r.id}`} className="row-title">
                    {r.client_name}
                  </Link>
                  <p className="row-sub">{r.title}</p>
                  <p className="row-meta">
                    {r.status === 'complete' ? (
                      <span className="chip ok">{t('status_complete')}</span>
                    ) : r.due_date ? (
                      <span className={overdue ? 'chip bad' : 'chip off'}>
                        {overdue ? t('overdue', { date: formatDate(r.due_date, lang) }) : t('due', { date: formatDate(r.due_date, lang) })}
                      </span>
                    ) : (
                      <span className="chip off">{t('no_deadline')}</span>
                    )}
                  </p>
                </div>
                <div className="row-progress">
                  <ProgressRail segments={segmentsFromCounts(total, done)} />
                  <p className="row-count">{t('progress', { done, total })}</p>
                </div>
                <ClientActions req={r} firmName={firm.name} onChanged={load} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
